-- HIPAA-004: automatic encrypted backups to storage the owner controls. The credentials are sealed under
-- the install's secret and the encryption key is the owner's public key (Balm never holds the private half).
-- Neither table travels in a .rer archive: credentials never do, and a restored clinic has its own history.
CREATE TABLE bm_backup_settings (
  id INTEGER PRIMARY KEY CHECK(id=1),
  enabled INTEGER NOT NULL DEFAULT 1 CHECK(enabled IN (0,1)),
  endpoint TEXT NOT NULL, region TEXT NOT NULL, bucket TEXT NOT NULL, prefix TEXT NOT NULL DEFAULT '',
  access_key_id TEXT NOT NULL, secret_sealed TEXT NOT NULL, secret_hint TEXT NOT NULL,
  public_key TEXT NOT NULL, key_fingerprint TEXT NOT NULL,
  interval_hours INTEGER NOT NULL DEFAULT 24 CHECK(interval_hours IN (1,6,12,24)),
  consent_by TEXT NOT NULL, consent_at TEXT NOT NULL,
  updated_by TEXT NOT NULL, updated_at TEXT NOT NULL,
  checked_at TEXT, check_ok INTEGER NOT NULL DEFAULT 0 CHECK(check_ok IN (0,1)), check_message TEXT NOT NULL DEFAULT ''
);
CREATE TABLE bm_backup_runs (
  id TEXT PRIMARY KEY,
  trigger TEXT NOT NULL CHECK(trigger IN ('schedule','manual')),
  started_at TEXT NOT NULL, finished_at TEXT,
  state TEXT NOT NULL CHECK(state IN ('running','ok','failed')),
  object_key TEXT, bytes INTEGER, content_hash TEXT, key_fingerprint TEXT,
  recovery_point TEXT, counts TEXT, error TEXT
);
CREATE INDEX bm_backup_runs_started ON bm_backup_runs(started_at);
