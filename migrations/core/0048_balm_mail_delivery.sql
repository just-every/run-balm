-- Durable application association exists before sending; messages and clinical text are not stored here.
CREATE TABLE bm_mail_attempts (
 id TEXT PRIMARY KEY, client_id TEXT NOT NULL REFERENCES bm_clients(id),
 kind TEXT NOT NULL CHECK(kind IN ('booking','intake','moved','cancelled','reminder')),
 provider TEXT NOT NULL, tenant_id TEXT NOT NULL, event_namespace TEXT NOT NULL,
 recipient TEXT NOT NULL, provider_message_id TEXT,
 submission_state TEXT NOT NULL CHECK(submission_state IN ('sending','accepted','failed','uncertain','suppressed','no_email','unavailable')),
 created_at TEXT NOT NULL, completed_at TEXT
);
CREATE INDEX bm_mail_attempts_client ON bm_mail_attempts(client_id,created_at);
CREATE INDEX bm_mail_attempts_provider ON bm_mail_attempts(provider,tenant_id,event_namespace,provider_message_id,recipient);
CREATE TABLE bm_mail_attempt_visits (
 delivery_id TEXT NOT NULL REFERENCES bm_mail_attempts(id), appointment_id TEXT NOT NULL REFERENCES bm_appointments(id),
 PRIMARY KEY(delivery_id,appointment_id)
);
CREATE TABLE bm_mail_reply_links (
 token_hash TEXT PRIMARY KEY, appointment_id TEXT NOT NULL REFERENCES bm_appointments(id), start_at TEXT NOT NULL
);
-- Additive migration. Never drop existing delivery receipts or state.
CREATE TABLE IF NOT EXISTS rer_mail_event_receipts (
  provider TEXT NOT NULL,
  tenant_id TEXT NOT NULL,
  event_namespace TEXT NOT NULL,
  event_id TEXT NOT NULL,
  fingerprint TEXT NOT NULL,
  event_json TEXT NOT NULL,
  commit_token TEXT NOT NULL,
  ordinal INTEGER NOT NULL,
  conflict INTEGER NOT NULL DEFAULT 0 CONSTRAINT rer_mail_event_identity_conflict CHECK (conflict = 0),
  PRIMARY KEY (provider, tenant_id, event_namespace, event_id)
);
CREATE TABLE IF NOT EXISTS rer_mail_event_states (
  provider TEXT NOT NULL,
  tenant_id TEXT NOT NULL,
  event_namespace TEXT NOT NULL,
  provider_message_id TEXT NOT NULL,
  recipient TEXT NOT NULL,
  status TEXT NOT NULL,
  occurred_at INTEGER NOT NULL,
  event_id TEXT NOT NULL,
  terminal INTEGER NOT NULL CHECK (terminal IN (0, 1)),
  PRIMARY KEY (provider, tenant_id, event_namespace, provider_message_id, recipient)
);
-- Reply credentials are invalid after a change even when only the clinician or room changes.
CREATE TRIGGER bm_mail_links_changed AFTER UPDATE OF start_at,status,practitioner_id,room_id ON bm_appointments
 WHEN NEW.start_at<>OLD.start_at OR NEW.status<>OLD.status OR NEW.practitioner_id<>OLD.practitioner_id OR NEW.room_id IS NOT OLD.room_id BEGIN
 DELETE FROM bm_mail_reply_links WHERE appointment_id=NEW.id;
 UPDATE bm_visit_reply_links SET revoked_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE reminder_id IN (SELECT id FROM bm_visit_reminders WHERE appointment_id=NEW.id);
END;
