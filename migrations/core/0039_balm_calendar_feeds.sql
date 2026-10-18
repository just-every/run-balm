-- Subscription credentials are hashed, revocable and excluded from archives.
CREATE TABLE bm_calendar_feeds (
 practitioner_id TEXT PRIMARY KEY REFERENCES bm_staff(id),
 token_hash TEXT NOT NULL UNIQUE,
 created_at TEXT NOT NULL
);
