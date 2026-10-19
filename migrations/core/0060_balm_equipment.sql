-- SCHED-002 equipment: a pool, an AlterG or another shared device. Like a room it
-- holds one live visit at a time; a visit names at most one room and one item.
CREATE TABLE bm_equipment (
 id TEXT PRIMARY KEY, name TEXT NOT NULL,
 active INTEGER NOT NULL DEFAULT 1 CHECK(active IN (0,1)), version INTEGER NOT NULL DEFAULT 1
);
ALTER TABLE bm_appointments ADD COLUMN equipment_id TEXT REFERENCES bm_equipment(id);
CREATE INDEX bm_appointments_equipment ON bm_appointments(equipment_id,start_at);
