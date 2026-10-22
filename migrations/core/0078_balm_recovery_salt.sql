-- Existing recovery digests used the unique operator UUID as their salt.
-- Newly issued sets use a separate random salt and replace the entire prior set.
ALTER TABLE bm_staff_factors ADD COLUMN recovery_salt TEXT NOT NULL DEFAULT '';
UPDATE bm_staff_factors SET recovery_salt=operator_id;
