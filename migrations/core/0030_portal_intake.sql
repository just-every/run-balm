-- Fixed consent documents and original insurance cards are health records.
CREATE TABLE bm_intake_consents (
 id TEXT PRIMARY KEY, response_id TEXT NOT NULL UNIQUE REFERENCES bm_intake_responses(id),
 client_id TEXT NOT NULL REFERENCES bm_clients(id), form_id TEXT NOT NULL REFERENCES bm_intake_forms(id),
 policy_version TEXT NOT NULL, policy_text TEXT NOT NULL, signer_name TEXT NOT NULL,
 signer_relationship TEXT NOT NULL CHECK(signer_relationship IN ('patient','parent','guardian')),
 signature TEXT NOT NULL, signed_at TEXT NOT NULL, signed_ip TEXT NOT NULL,
 pdf BLOB NOT NULL, pdf_sha256 TEXT NOT NULL
);
CREATE INDEX bm_intake_consents_client ON bm_intake_consents(client_id);
CREATE TRIGGER bm_intake_consent_fixed BEFORE UPDATE ON bm_intake_consents BEGIN SELECT RAISE(ABORT,'signed_records_cannot_change'); END;
CREATE TRIGGER bm_intake_consent_kept BEFORE DELETE ON bm_intake_consents BEGIN SELECT RAISE(ABORT,'signed_records_cannot_change'); END;

CREATE TABLE bm_intake_insurance (
 id TEXT PRIMARY KEY, response_id TEXT NOT NULL UNIQUE REFERENCES bm_intake_responses(id),
 client_id TEXT NOT NULL REFERENCES bm_clients(id), payer TEXT NOT NULL, member_id TEXT NOT NULL,
 group_number TEXT NOT NULL, subscriber_name TEXT NOT NULL, relationship TEXT NOT NULL,
 front BLOB, front_mime TEXT, back BLOB, back_mime TEXT,
 received_at TEXT NOT NULL, version INTEGER NOT NULL DEFAULT 1,
 verified_at TEXT, verified_by TEXT, ai_draft TEXT, ai_read_at TEXT
);
CREATE INDEX bm_intake_insurance_client ON bm_intake_insurance(client_id);
CREATE TRIGGER bm_intake_insurance_original_fixed BEFORE UPDATE ON bm_intake_insurance
 WHEN NEW.response_id IS NOT OLD.response_id OR NEW.client_id IS NOT OLD.client_id
 OR NEW.front IS NOT OLD.front OR NEW.back IS NOT OLD.back
 OR NEW.front_mime IS NOT OLD.front_mime OR NEW.back_mime IS NOT OLD.back_mime
 OR NEW.received_at IS NOT OLD.received_at
 BEGIN SELECT RAISE(ABORT,'insurance_original_fixed'); END;
CREATE TRIGGER bm_intake_insurance_kept BEFORE DELETE ON bm_intake_insurance BEGIN SELECT RAISE(ABORT,'insurance_is_health_record'); END;
