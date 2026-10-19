-- REF-001 referrals and referring providers. A referral (or a direct-access entry)
-- starts one episode of care (REF-003); its stage is derived from that episode's
-- records, except lost, which a person records. A referring provider looked up by NPI
-- keeps the NPPES registry answer and when it was retrieved.
ALTER TABLE bm_referrals ADD COLUMN kind TEXT NOT NULL DEFAULT 'referral' CHECK(kind IN ('referral','direct_access'));
ALTER TABLE bm_referrals ADD COLUMN source TEXT NOT NULL DEFAULT 'physician' CHECK(source IN ('physician','other_provider','self','insurer','employer','attorney','website','other'));
ALTER TABLE bm_referrals ADD COLUMN episode_id TEXT REFERENCES bm_episodes(id);
ALTER TABLE bm_referrals ADD COLUMN npi_source TEXT NOT NULL DEFAULT '' CHECK(npi_source IN ('','nppes','entered'));
ALTER TABLE bm_referrals ADD COLUMN lost_at TEXT;
ALTER TABLE bm_referrals ADD COLUMN lost_by TEXT;
ALTER TABLE bm_referrals ADD COLUMN lost_reason TEXT NOT NULL DEFAULT '' CHECK(length(lost_reason)<=300);
CREATE UNIQUE INDEX bm_referrals_episode ON bm_referrals(episode_id) WHERE episode_id IS NOT NULL;
CREATE TRIGGER bm_referral_episode_fixed BEFORE UPDATE ON bm_referrals
 WHEN (OLD.episode_id IS NOT NULL AND NEW.episode_id IS NOT OLD.episode_id) OR (OLD.lost_at IS NOT NULL AND (NEW.lost_at IS NOT OLD.lost_at OR NEW.episode_id IS NOT OLD.episode_id)) OR NEW.kind<>OLD.kind
 BEGIN SELECT RAISE(ABORT,'referral_fixed'); END;
CREATE TRIGGER bm_referral_episode_patient BEFORE UPDATE OF episode_id ON bm_referrals
 WHEN NEW.episode_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM bm_episodes WHERE id=NEW.episode_id AND client_id=NEW.client_id)
 BEGIN SELECT RAISE(ABORT,'episode_not_found'); END;
CREATE TRIGGER bm_referral_episode_patient_insert BEFORE INSERT ON bm_referrals
 WHEN NEW.episode_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM bm_episodes WHERE id=NEW.episode_id AND client_id=NEW.client_id)
 BEGIN SELECT RAISE(ABORT,'episode_not_found'); END;

-- OWN-001: the NPPES lookup is a declared integration the owner turns on; off by default.
ALTER TABLE bm_settings ADD COLUMN nppes_lookup INTEGER NOT NULL DEFAULT 0 CHECK(nppes_lookup IN (0,1));

-- The NPPES registry's answer for an NPI, as retrieved; not patient data.
CREATE TABLE bm_referring_providers (
  npi TEXT PRIMARY KEY CHECK(length(npi)=10), name TEXT NOT NULL, credential TEXT NOT NULL DEFAULT '', kind TEXT NOT NULL CHECK(kind IN ('individual','organization')),
  taxonomy TEXT NOT NULL DEFAULT '', address TEXT NOT NULL DEFAULT '', phone TEXT NOT NULL DEFAULT '', fax TEXT NOT NULL DEFAULT '', retrieved_at TEXT NOT NULL
);

-- HIPAA-002: a destroyed patient's referrals leave only the anonymous facts REPORT-001's
-- referral conversion counts (date, source, referring provider, stage, practitioner).
CREATE TABLE bm_destroyed_referrals(id TEXT PRIMARY KEY,received_on TEXT NOT NULL,source TEXT NOT NULL,provider TEXT NOT NULL,stage TEXT NOT NULL,scheduled INTEGER NOT NULL,evaluated INTEGER NOT NULL,practitioner_id TEXT);
CREATE TRIGGER bm_destroyed_referrals_fixed BEFORE UPDATE ON bm_destroyed_referrals BEGIN SELECT RAISE(ABORT,'anonymous_business_fact_fixed'); END;
