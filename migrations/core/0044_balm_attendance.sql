-- An attendance-started charge remains an unapproved, unnumbered invoice draft.
ALTER TABLE bm_invoices ADD COLUMN attendance_started INTEGER NOT NULL DEFAULT 0 CHECK(attendance_started IN (0,1));
