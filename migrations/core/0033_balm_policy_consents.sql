CREATE TABLE bm_consent_policies (
 id TEXT PRIMARY KEY, kind TEXT NOT NULL CHECK(kind IN ('treatment','hipaa','financial','cancellation','telehealth','sms')),
 title TEXT NOT NULL, body TEXT NOT NULL, version INTEGER NOT NULL,
 published_at TEXT NOT NULL, published_by TEXT NOT NULL, UNIQUE(kind,version)
);
INSERT INTO bm_consent_policies VALUES('treatment-records-2026-10-17-v1','treatment','Consent to treat',
 'I consent to the clinic providing the therapy services discussed with me. I acknowledge that the clinic keeps my intake answers and treatment records to provide my care. I have had the opportunity to ask questions. I intend my signature below to sign this acknowledgment.',1,'2026-10-17T00:00:00.000Z','Balm default');
CREATE TRIGGER bm_consent_policy_fixed BEFORE UPDATE ON bm_consent_policies BEGIN SELECT RAISE(ABORT,'published_policy_cannot_change'); END;
CREATE TRIGGER bm_consent_policy_kept BEFORE DELETE ON bm_consent_policies BEGIN SELECT RAISE(ABORT,'published_policy_cannot_change'); END;

-- Remove the one-document-per-response constraint without changing any signed bytes.
CREATE TABLE bm_intake_consents_next (
 id TEXT PRIMARY KEY, response_id TEXT NOT NULL REFERENCES bm_intake_responses(id),
 client_id TEXT NOT NULL REFERENCES bm_clients(id), form_id TEXT NOT NULL REFERENCES bm_intake_forms(id),
 policy_version TEXT NOT NULL, policy_text TEXT NOT NULL, signer_name TEXT NOT NULL,
 signer_relationship TEXT NOT NULL CHECK(signer_relationship IN ('patient','parent','guardian')),
 signature TEXT NOT NULL, signed_at TEXT NOT NULL, signed_ip TEXT NOT NULL,
 pdf BLOB NOT NULL, pdf_sha256 TEXT NOT NULL,
 policy_kind TEXT NOT NULL, policy_title TEXT NOT NULL
);
INSERT INTO bm_intake_consents_next SELECT *, 'treatment', 'Consent to treat' FROM bm_intake_consents;
DROP TABLE bm_intake_consents;
ALTER TABLE bm_intake_consents_next RENAME TO bm_intake_consents;
CREATE INDEX bm_intake_consents_client ON bm_intake_consents(client_id,policy_version);
CREATE TRIGGER bm_intake_consent_fixed BEFORE UPDATE ON bm_intake_consents BEGIN SELECT RAISE(ABORT,'signed_records_cannot_change'); END;
CREATE TRIGGER bm_intake_consent_kept BEFORE DELETE ON bm_intake_consents BEGIN SELECT RAISE(ABORT,'signed_records_cannot_change'); END;
CREATE TABLE bm_consent_declines (
 client_id TEXT NOT NULL REFERENCES bm_clients(id), policy_id TEXT NOT NULL REFERENCES bm_consent_policies(id),
 decided_at TEXT NOT NULL, PRIMARY KEY(client_id,policy_id)
);
CREATE TABLE bm_consent_links (
 token_hash TEXT PRIMARY KEY, response_id TEXT NOT NULL REFERENCES bm_intake_responses(id),
 expires_at TEXT NOT NULL, created_at TEXT NOT NULL
);
