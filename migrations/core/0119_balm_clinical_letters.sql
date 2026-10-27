-- Clinician drafts become an exact patient portal original only on explicit review.
CREATE TABLE bm_clinical_letters (
 id TEXT PRIMARY KEY, client_id TEXT NOT NULL REFERENCES bm_clients(id), episode_id TEXT REFERENCES bm_episodes(id),
 note_id TEXT NOT NULL REFERENCES bm_notes(id), author_id TEXT NOT NULL REFERENCES bm_staff(id), author_email TEXT NOT NULL,
 snapshot TEXT NOT NULL CHECK(json_valid(snapshot)), body TEXT NOT NULL, revision INTEGER NOT NULL,
 content_base64 TEXT NOT NULL, sha256 TEXT NOT NULL, byte_length INTEGER NOT NULL,
 created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE TABLE bm_letter_deliveries (
 letter_id TEXT PRIMARY KEY REFERENCES bm_clinical_letters(id), document_id TEXT UNIQUE NOT NULL REFERENCES bm_chart_documents(id),
 client_id TEXT NOT NULL REFERENCES bm_clients(id), channel TEXT NOT NULL CHECK(channel='portal'),
 delivered_at TEXT NOT NULL, delivered_by TEXT NOT NULL, sha256 TEXT NOT NULL
);
CREATE TRIGGER bm_letter_identity_fixed BEFORE UPDATE ON bm_clinical_letters WHEN NEW.id IS NOT OLD.id OR NEW.client_id IS NOT OLD.client_id OR NEW.episode_id IS NOT OLD.episode_id OR NEW.note_id IS NOT OLD.note_id OR NEW.author_id IS NOT OLD.author_id OR NEW.author_email IS NOT OLD.author_email OR NEW.snapshot IS NOT OLD.snapshot OR NEW.created_at IS NOT OLD.created_at OR EXISTS(SELECT 1 FROM bm_letter_deliveries WHERE letter_id=OLD.id) BEGIN SELECT RAISE(ABORT,'letter_original_fixed'); END;
CREATE TRIGGER bm_letter_delivery_fixed BEFORE UPDATE ON bm_letter_deliveries BEGIN SELECT RAISE(ABORT,'letter_original_fixed'); END;
CREATE TRIGGER bm_letter_delivery_patient BEFORE INSERT ON bm_letter_deliveries WHEN NOT EXISTS(SELECT 1 FROM bm_clinical_letters l JOIN bm_chart_documents d ON d.id=NEW.document_id WHERE l.id=NEW.letter_id AND l.client_id=NEW.client_id AND d.client_id=l.client_id AND d.sha256=l.sha256 AND NEW.sha256=l.sha256 AND d.content_base64=l.content_base64) BEGIN SELECT RAISE(ABORT,'letter_original_mismatch'); END;
CREATE TRIGGER bm_clinical_letters_kept BEFORE DELETE ON bm_clinical_letters WHEN NOT EXISTS(SELECT 1 FROM bm_retention_scope s JOIN bm_retention_permits p ON p.preview_id=s.preview_id WHERE s.table_name='bm_clinical_letters' AND s.record_rowid=OLD.rowid) BEGIN SELECT RAISE(ABORT,'letter_requires_retention_review'); END;
CREATE TRIGGER bm_clinical_letters_epoch_insert AFTER INSERT ON bm_clinical_letters BEGIN UPDATE bm_retention_epoch SET version=version+1 WHERE id=1; END;
CREATE TRIGGER bm_clinical_letters_epoch_update AFTER UPDATE ON bm_clinical_letters BEGIN UPDATE bm_retention_epoch SET version=version+1 WHERE id=1; END;
CREATE TRIGGER bm_clinical_letters_epoch_delete AFTER DELETE ON bm_clinical_letters BEGIN UPDATE bm_retention_epoch SET version=version+1 WHERE id=1; END;
CREATE TRIGGER bm_letter_deliveries_kept BEFORE DELETE ON bm_letter_deliveries WHEN NOT EXISTS(SELECT 1 FROM bm_retention_scope s JOIN bm_retention_permits p ON p.preview_id=s.preview_id WHERE s.table_name='bm_letter_deliveries' AND s.record_rowid=OLD.rowid) BEGIN SELECT RAISE(ABORT,'letter_requires_retention_review'); END;
CREATE TRIGGER bm_letter_deliveries_epoch_insert AFTER INSERT ON bm_letter_deliveries BEGIN UPDATE bm_retention_epoch SET version=version+1 WHERE id=1; END;
CREATE TRIGGER bm_letter_deliveries_epoch_update AFTER UPDATE ON bm_letter_deliveries BEGIN UPDATE bm_retention_epoch SET version=version+1 WHERE id=1; END;
CREATE TRIGGER bm_letter_deliveries_epoch_delete AFTER DELETE ON bm_letter_deliveries BEGIN UPDATE bm_retention_epoch SET version=version+1 WHERE id=1; END;
CREATE TRIGGER bm_letter_episode_fixed BEFORE UPDATE ON bm_episode_records WHEN OLD.record_kind='document' AND NEW.episode_id IS NOT OLD.episode_id AND EXISTS(SELECT 1 FROM bm_letter_deliveries WHERE document_id=OLD.record_id) BEGIN SELECT RAISE(ABORT,'letter_original_fixed'); END;
