-- Balm's schedule: treatment rooms, recurring series, and a waitlist whose
-- entries are offered freed slots by email (the first to accept is booked).
CREATE TABLE bm_rooms (
 id TEXT PRIMARY KEY, name TEXT NOT NULL,
 active INTEGER NOT NULL DEFAULT 1 CHECK(active IN (0,1)), version INTEGER NOT NULL DEFAULT 1
);

-- One booking request for many visits; skipped dates were chosen by a person, never dropped by Balm.
CREATE TABLE bm_series (
 id TEXT PRIMARY KEY, client_id TEXT NOT NULL REFERENCES bm_clients(id),
 practitioner_id TEXT NOT NULL REFERENCES bm_staff(id), service_id TEXT NOT NULL REFERENCES bm_services(id),
 room_id TEXT REFERENCES bm_rooms(id), pattern TEXT NOT NULL CHECK(json_valid(pattern)),
 skipped TEXT NOT NULL DEFAULT '[]' CHECK(json_valid(skipped)), created_at TEXT NOT NULL, created_by TEXT NOT NULL
);

ALTER TABLE bm_appointments ADD COLUMN room_id TEXT REFERENCES bm_rooms(id);
ALTER TABLE bm_appointments ADD COLUMN series_id TEXT REFERENCES bm_series(id);
ALTER TABLE bm_appointments ADD COLUMN offer_id TEXT;
CREATE INDEX bm_appointments_room ON bm_appointments(room_id,start_at);
CREATE INDEX bm_appointments_series ON bm_appointments(series_id,start_at);
CREATE INDEX bm_appointments_start ON bm_appointments(start_at);

CREATE TABLE bm_waitlist (
 id TEXT PRIMARY KEY, client_id TEXT NOT NULL REFERENCES bm_clients(id),
 practitioner_id TEXT REFERENCES bm_staff(id), service_id TEXT NOT NULL REFERENCES bm_services(id),
 earliest_date TEXT NOT NULL, latest_date TEXT NOT NULL, note TEXT NOT NULL DEFAULT '',
 status TEXT NOT NULL CHECK(status IN ('waiting','booked','removed')),
 appointment_id TEXT REFERENCES bm_appointments(id), created_at TEXT NOT NULL, created_by TEXT NOT NULL,
 version INTEGER NOT NULL DEFAULT 1, CHECK(earliest_date<=latest_date)
);
CREATE INDEX bm_waitlist_status ON bm_waitlist(status,practitioner_id);

-- A freed slot offered to every matching entry at once.
CREATE TABLE bm_offers (
 id TEXT PRIMARY KEY, source_appointment_id TEXT NOT NULL REFERENCES bm_appointments(id),
 practitioner_id TEXT NOT NULL REFERENCES bm_staff(id), room_id TEXT REFERENCES bm_rooms(id),
 start_at TEXT NOT NULL, status TEXT NOT NULL CHECK(status IN ('open','taken','closed')),
 created_at TEXT NOT NULL, appointment_id TEXT REFERENCES bm_appointments(id), closed_at TEXT
);
CREATE TABLE bm_offer_recipients (
 offer_id TEXT NOT NULL REFERENCES bm_offers(id), entry_id TEXT NOT NULL REFERENCES bm_waitlist(id),
 offer_token_hash TEXT NOT NULL UNIQUE, channel TEXT NOT NULL DEFAULT 'email' CHECK(channel IN ('email','text')),
 delivery TEXT NOT NULL DEFAULT 'pending', outcome TEXT CHECK(outcome IN ('accepted','too_late')),
 responded_at TEXT, taken_notice TEXT, PRIMARY KEY(offer_id,entry_id)
);
