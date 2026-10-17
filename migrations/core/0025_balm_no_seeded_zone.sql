-- Balm: no clinic time zone is assumed. 0015 seeded Australia/Brisbane; an
-- install whose owner never chose a zone and has no visits starts with none, and
-- the owner picks it (filled from their browser) before the app or online
-- booking opens. A zone the owner saved, or one visits were booked in, is kept.
UPDATE bm_settings SET time_zone='' WHERE time_zone_chosen=0 AND time_zone='Australia/Brisbane' AND NOT EXISTS(SELECT 1 FROM bm_appointments);
