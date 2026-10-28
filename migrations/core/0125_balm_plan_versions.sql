-- Plan replacements and returned originals retain every prior signed record.
CREATE TABLE bm_plan_replacements (
 predecessor_id TEXT PRIMARY KEY REFERENCES bm_plans_of_care(id), successor_id TEXT NOT NULL UNIQUE REFERENCES bm_plans_of_care(id),
 client_id TEXT NOT NULL REFERENCES bm_clients(id), episode_id TEXT REFERENCES bm_episodes(id), replaced_at TEXT NOT NULL, replaced_by TEXT NOT NULL,
 CHECK(predecessor_id<>successor_id)
);
CREATE TABLE bm_plan_sends (
 id TEXT PRIMARY KEY, plan_id TEXT NOT NULL REFERENCES bm_plans_of_care(id), client_id TEXT NOT NULL REFERENCES bm_clients(id),
 channel TEXT NOT NULL CHECK(channel='link'), recipient_name TEXT NOT NULL, recipient_address TEXT NOT NULL, sent_at TEXT NOT NULL, sent_by TEXT NOT NULL
);
-- Earlier installations retain the latest link issue they had recorded, without inventing earlier sends.
INSERT INTO bm_plan_sends SELECT id,id,client_id,'link',physician_name,physician_email,sent_at,therapist_name FROM bm_plans_of_care;
CREATE TABLE bm_plan_certifications (
 plan_id TEXT PRIMARY KEY REFERENCES bm_plans_of_care(id), document_id TEXT NOT NULL UNIQUE REFERENCES bm_chart_documents(id),
 client_id TEXT NOT NULL REFERENCES bm_clients(id), episode_id TEXT REFERENCES bm_episodes(id), signature_date TEXT NOT NULL,
 certification_date TEXT NOT NULL, filed_at TEXT NOT NULL, filed_by TEXT NOT NULL
);
CREATE TRIGGER bm_plan_identity_fixed BEFORE UPDATE ON bm_plans_of_care
 WHEN NEW.id IS NOT OLD.id OR NEW.client_id IS NOT OLD.client_id OR NEW.author_id IS NOT OLD.author_id OR NEW.note_id IS NOT OLD.note_id
 OR NEW.therapist_name IS NOT OLD.therapist_name OR NEW.therapist_credentials IS NOT OLD.therapist_credentials OR NEW.created_at IS NOT OLD.created_at
 OR NEW.physician_name IS NOT OLD.physician_name OR NEW.physician_email IS NOT OLD.physician_email
 BEGIN SELECT RAISE(ABORT,'plan_locked'); END;
CREATE TRIGGER bm_plan_replacement_match BEFORE INSERT ON bm_plan_replacements WHEN NOT EXISTS(
 SELECT 1 FROM bm_plans_of_care p JOIN bm_plans_of_care n ON n.id=NEW.successor_id
 WHERE p.id=NEW.predecessor_id AND p.client_id=NEW.client_id AND n.client_id=p.client_id AND n.author_id=p.author_id
 AND COALESCE((SELECT episode_id FROM bm_episode_records WHERE record_kind='plan' AND record_id=p.id),'')=COALESCE(NEW.episode_id,'')
 AND COALESCE((SELECT episode_id FROM bm_episode_records WHERE record_kind='plan' AND record_id=n.id),'')=COALESCE(NEW.episode_id,''))
 BEGIN SELECT RAISE(ABORT,'plan_locked'); END;
CREATE TRIGGER bm_plan_certification_match BEFORE INSERT ON bm_plan_certifications WHEN NOT EXISTS(
 SELECT 1 FROM bm_plans_of_care p JOIN bm_chart_documents d ON d.id=NEW.document_id
 WHERE p.id=NEW.plan_id AND p.status='certified' AND p.client_id=NEW.client_id AND d.client_id=p.client_id AND d.document_type='signed_plan'
 AND COALESCE((SELECT episode_id FROM bm_episode_records WHERE record_kind='plan' AND record_id=p.id),'')=COALESCE(NEW.episode_id,''))
 BEGIN SELECT RAISE(ABORT,'plan_locked'); END;
-- Filing a returned certification to its recorded closed episode does not reopen it.
DROP TRIGGER bm_episode_record_open;
CREATE TRIGGER bm_episode_record_open BEFORE INSERT ON bm_episode_records
 WHEN NOT EXISTS(SELECT 1 FROM bm_episodes WHERE id=NEW.episode_id AND client_id=NEW.client_id AND closed_at IS NULL)
 AND NOT EXISTS(SELECT 1 FROM bm_plan_certifications f WHERE NEW.record_kind='document' AND f.document_id=NEW.record_id AND f.client_id=NEW.client_id AND f.episode_id=NEW.episode_id)
 BEGIN SELECT RAISE(ABORT,'episode_not_open'); END;
