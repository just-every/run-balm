-- Clinician-requested AI questions, bound to an immutable note revision.
CREATE TABLE bm_note_checks (
  id TEXT PRIMARY KEY,
  note_id TEXT NOT NULL REFERENCES bm_notes(id),
  revision INTEGER NOT NULL,
  context_sha256 TEXT NOT NULL,
  model TEXT NOT NULL,
  result TEXT NOT NULL,
  checked_by TEXT NOT NULL,
  checked_at TEXT NOT NULL
);
CREATE INDEX bm_note_checks_note ON bm_note_checks(note_id, checked_at);
