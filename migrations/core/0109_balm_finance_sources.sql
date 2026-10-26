-- Owner-recorded allocated source amounts; never live processor or accounting truth.
CREATE TABLE bm_finance_sources (
 id TEXT PRIMARY KEY, client_id TEXT NOT NULL REFERENCES bm_clients(id),
 kind TEXT NOT NULL CHECK(kind IN ('charge','payout','accounting')),
 amount_cents INTEGER NOT NULL CHECK(amount_cents>0),
 fee_cents INTEGER NOT NULL DEFAULT 0 CHECK(fee_cents>=0),
 occurred_on TEXT NOT NULL, reference TEXT NOT NULL UNIQUE,
 source_reference TEXT NOT NULL, evidence TEXT NOT NULL,
 recorded_by TEXT NOT NULL, recorded_at TEXT NOT NULL
);
CREATE TRIGGER bm_finance_sources_fixed BEFORE UPDATE ON bm_finance_sources BEGIN SELECT RAISE(ABORT,'original_record_is_immutable'); END;
CREATE TRIGGER bm_finance_sources_epoch AFTER INSERT ON bm_finance_sources BEGIN UPDATE bm_retention_epoch SET version=version+1 WHERE id=1; END;
CREATE TRIGGER bm_finance_sources_live BEFORE INSERT ON bm_finance_sources BEGIN SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM bm_clients WHERE id=NEW.client_id AND erased_at IS NULL) THEN RAISE(ABORT,'bm_assert') END; END;
CREATE TRIGGER bm_finance_sources_kept BEFORE DELETE ON bm_finance_sources WHEN NOT EXISTS(SELECT 1 FROM bm_retention_scope s JOIN bm_retention_permits p ON p.preview_id=s.preview_id WHERE s.table_name='bm_finance_sources' AND s.record_rowid=OLD.rowid) BEGIN SELECT RAISE(ABORT,'finance_original_kept'); END;
CREATE TRIGGER bm_finance_sources_retain_client BEFORE UPDATE OF erased_at ON bm_clients WHEN NEW.erased_at IS NOT NULL AND EXISTS(SELECT 1 FROM bm_finance_sources WHERE client_id=NEW.id) BEGIN SELECT RAISE(ABORT,'bm_assert'); END;
