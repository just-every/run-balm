ALTER TABLE bm_settings ADD COLUMN reminder_leads TEXT NOT NULL DEFAULT '[1440]';
ALTER TABLE bm_settings ADD COLUMN reminder_sms INTEGER NOT NULL DEFAULT 0 CHECK(reminder_sms IN (0,1));
ALTER TABLE bm_clients ADD COLUMN sms_reminder_consent INTEGER NOT NULL DEFAULT 0 CHECK(sms_reminder_consent IN (0,1));
ALTER TABLE bm_appointments ADD COLUMN patient_response TEXT NOT NULL DEFAULT 'awaiting' CHECK(patient_response IN ('awaiting','confirmed','change_requested'));
ALTER TABLE bm_appointments ADD COLUMN patient_response_at TEXT;
CREATE TABLE bm_visit_reminders (
 id TEXT PRIMARY KEY, appointment_id TEXT NOT NULL REFERENCES bm_appointments(id),
 start_at TEXT NOT NULL, lead_minutes INTEGER NOT NULL, channel TEXT NOT NULL CHECK(channel IN ('email','sms')),
 due_at TEXT NOT NULL, state TEXT NOT NULL DEFAULT 'pending' CHECK(state IN ('pending','sending','sent','failed','cancelled','uncertain')),
 attempted_at TEXT, sent_at TEXT, outcome TEXT,
 UNIQUE(appointment_id,start_at,lead_minutes,channel)
);
CREATE TABLE bm_visit_reply_links (
reminder_id TEXT PRIMARY KEY REFERENCES bm_visit_reminders(id), token_hash TEXT NOT NULL UNIQUE, revoked_at TEXT
);
CREATE INDEX bm_visit_reminders_due ON bm_visit_reminders(state,due_at);
CREATE TRIGGER bm_visit_reminders_changed AFTER UPDATE OF start_at,status ON bm_appointments
 WHEN NEW.start_at<>OLD.start_at OR NEW.status<>'booked' BEGIN
 UPDATE bm_visit_reminders SET state='cancelled' WHERE appointment_id=NEW.id AND state IN ('pending','sending','failed');
 UPDATE bm_visit_reply_links SET revoked_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE reminder_id IN (SELECT id FROM bm_visit_reminders WHERE appointment_id=NEW.id);
 UPDATE bm_appointments SET patient_response='awaiting',patient_response_at=NULL WHERE id=NEW.id AND NEW.start_at<>OLD.start_at;
END;
