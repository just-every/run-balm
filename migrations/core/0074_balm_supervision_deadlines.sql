CREATE TABLE bm_supervision_deadlines (
 staff_id TEXT PRIMARY KEY REFERENCES bm_staff(id), state TEXT NOT NULL,
 hours INTEGER NOT NULL CHECK(hours BETWEEN 1 AND 720), source TEXT NOT NULL,
 version INTEGER NOT NULL DEFAULT 1, recorded_at TEXT NOT NULL, recorded_by TEXT NOT NULL
);
ALTER TABLE bm_note_submissions ADD COLUMN plan_id TEXT;
ALTER TABLE bm_note_submissions ADD COLUMN due_at TEXT;
ALTER TABLE bm_note_submissions ADD COLUMN deadline_basis TEXT NOT NULL DEFAULT '{}';
