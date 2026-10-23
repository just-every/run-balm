ALTER TABLE bm_portal_sessions ADD COLUMN method TEXT NOT NULL DEFAULT 'email' CHECK(method IN ('email','sms'));
ALTER TABLE bm_portal_sessions ADD COLUMN phone TEXT;
CREATE TABLE bm_portal_sms_codes (
 id TEXT PRIMARY KEY, client_id TEXT NOT NULL REFERENCES bm_clients(id), client_version INTEGER NOT NULL,
 code_hash TEXT NOT NULL, created_at TEXT NOT NULL, expires_at TEXT NOT NULL,
 attempts INTEGER NOT NULL DEFAULT 0, used_at TEXT, revoked_at TEXT
);
