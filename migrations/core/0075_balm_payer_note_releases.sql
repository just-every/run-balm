-- Payer-request releases are immutable, human-approved snapshots, never outbound sends.
CREATE TABLE bm_note_releases (
 id TEXT PRIMARY KEY, client_id TEXT NOT NULL REFERENCES bm_clients(id), payer_id TEXT NOT NULL REFERENCES bm_payers(id),
 purpose TEXT NOT NULL, reference TEXT NOT NULL, appointment_ids TEXT NOT NULL, payload TEXT NOT NULL,
 pdf BLOB NOT NULL, sha256 TEXT NOT NULL, prepared_at TEXT NOT NULL, prepared_by TEXT NOT NULL
);
CREATE TABLE bm_note_release_approvals (
 release_id TEXT PRIMARY KEY REFERENCES bm_note_releases(id), sha256 TEXT NOT NULL,
 approved_at TEXT NOT NULL, approved_by TEXT NOT NULL, expires_at TEXT NOT NULL
);
CREATE TABLE bm_note_release_revocations (
 release_id TEXT PRIMARY KEY REFERENCES bm_note_releases(id), revoked_at TEXT NOT NULL, revoked_by TEXT NOT NULL
);
CREATE TRIGGER bm_note_releases_fixed BEFORE UPDATE ON bm_note_releases BEGIN SELECT RAISE(ABORT,'note_locked'); END;
CREATE TRIGGER bm_note_releases_kept BEFORE DELETE ON bm_note_releases WHEN NOT EXISTS(SELECT 1 FROM bm_retention_scope s JOIN bm_retention_permits p ON p.preview_id=s.preview_id WHERE s.table_name='bm_note_releases' AND s.record_rowid=OLD.rowid) BEGIN SELECT RAISE(ABORT,'note_locked'); END;
CREATE TRIGGER bm_note_releases_epoch_insert AFTER INSERT ON bm_note_releases BEGIN UPDATE bm_retention_epoch SET version=version+1 WHERE id=1; END;
CREATE TRIGGER bm_note_releases_epoch_update AFTER UPDATE ON bm_note_releases BEGIN UPDATE bm_retention_epoch SET version=version+1 WHERE id=1; END;
CREATE TRIGGER bm_note_releases_epoch_delete AFTER DELETE ON bm_note_releases BEGIN UPDATE bm_retention_epoch SET version=version+1 WHERE id=1; END;
CREATE TRIGGER bm_note_release_approvals_fixed BEFORE UPDATE ON bm_note_release_approvals BEGIN SELECT RAISE(ABORT,'note_locked'); END;
CREATE TRIGGER bm_note_release_approvals_kept BEFORE DELETE ON bm_note_release_approvals WHEN NOT EXISTS(SELECT 1 FROM bm_retention_scope s JOIN bm_retention_permits p ON p.preview_id=s.preview_id WHERE s.table_name='bm_note_release_approvals' AND s.record_rowid=OLD.rowid) BEGIN SELECT RAISE(ABORT,'note_locked'); END;
CREATE TRIGGER bm_note_release_approvals_epoch_insert AFTER INSERT ON bm_note_release_approvals BEGIN UPDATE bm_retention_epoch SET version=version+1 WHERE id=1; END;
CREATE TRIGGER bm_note_release_approvals_epoch_update AFTER UPDATE ON bm_note_release_approvals BEGIN UPDATE bm_retention_epoch SET version=version+1 WHERE id=1; END;
CREATE TRIGGER bm_note_release_approvals_epoch_delete AFTER DELETE ON bm_note_release_approvals BEGIN UPDATE bm_retention_epoch SET version=version+1 WHERE id=1; END;
CREATE TRIGGER bm_note_release_revocations_fixed BEFORE UPDATE ON bm_note_release_revocations BEGIN SELECT RAISE(ABORT,'note_locked'); END;
CREATE TRIGGER bm_note_release_revocations_kept BEFORE DELETE ON bm_note_release_revocations WHEN NOT EXISTS(SELECT 1 FROM bm_retention_scope s JOIN bm_retention_permits p ON p.preview_id=s.preview_id WHERE s.table_name='bm_note_release_revocations' AND s.record_rowid=OLD.rowid) BEGIN SELECT RAISE(ABORT,'note_locked'); END;
CREATE TRIGGER bm_note_release_revocations_epoch_insert AFTER INSERT ON bm_note_release_revocations BEGIN UPDATE bm_retention_epoch SET version=version+1 WHERE id=1; END;
CREATE TRIGGER bm_note_release_revocations_epoch_update AFTER UPDATE ON bm_note_release_revocations BEGIN UPDATE bm_retention_epoch SET version=version+1 WHERE id=1; END;
CREATE TRIGGER bm_note_release_revocations_epoch_delete AFTER DELETE ON bm_note_release_revocations BEGIN UPDATE bm_retention_epoch SET version=version+1 WHERE id=1; END;
