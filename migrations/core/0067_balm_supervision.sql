-- Immutable author signatures wait for their named supervisor. A returned
-- submission stays in history; its return permits a new revision and signature.
CREATE TABLE bm_note_submissions (
 id TEXT PRIMARY KEY, note_id TEXT NOT NULL REFERENCES bm_notes(id), revision INTEGER NOT NULL,
 supervisor_id TEXT NOT NULL REFERENCES bm_staff(id), author_name TEXT NOT NULL,
 author_credentials TEXT NOT NULL, submitted_at TEXT NOT NULL, sha256 TEXT NOT NULL,
 UNIQUE(note_id,revision)
);
CREATE TABLE bm_note_reviews (
 submission_id TEXT PRIMARY KEY REFERENCES bm_note_submissions(id),
 decision TEXT NOT NULL CHECK(decision IN ('returned','cosigned')), reason TEXT NOT NULL,
 reviewed_at TEXT NOT NULL, reviewed_by TEXT NOT NULL
);
CREATE TRIGGER bm_submission_fixed BEFORE UPDATE ON bm_note_submissions BEGIN SELECT RAISE(ABORT,'note_locked'); END;
CREATE TRIGGER bm_submission_kept BEFORE DELETE ON bm_note_submissions WHEN NOT EXISTS(SELECT 1 FROM bm_retention_scope s JOIN bm_retention_permits p ON p.preview_id=s.preview_id WHERE s.table_name='bm_note_submissions' AND s.record_rowid=OLD.rowid) BEGIN SELECT RAISE(ABORT,'note_locked'); END;
CREATE TRIGGER bm_review_fixed BEFORE UPDATE ON bm_note_reviews BEGIN SELECT RAISE(ABORT,'note_locked'); END;
CREATE TRIGGER bm_review_kept BEFORE DELETE ON bm_note_reviews WHEN NOT EXISTS(SELECT 1 FROM bm_retention_scope s JOIN bm_retention_permits p ON p.preview_id=s.preview_id WHERE s.table_name='bm_note_reviews' AND s.record_rowid=OLD.rowid) BEGIN SELECT RAISE(ABORT,'note_locked'); END;
CREATE TRIGGER bm_submitted_revision BEFORE INSERT ON bm_note_revisions WHEN EXISTS(
 SELECT 1 FROM bm_note_submissions s WHERE s.note_id=NEW.note_id AND NOT EXISTS(SELECT 1 FROM bm_note_reviews r WHERE r.submission_id=s.id)
) BEGIN SELECT RAISE(ABORT,'note_locked'); END;
CREATE TRIGGER bm_submitted_measure_insert BEFORE INSERT ON bm_measures WHEN EXISTS(
 SELECT 1 FROM bm_note_submissions s WHERE s.note_id=NEW.note_id AND NOT EXISTS(SELECT 1 FROM bm_note_reviews r WHERE r.submission_id=s.id)
) BEGIN SELECT RAISE(ABORT,'note_locked'); END;
CREATE TRIGGER bm_submitted_measure_delete BEFORE DELETE ON bm_measures WHEN NOT EXISTS(SELECT 1 FROM bm_retention_scope s JOIN bm_retention_permits p ON p.preview_id=s.preview_id WHERE s.table_name='bm_measures' AND s.record_rowid=OLD.rowid) AND EXISTS(
 SELECT 1 FROM bm_note_submissions s WHERE s.note_id=OLD.note_id AND NOT EXISTS(SELECT 1 FROM bm_note_reviews r WHERE r.submission_id=s.id)
) BEGIN SELECT RAISE(ABORT,'note_locked'); END;
ALTER TABLE bm_payers ADD COLUMN supervisor_billing INTEGER NOT NULL DEFAULT 1 CHECK(supervisor_billing IN (0,1));
CREATE TRIGGER bm_retention_epoch_bm_note_submissions_insert AFTER INSERT ON bm_note_submissions BEGIN UPDATE bm_retention_epoch SET version=version+1 WHERE id=1; END;
CREATE TRIGGER bm_retention_epoch_bm_note_submissions_update AFTER UPDATE ON bm_note_submissions BEGIN UPDATE bm_retention_epoch SET version=version+1 WHERE id=1; END;
CREATE TRIGGER bm_retention_epoch_bm_note_submissions_delete AFTER DELETE ON bm_note_submissions BEGIN UPDATE bm_retention_epoch SET version=version+1 WHERE id=1; END;
CREATE TRIGGER bm_retention_epoch_bm_note_reviews_insert AFTER INSERT ON bm_note_reviews BEGIN UPDATE bm_retention_epoch SET version=version+1 WHERE id=1; END;
CREATE TRIGGER bm_retention_epoch_bm_note_reviews_update AFTER UPDATE ON bm_note_reviews BEGIN UPDATE bm_retention_epoch SET version=version+1 WHERE id=1; END;
CREATE TRIGGER bm_retention_epoch_bm_note_reviews_delete AFTER DELETE ON bm_note_reviews BEGIN UPDATE bm_retention_epoch SET version=version+1 WHERE id=1; END;
