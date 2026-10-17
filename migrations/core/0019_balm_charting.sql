-- Balm charting: discipline templates, signed notes locked against change,
-- addenda, CPT minutes per note, plans of care certified by the referring
-- physician through a one-use link, and the install's own scribe model key.
ALTER TABLE bm_staff ADD COLUMN credentials TEXT NOT NULL DEFAULT '';
ALTER TABLE bm_services ADD COLUMN note_template TEXT NOT NULL DEFAULT '';

ALTER TABLE bm_notes ADD COLUMN template TEXT NOT NULL DEFAULT '';
ALTER TABLE bm_notes ADD COLUMN signed_at TEXT;
ALTER TABLE bm_notes ADD COLUMN signed_revision INTEGER;
ALTER TABLE bm_notes ADD COLUMN signer_name TEXT;
ALTER TABLE bm_notes ADD COLUMN signer_credentials TEXT;
ALTER TABLE bm_notes ADD COLUMN signed_sha256 TEXT;
ALTER TABLE bm_note_revisions ADD COLUMN sections TEXT CHECK(sections IS NULL OR json_valid(sections));
ALTER TABLE bm_note_revisions ADD COLUMN charges TEXT CHECK(charges IS NULL OR json_valid(charges));
ALTER TABLE bm_note_revisions ADD COLUMN drafted_by TEXT NOT NULL DEFAULT 'author' CHECK(drafted_by IN ('author','scribe'));

-- A signed note is locked: no new revision, no rewrite, and its signature never changes.
CREATE TRIGGER bm_note_locked_revision BEFORE INSERT ON bm_note_revisions
 WHEN (SELECT signed_at FROM bm_notes WHERE id=NEW.note_id) IS NOT NULL BEGIN SELECT RAISE(ABORT,'note_locked'); END;
CREATE TRIGGER bm_note_revision_fixed BEFORE UPDATE ON bm_note_revisions BEGIN SELECT RAISE(ABORT,'note_locked'); END;
CREATE TRIGGER bm_note_signature_fixed BEFORE UPDATE ON bm_notes WHEN OLD.signed_at IS NOT NULL BEGIN SELECT RAISE(ABORT,'note_locked'); END;

-- Changes after signing are addenda, each signed by its author when written.
CREATE TABLE bm_note_addenda (
 id TEXT PRIMARY KEY, note_id TEXT NOT NULL REFERENCES bm_notes(id), author_id TEXT NOT NULL REFERENCES bm_staff(id),
 body TEXT NOT NULL, written_at TEXT NOT NULL, signer_name TEXT NOT NULL, signer_credentials TEXT NOT NULL, sha256 TEXT NOT NULL
);
CREATE INDEX bm_note_addenda_note ON bm_note_addenda(note_id,written_at);
CREATE TRIGGER bm_note_addenda_fixed BEFORE UPDATE ON bm_note_addenda BEGIN SELECT RAISE(ABORT,'note_locked'); END;
CREATE TRIGGER bm_note_addenda_kept BEFORE DELETE ON bm_note_addenda BEGIN SELECT RAISE(ABORT,'note_locked'); END;

-- A plan of care is signed by its therapist when sent; its content never changes.
-- The referring physician certifies it once through a link stored only as a hash.
CREATE TABLE bm_plans_of_care (
 id TEXT PRIMARY KEY, client_id TEXT NOT NULL REFERENCES bm_clients(id), author_id TEXT NOT NULL REFERENCES bm_staff(id),
 note_id TEXT REFERENCES bm_notes(id), content TEXT NOT NULL CHECK(json_valid(content)), content_sha256 TEXT NOT NULL,
 therapist_name TEXT NOT NULL, therapist_credentials TEXT NOT NULL, created_at TEXT NOT NULL,
 physician_name TEXT NOT NULL, physician_email TEXT NOT NULL,
 sign_token_hash TEXT UNIQUE, sign_token_expires_at TEXT, sent_at TEXT NOT NULL,
 status TEXT NOT NULL CHECK(status IN ('sent','certified')),
 certified_at TEXT, certifier_name TEXT, certifier_credentials TEXT, certifier_npi TEXT,
 version INTEGER NOT NULL DEFAULT 1
);
CREATE INDEX bm_plans_client ON bm_plans_of_care(client_id,created_at);
CREATE TRIGGER bm_plan_content_fixed BEFORE UPDATE ON bm_plans_of_care
 WHEN NEW.content IS NOT OLD.content OR NEW.content_sha256 IS NOT OLD.content_sha256 OR OLD.status='certified' BEGIN SELECT RAISE(ABORT,'plan_locked'); END;

-- The scribe's model: the owner's own key, sealed with the install's session secret.
CREATE TABLE bm_scribe (
 id INTEGER PRIMARY KEY CHECK(id=1), provider TEXT NOT NULL CHECK(provider IN ('anthropic','openai')),
 endpoint TEXT NOT NULL, model TEXT NOT NULL, workspace TEXT NOT NULL DEFAULT '', key_sealed TEXT NOT NULL, key_hint TEXT NOT NULL,
 updated_by TEXT NOT NULL, updated_at TEXT NOT NULL
);
