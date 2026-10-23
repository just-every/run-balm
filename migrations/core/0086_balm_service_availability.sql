-- Service and location scheduling. Existing unscoped services retain clinic hours.
ALTER TABLE bm_services ADD COLUMN practitioner_ids TEXT NOT NULL DEFAULT '[]';
ALTER TABLE bm_services ADD COLUMN location_ids TEXT NOT NULL DEFAULT '[]';
ALTER TABLE bm_services ADD COLUMN cpt_defaults TEXT NOT NULL DEFAULT '[]';
ALTER TABLE bm_services ADD COLUMN before_buffer INTEGER NOT NULL DEFAULT 0 CHECK(before_buffer BETWEEN 0 AND 120);
ALTER TABLE bm_services ADD COLUMN after_buffer INTEGER NOT NULL DEFAULT 0 CHECK(after_buffer BETWEEN 0 AND 120);
ALTER TABLE bm_locations ADD COLUMN time_zone TEXT NOT NULL DEFAULT '';
ALTER TABLE bm_locations ADD COLUMN hours TEXT NOT NULL DEFAULT '[]';
CREATE TABLE bm_schedule_exceptions (
 id TEXT PRIMARY KEY, location_id TEXT REFERENCES bm_locations(id), practitioner_id TEXT REFERENCES bm_staff(id),
 date TEXT NOT NULL, mode TEXT NOT NULL CHECK(mode IN ('open','closed')), windows TEXT NOT NULL, name TEXT NOT NULL,
 CHECK(location_id IS NOT NULL OR practitioner_id IS NOT NULL)
);
CREATE UNIQUE INDEX bm_schedule_exception_scope ON bm_schedule_exceptions(COALESCE(location_id,''),COALESCE(practitioner_id,''),date);
CREATE TABLE bm_schedule_revision(id INTEGER PRIMARY KEY CHECK(id=1), version INTEGER NOT NULL);
INSERT INTO bm_schedule_revision VALUES(1,1);
CREATE TRIGGER bm_schedule_bm_services_insert AFTER INSERT ON bm_services BEGIN UPDATE bm_schedule_revision SET version=version+1 WHERE id=1; END;
CREATE TRIGGER bm_schedule_bm_services_update AFTER UPDATE ON bm_services BEGIN UPDATE bm_schedule_revision SET version=version+1 WHERE id=1; END;
CREATE TRIGGER bm_schedule_bm_services_delete AFTER DELETE ON bm_services BEGIN UPDATE bm_schedule_revision SET version=version+1 WHERE id=1; END;
CREATE TRIGGER bm_schedule_bm_staff_insert AFTER INSERT ON bm_staff BEGIN UPDATE bm_schedule_revision SET version=version+1 WHERE id=1; END;
CREATE TRIGGER bm_schedule_bm_staff_update AFTER UPDATE ON bm_staff BEGIN UPDATE bm_schedule_revision SET version=version+1 WHERE id=1; END;
CREATE TRIGGER bm_schedule_bm_staff_delete AFTER DELETE ON bm_staff BEGIN UPDATE bm_schedule_revision SET version=version+1 WHERE id=1; END;
CREATE TRIGGER bm_schedule_bm_hours_insert AFTER INSERT ON bm_hours BEGIN UPDATE bm_schedule_revision SET version=version+1 WHERE id=1; END;
CREATE TRIGGER bm_schedule_bm_hours_update AFTER UPDATE ON bm_hours BEGIN UPDATE bm_schedule_revision SET version=version+1 WHERE id=1; END;
CREATE TRIGGER bm_schedule_bm_hours_delete AFTER DELETE ON bm_hours BEGIN UPDATE bm_schedule_revision SET version=version+1 WHERE id=1; END;
CREATE TRIGGER bm_schedule_bm_settings_insert AFTER INSERT ON bm_settings BEGIN UPDATE bm_schedule_revision SET version=version+1 WHERE id=1; END;
CREATE TRIGGER bm_schedule_bm_settings_update AFTER UPDATE ON bm_settings BEGIN UPDATE bm_schedule_revision SET version=version+1 WHERE id=1; END;
CREATE TRIGGER bm_schedule_bm_settings_delete AFTER DELETE ON bm_settings BEGIN UPDATE bm_schedule_revision SET version=version+1 WHERE id=1; END;
CREATE TRIGGER bm_schedule_bm_locations_insert AFTER INSERT ON bm_locations BEGIN UPDATE bm_schedule_revision SET version=version+1 WHERE id=1; END;
CREATE TRIGGER bm_schedule_bm_locations_update AFTER UPDATE ON bm_locations BEGIN UPDATE bm_schedule_revision SET version=version+1 WHERE id=1; END;
CREATE TRIGGER bm_schedule_bm_locations_delete AFTER DELETE ON bm_locations BEGIN UPDATE bm_schedule_revision SET version=version+1 WHERE id=1; END;
CREATE TRIGGER bm_schedule_bm_room_locations_insert AFTER INSERT ON bm_room_locations BEGIN UPDATE bm_schedule_revision SET version=version+1 WHERE id=1; END;
CREATE TRIGGER bm_schedule_bm_room_locations_update AFTER UPDATE ON bm_room_locations BEGIN UPDATE bm_schedule_revision SET version=version+1 WHERE id=1; END;
CREATE TRIGGER bm_schedule_bm_room_locations_delete AFTER DELETE ON bm_room_locations BEGIN UPDATE bm_schedule_revision SET version=version+1 WHERE id=1; END;
CREATE TRIGGER bm_schedule_bm_rooms_insert AFTER INSERT ON bm_rooms BEGIN UPDATE bm_schedule_revision SET version=version+1 WHERE id=1; END;
CREATE TRIGGER bm_schedule_bm_rooms_update AFTER UPDATE ON bm_rooms BEGIN UPDATE bm_schedule_revision SET version=version+1 WHERE id=1; END;
CREATE TRIGGER bm_schedule_bm_rooms_delete AFTER DELETE ON bm_rooms BEGIN UPDATE bm_schedule_revision SET version=version+1 WHERE id=1; END;
CREATE TRIGGER bm_schedule_bm_schedule_exceptions_insert AFTER INSERT ON bm_schedule_exceptions BEGIN UPDATE bm_schedule_revision SET version=version+1 WHERE id=1; END;
CREATE TRIGGER bm_schedule_bm_schedule_exceptions_update AFTER UPDATE ON bm_schedule_exceptions BEGIN UPDATE bm_schedule_revision SET version=version+1 WHERE id=1; END;
CREATE TRIGGER bm_schedule_bm_schedule_exceptions_delete AFTER DELETE ON bm_schedule_exceptions BEGIN UPDATE bm_schedule_revision SET version=version+1 WHERE id=1; END;