CREATE TRIGGER bm_plan_filed_episode_update BEFORE UPDATE ON bm_episode_records
 WHEN NEW.episode_id IS NOT OLD.episode_id AND (
 EXISTS(SELECT 1 FROM bm_plan_certifications f WHERE (OLD.record_kind='document' AND f.document_id=OLD.record_id) OR (OLD.record_kind='plan' AND f.plan_id=OLD.record_id))
 OR EXISTS(SELECT 1 FROM bm_plan_replacements r WHERE OLD.record_kind='plan' AND (r.predecessor_id=OLD.record_id OR r.successor_id=OLD.record_id)))
 BEGIN SELECT RAISE(ABORT,'plan_locked'); END;
CREATE TRIGGER bm_plan_filed_episode_insert BEFORE INSERT ON bm_episode_records
 WHEN EXISTS(SELECT 1 FROM bm_plan_certifications f WHERE ((NEW.record_kind='document' AND f.document_id=NEW.record_id) OR (NEW.record_kind='plan' AND f.plan_id=NEW.record_id)) AND COALESCE(f.episode_id,'')<>NEW.episode_id)
 OR EXISTS(SELECT 1 FROM bm_plan_replacements r WHERE NEW.record_kind='plan' AND (r.predecessor_id=NEW.record_id OR r.successor_id=NEW.record_id) AND COALESCE(r.episode_id,'')<>NEW.episode_id)
 BEGIN SELECT RAISE(ABORT,'plan_locked'); END;
CREATE TRIGGER bm_plan_replacements_fixed BEFORE UPDATE ON bm_plan_replacements BEGIN SELECT RAISE(ABORT,'plan_locked'); END;
CREATE TRIGGER bm_plan_replacements_kept BEFORE DELETE ON bm_plan_replacements WHEN NOT EXISTS(SELECT 1 FROM bm_retention_scope s JOIN bm_retention_permits p ON p.preview_id=s.preview_id WHERE s.table_name='bm_plan_replacements' AND s.record_rowid=OLD.rowid) BEGIN SELECT RAISE(ABORT,'plan_requires_retention_review'); END;
CREATE TRIGGER bm_plan_replacements_epoch_insert AFTER INSERT ON bm_plan_replacements BEGIN UPDATE bm_retention_epoch SET version=version+1 WHERE id=1; END;
CREATE TRIGGER bm_plan_replacements_epoch_update AFTER UPDATE ON bm_plan_replacements BEGIN UPDATE bm_retention_epoch SET version=version+1 WHERE id=1; END;
CREATE TRIGGER bm_plan_replacements_epoch_delete AFTER DELETE ON bm_plan_replacements BEGIN UPDATE bm_retention_epoch SET version=version+1 WHERE id=1; END;
CREATE TRIGGER bm_plan_sends_fixed BEFORE UPDATE ON bm_plan_sends BEGIN SELECT RAISE(ABORT,'plan_locked'); END;
CREATE TRIGGER bm_plan_sends_kept BEFORE DELETE ON bm_plan_sends WHEN NOT EXISTS(SELECT 1 FROM bm_retention_scope s JOIN bm_retention_permits p ON p.preview_id=s.preview_id WHERE s.table_name='bm_plan_sends' AND s.record_rowid=OLD.rowid) BEGIN SELECT RAISE(ABORT,'plan_requires_retention_review'); END;
CREATE TRIGGER bm_plan_sends_epoch_insert AFTER INSERT ON bm_plan_sends BEGIN UPDATE bm_retention_epoch SET version=version+1 WHERE id=1; END;
CREATE TRIGGER bm_plan_sends_epoch_update AFTER UPDATE ON bm_plan_sends BEGIN UPDATE bm_retention_epoch SET version=version+1 WHERE id=1; END;
CREATE TRIGGER bm_plan_sends_epoch_delete AFTER DELETE ON bm_plan_sends BEGIN UPDATE bm_retention_epoch SET version=version+1 WHERE id=1; END;
CREATE TRIGGER bm_plan_certifications_fixed BEFORE UPDATE ON bm_plan_certifications BEGIN SELECT RAISE(ABORT,'plan_locked'); END;
CREATE TRIGGER bm_plan_certifications_kept BEFORE DELETE ON bm_plan_certifications WHEN NOT EXISTS(SELECT 1 FROM bm_retention_scope s JOIN bm_retention_permits p ON p.preview_id=s.preview_id WHERE s.table_name='bm_plan_certifications' AND s.record_rowid=OLD.rowid) BEGIN SELECT RAISE(ABORT,'plan_requires_retention_review'); END;
CREATE TRIGGER bm_plan_certifications_epoch_insert AFTER INSERT ON bm_plan_certifications BEGIN UPDATE bm_retention_epoch SET version=version+1 WHERE id=1; END;
CREATE TRIGGER bm_plan_certifications_epoch_update AFTER UPDATE ON bm_plan_certifications BEGIN UPDATE bm_retention_epoch SET version=version+1 WHERE id=1; END;
CREATE TRIGGER bm_plan_certifications_epoch_delete AFTER DELETE ON bm_plan_certifications BEGIN UPDATE bm_retention_epoch SET version=version+1 WHERE id=1; END;
