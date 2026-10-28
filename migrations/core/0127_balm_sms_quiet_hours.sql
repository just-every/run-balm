-- No patient zone or quiet interval is inferred for existing records.
ALTER TABLE bm_clients ADD COLUMN sms_time_zone TEXT;
CREATE TABLE bm_sms_quiet_policies (
 id TEXT PRIMARY KEY,
 intervals TEXT NOT NULL,
 source TEXT NOT NULL,
 recorded_at TEXT NOT NULL,
 recorded_by TEXT NOT NULL
);
CREATE TRIGGER bm_sms_quiet_policies_immutable_update BEFORE UPDATE ON bm_sms_quiet_policies BEGIN SELECT RAISE(ABORT,'sms_quiet_policy_is_immutable'); END;
CREATE TRIGGER bm_sms_quiet_policies_immutable_delete BEFORE DELETE ON bm_sms_quiet_policies BEGIN SELECT RAISE(ABORT,'sms_quiet_policy_is_immutable'); END;
ALTER TABLE bm_settings ADD COLUMN sms_quiet_policy_id TEXT REFERENCES bm_sms_quiet_policies(id);
ALTER TABLE bm_visit_reminders ADD COLUMN sms_quiet_policy_id TEXT REFERENCES bm_sms_quiet_policies(id);
ALTER TABLE bm_visit_reminders ADD COLUMN sms_time_zone TEXT;
