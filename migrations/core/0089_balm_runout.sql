-- Reviewed legacy receivables stay separate from newly issued Balm invoices.
CREATE TABLE bm_migrated_claims (
 id TEXT PRIMARY KEY, source TEXT NOT NULL, source_claim TEXT NOT NULL,
 client_id TEXT NOT NULL REFERENCES bm_clients(id), payer_id TEXT NOT NULL REFERENCES bm_payers(id),
 source_hash TEXT NOT NULL, patient_control TEXT NOT NULL, payer_control TEXT NOT NULL, service_date TEXT NOT NULL,
 billed_cents INTEGER NOT NULL CHECK(billed_cents>0), initial_cents INTEGER NOT NULL CHECK(initial_cents>=0),
 balance_cents INTEGER NOT NULL CHECK(balance_cents>=0), status TEXT NOT NULL,
 imported_by TEXT NOT NULL, imported_at TEXT NOT NULL, version INTEGER NOT NULL DEFAULT 1,
 UNIQUE(source,source_claim)
);
CREATE INDEX bm_migrated_controls ON bm_migrated_claims(payer_id,patient_control,payer_control);
CREATE TABLE bm_runout_postings (
 id TEXT PRIMARY KEY, import_id TEXT REFERENCES bm_insurance_imports(id),
 paper_batch_id TEXT REFERENCES bm_payer_payment_batches(id), migrated_id TEXT NOT NULL REFERENCES bm_migrated_claims(id),
 paid_cents INTEGER NOT NULL, adjustment_cents INTEGER NOT NULL, pr_cents INTEGER NOT NULL,
 detail TEXT NOT NULL, created_at TEXT NOT NULL, UNIQUE(import_id,migrated_id), UNIQUE(paper_batch_id,migrated_id), CHECK((import_id IS NULL)<>(paper_batch_id IS NULL))
);
CREATE TABLE bm_remittance_suspense (
 id TEXT PRIMARY KEY, import_id TEXT REFERENCES bm_insurance_imports(id),
 paper_batch_id TEXT REFERENCES bm_payer_payment_batches(id), payer_id TEXT NOT NULL REFERENCES bm_payers(id), patient_control TEXT NOT NULL,
 paid_cents INTEGER NOT NULL CHECK(paid_cents>=0), detail TEXT NOT NULL, reason TEXT NOT NULL,
 resolved_claim TEXT REFERENCES bm_migrated_claims(id), created_at TEXT NOT NULL,
 UNIQUE(import_id,patient_control), UNIQUE(paper_batch_id,patient_control), CHECK((import_id IS NULL)<>(paper_batch_id IS NULL))
);
CREATE TABLE bm_runout_closures (id TEXT PRIMARY KEY, closed_by TEXT NOT NULL, closed_at TEXT NOT NULL);
-- Numeric deposit custody does not retain patient metadata.
CREATE TABLE bm_runout_deposits (import_id TEXT PRIMARY KEY REFERENCES bm_insurance_imports(id),native_cents INTEGER NOT NULL CHECK(native_cents>=0));
CREATE TRIGGER bm_migrated_claims_epoch_insert AFTER INSERT ON bm_migrated_claims BEGIN UPDATE bm_retention_epoch SET version=version+1 WHERE id=1; END;
CREATE TRIGGER bm_migrated_claims_epoch_update AFTER UPDATE ON bm_migrated_claims BEGIN UPDATE bm_retention_epoch SET version=version+1 WHERE id=1; END;
CREATE TRIGGER bm_migrated_claims_epoch_delete AFTER DELETE ON bm_migrated_claims BEGIN UPDATE bm_retention_epoch SET version=version+1 WHERE id=1; END;
CREATE TRIGGER bm_migrated_claims_kept BEFORE DELETE ON bm_migrated_claims WHEN NOT EXISTS(SELECT 1 FROM bm_retention_scope s JOIN bm_retention_permits p ON p.preview_id=s.preview_id WHERE s.table_name='bm_migrated_claims' AND s.record_rowid=OLD.rowid) BEGIN SELECT RAISE(ABORT,'runout_record_retained'); END;
CREATE TRIGGER bm_runout_postings_epoch_insert AFTER INSERT ON bm_runout_postings BEGIN UPDATE bm_retention_epoch SET version=version+1 WHERE id=1; END;
CREATE TRIGGER bm_runout_postings_epoch_update AFTER UPDATE ON bm_runout_postings BEGIN UPDATE bm_retention_epoch SET version=version+1 WHERE id=1; END;
CREATE TRIGGER bm_runout_postings_epoch_delete AFTER DELETE ON bm_runout_postings BEGIN UPDATE bm_retention_epoch SET version=version+1 WHERE id=1; END;
CREATE TRIGGER bm_runout_postings_kept BEFORE DELETE ON bm_runout_postings WHEN NOT EXISTS(SELECT 1 FROM bm_retention_scope s JOIN bm_retention_permits p ON p.preview_id=s.preview_id WHERE s.table_name='bm_runout_postings' AND s.record_rowid=OLD.rowid) BEGIN SELECT RAISE(ABORT,'runout_record_retained'); END;
CREATE TRIGGER bm_remittance_suspense_epoch_insert AFTER INSERT ON bm_remittance_suspense BEGIN UPDATE bm_retention_epoch SET version=version+1 WHERE id=1; END;
CREATE TRIGGER bm_remittance_suspense_epoch_update AFTER UPDATE ON bm_remittance_suspense BEGIN UPDATE bm_retention_epoch SET version=version+1 WHERE id=1; END;
CREATE TRIGGER bm_remittance_suspense_epoch_delete AFTER DELETE ON bm_remittance_suspense BEGIN UPDATE bm_retention_epoch SET version=version+1 WHERE id=1; END;
CREATE TRIGGER bm_remittance_suspense_kept BEFORE DELETE ON bm_remittance_suspense WHEN NOT EXISTS(SELECT 1 FROM bm_retention_scope s JOIN bm_retention_permits p ON p.preview_id=s.preview_id WHERE s.table_name='bm_remittance_suspense' AND s.record_rowid=OLD.rowid) BEGIN SELECT RAISE(ABORT,'runout_record_retained'); END;
ALTER TABLE bm_migrated_claims ADD COLUMN native_claim_id TEXT REFERENCES bm_claims(id);
ALTER TABLE bm_migrated_claims ADD COLUMN transferred_cents INTEGER NOT NULL DEFAULT 0;
CREATE UNIQUE INDEX bm_runout_native_claim ON bm_migrated_claims(native_claim_id) WHERE native_claim_id IS NOT NULL;
-- Opening settled amounts are explicitly labelled source facts, never an invented ERA.
CREATE TABLE bm_runout_opening_credits (
 id TEXT PRIMARY KEY, migrated_id TEXT NOT NULL UNIQUE REFERENCES bm_migrated_claims(id),
 invoice_id TEXT NOT NULL REFERENCES bm_invoices(id), amount_cents INTEGER NOT NULL CHECK(amount_cents>0),
 recorded_by TEXT NOT NULL, recorded_at TEXT NOT NULL
);
DROP VIEW bm_invoice_adjustments;
CREATE VIEW bm_invoice_adjustments AS
 SELECT id,invoice_id,amount_cents,reason,recorded_by,recorded_at,'insurance' AS source FROM bm_insurance_adjustments
 UNION ALL SELECT id,invoice_id,amount_cents,reason,approved_by,posted_at,'manual' FROM bm_posted_account_entries WHERE kind IN ('adjustment','write_off')
 UNION ALL SELECT l.id,l.invoice_id,COALESCE(c.amount_cents,l.adjustment_cents),'Paper EOB · '||l.adjustments,b.closed_by,b.closed_at,'insurance'
 FROM bm_payer_payment_lines l JOIN bm_payer_payment_batches b ON b.id=l.batch_id LEFT JOIN bm_cob_manual_reductions c ON c.line_id=l.id
 WHERE b.status='closed' AND l.kind='payment' AND COALESCE(c.amount_cents,l.adjustment_cents)>0
 UNION ALL SELECT id,invoice_id,amount_cents,'Incumbent amount settled before cutover',recorded_by,recorded_at,'insurance' FROM bm_runout_opening_credits;
