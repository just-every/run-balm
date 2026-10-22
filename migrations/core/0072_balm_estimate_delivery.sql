ALTER TABLE bm_appointments ADD COLUMN coverage_choice TEXT NOT NULL DEFAULT 'unknown' CHECK(coverage_choice IN ('unknown','insured_claim','uninsured','self_pay'));
ALTER TABLE bm_estimate_requests ADD COLUMN delivery_method TEXT NOT NULL DEFAULT 'portal' CHECK(delivery_method IN ('portal','paper'));
ALTER TABLE bm_estimates ADD COLUMN delivery_method TEXT NOT NULL DEFAULT 'portal' CHECK(delivery_method IN ('portal','paper'));
CREATE TABLE bm_estimate_deliveries (
 estimate_id TEXT PRIMARY KEY REFERENCES bm_estimates(id),
 method TEXT NOT NULL CHECK(method IN ('handed','mailed')), delivered_on TEXT NOT NULL,
 original_sha256 TEXT NOT NULL, recorded_at TEXT NOT NULL, recorded_by TEXT NOT NULL
);
CREATE TRIGGER bm_estimate_delivery_fixed BEFORE UPDATE ON bm_estimate_deliveries BEGIN SELECT RAISE(ABORT,'estimate_original_is_immutable'); END;
CREATE TRIGGER bm_estimate_delivery_kept BEFORE DELETE ON bm_estimate_deliveries WHEN NOT EXISTS(SELECT 1 FROM bm_retention_scope s JOIN bm_retention_permits p ON p.preview_id=s.preview_id WHERE s.table_name='bm_estimate_deliveries' AND s.record_rowid=OLD.rowid) BEGIN SELECT RAISE(ABORT,'estimate_original_is_immutable'); END;
CREATE TRIGGER bm_estimate_delivery_epoch_insert AFTER INSERT ON bm_estimate_deliveries BEGIN UPDATE bm_retention_epoch SET version=version+1 WHERE id=1; END;
CREATE TRIGGER bm_estimate_delivery_epoch_update AFTER UPDATE ON bm_estimate_deliveries BEGIN UPDATE bm_retention_epoch SET version=version+1 WHERE id=1; END;
CREATE TRIGGER bm_estimate_delivery_epoch_delete AFTER DELETE ON bm_estimate_deliveries BEGIN UPDATE bm_retention_epoch SET version=version+1 WHERE id=1; END;
