-- Keep the original journal day and tender classification through authorized erasure.
ALTER TABLE bm_destroyed_invoices ADD COLUMN approved_at TEXT;
ALTER TABLE bm_destroyed_invoices ADD COLUMN voided_at TEXT;
ALTER TABLE bm_destroyed_payments ADD COLUMN tender_method TEXT CHECK(tender_method IN ('cash','check','bank','external'));
ALTER TABLE bm_destroyed_payments ADD COLUMN accounting_prefix TEXT CHECK(accounting_prefix IN ('payment','payer'));
ALTER TABLE bm_destroyed_payments ADD COLUMN payer_batch_id TEXT;