CREATE TRIGGER bm_runout_opening_credits_fixed BEFORE UPDATE ON bm_runout_opening_credits BEGIN SELECT RAISE(ABORT,'runout_original_fixed'); END;
CREATE TRIGGER bm_runout_opening_credits_kept BEFORE DELETE ON bm_runout_opening_credits WHEN NOT EXISTS(SELECT 1 FROM bm_retention_scope s JOIN bm_retention_permits p ON p.preview_id=s.preview_id WHERE s.table_name='bm_runout_opening_credits' AND s.record_rowid=OLD.rowid) BEGIN SELECT RAISE(ABORT,'runout_record_retained'); END;
ALTER TABLE bm_runout_closures ADD COLUMN reopened_at TEXT;
ALTER TABLE bm_runout_closures ADD COLUMN reopened_by TEXT;
CREATE TABLE bm_runout_paper_lines (
 id TEXT PRIMARY KEY,batch_id TEXT NOT NULL REFERENCES bm_payer_payment_batches(id),
 migrated_id TEXT REFERENCES bm_migrated_claims(id),client_id TEXT REFERENCES bm_clients(id),
 paid_cents INTEGER NOT NULL CHECK(paid_cents>=0),detail TEXT NOT NULL CHECK(json_valid(detail)),reason TEXT NOT NULL,created_at TEXT NOT NULL
);
CREATE TRIGGER bm_runout_paper_lines_fixed BEFORE UPDATE ON bm_runout_paper_lines BEGIN SELECT RAISE(ABORT,'paper_original_fixed'); END;
CREATE TRIGGER bm_runout_paper_lines_kept BEFORE DELETE ON bm_runout_paper_lines WHEN (SELECT status FROM bm_payer_payment_batches WHERE id=OLD.batch_id)='closed' AND NOT EXISTS(SELECT 1 FROM bm_retention_scope s JOIN bm_retention_permits p ON p.preview_id=s.preview_id WHERE s.table_name='bm_runout_paper_lines' AND s.record_rowid=OLD.rowid) BEGIN SELECT RAISE(ABORT,'runout_record_retained'); END;
