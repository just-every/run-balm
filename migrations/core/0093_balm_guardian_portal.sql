-- Delegation is per minor and must be explicitly verified by the owner.
-- No relationship is inferred from a shared email, name, intake or payment.
CREATE TABLE bm_guardian_grants (
 id TEXT PRIMARY KEY, client_id TEXT NOT NULL REFERENCES bm_clients(id),
 email TEXT NOT NULL, name TEXT NOT NULL, relationship TEXT NOT NULL CHECK(relationship IN ('parent','guardian')),
 verification TEXT NOT NULL, granted_by TEXT NOT NULL, granted_at TEXT NOT NULL,
 revoked_at TEXT, UNIQUE(client_id,email,granted_at)
);
CREATE UNIQUE INDEX bm_guardian_one_live ON bm_guardian_grants(client_id,email) WHERE revoked_at IS NULL;
CREATE TABLE bm_guardian_links (
 id TEXT PRIMARY KEY, token_hash TEXT NOT NULL UNIQUE, email TEXT NOT NULL,
 created_at TEXT NOT NULL, expires_at TEXT NOT NULL, used_at TEXT, revoked_at TEXT
);
CREATE TABLE bm_guardian_sessions (
 id TEXT PRIMARY KEY, token_hash TEXT NOT NULL UNIQUE, email TEXT NOT NULL,
 client_id TEXT NOT NULL REFERENCES bm_clients(id), client_version INTEGER NOT NULL,
 created_at TEXT NOT NULL, expires_at TEXT NOT NULL, revoked_at TEXT
);
CREATE TABLE bm_portal_profile_changes (
 id TEXT PRIMARY KEY, client_id TEXT NOT NULL REFERENCES bm_clients(id),
 kind TEXT NOT NULL CHECK(kind IN ('contact','insurance')), payload TEXT NOT NULL CHECK(json_valid(payload)),
 submitted_at TEXT NOT NULL, submitted_by TEXT NOT NULL,
 reviewed_at TEXT, reviewed_by TEXT
);
CREATE TRIGGER bm_guardian_fixed BEFORE UPDATE ON bm_guardian_grants
 WHEN NEW.id IS NOT OLD.id OR NEW.client_id IS NOT OLD.client_id OR NEW.email IS NOT OLD.email OR NEW.name IS NOT OLD.name
 OR NEW.relationship IS NOT OLD.relationship OR NEW.verification IS NOT OLD.verification OR NEW.granted_by IS NOT OLD.granted_by
 OR NEW.granted_at IS NOT OLD.granted_at OR OLD.revoked_at IS NOT NULL
 BEGIN SELECT RAISE(ABORT,'guardian_grant_fixed'); END;
CREATE TRIGGER bm_guardian_client_changed AFTER UPDATE ON bm_clients
 WHEN NEW.version IS NOT OLD.version OR NEW.erased_at IS NOT OLD.erased_at BEGIN
 UPDATE bm_guardian_sessions SET revoked_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE client_id=NEW.id AND revoked_at IS NULL;
 END;
CREATE TRIGGER bm_guardian_grant_revoked AFTER UPDATE OF revoked_at ON bm_guardian_grants WHEN NEW.revoked_at IS NOT NULL BEGIN
 UPDATE bm_guardian_sessions SET revoked_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE email=NEW.email AND revoked_at IS NULL;
 END;
CREATE TRIGGER bm_guardian_grants_kept BEFORE DELETE ON bm_guardian_grants
 WHEN NOT EXISTS(SELECT 1 FROM bm_retention_scope s JOIN bm_retention_permits p ON p.preview_id=s.preview_id WHERE s.table_name='bm_guardian_grants' AND s.record_rowid=OLD.rowid)
 BEGIN SELECT RAISE(ABORT,'guardian_history_kept'); END;
CREATE TRIGGER bm_portal_profile_changes_kept BEFORE DELETE ON bm_portal_profile_changes
 WHEN NOT EXISTS(SELECT 1 FROM bm_retention_scope s JOIN bm_retention_permits p ON p.preview_id=s.preview_id WHERE s.table_name='bm_portal_profile_changes' AND s.record_rowid=OLD.rowid)
 BEGIN SELECT RAISE(ABORT,'profile_history_kept'); END;
CREATE TRIGGER bm_profile_fixed BEFORE UPDATE ON bm_portal_profile_changes
 WHEN NEW.id IS NOT OLD.id OR NEW.client_id IS NOT OLD.client_id OR NEW.kind IS NOT OLD.kind OR NEW.payload IS NOT OLD.payload
 OR NEW.submitted_at IS NOT OLD.submitted_at OR NEW.submitted_by IS NOT OLD.submitted_by OR OLD.reviewed_at IS NOT NULL
 BEGIN SELECT RAISE(ABORT,'profile_submission_fixed'); END;
CREATE TRIGGER bm_guardian_grants_epoch_insert AFTER INSERT ON bm_guardian_grants BEGIN UPDATE bm_retention_epoch SET version=version+1 WHERE id=1; END;
CREATE TRIGGER bm_guardian_grants_epoch_update AFTER UPDATE ON bm_guardian_grants BEGIN UPDATE bm_retention_epoch SET version=version+1 WHERE id=1; END;
CREATE TRIGGER bm_guardian_grants_epoch_delete AFTER DELETE ON bm_guardian_grants BEGIN UPDATE bm_retention_epoch SET version=version+1 WHERE id=1; END;
CREATE TRIGGER bm_portal_profile_changes_epoch_insert AFTER INSERT ON bm_portal_profile_changes BEGIN UPDATE bm_retention_epoch SET version=version+1 WHERE id=1; END;
CREATE TRIGGER bm_portal_profile_changes_epoch_update AFTER UPDATE ON bm_portal_profile_changes BEGIN UPDATE bm_retention_epoch SET version=version+1 WHERE id=1; END;
CREATE TRIGGER bm_portal_profile_changes_epoch_delete AFTER DELETE ON bm_portal_profile_changes BEGIN UPDATE bm_retention_epoch SET version=version+1 WHERE id=1; END;
CREATE TRIGGER bm_guardian_session_payment_revoked AFTER UPDATE OF revoked_at ON bm_guardian_sessions
 WHEN NEW.revoked_at IS NOT NULL BEGIN
 UPDATE bm_pay_links SET expires_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE created_by='patient-portal:'||NEW.id;
 END;
CREATE TRIGGER bm_guardian_profile_client_retained BEFORE UPDATE OF erased_at ON bm_clients
 WHEN NEW.erased_at IS NOT NULL AND (EXISTS(SELECT 1 FROM bm_guardian_grants WHERE client_id=OLD.id) OR EXISTS(SELECT 1 FROM bm_portal_profile_changes WHERE client_id=OLD.id))
 BEGIN SELECT RAISE(ABORT,'clients_with_health_records_are_retained'); END;
