CREATE TABLE bm_calls (
  id TEXT PRIMARY KEY,
  client_id TEXT NOT NULL REFERENCES bm_clients(id),
  direction TEXT NOT NULL CHECK(direction IN ('incoming','outgoing')),
  occurred_at TEXT NOT NULL,
  staff_id TEXT REFERENCES bm_staff(id),
  staff_name TEXT NOT NULL,
  recorded_by TEXT NOT NULL,
  recorded_at TEXT NOT NULL,
  disposition TEXT NOT NULL,
  route TEXT NOT NULL CHECK(route IN ('practitioner','front_desk')),
  practitioner_id TEXT REFERENCES bm_staff(id),
  CHECK(route<>'front_desk' OR practitioner_id IS NULL)
);
CREATE INDEX bm_calls_client_time ON bm_calls(client_id,occurred_at,id);
CREATE TRIGGER bm_calls_fixed_update BEFORE UPDATE ON bm_calls BEGIN SELECT RAISE(ABORT,'calls_are_health_records'); END;
CREATE TRIGGER bm_calls_fixed_delete BEFORE DELETE ON bm_calls
  WHEN NOT EXISTS(SELECT 1 FROM bm_retention_scope s JOIN bm_retention_permits p ON p.preview_id=s.preview_id WHERE s.table_name='bm_calls' AND s.record_rowid=OLD.rowid)
  BEGIN SELECT RAISE(ABORT,'calls_are_health_records'); END;
CREATE TRIGGER bm_retention_epoch_calls_insert AFTER INSERT ON bm_calls BEGIN UPDATE bm_retention_epoch SET version=version+1 WHERE id=1; END;
CREATE TRIGGER bm_retention_epoch_calls_delete AFTER DELETE ON bm_calls BEGIN UPDATE bm_retention_epoch SET version=version+1 WHERE id=1; END;
