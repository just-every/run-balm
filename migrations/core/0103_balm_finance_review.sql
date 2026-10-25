-- Immutable owner-supplied settlement observations; never payer adjudications.
CREATE TABLE bm_finance_observations (
 id TEXT PRIMARY KEY, client_id TEXT NOT NULL REFERENCES bm_clients(id),
 kind TEXT NOT NULL CHECK(kind IN ('eft','card')), amount_cents INTEGER NOT NULL CHECK(amount_cents>0),
 occurred_on TEXT NOT NULL, reference TEXT NOT NULL UNIQUE, source_reference TEXT NOT NULL,
 evidence TEXT NOT NULL, recorded_by TEXT NOT NULL, recorded_at TEXT NOT NULL
);
CREATE TABLE bm_finance_reviews (
 id TEXT PRIMARY KEY, client_id TEXT NOT NULL REFERENCES bm_clients(id),
 observation_id TEXT NOT NULL REFERENCES bm_finance_observations(id), kind TEXT NOT NULL,
 payload TEXT NOT NULL, sha256 TEXT NOT NULL, prepared_by TEXT NOT NULL, prepared_at TEXT NOT NULL,
 approved_by TEXT, approved_at TEXT, UNIQUE(observation_id,kind)
);
CREATE TRIGGER bm_finance_observations_epoch_insert AFTER INSERT ON bm_finance_observations BEGIN UPDATE bm_retention_epoch SET version=version+1 WHERE id=1; END;
CREATE TRIGGER bm_finance_observations_immutable BEFORE UPDATE ON bm_finance_observations BEGIN SELECT RAISE(ABORT,'original_record_is_immutable'); END;
CREATE TRIGGER bm_finance_observations_client_live BEFORE INSERT ON bm_finance_observations BEGIN SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM bm_clients WHERE id=NEW.client_id AND erased_at IS NULL) THEN RAISE(ABORT,'bm_assert') END; END;
CREATE TRIGGER bm_finance_reviews_epoch_insert AFTER INSERT ON bm_finance_reviews BEGIN UPDATE bm_retention_epoch SET version=version+1 WHERE id=1; END;
CREATE TRIGGER bm_finance_reviews_client_live BEFORE INSERT ON bm_finance_reviews BEGIN SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM bm_clients WHERE id=NEW.client_id AND erased_at IS NULL) THEN RAISE(ABORT,'bm_assert') END; END;
CREATE TRIGGER bm_finance_observations_retain_client BEFORE UPDATE OF erased_at ON bm_clients WHEN NEW.erased_at IS NOT NULL AND EXISTS(SELECT 1 FROM bm_finance_observations WHERE client_id=NEW.id) BEGIN SELECT RAISE(ABORT,'bm_assert'); END;
