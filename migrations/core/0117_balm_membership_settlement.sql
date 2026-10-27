-- A recorded external cash refund settles unused visits without inventing attendance.
CREATE TABLE bm_membership_settlements (
 sale_id TEXT PRIMARY KEY REFERENCES bm_retail_sales(id), client_id TEXT NOT NULL REFERENCES bm_clients(id),
 units INTEGER NOT NULL CHECK(units>0), amount_cents INTEGER NOT NULL CHECK(amount_cents>0),
 reference TEXT NOT NULL UNIQUE, evidence TEXT NOT NULL, recorded_at TEXT NOT NULL, recorded_by TEXT NOT NULL
);
CREATE TRIGGER bm_membership_settlements_fixed BEFORE UPDATE ON bm_membership_settlements BEGIN SELECT RAISE(ABORT,'original_record_is_immutable'); END;
CREATE TRIGGER bm_membership_settlements_epoch AFTER INSERT ON bm_membership_settlements BEGIN UPDATE bm_retention_epoch SET version=version+1 WHERE id=1; END;
CREATE TRIGGER bm_membership_settlements_kept BEFORE DELETE ON bm_membership_settlements WHEN NOT EXISTS(SELECT 1 FROM bm_retention_scope s JOIN bm_retention_permits p ON p.preview_id=s.preview_id WHERE s.table_name='bm_membership_settlements' AND s.record_rowid=OLD.rowid) BEGIN SELECT RAISE(ABORT,'membership_original_kept'); END;
ALTER TABLE bm_destroyed_retail ADD COLUMN settlement TEXT;
