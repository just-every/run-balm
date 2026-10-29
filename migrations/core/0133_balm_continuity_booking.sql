-- Explicit patient acceptance is separate from historical preparation approval.
CREATE TABLE bm_continuity_offers (
 id TEXT PRIMARY KEY, proposal_id TEXT NOT NULL REFERENCES bm_continuity_proposals(id),
 client_id TEXT NOT NULL REFERENCES bm_clients(id), practitioner_id TEXT NOT NULL REFERENCES bm_staff(id),
 released_at TEXT NOT NULL, released_by TEXT NOT NULL, operator_id TEXT NOT NULL,
 operator_version INTEGER NOT NULL, staff_version INTEGER NOT NULL, session_id TEXT,
 expires_at TEXT NOT NULL, revoked_at TEXT,
 execution_authority INTEGER NOT NULL DEFAULT 1 CHECK(execution_authority IN (0,1))
);
CREATE TABLE bm_continuity_acceptances (
 proposal_id TEXT PRIMARY KEY REFERENCES bm_continuity_proposals(id),
 offer_id TEXT NOT NULL UNIQUE REFERENCES bm_continuity_offers(id),
 client_id TEXT NOT NULL REFERENCES bm_clients(id), accepted_at TEXT NOT NULL,
 appointment_ids TEXT NOT NULL CHECK(json_valid(appointment_ids)),
 authorization TEXT NOT NULL CHECK(json_valid(authorization))
);
CREATE TRIGGER bm_continuity_offer_fixed BEFORE UPDATE ON bm_continuity_offers
 WHEN NEW.id IS NOT OLD.id OR NEW.proposal_id IS NOT OLD.proposal_id OR NEW.client_id IS NOT OLD.client_id
 OR NEW.practitioner_id IS NOT OLD.practitioner_id OR NEW.released_at IS NOT OLD.released_at OR NEW.released_by IS NOT OLD.released_by
 OR NEW.operator_id IS NOT OLD.operator_id OR NEW.operator_version IS NOT OLD.operator_version OR NEW.staff_version IS NOT OLD.staff_version
 OR NEW.session_id IS NOT OLD.session_id OR NEW.expires_at IS NOT OLD.expires_at
 OR (OLD.revoked_at IS NOT NULL AND NEW.revoked_at IS NOT OLD.revoked_at) OR NEW.execution_authority>OLD.execution_authority
 BEGIN SELECT RAISE(ABORT,'continuity_original_kept'); END;
CREATE TRIGGER bm_continuity_acceptance_fixed BEFORE UPDATE ON bm_continuity_acceptances
 BEGIN SELECT RAISE(ABORT,'continuity_original_kept'); END;
CREATE TRIGGER bm_continuity_offer_kept BEFORE DELETE ON bm_continuity_offers
 WHEN NOT EXISTS(SELECT 1 FROM bm_retention_scope s JOIN bm_retention_permits p ON p.preview_id=s.preview_id WHERE s.table_name='bm_continuity_offers' AND s.record_rowid=OLD.rowid)
 BEGIN SELECT RAISE(ABORT,'continuity_original_kept'); END;
CREATE TRIGGER bm_continuity_acceptance_kept BEFORE DELETE ON bm_continuity_acceptances
 WHEN NOT EXISTS(SELECT 1 FROM bm_retention_scope s JOIN bm_retention_permits p ON p.preview_id=s.preview_id WHERE s.table_name='bm_continuity_acceptances' AND s.record_rowid=OLD.rowid)
 BEGIN SELECT RAISE(ABORT,'continuity_original_kept'); END;
CREATE TRIGGER bm_continuity_offer_epoch_insert AFTER INSERT ON bm_continuity_offers BEGIN UPDATE bm_retention_epoch SET version=version+1 WHERE id=1; END;
CREATE TRIGGER bm_continuity_offer_epoch_update AFTER UPDATE ON bm_continuity_offers BEGIN UPDATE bm_retention_epoch SET version=version+1 WHERE id=1; END;
CREATE TRIGGER bm_continuity_offer_epoch_delete AFTER DELETE ON bm_continuity_offers BEGIN UPDATE bm_retention_epoch SET version=version+1 WHERE id=1; END;
CREATE TRIGGER bm_continuity_acceptance_epoch_insert AFTER INSERT ON bm_continuity_acceptances BEGIN UPDATE bm_retention_epoch SET version=version+1 WHERE id=1; END;
CREATE TRIGGER bm_continuity_acceptance_epoch_delete AFTER DELETE ON bm_continuity_acceptances BEGIN UPDATE bm_retention_epoch SET version=version+1 WHERE id=1; END;
