CREATE TABLE bm_followup_settings (
 kind TEXT PRIMARY KEY CHECK(kind IN ('welcome','missed','no_next','discharge','recall')),
 enabled INTEGER NOT NULL DEFAULT 0, delay_days INTEGER NOT NULL DEFAULT 1,
 repeat_days INTEGER NOT NULL DEFAULT 7, max_sends INTEGER NOT NULL DEFAULT 3,
 survey_url TEXT, review_url TEXT, version INTEGER NOT NULL DEFAULT 1
);
INSERT INTO bm_followup_settings(kind) VALUES('welcome'),('missed'),('no_next'),('discharge'),('recall');
ALTER TABLE bm_settings ADD COLUMN followup_contact_limit INTEGER NOT NULL DEFAULT 1;
CREATE TABLE bm_followups (
 id TEXT PRIMARY KEY, client_id TEXT NOT NULL REFERENCES bm_clients(id),
 kind TEXT NOT NULL REFERENCES bm_followup_settings(kind),
 consent_by TEXT NOT NULL, consent_at TEXT NOT NULL, consent_record TEXT NOT NULL,
 enrolled_at TEXT NOT NULL, state TEXT NOT NULL DEFAULT 'active' CHECK(state IN ('active','stopped','goal_met')),
 stopped_at TEXT, stopped_reason TEXT, version INTEGER NOT NULL DEFAULT 1
);
CREATE UNIQUE INDEX bm_followup_active ON bm_followups(client_id,kind) WHERE state='active';
CREATE TABLE bm_followup_attempts (
 id TEXT PRIMARY KEY, followup_id TEXT NOT NULL REFERENCES bm_followups(id),
 client_id TEXT NOT NULL REFERENCES bm_clients(id), sequence INTEGER NOT NULL,
 attempted_at TEXT NOT NULL, state TEXT NOT NULL DEFAULT 'reserved',
 UNIQUE(followup_id,sequence)
);
CREATE INDEX bm_followup_contacts ON bm_followup_attempts(client_id,attempted_at);
