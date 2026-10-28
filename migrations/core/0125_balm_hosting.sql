-- Hosting evidence survives export; executable qualification and patient mode do not.
CREATE TABLE bm_hosting_records (
  id TEXT PRIMARY KEY,
  origin TEXT NOT NULL,
  provider TEXT NOT NULL CHECK(provider IN ('aws','cloudflare')),
  account TEXT NOT NULL,
  deployment TEXT NOT NULL,
  services TEXT NOT NULL CHECK(json_valid(services)),
  covered_services TEXT NOT NULL CHECK(json_valid(covered_services)),
  service_evidence TEXT NOT NULL CHECK(json_valid(service_evidence)),
  baa_id TEXT NOT NULL REFERENCES bm_baa_records(id),
  backup_baa_id TEXT NOT NULL REFERENCES bm_baa_records(id),
  qualification_reference TEXT NOT NULL,
  backup_receipt TEXT NOT NULL,
  drill_receipt TEXT NOT NULL,
  recorded_at TEXT NOT NULL,
  recorded_by TEXT NOT NULL
);
CREATE TABLE bm_hosting_revocations (
  record_id TEXT PRIMARY KEY REFERENCES bm_hosting_records(id),
  revoked_at TEXT NOT NULL,
  revoked_by TEXT NOT NULL
);
CREATE TABLE bm_hosting_qualifications (
  record_id TEXT PRIMARY KEY REFERENCES bm_hosting_records(id),
  owner_id TEXT NOT NULL,
  owner_version INTEGER NOT NULL
);
CREATE TABLE bm_patient_mode (
  id INTEGER PRIMARY KEY CHECK(id=1),
  mode TEXT NOT NULL CHECK(mode IN ('blocked','demo','real')),
  origin TEXT NOT NULL,
  record_id TEXT REFERENCES bm_hosting_records(id),
  owner_id TEXT NOT NULL,
  owner_version INTEGER NOT NULL
);
INSERT INTO bm_patient_mode VALUES(1,'blocked','',NULL,'',0);
CREATE TRIGGER bm_hosting_records_immutable BEFORE UPDATE ON bm_hosting_records BEGIN SELECT RAISE(ABORT,'hosting_evidence_immutable'); END;
CREATE TRIGGER bm_hosting_records_retained BEFORE DELETE ON bm_hosting_records BEGIN SELECT RAISE(ABORT,'hosting_evidence_retained'); END;
