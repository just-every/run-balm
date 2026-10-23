CREATE TABLE bm_practice_exercises (
 id TEXT PRIMARY KEY, title TEXT NOT NULL, title_es TEXT NOT NULL,
 instructions TEXT NOT NULL, instructions_es TEXT NOT NULL,
 discipline TEXT NOT NULL CHECK(discipline IN ('pt','ot','slp')),
 region TEXT NOT NULL, position TEXT NOT NULL, equipment TEXT NOT NULL,
 sets INTEGER NOT NULL CHECK(sets BETWEEN 1 AND 100), reps TEXT NOT NULL,
 hold_seconds INTEGER NOT NULL CHECK(hold_seconds BETWEEN 0 AND 600), frequency TEXT NOT NULL,
 image TEXT NOT NULL, source TEXT NOT NULL, license TEXT NOT NULL,
 created_at TEXT NOT NULL, created_by TEXT NOT NULL, content_sha256 TEXT NOT NULL UNIQUE
);
ALTER TABLE bm_home_exercises ADD COLUMN library_id TEXT;
ALTER TABLE bm_home_exercises ADD COLUMN instructions_es TEXT;
ALTER TABLE bm_home_exercises ADD COLUMN title_es TEXT;
ALTER TABLE bm_home_exercises ADD COLUMN exercise_license TEXT;
ALTER TABLE bm_home_exercises ADD COLUMN exercise_source TEXT;
CREATE TRIGGER bm_library_assignment_fixed BEFORE UPDATE ON bm_home_exercises
 WHEN NEW.library_id IS NOT OLD.library_id OR NEW.instructions_es IS NOT OLD.instructions_es OR NEW.title_es IS NOT OLD.title_es
 OR NEW.exercise_license IS NOT OLD.exercise_license OR NEW.exercise_source IS NOT OLD.exercise_source
 BEGIN SELECT RAISE(ABORT,'exercise_content_fixed'); END;
