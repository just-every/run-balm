ALTER TABLE bm_services ADD COLUMN self_book_enabled INTEGER NOT NULL DEFAULT 1 CHECK(self_book_enabled IN (0,1));
ALTER TABLE bm_services ADD COLUMN self_book_notice_minutes INTEGER NOT NULL DEFAULT 120 CHECK(self_book_notice_minutes BETWEEN 120 AND 86400);
ALTER TABLE bm_services ADD COLUMN self_book_plan_required INTEGER NOT NULL DEFAULT 0 CHECK(self_book_plan_required IN (0,1));
ALTER TABLE bm_services ADD COLUMN self_book_auth_required INTEGER NOT NULL DEFAULT 0 CHECK(self_book_auth_required IN (0,1));
ALTER TABLE bm_settings ADD COLUMN booking_embed_origins TEXT NOT NULL DEFAULT '[]' CHECK(json_valid(booking_embed_origins) AND json_type(booking_embed_origins)='array');

-- These policy and availability tables were not covered by the retention epoch.
CREATE TRIGGER bm_retention_epoch_services_insert AFTER INSERT ON bm_services BEGIN UPDATE bm_retention_epoch SET version=version+1 WHERE id=1; END;
CREATE TRIGGER bm_retention_epoch_services_update AFTER UPDATE ON bm_services BEGIN UPDATE bm_retention_epoch SET version=version+1 WHERE id=1; END;
CREATE TRIGGER bm_retention_epoch_services_delete AFTER DELETE ON bm_services BEGIN UPDATE bm_retention_epoch SET version=version+1 WHERE id=1; END;
CREATE TRIGGER bm_retention_epoch_settings_insert AFTER INSERT ON bm_settings BEGIN UPDATE bm_retention_epoch SET version=version+1 WHERE id=1; END;
CREATE TRIGGER bm_retention_epoch_settings_update AFTER UPDATE ON bm_settings BEGIN UPDATE bm_retention_epoch SET version=version+1 WHERE id=1; END;
CREATE TRIGGER bm_retention_epoch_settings_delete AFTER DELETE ON bm_settings BEGIN UPDATE bm_retention_epoch SET version=version+1 WHERE id=1; END;
CREATE TRIGGER bm_retention_epoch_hours_insert AFTER INSERT ON bm_hours BEGIN UPDATE bm_retention_epoch SET version=version+1 WHERE id=1; END;
CREATE TRIGGER bm_retention_epoch_hours_update AFTER UPDATE ON bm_hours BEGIN UPDATE bm_retention_epoch SET version=version+1 WHERE id=1; END;
CREATE TRIGGER bm_retention_epoch_hours_delete AFTER DELETE ON bm_hours BEGIN UPDATE bm_retention_epoch SET version=version+1 WHERE id=1; END;
