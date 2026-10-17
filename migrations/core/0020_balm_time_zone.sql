-- Balm: the clinic's time zone is chosen by the owner, not assumed. Until the
-- owner saves it, the Clinic page fills it from the browser's own time zone.
-- Installs whose settings were already saved keep their zone as chosen.
ALTER TABLE bm_settings ADD COLUMN time_zone_chosen INTEGER NOT NULL DEFAULT 0 CHECK(time_zone_chosen IN (0,1));
UPDATE bm_settings SET time_zone_chosen=1 WHERE version>1 OR EXISTS(SELECT 1 FROM bm_appointments);
