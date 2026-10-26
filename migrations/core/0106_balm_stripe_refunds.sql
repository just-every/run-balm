-- PAY-002: original receipts remain fixed; refunds are separate processor facts.
ALTER TABLE bm_card_payments ADD COLUMN refunded_cents INTEGER NOT NULL DEFAULT 0 CHECK(refunded_cents>=0);
CREATE TABLE bm_card_refunds (
 id TEXT PRIMARY KEY, payment_id TEXT NOT NULL REFERENCES bm_card_payments(id), client_id TEXT NOT NULL REFERENCES bm_clients(id),
 account_id TEXT NOT NULL, customer_id TEXT NOT NULL, payment_intent TEXT NOT NULL, charge_id TEXT NOT NULL,
 amount_cents INTEGER NOT NULL CHECK(amount_cents BETWEEN 1 AND 10000000), reason TEXT NOT NULL,
 source_json TEXT NOT NULL, sha256 TEXT NOT NULL, prepared_by TEXT NOT NULL, prepared_at TEXT NOT NULL,
 status TEXT NOT NULL DEFAULT 'prepared' CHECK(status IN ('prepared','approved','attempted','uncertain','confirmed','failed','superseded')),
 approved_by TEXT, approver_id TEXT, approved_at TEXT, attempted_at TEXT,
 provider_refund_id TEXT UNIQUE, provider_status TEXT, confirmed_at TEXT, receipt_base64 TEXT
);
CREATE UNIQUE INDEX bm_card_refunds_active ON bm_card_refunds(payment_id) WHERE status IN ('prepared','approved','attempted','uncertain');
CREATE INDEX bm_card_refunds_client ON bm_card_refunds(client_id,prepared_at);
CREATE TABLE bm_card_refund_allocations (
 id TEXT PRIMARY KEY, refund_id TEXT NOT NULL REFERENCES bm_card_refunds(id),
 payment_id TEXT NOT NULL REFERENCES bm_card_payments(id), invoice_id TEXT NOT NULL REFERENCES bm_invoices(id),
 amount_cents INTEGER NOT NULL CHECK(amount_cents>0), UNIQUE(refund_id,invoice_id)
);
-- Every invoice balance includes the reversal without editing the original payment.
DROP VIEW bm_invoice_payments;
CREATE VIEW bm_invoice_payments AS
 SELECT id,invoice_id,amount_cents,reference,recorded_by,recorded_at,card_payment_id,account_entry_id FROM bm_payments
 UNION ALL SELECT l.id,l.invoice_id,CASE l.kind WHEN 'recoupment' THEN -l.amount_cents ELSE l.paid_cents END,
 'payer:'||b.payer_id||':'||b.reference||':'||l.id,b.closed_by,b.closed_at,NULL,NULL
 FROM bm_payer_payment_lines l JOIN bm_payer_payment_batches b ON b.id=l.batch_id
 WHERE b.status='closed' AND (l.kind='recoupment' OR (l.kind='payment' AND l.paid_cents>0))
 UNION ALL SELECT a.id,a.invoice_id,-a.amount_cents,'stripe-refund:'||r.provider_refund_id||':'||a.invoice_id,
 r.approved_by,r.confirmed_at,a.payment_id,NULL
 FROM bm_card_refund_allocations a JOIN bm_card_refunds r ON r.id=a.refund_id WHERE r.status='confirmed';

