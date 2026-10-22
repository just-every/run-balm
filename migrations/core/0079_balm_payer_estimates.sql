-- Payer-authored AEOB originals are manually matched, reviewed and published.
-- This performs no payer submission, calculation, polling or outbound delivery.
CREATE TABLE bm_aeob_sources (
 id TEXT PRIMARY KEY,client_id TEXT NOT NULL REFERENCES bm_clients(id),policy_id TEXT NOT NULL REFERENCES bm_policies(id),
 snapshot TEXT NOT NULL CHECK(json_valid(snapshot)),source_reference TEXT NOT NULL,source_date TEXT NOT NULL,match_evidence TEXT NOT NULL,
 filename TEXT NOT NULL,content_base64 TEXT NOT NULL,file_sha256 TEXT NOT NULL,sha256 TEXT NOT NULL,prepared_at TEXT NOT NULL,prepared_by TEXT NOT NULL,
 UNIQUE(client_id,policy_id,source_reference,file_sha256)
);
CREATE TABLE bm_aeob_issues (
 source_id TEXT PRIMARY KEY REFERENCES bm_aeob_sources(id),sha256 TEXT NOT NULL,portal_consent TEXT NOT NULL,
 issued_at TEXT NOT NULL,issued_by TEXT NOT NULL
);
CREATE INDEX bm_aeob_client ON bm_aeob_sources(client_id,prepared_at);
CREATE TRIGGER bm_aeob_sources_fixed BEFORE UPDATE ON bm_aeob_sources BEGIN SELECT RAISE(ABORT,'payer_estimate_original_is_immutable'); END;
CREATE TRIGGER bm_aeob_sources_kept BEFORE DELETE ON bm_aeob_sources WHEN NOT EXISTS(SELECT 1 FROM bm_retention_scope s JOIN bm_retention_permits p ON p.preview_id=s.preview_id WHERE s.table_name='bm_aeob_sources' AND s.record_rowid=OLD.rowid) BEGIN SELECT RAISE(ABORT,'payer_estimate_original_is_immutable'); END;
CREATE TRIGGER bm_aeob_sources_epoch_insert AFTER INSERT ON bm_aeob_sources BEGIN UPDATE bm_retention_epoch SET version=version+1 WHERE id=1; END;
CREATE TRIGGER bm_aeob_sources_epoch_update AFTER UPDATE ON bm_aeob_sources BEGIN UPDATE bm_retention_epoch SET version=version+1 WHERE id=1; END;
CREATE TRIGGER bm_aeob_sources_epoch_delete AFTER DELETE ON bm_aeob_sources BEGIN UPDATE bm_retention_epoch SET version=version+1 WHERE id=1; END;
CREATE TRIGGER bm_aeob_issues_fixed BEFORE UPDATE ON bm_aeob_issues BEGIN SELECT RAISE(ABORT,'payer_estimate_original_is_immutable'); END;
CREATE TRIGGER bm_aeob_issues_kept BEFORE DELETE ON bm_aeob_issues WHEN NOT EXISTS(SELECT 1 FROM bm_retention_scope s JOIN bm_retention_permits p ON p.preview_id=s.preview_id WHERE s.table_name='bm_aeob_issues' AND s.record_rowid=OLD.rowid) BEGIN SELECT RAISE(ABORT,'payer_estimate_original_is_immutable'); END;
CREATE TRIGGER bm_aeob_issues_epoch_insert AFTER INSERT ON bm_aeob_issues BEGIN UPDATE bm_retention_epoch SET version=version+1 WHERE id=1; END;
CREATE TRIGGER bm_aeob_issues_epoch_update AFTER UPDATE ON bm_aeob_issues BEGIN UPDATE bm_retention_epoch SET version=version+1 WHERE id=1; END;
CREATE TRIGGER bm_aeob_issues_epoch_delete AFTER DELETE ON bm_aeob_issues BEGIN UPDATE bm_retention_epoch SET version=version+1 WHERE id=1; END;
CREATE TRIGGER bm_aeob_six_year_floor BEFORE DELETE ON bm_aeob_sources WHEN date(OLD.prepared_at,'+6 years')>=date('now') BEGIN SELECT RAISE(ABORT,'estimate_six_year_retention'); END;
