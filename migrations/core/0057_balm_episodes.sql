-- REF-003 episodes of care (ct 19 Oct 17:20Z). An episode belongs to one patient for
-- good: its id, patient, title and opening never change, and it closes once, freezing
-- which records it holds. Records filed before episodes, or while none or several were
-- open without a choice, stay in the labelled "not assigned" bucket until a person
-- assigns them; Balm never guesses an episode from dates. Notes of a visit, their
-- measures and intake (with its consents, cards and ID) follow their visit's episode.
CREATE TABLE bm_episodes (
  id TEXT PRIMARY KEY, client_id TEXT NOT NULL REFERENCES bm_clients(id),
  title TEXT NOT NULL CHECK(length(title) BETWEEN 1 AND 120),
  opened_at TEXT NOT NULL, opened_by TEXT NOT NULL,
  closed_at TEXT, closed_by TEXT, close_reason TEXT NOT NULL DEFAULT '' CHECK(length(close_reason)<=300),
  CHECK((closed_at IS NULL)=(closed_by IS NULL))
);
CREATE INDEX bm_episodes_client ON bm_episodes(client_id,opened_at);
CREATE TRIGGER bm_episode_fixed BEFORE UPDATE ON bm_episodes
 WHEN NEW.id<>OLD.id OR NEW.client_id<>OLD.client_id OR NEW.title<>OLD.title OR NEW.opened_at<>OLD.opened_at OR NEW.opened_by<>OLD.opened_by OR OLD.closed_at IS NOT NULL
 BEGIN SELECT RAISE(ABORT,'episode_fixed'); END;

CREATE TABLE bm_episode_records (
  record_kind TEXT NOT NULL CHECK(record_kind IN ('visit','note','plan','authorization','document','message','historical_note')),
  record_id TEXT NOT NULL, client_id TEXT NOT NULL REFERENCES bm_clients(id), episode_id TEXT NOT NULL REFERENCES bm_episodes(id),
  assigned_at TEXT NOT NULL, assigned_by TEXT NOT NULL,
  PRIMARY KEY(record_kind,record_id)
);
CREATE INDEX bm_episode_records_episode ON bm_episode_records(episode_id);
CREATE INDEX bm_episode_records_client ON bm_episode_records(client_id);
-- Only an open episode of the record's own patient takes a record, and a closed episode keeps its records.
CREATE TRIGGER bm_episode_record_open BEFORE INSERT ON bm_episode_records
 WHEN NOT EXISTS(SELECT 1 FROM bm_episodes WHERE id=NEW.episode_id AND client_id=NEW.client_id AND closed_at IS NULL)
 BEGIN SELECT RAISE(ABORT,'episode_not_open'); END;
CREATE TRIGGER bm_episode_record_move BEFORE UPDATE ON bm_episode_records
 WHEN NEW.record_kind<>OLD.record_kind OR NEW.record_id<>OLD.record_id OR NEW.client_id<>OLD.client_id
  OR NOT EXISTS(SELECT 1 FROM bm_episodes WHERE id=NEW.episode_id AND client_id=NEW.client_id AND closed_at IS NULL)
  OR EXISTS(SELECT 1 FROM bm_episodes WHERE id=OLD.episode_id AND closed_at IS NOT NULL)
 BEGIN SELECT RAISE(ABORT,'episode_not_open'); END;

-- Every producer files a new record to the patient's only open episode unless the
-- same batch already chose one; with none or several open it stays not assigned.
CREATE TRIGGER bm_episode_file_visit AFTER INSERT ON bm_appointments
 WHEN NOT EXISTS(SELECT 1 FROM bm_episode_records WHERE record_kind='visit' AND record_id=NEW.id)
  AND (SELECT COUNT(*) FROM bm_episodes WHERE client_id=NEW.client_id AND closed_at IS NULL)=1
 BEGIN INSERT INTO bm_episode_records(record_kind,record_id,client_id,episode_id,assigned_at,assigned_by)
  SELECT 'visit',NEW.id,client_id,id,strftime('%Y-%m-%dT%H:%M:%fZ','now'),'only open episode' FROM bm_episodes WHERE client_id=NEW.client_id AND closed_at IS NULL; END;
