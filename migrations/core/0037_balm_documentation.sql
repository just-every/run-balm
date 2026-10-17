-- Documentation requirements are checked against the exact revision signed.
ALTER TABLE bm_note_revisions ADD COLUMN documentation TEXT CHECK(documentation IS NULL OR json_valid(documentation));
CREATE TABLE bm_documentation_settings (
 id INTEGER PRIMARY KEY CHECK(id=1), late_days INTEGER NOT NULL CHECK(late_days BETWEEN 1 AND 90),
 kx_near_cents INTEGER NOT NULL CHECK(kx_near_cents>=0), version INTEGER NOT NULL DEFAULT 1
);
INSERT INTO bm_documentation_settings(id,late_days,kx_near_cents) VALUES(1,30,20000);
CREATE TABLE bm_payer_documentation (
 payer_id TEXT PRIMARY KEY REFERENCES bm_payers(id), required TEXT NOT NULL CHECK(json_valid(required)), version INTEGER NOT NULL DEFAULT 1
);
