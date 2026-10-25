-- Clinician-selected episode cadence; patient answers retain their published form.
CREATE TABLE bm_outcome_schedules (
 id TEXT PRIMARY KEY,client_id TEXT NOT NULL REFERENCES bm_clients(id),episode_id TEXT NOT NULL REFERENCES bm_episodes(id),
 form_id TEXT REFERENCES bm_intake_forms(id),exercise_ids TEXT NOT NULL CHECK(json_valid(exercise_ids)),checkins INTEGER NOT NULL CHECK(checkins IN(0,1)),
 cadence_days INTEGER NOT NULL CHECK(cadence_days BETWEEN 1 AND 365),response_days INTEGER NOT NULL CHECK(response_days BETWEEN 0 AND 30),
 max_cycles INTEGER NOT NULL CHECK(max_cycles BETWEEN 1 AND 52),next_due TEXT NOT NULL,consent_record TEXT NOT NULL,
 created_by TEXT NOT NULL,created_at TEXT NOT NULL,stopped_at TEXT,stopped_by TEXT,version INTEGER NOT NULL DEFAULT 1
);
CREATE TABLE bm_outcome_requests (
 id TEXT PRIMARY KEY,schedule_id TEXT NOT NULL REFERENCES bm_outcome_schedules(id),client_id TEXT NOT NULL REFERENCES bm_clients(id),
 episode_id TEXT NOT NULL REFERENCES bm_episodes(id),form_id TEXT REFERENCES bm_intake_forms(id),due_at TEXT NOT NULL,created_at TEXT NOT NULL,
 UNIQUE(schedule_id,due_at)
);
CREATE TABLE bm_outcome_attempts (
 id TEXT PRIMARY KEY,request_id TEXT NOT NULL REFERENCES bm_outcome_requests(id),client_id TEXT NOT NULL REFERENCES bm_clients(id),
 kind TEXT NOT NULL CHECK(kind IN('initial','followup')),digest TEXT NOT NULL,recipient TEXT NOT NULL,attempted_at TEXT NOT NULL,
 approved_by TEXT NOT NULL,consent_record TEXT NOT NULL,state TEXT NOT NULL DEFAULT 'sending',UNIQUE(request_id,kind)
);
CREATE TABLE bm_outcome_responses (
 id TEXT PRIMARY KEY,request_id TEXT NOT NULL UNIQUE REFERENCES bm_outcome_requests(id),client_id TEXT NOT NULL REFERENCES bm_clients(id),
 answers TEXT NOT NULL CHECK(json_valid(answers)),scores TEXT NOT NULL CHECK(json_valid(scores)),checkin TEXT NOT NULL CHECK(json_valid(checkin)),submitted_at TEXT NOT NULL
);
CREATE TABLE bm_outcome_briefs (
 id TEXT PRIMARY KEY,client_id TEXT NOT NULL REFERENCES bm_clients(id),episode_id TEXT NOT NULL REFERENCES bm_episodes(id),
 payload TEXT NOT NULL CHECK(json_valid(payload)),sha256 TEXT NOT NULL,prepared_by TEXT NOT NULL,prepared_at TEXT NOT NULL
);
CREATE TRIGGER bm_outcome_request_fixed BEFORE UPDATE ON bm_outcome_requests BEGIN SELECT RAISE(ABORT,'outcome_original_fixed'); END;
CREATE TRIGGER bm_outcome_response_fixed BEFORE UPDATE ON bm_outcome_responses BEGIN SELECT RAISE(ABORT,'outcome_original_fixed'); END;
CREATE TRIGGER bm_outcome_brief_fixed BEFORE UPDATE ON bm_outcome_briefs BEGIN SELECT RAISE(ABORT,'outcome_original_fixed'); END;
CREATE TRIGGER bm_outcome_schedule_fixed BEFORE UPDATE ON bm_outcome_schedules
 WHEN NEW.client_id IS NOT OLD.client_id OR NEW.episode_id IS NOT OLD.episode_id OR NEW.form_id IS NOT OLD.form_id OR NEW.exercise_ids IS NOT OLD.exercise_ids OR NEW.checkins IS NOT OLD.checkins OR NEW.cadence_days IS NOT OLD.cadence_days OR NEW.response_days IS NOT OLD.response_days OR NEW.max_cycles IS NOT OLD.max_cycles OR NEW.consent_record IS NOT OLD.consent_record OR NEW.created_by IS NOT OLD.created_by OR NEW.created_at IS NOT OLD.created_at
 BEGIN SELECT RAISE(ABORT,'outcome_original_fixed'); END;
CREATE TRIGGER bm_outcome_schedule_episode BEFORE INSERT ON bm_outcome_schedules BEGIN
 SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM bm_episodes e JOIN bm_clients c ON c.id=e.client_id WHERE e.id=NEW.episode_id AND e.client_id=NEW.client_id AND e.closed_at IS NULL AND c.erased_at IS NULL) THEN RAISE(ABORT,'bm_assert') END;
END;
CREATE TRIGGER bm_outcome_request_episode BEFORE INSERT ON bm_outcome_requests BEGIN
 SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM bm_outcome_schedules s JOIN bm_episodes e ON e.id=s.episode_id WHERE s.id=NEW.schedule_id AND s.client_id=NEW.client_id AND s.episode_id=NEW.episode_id AND s.form_id IS NEW.form_id AND s.stopped_at IS NULL AND e.closed_at IS NULL) THEN RAISE(ABORT,'bm_assert') END;
