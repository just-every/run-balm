-- PAY-004: proposals and approvals are separate immutable facts. A recorded
-- external receipt/refund never impersonates a Stripe operation.
CREATE TABLE bm_account_entries (
 id TEXT PRIMARY KEY, client_id TEXT NOT NULL REFERENCES bm_clients(id),
 invoice_id TEXT REFERENCES bm_invoices(id), credit_id TEXT REFERENCES bm_account_entries(id),
 kind TEXT NOT NULL CHECK(kind IN ('adjustment','write_off','credit','refund')),
 amount_cents INTEGER NOT NULL CHECK(amount_cents>0 AND amount_cents<=10000000),
 reason TEXT NOT NULL, reference TEXT NOT NULL UNIQUE, occurred_on TEXT NOT NULL,
 prepared_by TEXT NOT NULL, prepared_at TEXT NOT NULL, sha256 TEXT NOT NULL,
 CHECK((kind IN ('adjustment','write_off') AND invoice_id IS NOT NULL AND credit_id IS NULL)
 OR (kind='credit' AND invoice_id IS NULL AND credit_id IS NULL)
 OR (kind='refund' AND invoice_id IS NULL AND credit_id IS NOT NULL))
);
CREATE INDEX bm_account_entries_client ON bm_account_entries(client_id);
CREATE TABLE bm_account_postings (
 entry_id TEXT PRIMARY KEY REFERENCES bm_account_entries(id), approved_by TEXT NOT NULL,
 posted_at TEXT NOT NULL, sha256 TEXT NOT NULL, receipt_base64 TEXT
);
ALTER TABLE bm_payments ADD COLUMN account_entry_id TEXT REFERENCES bm_account_entries(id);
CREATE INDEX bm_payments_account_entry ON bm_payments(account_entry_id);
CREATE VIEW bm_posted_account_entries AS SELECT e.*,p.approved_by,p.posted_at,p.receipt_base64
 FROM bm_account_entries e JOIN bm_account_postings p ON p.entry_id=e.id;
CREATE VIEW bm_invoice_adjustments AS
 SELECT id,invoice_id,amount_cents,reason,recorded_by,recorded_at,'insurance' AS source FROM bm_insurance_adjustments
 UNION ALL SELECT id,invoice_id,amount_cents,reason,approved_by,posted_at,'manual' FROM bm_posted_account_entries WHERE kind IN ('adjustment','write_off');
CREATE VIEW bm_credit_balances AS SELECT e.*,
 COALESCE((SELECT SUM(p.amount_cents) FROM bm_payments p WHERE p.account_entry_id=e.id),0) AS allocated_cents,
 COALESCE((SELECT SUM(r.amount_cents) FROM bm_posted_account_entries r WHERE r.credit_id=e.id AND r.kind='refund'),0) AS refunded_cents,
 e.amount_cents-COALESCE((SELECT SUM(p.amount_cents) FROM bm_payments p WHERE p.account_entry_id=e.id),0)
 -COALESCE((SELECT SUM(r.amount_cents) FROM bm_posted_account_entries r WHERE r.credit_id=e.id AND r.kind='refund'),0) AS remaining_cents
 FROM bm_posted_account_entries e WHERE e.kind='credit';
ALTER TABLE bm_balance_reminders ADD COLUMN statement_mode INTEGER NOT NULL DEFAULT 0 CHECK(statement_mode IN (0,1));
CREATE TABLE bm_patient_statements (
 id TEXT PRIMARY KEY,client_id TEXT NOT NULL REFERENCES bm_clients(id),reminder_id TEXT NOT NULL REFERENCES bm_balance_reminders(id),
 due_on TEXT NOT NULL,amount_cents INTEGER NOT NULL,original_base64 TEXT NOT NULL,issued_at TEXT NOT NULL,
 UNIQUE(reminder_id,due_on)
);

CREATE TRIGGER bm_account_entries_fixed BEFORE UPDATE ON bm_account_entries BEGIN SELECT RAISE(ABORT,'account_record_fixed'); END;
CREATE TRIGGER bm_account_entries_kept BEFORE DELETE ON bm_account_entries WHEN NOT EXISTS(SELECT 1 FROM bm_retention_scope s JOIN bm_retention_permits p ON p.preview_id=s.preview_id WHERE s.table_name='bm_account_entries' AND s.record_rowid=OLD.rowid) BEGIN SELECT RAISE(ABORT,'account_record_retained'); END;
CREATE TRIGGER bm_retention_epoch_account_entries_insert AFTER INSERT ON bm_account_entries BEGIN UPDATE bm_retention_epoch SET version=version+1 WHERE id=1; END;
CREATE TRIGGER bm_retention_epoch_account_entries_delete AFTER DELETE ON bm_account_entries BEGIN UPDATE bm_retention_epoch SET version=version+1 WHERE id=1; END;

CREATE TRIGGER bm_account_postings_fixed BEFORE UPDATE ON bm_account_postings BEGIN SELECT RAISE(ABORT,'account_record_fixed'); END;
CREATE TRIGGER bm_account_postings_kept BEFORE DELETE ON bm_account_postings WHEN NOT EXISTS(SELECT 1 FROM bm_retention_scope s JOIN bm_retention_permits p ON p.preview_id=s.preview_id WHERE s.table_name='bm_account_postings' AND s.record_rowid=OLD.rowid) BEGIN SELECT RAISE(ABORT,'account_record_retained'); END;
CREATE TRIGGER bm_retention_epoch_account_postings_insert AFTER INSERT ON bm_account_postings BEGIN UPDATE bm_retention_epoch SET version=version+1 WHERE id=1; END;
CREATE TRIGGER bm_retention_epoch_account_postings_delete AFTER DELETE ON bm_account_postings BEGIN UPDATE bm_retention_epoch SET version=version+1 WHERE id=1; END;

CREATE TRIGGER bm_patient_statements_fixed BEFORE UPDATE ON bm_patient_statements BEGIN SELECT RAISE(ABORT,'account_record_fixed'); END;
CREATE TRIGGER bm_patient_statements_kept BEFORE DELETE ON bm_patient_statements WHEN NOT EXISTS(SELECT 1 FROM bm_retention_scope s JOIN bm_retention_permits p ON p.preview_id=s.preview_id WHERE s.table_name='bm_patient_statements' AND s.record_rowid=OLD.rowid) BEGIN SELECT RAISE(ABORT,'account_record_retained'); END;
CREATE TRIGGER bm_retention_epoch_patient_statements_insert AFTER INSERT ON bm_patient_statements BEGIN UPDATE bm_retention_epoch SET version=version+1 WHERE id=1; END;
CREATE TRIGGER bm_retention_epoch_patient_statements_delete AFTER DELETE ON bm_patient_statements BEGIN UPDATE bm_retention_epoch SET version=version+1 WHERE id=1; END;

ALTER TABLE bm_destroyed_payments ADD COLUMN account_entry_id TEXT;
CREATE TABLE bm_destroyed_account_entries(id TEXT PRIMARY KEY,credit_id TEXT,kind TEXT NOT NULL,amount_cents INTEGER NOT NULL,posted_at TEXT NOT NULL);
CREATE TRIGGER bm_destroyed_account_entries_fixed BEFORE UPDATE ON bm_destroyed_account_entries BEGIN SELECT RAISE(ABORT,'anonymous_business_fact_fixed'); END;
CREATE TRIGGER bm_destroyed_account_entries_kept BEFORE DELETE ON bm_destroyed_account_entries BEGIN SELECT RAISE(ABORT,'anonymous_business_fact_fixed'); END;
