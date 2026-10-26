CREATE TABLE bm_payment_tenders (
 payment_id TEXT PRIMARY KEY REFERENCES bm_payments(id) ON DELETE CASCADE,
 method TEXT NOT NULL CHECK(method IN ('cash','check','bank','external'))
);
CREATE TABLE bm_accounting_connection (
 id INTEGER PRIMARY KEY CHECK(id=1), realm_id TEXT NOT NULL, sandbox INTEGER NOT NULL,
 company_name TEXT NOT NULL DEFAULT '', credentials TEXT NOT NULL, accounts TEXT NOT NULL, mappings TEXT,
 version INTEGER NOT NULL DEFAULT 1, connected_at TEXT NOT NULL, connected_by TEXT NOT NULL,
 refresh_lease TEXT, refresh_until INTEGER
);
CREATE TABLE bm_accounting_batches (
 id TEXT PRIMARY KEY, realm_id TEXT NOT NULL, sandbox INTEGER NOT NULL, day TEXT NOT NULL,
 connection_version INTEGER NOT NULL, payload TEXT NOT NULL, sources TEXT NOT NULL,
 sha256 TEXT NOT NULL, status TEXT NOT NULL CHECK(status IN ('prepared','sending','confirmed','conflict')),
 prepared_at TEXT NOT NULL, approved_by TEXT, attempted_at TEXT,
 provider_id TEXT, confirmed_at TEXT, error TEXT
);
CREATE TABLE bm_accounting_claims (
 realm_id TEXT NOT NULL, sandbox INTEGER NOT NULL, source_id TEXT NOT NULL,
 source_json TEXT NOT NULL, batch_id TEXT NOT NULL REFERENCES bm_accounting_batches(id),
 PRIMARY KEY(realm_id,sandbox,source_id)
);
CREATE TRIGGER bm_accounting_batch_fixed BEFORE UPDATE ON bm_accounting_batches
 WHEN NEW.payload IS NOT OLD.payload OR NEW.sources IS NOT OLD.sources OR NEW.sha256 IS NOT OLD.sha256
 OR NEW.realm_id IS NOT OLD.realm_id OR NEW.sandbox IS NOT OLD.sandbox OR NEW.day IS NOT OLD.day
 OR NEW.connection_version IS NOT OLD.connection_version OR NEW.id IS NOT OLD.id
 BEGIN SELECT RAISE(ABORT,'accounting_original_fixed'); END;

CREATE TRIGGER bm_payment_tenders_epoch AFTER INSERT ON bm_payment_tenders BEGIN UPDATE bm_retention_epoch SET version=version+1 WHERE id=1; END;