END;
CREATE TRIGGER bm_outcome_response_patient BEFORE INSERT ON bm_outcome_responses BEGIN SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM bm_outcome_requests WHERE id=NEW.request_id AND client_id=NEW.client_id) THEN RAISE(ABORT,'bm_assert') END; END;
CREATE TRIGGER bm_outcome_schedule_epoch_insert AFTER INSERT ON bm_outcome_schedules BEGIN UPDATE bm_retention_epoch SET version=version+1 WHERE id=1; END;
CREATE TRIGGER bm_outcome_schedule_epoch_update AFTER UPDATE ON bm_outcome_schedules BEGIN UPDATE bm_retention_epoch SET version=version+1 WHERE id=1; END;
CREATE TRIGGER bm_outcome_request_epoch_insert AFTER INSERT ON bm_outcome_requests BEGIN UPDATE bm_retention_epoch SET version=version+1 WHERE id=1; END;
CREATE TRIGGER bm_outcome_attempt_epoch_insert AFTER INSERT ON bm_outcome_attempts BEGIN UPDATE bm_retention_epoch SET version=version+1 WHERE id=1; END;
CREATE TRIGGER bm_outcome_response_epoch_insert AFTER INSERT ON bm_outcome_responses BEGIN UPDATE bm_retention_epoch SET version=version+1 WHERE id=1; END;
CREATE TRIGGER bm_outcome_brief_epoch_insert AFTER INSERT ON bm_outcome_briefs BEGIN UPDATE bm_retention_epoch SET version=version+1 WHERE id=1; END;
CREATE TRIGGER bm_outcome_attempt_fixed BEFORE UPDATE ON bm_outcome_attempts WHEN NEW.id IS NOT OLD.id OR NEW.request_id IS NOT OLD.request_id OR NEW.client_id IS NOT OLD.client_id OR NEW.kind IS NOT OLD.kind OR NEW.digest IS NOT OLD.digest OR NEW.recipient IS NOT OLD.recipient OR NEW.attempted_at IS NOT OLD.attempted_at OR NEW.approved_by IS NOT OLD.approved_by OR NEW.consent_record IS NOT OLD.consent_record BEGIN SELECT RAISE(ABORT,'outcome_original_fixed'); END;
CREATE TRIGGER bm_outcome_schedules_kept BEFORE DELETE ON bm_outcome_schedules WHEN NOT EXISTS(SELECT 1 FROM bm_retention_scope s JOIN bm_retention_permits p ON p.preview_id=s.preview_id WHERE s.table_name='bm_outcome_schedules' AND s.record_rowid=OLD.rowid) BEGIN SELECT RAISE(ABORT,'outcome_record_requires_retention_review'); END;
CREATE TRIGGER bm_outcome_schedules_epoch_delete AFTER DELETE ON bm_outcome_schedules BEGIN UPDATE bm_retention_epoch SET version=version+1 WHERE id=1; END;
CREATE TRIGGER bm_outcome_requests_kept BEFORE DELETE ON bm_outcome_requests WHEN NOT EXISTS(SELECT 1 FROM bm_retention_scope s JOIN bm_retention_permits p ON p.preview_id=s.preview_id WHERE s.table_name='bm_outcome_requests' AND s.record_rowid=OLD.rowid) BEGIN SELECT RAISE(ABORT,'outcome_record_requires_retention_review'); END;
CREATE TRIGGER bm_outcome_requests_epoch_delete AFTER DELETE ON bm_outcome_requests BEGIN UPDATE bm_retention_epoch SET version=version+1 WHERE id=1; END;
CREATE TRIGGER bm_outcome_attempts_kept BEFORE DELETE ON bm_outcome_attempts WHEN NOT EXISTS(SELECT 1 FROM bm_retention_scope s JOIN bm_retention_permits p ON p.preview_id=s.preview_id WHERE s.table_name='bm_outcome_attempts' AND s.record_rowid=OLD.rowid) BEGIN SELECT RAISE(ABORT,'outcome_record_requires_retention_review'); END;
CREATE TRIGGER bm_outcome_attempts_epoch_delete AFTER DELETE ON bm_outcome_attempts BEGIN UPDATE bm_retention_epoch SET version=version+1 WHERE id=1; END;
CREATE TRIGGER bm_outcome_responses_kept BEFORE DELETE ON bm_outcome_responses WHEN NOT EXISTS(SELECT 1 FROM bm_retention_scope s JOIN bm_retention_permits p ON p.preview_id=s.preview_id WHERE s.table_name='bm_outcome_responses' AND s.record_rowid=OLD.rowid) BEGIN SELECT RAISE(ABORT,'outcome_record_requires_retention_review'); END;
CREATE TRIGGER bm_outcome_responses_epoch_delete AFTER DELETE ON bm_outcome_responses BEGIN UPDATE bm_retention_epoch SET version=version+1 WHERE id=1; END;
CREATE TRIGGER bm_outcome_briefs_kept BEFORE DELETE ON bm_outcome_briefs WHEN NOT EXISTS(SELECT 1 FROM bm_retention_scope s JOIN bm_retention_permits p ON p.preview_id=s.preview_id WHERE s.table_name='bm_outcome_briefs' AND s.record_rowid=OLD.rowid) BEGIN SELECT RAISE(ABORT,'outcome_record_requires_retention_review'); END;
CREATE TRIGGER bm_outcome_briefs_epoch_delete AFTER DELETE ON bm_outcome_briefs BEGIN UPDATE bm_retention_epoch SET version=version+1 WHERE id=1; END;