CREATE TRIGGER bm_card_refund_basis_fixed BEFORE UPDATE ON bm_card_refunds
 WHEN NEW.id IS NOT OLD.id OR NEW.payment_id IS NOT OLD.payment_id OR NEW.client_id IS NOT OLD.client_id
 OR NEW.account_id IS NOT OLD.account_id OR NEW.customer_id IS NOT OLD.customer_id OR NEW.payment_intent IS NOT OLD.payment_intent
 OR NEW.charge_id IS NOT OLD.charge_id OR NEW.amount_cents IS NOT OLD.amount_cents OR NEW.reason IS NOT OLD.reason
 OR NEW.source_json IS NOT OLD.source_json OR NEW.sha256 IS NOT OLD.sha256 OR NEW.prepared_by IS NOT OLD.prepared_by OR NEW.prepared_at IS NOT OLD.prepared_at
 OR (OLD.approved_at IS NOT NULL AND (NEW.approved_at IS NOT OLD.approved_at OR NEW.approved_by IS NOT OLD.approved_by OR NEW.approver_id IS NOT OLD.approver_id))
 OR (OLD.attempted_at IS NOT NULL AND NEW.attempted_at IS NOT OLD.attempted_at)
 OR (OLD.provider_refund_id IS NOT NULL AND NEW.provider_refund_id IS NOT OLD.provider_refund_id)
 OR OLD.status IN ('confirmed','failed','superseded')
 BEGIN SELECT RAISE(ABORT,'stripe_refund_fixed'); END;
CREATE TRIGGER bm_card_refund_kept BEFORE DELETE ON bm_card_refunds
 WHEN NOT EXISTS(SELECT 1 FROM bm_retention_scope s JOIN bm_retention_permits p ON p.preview_id=s.preview_id WHERE s.table_name='bm_card_refunds' AND s.record_rowid=OLD.rowid)
 BEGIN SELECT RAISE(ABORT,'stripe_refund_retained'); END;
CREATE TRIGGER bm_card_refund_allocation_fixed BEFORE UPDATE ON bm_card_refund_allocations BEGIN SELECT RAISE(ABORT,'stripe_refund_fixed'); END;
CREATE TRIGGER bm_card_refund_allocation_kept BEFORE DELETE ON bm_card_refund_allocations
 WHEN NOT EXISTS(SELECT 1 FROM bm_retention_scope s JOIN bm_retention_permits p ON p.preview_id=s.preview_id WHERE s.table_name='bm_card_refund_allocations' AND s.record_rowid=OLD.rowid)
 BEGIN SELECT RAISE(ABORT,'stripe_refund_retained'); END;
CREATE TRIGGER bm_card_refund_credit_limit BEFORE UPDATE OF applied_cents,refunded_cents ON bm_card_payments
 WHEN NEW.applied_cents+NEW.refunded_cents>NEW.amount_cents BEGIN SELECT RAISE(ABORT,'stripe_refund_credit_exceeded'); END;
-- An in-flight refund's source cannot be spent on another invoice.
CREATE TRIGGER bm_card_refund_allocation_reservation BEFORE INSERT ON bm_payments
 WHEN NEW.card_payment_id IS NOT NULL AND EXISTS(SELECT 1 FROM bm_card_refunds WHERE payment_id=NEW.card_payment_id AND status IN ('approved','attempted','uncertain'))
 BEGIN SELECT RAISE(ABORT,'stripe_refund_pending'); END;
CREATE TRIGGER bm_retention_epoch_card_refunds_insert AFTER INSERT ON bm_card_refunds BEGIN UPDATE bm_retention_epoch SET version=version+1 WHERE id=1; END;
CREATE TRIGGER bm_retention_epoch_card_refunds_update AFTER UPDATE ON bm_card_refunds BEGIN UPDATE bm_retention_epoch SET version=version+1 WHERE id=1; END;
CREATE TRIGGER bm_retention_epoch_card_refunds_delete AFTER DELETE ON bm_card_refunds BEGIN UPDATE bm_retention_epoch SET version=version+1 WHERE id=1; END;
CREATE TRIGGER bm_retention_epoch_card_refund_allocations_insert AFTER INSERT ON bm_card_refund_allocations BEGIN UPDATE bm_retention_epoch SET version=version+1 WHERE id=1; END;
CREATE TRIGGER bm_retention_epoch_card_refund_allocations_delete AFTER DELETE ON bm_card_refund_allocations BEGIN UPDATE bm_retention_epoch SET version=version+1 WHERE id=1; END;
