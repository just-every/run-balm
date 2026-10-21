-- PAY-007: dated requests, exact preparation and immutable issued originals.
CREATE TABLE bm_estimate_requests (
 id TEXT PRIMARY KEY, client_id TEXT NOT NULL REFERENCES bm_clients(id), appointment_id TEXT REFERENCES bm_appointments(id),
 coverage_kind TEXT NOT NULL CHECK(coverage_kind IN ('uninsured','self_pay')), coverage_attestation TEXT NOT NULL,
 requested_at TEXT NOT NULL, due_on TEXT NOT NULL, created_by TEXT NOT NULL
);
CREATE TABLE bm_estimate_drafts (
 id TEXT PRIMARY KEY, request_id TEXT NOT NULL REFERENCES bm_estimate_requests(id),
 payload TEXT NOT NULL CHECK(json_valid(payload)), basis TEXT NOT NULL CHECK(json_valid(basis)), sha256 TEXT NOT NULL,
 prepared_at TEXT NOT NULL, prepared_by TEXT NOT NULL
);
CREATE TABLE bm_estimates (
 id TEXT PRIMARY KEY, request_id TEXT NOT NULL UNIQUE REFERENCES bm_estimate_requests(id), draft_id TEXT NOT NULL UNIQUE REFERENCES bm_estimate_drafts(id),
 client_id TEXT NOT NULL REFERENCES bm_clients(id), from_on TEXT NOT NULL, through_on TEXT NOT NULL, total_cents INTEGER NOT NULL,
 payload TEXT NOT NULL CHECK(json_valid(payload)), sha256 TEXT NOT NULL, pdf BLOB NOT NULL, issued_at TEXT NOT NULL, issued_by TEXT NOT NULL
);
CREATE INDEX bm_estimates_client ON bm_estimates(client_id,issued_at);
CREATE TRIGGER bm_estimate_requests_fixed BEFORE UPDATE ON bm_estimate_requests BEGIN SELECT RAISE(ABORT,'estimate_original_is_immutable'); END;
CREATE TRIGGER bm_estimate_requests_kept BEFORE DELETE ON bm_estimate_requests WHEN NOT EXISTS(SELECT 1 FROM bm_retention_scope s JOIN bm_retention_permits p ON p.preview_id=s.preview_id WHERE s.table_name='bm_estimate_requests' AND s.record_rowid=OLD.rowid) BEGIN SELECT RAISE(ABORT,'estimate_original_is_immutable'); END;
CREATE TRIGGER bm_estimate_requests_epoch_insert AFTER INSERT ON bm_estimate_requests BEGIN UPDATE bm_retention_epoch SET version=version+1 WHERE id=1; END;
CREATE TRIGGER bm_estimate_requests_epoch_update AFTER UPDATE ON bm_estimate_requests BEGIN UPDATE bm_retention_epoch SET version=version+1 WHERE id=1; END;
CREATE TRIGGER bm_estimate_requests_epoch_delete AFTER DELETE ON bm_estimate_requests BEGIN UPDATE bm_retention_epoch SET version=version+1 WHERE id=1; END;
CREATE TRIGGER bm_estimate_drafts_fixed BEFORE UPDATE ON bm_estimate_drafts BEGIN SELECT RAISE(ABORT,'estimate_original_is_immutable'); END;
CREATE TRIGGER bm_estimate_drafts_kept BEFORE DELETE ON bm_estimate_drafts WHEN NOT EXISTS(SELECT 1 FROM bm_retention_scope s JOIN bm_retention_permits p ON p.preview_id=s.preview_id WHERE s.table_name='bm_estimate_drafts' AND s.record_rowid=OLD.rowid) BEGIN SELECT RAISE(ABORT,'estimate_original_is_immutable'); END;
CREATE TRIGGER bm_estimate_drafts_epoch_insert AFTER INSERT ON bm_estimate_drafts BEGIN UPDATE bm_retention_epoch SET version=version+1 WHERE id=1; END;
CREATE TRIGGER bm_estimate_drafts_epoch_update AFTER UPDATE ON bm_estimate_drafts BEGIN UPDATE bm_retention_epoch SET version=version+1 WHERE id=1; END;
CREATE TRIGGER bm_estimate_drafts_epoch_delete AFTER DELETE ON bm_estimate_drafts BEGIN UPDATE bm_retention_epoch SET version=version+1 WHERE id=1; END;
CREATE TRIGGER bm_estimates_fixed BEFORE UPDATE ON bm_estimates BEGIN SELECT RAISE(ABORT,'estimate_original_is_immutable'); END;
CREATE TRIGGER bm_estimates_kept BEFORE DELETE ON bm_estimates WHEN NOT EXISTS(SELECT 1 FROM bm_retention_scope s JOIN bm_retention_permits p ON p.preview_id=s.preview_id WHERE s.table_name='bm_estimates' AND s.record_rowid=OLD.rowid) BEGIN SELECT RAISE(ABORT,'estimate_original_is_immutable'); END;
CREATE TRIGGER bm_estimates_epoch_insert AFTER INSERT ON bm_estimates BEGIN UPDATE bm_retention_epoch SET version=version+1 WHERE id=1; END;
CREATE TRIGGER bm_estimates_epoch_update AFTER UPDATE ON bm_estimates BEGIN UPDATE bm_retention_epoch SET version=version+1 WHERE id=1; END;
CREATE TRIGGER bm_estimates_epoch_delete AFTER DELETE ON bm_estimates BEGIN UPDATE bm_retention_epoch SET version=version+1 WHERE id=1; END;
