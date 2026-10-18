-- One photo per row stays within D1's 2,000,000-byte row limit.
CREATE TABLE bm_intake_photos (id TEXT PRIMARY KEY, bytes BLOB NOT NULL, mime TEXT NOT NULL);
CREATE TRIGGER bm_intake_photo_fixed BEFORE UPDATE ON bm_intake_photos BEGIN SELECT RAISE(ABORT,'photo_original_fixed'); END;
CREATE TRIGGER bm_intake_photo_kept BEFORE DELETE ON bm_intake_photos BEGIN SELECT RAISE(ABORT,'photo_is_health_record'); END;
INSERT INTO bm_intake_photos SELECT id||'-front',front,front_mime FROM bm_intake_insurance WHERE front IS NOT NULL;
INSERT INTO bm_intake_photos SELECT id||'-back',back,back_mime FROM bm_intake_insurance WHERE back IS NOT NULL;
-- Keep every original card; new intakes capture a primary and a secondary policy.
CREATE TABLE bm_intake_insurance_next (
 id TEXT PRIMARY KEY, response_id TEXT NOT NULL REFERENCES bm_intake_responses(id),
 client_id TEXT NOT NULL REFERENCES bm_clients(id), payer TEXT NOT NULL, member_id TEXT NOT NULL,
 group_number TEXT NOT NULL, subscriber_name TEXT NOT NULL, relationship TEXT NOT NULL,
 front TEXT REFERENCES bm_intake_photos(id), front_mime TEXT, back TEXT REFERENCES bm_intake_photos(id), back_mime TEXT,
 received_at TEXT NOT NULL, version INTEGER NOT NULL DEFAULT 1,
 verified_at TEXT, verified_by TEXT, ai_draft TEXT, ai_read_at TEXT,
 priority INTEGER NOT NULL CHECK(priority IN (1,2)), policy_id TEXT REFERENCES bm_policies(id), UNIQUE(response_id,priority)
);
INSERT INTO bm_intake_insurance_next SELECT id,response_id,client_id,payer,member_id,group_number,subscriber_name,relationship,
 CASE WHEN front IS NOT NULL THEN id||'-front' END,front_mime,CASE WHEN back IS NOT NULL THEN id||'-back' END,back_mime,
 received_at,version,verified_at,verified_by,ai_draft,ai_read_at,1,NULL FROM bm_intake_insurance;
DROP TABLE bm_intake_insurance;
ALTER TABLE bm_intake_insurance_next RENAME TO bm_intake_insurance;
CREATE INDEX bm_intake_insurance_client ON bm_intake_insurance(client_id);
CREATE TRIGGER bm_intake_insurance_original_fixed BEFORE UPDATE ON bm_intake_insurance
 WHEN NEW.response_id IS NOT OLD.response_id OR NEW.client_id IS NOT OLD.client_id
 OR NEW.front IS NOT OLD.front OR NEW.back IS NOT OLD.back
 OR NEW.front_mime IS NOT OLD.front_mime OR NEW.back_mime IS NOT OLD.back_mime
 OR NEW.received_at IS NOT OLD.received_at OR NEW.priority IS NOT OLD.priority OR NEW.policy_id IS NOT OLD.policy_id
 BEGIN SELECT RAISE(ABORT,'insurance_original_fixed'); END;
CREATE TRIGGER bm_intake_insurance_kept BEFORE DELETE ON bm_intake_insurance BEGIN SELECT RAISE(ABORT,'insurance_is_health_record'); END;
CREATE TABLE bm_intake_identity (
 id TEXT PRIMARY KEY, response_id TEXT NOT NULL UNIQUE REFERENCES bm_intake_responses(id),
 client_id TEXT NOT NULL REFERENCES bm_clients(id), photo_id TEXT NOT NULL REFERENCES bm_intake_photos(id), received_at TEXT NOT NULL
);
CREATE TRIGGER bm_intake_identity_fixed BEFORE UPDATE ON bm_intake_identity BEGIN SELECT RAISE(ABORT,'identity_original_fixed'); END;
CREATE TRIGGER bm_intake_identity_kept BEFORE DELETE ON bm_intake_identity BEGIN SELECT RAISE(ABORT,'identity_is_health_record'); END;