CREATE TRIGGER bm_episode_file_note AFTER INSERT ON bm_notes
 WHEN NEW.appointment_id IS NULL AND NOT EXISTS(SELECT 1 FROM bm_episode_records WHERE record_kind='note' AND record_id=NEW.id)
  AND (SELECT COUNT(*) FROM bm_episodes WHERE client_id=NEW.client_id AND closed_at IS NULL)=1
 BEGIN INSERT INTO bm_episode_records(record_kind,record_id,client_id,episode_id,assigned_at,assigned_by)
  SELECT 'note',NEW.id,client_id,id,strftime('%Y-%m-%dT%H:%M:%fZ','now'),'only open episode' FROM bm_episodes WHERE client_id=NEW.client_id AND closed_at IS NULL; END;
CREATE TRIGGER bm_episode_file_plan AFTER INSERT ON bm_plans_of_care
 WHEN NOT EXISTS(SELECT 1 FROM bm_episode_records WHERE record_kind='plan' AND record_id=NEW.id)
  AND (SELECT COUNT(*) FROM bm_episodes WHERE client_id=NEW.client_id AND closed_at IS NULL)=1
 BEGIN INSERT INTO bm_episode_records(record_kind,record_id,client_id,episode_id,assigned_at,assigned_by)
  SELECT 'plan',NEW.id,client_id,id,strftime('%Y-%m-%dT%H:%M:%fZ','now'),'only open episode' FROM bm_episodes WHERE client_id=NEW.client_id AND closed_at IS NULL; END;
CREATE TRIGGER bm_episode_file_authorization AFTER INSERT ON bm_authorizations
 WHEN NOT EXISTS(SELECT 1 FROM bm_episode_records WHERE record_kind='authorization' AND record_id=NEW.id)
  AND (SELECT COUNT(*) FROM bm_episodes WHERE client_id=(SELECT client_id FROM bm_policies WHERE id=NEW.policy_id) AND closed_at IS NULL)=1
 BEGIN INSERT INTO bm_episode_records(record_kind,record_id,client_id,episode_id,assigned_at,assigned_by)
  SELECT 'authorization',NEW.id,client_id,id,strftime('%Y-%m-%dT%H:%M:%fZ','now'),'only open episode' FROM bm_episodes WHERE client_id=(SELECT client_id FROM bm_policies WHERE id=NEW.policy_id) AND closed_at IS NULL; END;
CREATE TRIGGER bm_episode_file_document AFTER INSERT ON bm_chart_documents
 WHEN NOT EXISTS(SELECT 1 FROM bm_episode_records WHERE record_kind='document' AND record_id=NEW.id)
  AND (SELECT COUNT(*) FROM bm_episodes WHERE client_id=NEW.client_id AND closed_at IS NULL)=1
 BEGIN INSERT INTO bm_episode_records(record_kind,record_id,client_id,episode_id,assigned_at,assigned_by)
  SELECT 'document',NEW.id,client_id,id,strftime('%Y-%m-%dT%H:%M:%fZ','now'),'only open episode' FROM bm_episodes WHERE client_id=NEW.client_id AND closed_at IS NULL; END;
CREATE TRIGGER bm_episode_file_message AFTER INSERT ON bm_messages
 WHEN NOT EXISTS(SELECT 1 FROM bm_episode_records WHERE record_kind='message' AND record_id=NEW.id)
  AND (SELECT COUNT(*) FROM bm_episodes WHERE client_id=NEW.client_id AND closed_at IS NULL)=1
 BEGIN INSERT INTO bm_episode_records(record_kind,record_id,client_id,episode_id,assigned_at,assigned_by)
  SELECT 'message',NEW.id,client_id,id,strftime('%Y-%m-%dT%H:%M:%fZ','now'),'only open episode' FROM bm_episodes WHERE client_id=NEW.client_id AND closed_at IS NULL; END;
