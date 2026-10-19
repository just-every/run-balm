-- The practice sets how long a draft may remain unsigned after it is started.
ALTER TABLE bm_documentation_settings ADD COLUMN unsigned_note_hours INTEGER NOT NULL DEFAULT 24 CHECK(unsigned_note_hours BETWEEN 1 AND 720);
