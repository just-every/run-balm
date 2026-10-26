-- Staff record external payer work; clinical packets and decisions stay fixed.
CREATE TABLE bm_authorization_requests (
 id TEXT PRIMARY KEY, client_id TEXT NOT NULL REFERENCES bm_clients(id),
 referral_id TEXT NOT NULL REFERENCES bm_referrals(id), policy_id TEXT NOT NULL REFERENCES bm_policies(id),
 episode_id TEXT REFERENCES bm_episodes(id), note_id TEXT NOT NULL REFERENCES bm_notes(id), plan_id TEXT NOT NULL REFERENCES bm_plans_of_care(id),
 payload TEXT NOT NULL CHECK(json_valid(payload)), pdf BLOB NOT NULL, sha256 TEXT NOT NULL,
 prepared_at TEXT NOT NULL, prepared_by TEXT NOT NULL
);
CREATE INDEX bm_authorization_requests_client ON bm_authorization_requests(client_id,prepared_at);
CREATE TABLE bm_authorization_submissions (
 request_id TEXT PRIMARY KEY REFERENCES bm_authorization_requests(id),
 channel TEXT NOT NULL CHECK(channel IN ('availity','payer_portal')), submitted_on TEXT NOT NULL,
 reference TEXT NOT NULL, recorded_at TEXT NOT NULL, recorded_by TEXT NOT NULL
);
CREATE TABLE bm_authorization_decisions (
 request_id TEXT PRIMARY KEY REFERENCES bm_authorization_submissions(request_id),
 decision TEXT NOT NULL CHECK(decision IN ('approved','denied')), decided_on TEXT NOT NULL,
 reference TEXT NOT NULL, reason TEXT NOT NULL, authorization_id TEXT UNIQUE REFERENCES bm_authorizations(id),
 recorded_at TEXT NOT NULL, recorded_by TEXT NOT NULL,
 CHECK((decision='approved' AND authorization_id IS NOT NULL) OR (decision='denied' AND authorization_id IS NULL))
);
CREATE TRIGGER bm_authorization_requests_fixed BEFORE UPDATE ON bm_authorization_requests BEGIN SELECT RAISE(ABORT,'authorization_original_fixed'); END;
CREATE TRIGGER bm_authorization_requests_kept BEFORE DELETE ON bm_authorization_requests WHEN NOT EXISTS(SELECT 1 FROM bm_retention_scope s JOIN bm_retention_permits p ON p.preview_id=s.preview_id WHERE s.table_name='bm_authorization_requests' AND s.record_rowid=OLD.rowid) BEGIN SELECT RAISE(ABORT,'authorization_requires_retention_review'); END;
CREATE TRIGGER bm_authorization_requests_epoch_insert AFTER INSERT ON bm_authorization_requests BEGIN UPDATE bm_retention_epoch SET version=version+1 WHERE id=1; END;
CREATE TRIGGER bm_authorization_requests_epoch_delete AFTER DELETE ON bm_authorization_requests BEGIN UPDATE bm_retention_epoch SET version=version+1 WHERE id=1; END;
CREATE TRIGGER bm_authorization_submissions_fixed BEFORE UPDATE ON bm_authorization_submissions BEGIN SELECT RAISE(ABORT,'authorization_original_fixed'); END;
CREATE TRIGGER bm_authorization_submissions_kept BEFORE DELETE ON bm_authorization_submissions WHEN NOT EXISTS(SELECT 1 FROM bm_retention_scope s JOIN bm_retention_permits p ON p.preview_id=s.preview_id WHERE s.table_name='bm_authorization_submissions' AND s.record_rowid=OLD.rowid) BEGIN SELECT RAISE(ABORT,'authorization_requires_retention_review'); END;
CREATE TRIGGER bm_authorization_submissions_epoch_insert AFTER INSERT ON bm_authorization_submissions BEGIN UPDATE bm_retention_epoch SET version=version+1 WHERE id=1; END;
CREATE TRIGGER bm_authorization_submissions_epoch_delete AFTER DELETE ON bm_authorization_submissions BEGIN UPDATE bm_retention_epoch SET version=version+1 WHERE id=1; END;
CREATE TRIGGER bm_authorization_decisions_fixed BEFORE UPDATE ON bm_authorization_decisions BEGIN SELECT RAISE(ABORT,'authorization_original_fixed'); END;
CREATE TRIGGER bm_authorization_decisions_kept BEFORE DELETE ON bm_authorization_decisions WHEN NOT EXISTS(SELECT 1 FROM bm_retention_scope s JOIN bm_retention_permits p ON p.preview_id=s.preview_id WHERE s.table_name='bm_authorization_decisions' AND s.record_rowid=OLD.rowid) BEGIN SELECT RAISE(ABORT,'authorization_requires_retention_review'); END;
CREATE TRIGGER bm_authorization_decisions_epoch_insert AFTER INSERT ON bm_authorization_decisions BEGIN UPDATE bm_retention_epoch SET version=version+1 WHERE id=1; END;
CREATE TRIGGER bm_authorization_decisions_epoch_delete AFTER DELETE ON bm_authorization_decisions BEGIN UPDATE bm_retention_epoch SET version=version+1 WHERE id=1; END;
