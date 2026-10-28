-- Existing entries remain available on every day, with no time restriction.
ALTER TABLE bm_waitlist ADD COLUMN preferred_weekdays TEXT NOT NULL DEFAULT '[0,1,2,3,4,5,6]' CHECK(json_valid(preferred_weekdays) AND json_type(preferred_weekdays)='array' AND json_array_length(preferred_weekdays)>0);
ALTER TABLE bm_waitlist ADD COLUMN preferred_start_minute INTEGER NOT NULL DEFAULT 0 CHECK(preferred_start_minute BETWEEN 0 AND 1439);
ALTER TABLE bm_waitlist ADD COLUMN preferred_end_minute INTEGER NOT NULL DEFAULT 1440 CHECK(preferred_end_minute BETWEEN 1 AND 1440 AND preferred_end_minute>preferred_start_minute);
