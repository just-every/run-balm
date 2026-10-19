-- CHART-005 objective measures: structured entries recorded in a treatment note.
-- They lock with the note's signature and leave only through an approved
-- HIPAA-002 destruction.
CREATE TABLE bm_measures (
 id TEXT PRIMARY KEY, note_id TEXT NOT NULL REFERENCES bm_notes(id), client_id TEXT NOT NULL REFERENCES bm_clients(id),
 kind TEXT NOT NULL CHECK(kind IN ('rom','mmt','girth','balance','gait','score','flowsheet')),
 name TEXT NOT NULL, side TEXT NOT NULL CHECK(side IN ('left','right','both','none')), value REAL NOT NULL, unit TEXT NOT NULL,
 sets INTEGER, reps INTEGER, recorded_by TEXT NOT NULL REFERENCES bm_staff(id), recorded_at TEXT NOT NULL
);
CREATE INDEX bm_measures_note ON bm_measures(note_id,recorded_at);
CREATE INDEX bm_measures_client ON bm_measures(client_id);
CREATE TRIGGER bm_measure_unsigned BEFORE INSERT ON bm_measures
 WHEN (SELECT signed_at FROM bm_notes WHERE id=NEW.note_id) IS NOT NULL BEGIN SELECT RAISE(ABORT,'note_locked'); END;
CREATE TRIGGER bm_measure_fixed BEFORE UPDATE ON bm_measures BEGIN SELECT RAISE(ABORT,'note_locked'); END;
CREATE TRIGGER bm_measure_kept BEFORE DELETE ON bm_measures
 WHEN (SELECT signed_at FROM bm_notes WHERE id=OLD.note_id) IS NOT NULL
  AND NOT EXISTS(SELECT 1 FROM bm_retention_scope s JOIN bm_retention_permits p ON p.preview_id=s.preview_id WHERE s.table_name='bm_measures' AND s.record_rowid=OLD.rowid)
 BEGIN SELECT RAISE(ABORT,'note_locked'); END;
CREATE TRIGGER bm_retention_epoch_measures_insert AFTER INSERT ON bm_measures BEGIN UPDATE bm_retention_epoch SET version=version+1 WHERE id=1; END;
CREATE TRIGGER bm_retention_epoch_measures_update AFTER UPDATE ON bm_measures BEGIN UPDATE bm_retention_epoch SET version=version+1 WHERE id=1; END;
CREATE TRIGGER bm_retention_epoch_measures_delete AFTER DELETE ON bm_measures BEGIN UPDATE bm_retention_epoch SET version=version+1 WHERE id=1; END;
