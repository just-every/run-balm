-- SCHED-010 practitioner capacity and double-booking. A practitioner carries up to
-- min(their capacity, each overlapping visit's service capacity) live visits at any
-- instant; both default to 1, which keeps BALM-002's overlap refusal.
ALTER TABLE bm_staff ADD COLUMN capacity INTEGER NOT NULL DEFAULT 1 CHECK(capacity BETWEEN 1 AND 10);
ALTER TABLE bm_services ADD COLUMN capacity INTEGER NOT NULL DEFAULT 1 CHECK(capacity BETWEEN 1 AND 10);
ALTER TABLE bm_services ADD COLUMN online_double_booking INTEGER NOT NULL DEFAULT 0 CHECK(online_double_booking IN (0,1));
-- Booking two Medicare Part B patients over the same minutes anyway: who decided, kept on both visits.
CREATE TABLE bm_medicare_overlaps (
  appointment_id TEXT NOT NULL REFERENCES bm_appointments(id), other_appointment_id TEXT NOT NULL REFERENCES bm_appointments(id),
  client_id TEXT NOT NULL REFERENCES bm_clients(id), acknowledged_by TEXT NOT NULL, acknowledged_at TEXT NOT NULL,
  PRIMARY KEY(appointment_id,other_appointment_id)
);
CREATE INDEX bm_medicare_overlaps_client ON bm_medicare_overlaps(client_id);
CREATE TRIGGER bm_medicare_overlap_fixed BEFORE UPDATE ON bm_medicare_overlaps BEGIN SELECT RAISE(ABORT,'medicare_overlap_fixed'); END;
CREATE TRIGGER bm_retention_epoch_medicare_overlaps_insert AFTER INSERT ON bm_medicare_overlaps BEGIN UPDATE bm_retention_epoch SET version=version+1 WHERE id=1; END;
CREATE TRIGGER bm_retention_epoch_medicare_overlaps_update AFTER UPDATE ON bm_medicare_overlaps BEGIN UPDATE bm_retention_epoch SET version=version+1 WHERE id=1; END;
CREATE TRIGGER bm_retention_epoch_medicare_overlaps_delete AFTER DELETE ON bm_medicare_overlaps BEGIN UPDATE bm_retention_epoch SET version=version+1 WHERE id=1; END;
