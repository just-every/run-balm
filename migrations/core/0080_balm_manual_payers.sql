-- INS-012: drafts are inert; closed manual EOB batches are fixed money facts.
CREATE TABLE bm_payer_payment_batches (
 id TEXT PRIMARY KEY,payer_id TEXT NOT NULL REFERENCES bm_payers(id),reference TEXT NOT NULL,
 deposit_on TEXT NOT NULL,amount_cents INTEGER NOT NULL CHECK(amount_cents>=0),
 status TEXT NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','closed')),version INTEGER NOT NULL DEFAULT 1,
 created_by TEXT NOT NULL,created_at TEXT NOT NULL,closed_by TEXT,closed_at TEXT,
 paid_cents INTEGER NOT NULL DEFAULT 0,interest_cents INTEGER NOT NULL DEFAULT 0,recouped_cents INTEGER NOT NULL DEFAULT 0,
 UNIQUE(payer_id,reference)
);
CREATE TABLE bm_payer_payment_lines (
 id TEXT PRIMARY KEY,batch_id TEXT NOT NULL REFERENCES bm_payer_payment_batches(id),
 kind TEXT NOT NULL CHECK(kind IN ('payment','interest','recoupment')),
 claim_id TEXT REFERENCES bm_claims(id),client_id TEXT REFERENCES bm_clients(id),invoice_id TEXT REFERENCES bm_invoices(id),
 billed_cents INTEGER NOT NULL DEFAULT 0,allowed_cents INTEGER NOT NULL DEFAULT 0,paid_cents INTEGER NOT NULL DEFAULT 0,
 adjustment_cents INTEGER NOT NULL DEFAULT 0,pr_cents INTEGER NOT NULL DEFAULT 0,
 amount_cents INTEGER NOT NULL DEFAULT 0,adjudication TEXT NOT NULL DEFAULT 'paid' CHECK(adjudication IN ('paid','denied')),
 adjustments TEXT NOT NULL DEFAULT '[]',remarks TEXT NOT NULL DEFAULT '[]',payer_control TEXT NOT NULL DEFAULT '',
 reason TEXT NOT NULL DEFAULT '',created_at TEXT NOT NULL,
 CHECK((kind='interest' AND claim_id IS NULL AND client_id IS NULL AND invoice_id IS NULL AND amount_cents>0)
 OR (kind IN ('payment','recoupment') AND claim_id IS NOT NULL AND client_id IS NOT NULL AND invoice_id IS NOT NULL))
);
CREATE INDEX bm_payer_payment_lines_claim ON bm_payer_payment_lines(claim_id);
CREATE INDEX bm_payer_payment_lines_batch ON bm_payer_payment_lines(batch_id);
CREATE TABLE bm_payer_eobs (
 batch_id TEXT PRIMARY KEY REFERENCES bm_payer_payment_batches(id),filename TEXT NOT NULL,mime TEXT NOT NULL,
 content_base64 TEXT NOT NULL,sha256 TEXT NOT NULL,uploaded_by TEXT NOT NULL,uploaded_at TEXT NOT NULL
);
-- Every invoice balance uses the same signed cash projection; the original cash
-- receipt is never edited or deleted by a later payer takeback.
CREATE VIEW bm_invoice_payments AS
 SELECT id,invoice_id,amount_cents,reference,recorded_by,recorded_at,card_payment_id,account_entry_id FROM bm_payments
 UNION ALL SELECT l.id,l.invoice_id,CASE l.kind WHEN 'recoupment' THEN -l.amount_cents ELSE l.paid_cents END,
 'payer:'||b.payer_id||':'||b.reference||':'||l.id,b.closed_by,b.closed_at,NULL,NULL
 FROM bm_payer_payment_lines l JOIN bm_payer_payment_batches b ON b.id=l.batch_id
 WHERE b.status='closed' AND (l.kind='recoupment' OR (l.kind='payment' AND l.paid_cents>0));
DROP VIEW bm_invoice_adjustments;
CREATE VIEW bm_invoice_adjustments AS
 SELECT id,invoice_id,amount_cents,reason,recorded_by,recorded_at,'insurance' AS source FROM bm_insurance_adjustments
 UNION ALL SELECT id,invoice_id,amount_cents,reason,approved_by,posted_at,'manual' FROM bm_posted_account_entries WHERE kind IN ('adjustment','write_off')
 UNION ALL SELECT l.id,l.invoice_id,l.adjustment_cents,'Paper EOB · '||l.adjustments,b.closed_by,b.closed_at,'insurance'
 FROM bm_payer_payment_lines l JOIN bm_payer_payment_batches b ON b.id=l.batch_id
 WHERE b.status='closed' AND l.kind='payment' AND l.adjustment_cents>0;
CREATE TRIGGER bm_payer_batch_fixed BEFORE UPDATE ON bm_payer_payment_batches WHEN OLD.status='closed' BEGIN SELECT RAISE(ABORT,'payer_batch_fixed'); END;
CREATE TRIGGER bm_payer_line_fixed BEFORE UPDATE ON bm_payer_payment_lines BEGIN SELECT RAISE(ABORT,'payer_line_fixed'); END;
CREATE TRIGGER bm_payer_line_kept BEFORE DELETE ON bm_payer_payment_lines WHEN (SELECT status FROM bm_payer_payment_batches WHERE id=OLD.batch_id)='closed'
 AND NOT EXISTS(SELECT 1 FROM bm_retention_scope s JOIN bm_retention_permits p ON p.preview_id=s.preview_id WHERE s.table_name='bm_payer_payment_lines' AND s.record_rowid=OLD.rowid)
 BEGIN SELECT RAISE(ABORT,'payer_line_retained'); END;
CREATE TRIGGER bm_payer_line_open BEFORE INSERT ON bm_payer_payment_lines WHEN (SELECT status FROM bm_payer_payment_batches WHERE id=NEW.batch_id)<>'draft' BEGIN SELECT RAISE(ABORT,'payer_batch_fixed'); END;
CREATE TRIGGER bm_retention_epoch_payer_line_insert AFTER INSERT ON bm_payer_payment_lines BEGIN UPDATE bm_retention_epoch SET version=version+1 WHERE id=1; END;
CREATE TRIGGER bm_retention_epoch_payer_line_delete AFTER DELETE ON bm_payer_payment_lines BEGIN UPDATE bm_retention_epoch SET version=version+1 WHERE id=1; END;
CREATE TRIGGER bm_retention_epoch_payer_eob_insert AFTER INSERT ON bm_payer_eobs BEGIN UPDATE bm_retention_epoch SET version=version+1 WHERE id=1; END;
CREATE TRIGGER bm_retention_epoch_payer_eob_delete AFTER DELETE ON bm_payer_eobs BEGIN UPDATE bm_retention_epoch SET version=version+1 WHERE id=1; END;
