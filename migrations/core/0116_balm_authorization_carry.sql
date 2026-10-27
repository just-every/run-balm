-- Prior source usage is a cutover baseline, separate from native visit usage.
ALTER TABLE bm_authorizations ADD COLUMN imported_used INTEGER NOT NULL DEFAULT 0 CHECK(imported_used>=0);
ALTER TABLE bm_authorizations ADD COLUMN imported_cutover_on TEXT;
CREATE TRIGGER bm_authorization_carry_baseline_fixed BEFORE UPDATE OF imported_used,imported_cutover_on ON bm_authorizations
WHEN NEW.imported_used IS NOT OLD.imported_used OR NEW.imported_cutover_on IS NOT OLD.imported_cutover_on
BEGIN SELECT RAISE(ABORT,'authorization_carry_baseline_fixed'); END;
