-- Balm: the scribe is Ready only after its test passes. Saving settings runs the
-- test; the last result is kept here. Saved keys start untested.
ALTER TABLE bm_scribe ADD COLUMN checked_at TEXT;
ALTER TABLE bm_scribe ADD COLUMN check_ok INTEGER NOT NULL DEFAULT 0 CHECK(check_ok IN (0,1));
ALTER TABLE bm_scribe ADD COLUMN check_message TEXT NOT NULL DEFAULT '';
