-- ROLE-002 location foundation carries REPORT-001 before SCHED-007 expands it.
CREATE TABLE bm_hour_locations (
 practitioner_id TEXT NOT NULL,weekday INTEGER NOT NULL,start_minute INTEGER NOT NULL,
 location_id TEXT NOT NULL REFERENCES bm_locations(id),
 PRIMARY KEY(practitioner_id,weekday,start_minute),
 FOREIGN KEY(practitioner_id,weekday,start_minute) REFERENCES bm_hours(practitioner_id,weekday,start_minute) ON DELETE CASCADE
);
ALTER TABLE bm_destroyed_operations ADD COLUMN location_id TEXT;
ALTER TABLE bm_destroyed_evaluations ADD COLUMN location_id TEXT;
ALTER TABLE bm_destroyed_plans ADD COLUMN location_id TEXT;
ALTER TABLE bm_destroyed_referrals ADD COLUMN location_id TEXT;
