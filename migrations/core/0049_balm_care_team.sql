-- CHART-013: owner-granted read-only care-team access to one patient's notes,
-- and audited 12-hour break-glass openings with the owner's in-app notice.
CREATE TABLE bm_care_grants (
 id TEXT PRIMARY KEY, client_id TEXT NOT NULL REFERENCES bm_clients(id), practitioner_id TEXT NOT NULL REFERENCES bm_staff(id),
 granted_by TEXT NOT NULL, granted_at TEXT NOT NULL, revoked_by TEXT, revoked_at TEXT
);
CREATE UNIQUE INDEX bm_care_grants_live ON bm_care_grants(client_id,practitioner_id) WHERE revoked_at IS NULL;
CREATE TRIGGER bm_care_grants_revoke_only BEFORE UPDATE ON bm_care_grants
 WHEN OLD.revoked_at IS NOT NULL OR NEW.id IS NOT OLD.id OR NEW.client_id IS NOT OLD.client_id OR NEW.practitioner_id IS NOT OLD.practitioner_id
  OR NEW.granted_by IS NOT OLD.granted_by OR NEW.granted_at IS NOT OLD.granted_at
 BEGIN SELECT RAISE(ABORT,'care_grant_fixed'); END;
CREATE TRIGGER bm_care_grants_no_delete BEFORE DELETE ON bm_care_grants BEGIN SELECT RAISE(ABORT,'care_grant_fixed'); END;

CREATE TABLE bm_break_glass (
 id TEXT PRIMARY KEY, client_id TEXT NOT NULL REFERENCES bm_clients(id), practitioner_id TEXT NOT NULL REFERENCES bm_staff(id),
 opened_by TEXT NOT NULL, reason TEXT NOT NULL, opened_at TEXT NOT NULL, expires_at TEXT NOT NULL,
 ended_by TEXT, ended_at TEXT, acknowledged_by TEXT, acknowledged_at TEXT
);
CREATE INDEX bm_break_glass_open ON bm_break_glass(client_id,practitioner_id,expires_at);
CREATE TRIGGER bm_break_glass_fixed BEFORE UPDATE ON bm_break_glass
 WHEN NEW.id IS NOT OLD.id OR NEW.client_id IS NOT OLD.client_id OR NEW.practitioner_id IS NOT OLD.practitioner_id OR NEW.opened_by IS NOT OLD.opened_by
  OR NEW.reason IS NOT OLD.reason OR NEW.opened_at IS NOT OLD.opened_at OR NEW.expires_at IS NOT OLD.expires_at
  OR (OLD.ended_at IS NOT NULL AND NEW.ended_at IS NOT OLD.ended_at) OR (OLD.acknowledged_at IS NOT NULL AND NEW.acknowledged_at IS NOT OLD.acknowledged_at)
 BEGIN SELECT RAISE(ABORT,'break_glass_fixed'); END;
CREATE TRIGGER bm_break_glass_no_delete BEFORE DELETE ON bm_break_glass BEGIN SELECT RAISE(ABORT,'break_glass_fixed'); END;
