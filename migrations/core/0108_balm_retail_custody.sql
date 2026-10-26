-- Anonymous dated business facts survive approved identifying-record destruction.
CREATE TABLE bm_destroyed_retail (
 id TEXT PRIMARY KEY, kind TEXT NOT NULL, units INTEGER NOT NULL,
 amount_cents INTEGER NOT NULL, tax_cents INTEGER NOT NULL,
 gift_id TEXT, recorded_at TEXT NOT NULL
);
CREATE TRIGGER bm_destroyed_retail_fixed BEFORE UPDATE ON bm_destroyed_retail BEGIN SELECT RAISE(ABORT,'anonymous_business_fact_fixed'); END;
CREATE TRIGGER bm_destroyed_retail_kept BEFORE DELETE ON bm_destroyed_retail BEGIN SELECT RAISE(ABORT,'anonymous_business_fact_fixed'); END;
CREATE TRIGGER bm_retail_sales_kept BEFORE DELETE ON bm_retail_sales WHEN NOT EXISTS(SELECT 1 FROM bm_retention_scope s JOIN bm_retention_permits p ON p.preview_id=s.preview_id WHERE s.table_name='bm_retail_sales' AND s.record_rowid=OLD.rowid) BEGIN SELECT RAISE(ABORT,'retail_original_kept'); END;
CREATE TRIGGER bm_package_assignments_kept BEFORE DELETE ON bm_package_assignments WHEN NOT EXISTS(SELECT 1 FROM bm_retention_scope s JOIN bm_retention_permits p ON p.preview_id=s.preview_id WHERE s.table_name='bm_package_assignments' AND s.record_rowid=OLD.rowid) BEGIN SELECT RAISE(ABORT,'retail_original_kept'); END;
CREATE TRIGGER bm_package_uses_kept BEFORE DELETE ON bm_package_uses WHEN NOT EXISTS(SELECT 1 FROM bm_retention_scope s JOIN bm_retention_permits p ON p.preview_id=s.preview_id WHERE s.table_name='bm_package_uses' AND s.record_rowid=OLD.rowid) BEGIN SELECT RAISE(ABORT,'retail_original_kept'); END;
