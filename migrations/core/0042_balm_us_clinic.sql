-- Preserve the legacy tax-ID column and frozen invoice bytes; new forms name it taxId.
ALTER TABLE bm_settings ADD COLUMN tax_id_type TEXT NOT NULL DEFAULT 'EIN' CHECK(tax_id_type IN ('EIN','SSN'));
ALTER TABLE bm_settings ADD COLUMN practice_npi TEXT NOT NULL DEFAULT '';
ALTER TABLE bm_settings ADD COLUMN street_address TEXT NOT NULL DEFAULT '';
ALTER TABLE bm_settings ADD COLUMN city TEXT NOT NULL DEFAULT '';
ALTER TABLE bm_settings ADD COLUMN state TEXT NOT NULL DEFAULT '';
ALTER TABLE bm_settings ADD COLUMN postal_code TEXT NOT NULL DEFAULT '';
