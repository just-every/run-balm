-- ROLE-002: retain the existing clinical/desk storage role while recording the
-- narrower, owner-assigned job separately. Changes increment bm_staff.version.
CREATE TABLE bm_staff_access (
 staff_id TEXT PRIMARY KEY REFERENCES bm_staff(id),
 kind TEXT NOT NULL CHECK(kind IN ('practitioner','reception','biller','assistant','student','fellow','supervisor','location_manager')),
 supervisor_id TEXT REFERENCES bm_staff(id), location_id TEXT REFERENCES bm_locations(id),
 CHECK((kind IN ('assistant','student','fellow') AND supervisor_id IS NOT NULL) OR (kind NOT IN ('assistant','student','fellow') AND supervisor_id IS NULL)),
 CHECK((kind='location_manager' AND location_id IS NOT NULL) OR (kind<>'location_manager' AND location_id IS NULL))
);
CREATE TABLE bm_locations(id TEXT PRIMARY KEY,name TEXT NOT NULL,active INTEGER NOT NULL DEFAULT 1 CHECK(active IN (0,1)));
CREATE TABLE bm_room_locations(room_id TEXT PRIMARY KEY REFERENCES bm_rooms(id),location_id TEXT NOT NULL REFERENCES bm_locations(id));
