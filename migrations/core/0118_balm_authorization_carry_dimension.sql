-- Fixed source consumption retains its original measurement dimension.
CREATE TRIGGER bm_authorization_carry_dimension_fixed BEFORE UPDATE OF allowance_kind ON bm_authorizations
WHEN OLD.imported_cutover_on IS NOT NULL AND NEW.allowance_kind IS NOT OLD.allowance_kind
BEGIN SELECT RAISE(ABORT,'imported_authorization_dimension_cannot_change'); END;