CREATE TRIGGER bm_episode_file_historical_note AFTER INSERT ON bm_movein_notes
 WHEN NOT EXISTS(SELECT 1 FROM bm_episode_records WHERE record_kind='historical_note' AND record_id=NEW.id)
  AND (SELECT COUNT(*) FROM bm_episodes WHERE client_id=NEW.client_id AND closed_at IS NULL)=1
 BEGIN INSERT INTO bm_episode_records(record_kind,record_id,client_id,episode_id,assigned_at,assigned_by)
  SELECT 'historical_note',NEW.id,client_id,id,strftime('%Y-%m-%dT%H:%M:%fZ','now'),'only open episode' FROM bm_episodes WHERE client_id=NEW.client_id AND closed_at IS NULL; END;
-- Removing a record (an undone import) removes its filing.
CREATE TRIGGER bm_episode_unfile_visit AFTER DELETE ON bm_appointments BEGIN DELETE FROM bm_episode_records WHERE record_kind='visit' AND record_id=OLD.id; END;
CREATE TRIGGER bm_episode_unfile_note AFTER DELETE ON bm_notes BEGIN DELETE FROM bm_episode_records WHERE record_kind='note' AND record_id=OLD.id; END;
CREATE TRIGGER bm_episode_unfile_plan AFTER DELETE ON bm_plans_of_care BEGIN DELETE FROM bm_episode_records WHERE record_kind='plan' AND record_id=OLD.id; END;
CREATE TRIGGER bm_episode_unfile_authorization AFTER DELETE ON bm_authorizations BEGIN DELETE FROM bm_episode_records WHERE record_kind='authorization' AND record_id=OLD.id; END;
CREATE TRIGGER bm_episode_unfile_document AFTER DELETE ON bm_chart_documents BEGIN DELETE FROM bm_episode_records WHERE record_kind='document' AND record_id=OLD.id; END;
CREATE TRIGGER bm_episode_unfile_message AFTER DELETE ON bm_messages BEGIN DELETE FROM bm_episode_records WHERE record_kind='message' AND record_id=OLD.id; END;
CREATE TRIGGER bm_episode_unfile_historical_note AFTER DELETE ON bm_movein_notes BEGIN DELETE FROM bm_episode_records WHERE record_kind='historical_note' AND record_id=OLD.id; END;

-- Anonymous retention facts keep an opaque episode id so REPORT-001 totals survive a purge.
ALTER TABLE bm_destroyed_operations ADD COLUMN episode_id TEXT;
ALTER TABLE bm_destroyed_plans ADD COLUMN episode_id TEXT;
CREATE TRIGGER bm_retention_epoch_episodes_insert AFTER INSERT ON bm_episodes BEGIN UPDATE bm_retention_epoch SET version=version+1 WHERE id=1; END;
CREATE TRIGGER bm_retention_epoch_episodes_update AFTER UPDATE ON bm_episodes BEGIN UPDATE bm_retention_epoch SET version=version+1 WHERE id=1; END;
CREATE TRIGGER bm_retention_epoch_episodes_delete AFTER DELETE ON bm_episodes BEGIN UPDATE bm_retention_epoch SET version=version+1 WHERE id=1; END;
CREATE TRIGGER bm_retention_epoch_episode_records_insert AFTER INSERT ON bm_episode_records BEGIN UPDATE bm_retention_epoch SET version=version+1 WHERE id=1; END;
CREATE TRIGGER bm_retention_epoch_episode_records_update AFTER UPDATE ON bm_episode_records BEGIN UPDATE bm_retention_epoch SET version=version+1 WHERE id=1; END;
CREATE TRIGGER bm_retention_epoch_episode_records_delete AFTER DELETE ON bm_episode_records BEGIN UPDATE bm_retention_epoch SET version=version+1 WHERE id=1; END;
