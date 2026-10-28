-- Historical invoices preserve source facts, never issue a second bill.
CREATE TABLE bm_movein_invoices (
 id TEXT PRIMARY KEY, job_id TEXT NOT NULL REFERENCES bm_movein_jobs(id),
 client_id TEXT NOT NULL REFERENCES bm_clients(id), source_id TEXT NOT NULL,
 reference TEXT NOT NULL, issued_on TEXT NOT NULL,
 billed_cents INTEGER NOT NULL CHECK(billed_cents>=0),
 balance_cents INTEGER NOT NULL CHECK(balance_cents>=0 AND balance_cents<=billed_cents),
 imported_at TEXT NOT NULL, currency TEXT NOT NULL DEFAULT 'USD' CHECK(currency='USD'),
 UNIQUE(job_id,source_id)
);
CREATE INDEX bm_movein_invoices_client ON bm_movein_invoices(client_id);
CREATE TRIGGER bm_movein_invoices_fixed BEFORE UPDATE ON bm_movein_invoices BEGIN SELECT RAISE(ABORT,'imported_records_read_only'); END;
CREATE TRIGGER bm_movein_invoices_kept BEFORE DELETE ON bm_movein_invoices
 WHEN (SELECT state FROM bm_movein_jobs WHERE id=OLD.job_id)<>'undoing'
 AND NOT EXISTS(SELECT 1 FROM bm_retention_scope s JOIN bm_retention_permits p ON p.preview_id=s.preview_id WHERE s.table_name='bm_movein_invoices' AND s.record_rowid=OLD.rowid)
 BEGIN SELECT RAISE(ABORT,'imported_records_retained'); END;
CREATE TRIGGER bm_movein_invoices_insert_epoch AFTER INSERT ON bm_movein_invoices BEGIN UPDATE bm_retention_epoch SET version=version+1 WHERE id=1; END;
CREATE TRIGGER bm_movein_invoices_delete_epoch AFTER DELETE ON bm_movein_invoices BEGIN UPDATE bm_retention_epoch SET version=version+1 WHERE id=1; END;

CREATE TABLE bm_destroyed_movein_invoices(id TEXT PRIMARY KEY,issued_on TEXT NOT NULL,billed_cents INTEGER NOT NULL,balance_cents INTEGER NOT NULL);
