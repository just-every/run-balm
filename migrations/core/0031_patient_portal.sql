-- Patient identity is independent of the clinic's operator sessions. Only
-- hashes of emailed credentials and session cookies are retained.
CREATE TABLE bm_portal_links (
 id TEXT PRIMARY KEY, token_hash TEXT NOT NULL UNIQUE,
 client_id TEXT NOT NULL REFERENCES bm_clients(id), client_version INTEGER NOT NULL,
 email TEXT NOT NULL, created_at TEXT NOT NULL, expires_at TEXT NOT NULL,
 used_at TEXT, revoked_at TEXT
);
CREATE INDEX bm_portal_links_client ON bm_portal_links(client_id);
CREATE TABLE bm_portal_sessions (
 id TEXT PRIMARY KEY, token_hash TEXT NOT NULL UNIQUE,
 client_id TEXT NOT NULL REFERENCES bm_clients(id), client_version INTEGER NOT NULL,
 email TEXT NOT NULL, created_at TEXT NOT NULL, expires_at TEXT NOT NULL, revoked_at TEXT
);
CREATE INDEX bm_portal_sessions_client ON bm_portal_sessions(client_id);
CREATE TABLE bm_portal_rates (
 key_hash TEXT NOT NULL, window INTEGER NOT NULL, attempts INTEGER NOT NULL,
 PRIMARY KEY(key_hash,window)
);
-- Changes to a patient's file invalidate old links and sessions immediately.
CREATE TRIGGER bm_portal_client_changed AFTER UPDATE ON bm_clients
 WHEN NEW.version IS NOT OLD.version OR NEW.email IS NOT OLD.email OR NEW.erased_at IS NOT OLD.erased_at
 BEGIN
 UPDATE bm_portal_links SET revoked_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE client_id=NEW.id AND revoked_at IS NULL;
 UPDATE bm_portal_sessions SET revoked_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE client_id=NEW.id AND revoked_at IS NULL;
 END;

-- Practice-made exercise assignments and daily completion are clinical records.
-- Assignment content stays fixed; corrections are a new assignment.
CREATE TABLE bm_home_exercises (
 id TEXT PRIMARY KEY, client_id TEXT NOT NULL REFERENCES bm_clients(id),
 title TEXT NOT NULL, sets INTEGER NOT NULL CHECK(sets BETWEEN 1 AND 100),
 reps TEXT NOT NULL, frequency TEXT NOT NULL, instructions TEXT NOT NULL,
 image TEXT, assigned_by TEXT NOT NULL, assigned_at TEXT NOT NULL,
 seen_at TEXT, done_at TEXT, archived_at TEXT
);
CREATE INDEX bm_home_exercises_client ON bm_home_exercises(client_id,assigned_at);
CREATE TABLE bm_home_exercise_done (
 exercise_id TEXT NOT NULL REFERENCES bm_home_exercises(id),
 day TEXT NOT NULL, done_at TEXT NOT NULL, PRIMARY KEY(exercise_id,day)
);
CREATE TRIGGER bm_home_exercise_fixed BEFORE UPDATE ON bm_home_exercises
 WHEN NEW.id IS NOT OLD.id OR NEW.client_id IS NOT OLD.client_id OR NEW.title IS NOT OLD.title
 OR NEW.sets IS NOT OLD.sets OR NEW.reps IS NOT OLD.reps OR NEW.frequency IS NOT OLD.frequency
 OR NEW.instructions IS NOT OLD.instructions OR NEW.image IS NOT OLD.image
 OR NEW.assigned_by IS NOT OLD.assigned_by OR NEW.assigned_at IS NOT OLD.assigned_at
 BEGIN SELECT RAISE(ABORT,'exercise_content_fixed'); END;
CREATE TRIGGER bm_home_exercise_kept BEFORE DELETE ON bm_home_exercises
 BEGIN SELECT RAISE(ABORT,'exercises_are_health_records'); END;
CREATE TRIGGER bm_home_exercise_done_kept BEFORE DELETE ON bm_home_exercise_done
 BEGIN SELECT RAISE(ABORT,'exercise_completions_are_health_records'); END;
CREATE TRIGGER bm_home_exercise_done_fixed BEFORE UPDATE ON bm_home_exercise_done
 BEGIN SELECT RAISE(ABORT,'exercise_completions_are_health_records'); END;
CREATE TRIGGER bm_home_exercise_client_retained BEFORE UPDATE OF erased_at ON bm_clients
 WHEN NEW.erased_at IS NOT NULL AND EXISTS(SELECT 1 FROM bm_home_exercises WHERE client_id=OLD.id)
 BEGIN SELECT RAISE(ABORT,'clients_with_health_records_are_retained'); END;
-- A payment link opened from a portal session cannot outlive that session.
CREATE TRIGGER bm_portal_session_payment_revoked AFTER UPDATE OF revoked_at ON bm_portal_sessions
 WHEN NEW.revoked_at IS NOT NULL BEGIN
 UPDATE bm_pay_links SET expires_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE created_by='patient-portal:'||NEW.id;
 END;
