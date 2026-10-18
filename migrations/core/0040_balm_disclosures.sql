-- Completed releases outside Balm; never rewrite the historical accounting.
CREATE TABLE bm_disclosures (
 id TEXT PRIMARY KEY, client_id TEXT NOT NULL REFERENCES bm_clients(id),
 recipient TEXT NOT NULL, purpose TEXT NOT NULL, basis TEXT NOT NULL,
 records TEXT NOT NULL, released_at TEXT NOT NULL,
 recorded_at TEXT NOT NULL, recorded_by TEXT NOT NULL
);
CREATE INDEX bm_disclosures_patient_time ON bm_disclosures(client_id,released_at,id);
CREATE TRIGGER bm_disclosures_no_update BEFORE UPDATE ON bm_disclosures
 BEGIN SELECT RAISE(ABORT,'disclosure_append_only'); END;
CREATE TRIGGER bm_disclosures_no_delete BEFORE DELETE ON bm_disclosures
 BEGIN SELECT RAISE(ABORT,'disclosure_append_only'); END;
