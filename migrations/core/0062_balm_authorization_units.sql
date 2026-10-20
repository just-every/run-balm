-- Existing visit allowances retain their meaning. Unit allowances retain an
-- inert positive visits value for the original table constraint.
ALTER TABLE bm_authorizations ADD COLUMN allowance_kind TEXT NOT NULL DEFAULT 'visits' CHECK(allowance_kind IN ('visits','units'));
ALTER TABLE bm_authorizations ADD COLUMN units INTEGER CHECK(units IS NULL OR (typeof(units)='integer' AND units>0));
ALTER TABLE bm_authorizations ADD COLUMN units_per_visit INTEGER CHECK(units_per_visit IS NULL OR (typeof(units_per_visit)='integer' AND units_per_visit>0));
ALTER TABLE bm_authorizations ADD COLUMN cpt_scope TEXT NOT NULL DEFAULT '[]' CHECK(CASE WHEN json_valid(cpt_scope) THEN json_type(cpt_scope)='array' ELSE 0 END);
ALTER TABLE bm_authorizations ADD COLUMN low_remainder INTEGER NOT NULL DEFAULT 2 CHECK(typeof(low_remainder)='integer' AND low_remainder>=0);
CREATE TRIGGER bm_authorization_units_insert BEFORE INSERT ON bm_authorizations
 WHEN NEW.allowance_kind='units' AND (NEW.units IS NULL OR NEW.units_per_visit IS NULL)
 BEGIN SELECT RAISE(ABORT,'authorization_units_required'); END;
CREATE TRIGGER bm_authorization_units_update BEFORE UPDATE ON bm_authorizations
 WHEN NEW.allowance_kind='units' AND (NEW.units IS NULL OR NEW.units_per_visit IS NULL)
 BEGIN SELECT RAISE(ABORT,'authorization_units_required'); END;
