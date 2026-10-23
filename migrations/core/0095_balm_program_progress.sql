ALTER TABLE bm_home_exercises ADD COLUMN source_note_id TEXT REFERENCES bm_notes(id);
ALTER TABLE bm_home_exercises ADD COLUMN hold_seconds INTEGER NOT NULL DEFAULT 0 CHECK(hold_seconds BETWEEN 0 AND 600);
ALTER TABLE bm_home_exercise_done ADD COLUMN pain INTEGER CHECK(pain BETWEEN 0 AND 10);
CREATE TRIGGER bm_exercise_dosage_fixed BEFORE UPDATE ON bm_home_exercises
 WHEN NEW.source_note_id IS NOT OLD.source_note_id OR NEW.hold_seconds IS NOT OLD.hold_seconds
 BEGIN SELECT RAISE(ABORT,'exercise_content_fixed'); END;
