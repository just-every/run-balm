-- Explicit finite renewals are new cash receipts; originals never change.
ALTER TABLE bm_retail_sales ADD COLUMN renewal_of TEXT REFERENCES bm_retail_sales(id);
ALTER TABLE bm_retail_sales ADD COLUMN renewal_authorization TEXT;
CREATE UNIQUE INDEX bm_membership_one_renewal ON bm_retail_sales(renewal_of) WHERE renewal_of IS NOT NULL;
-- Anonymous historical facts retain no consent evidence or staff identity.
ALTER TABLE bm_destroyed_retail ADD COLUMN used_times TEXT NOT NULL DEFAULT '[]';
ALTER TABLE bm_destroyed_retail ADD COLUMN membership_states TEXT NOT NULL DEFAULT '[]';
ALTER TABLE bm_destroyed_retail ADD COLUMN cancelled_at TEXT;
ALTER TABLE bm_destroyed_retail ADD COLUMN renewal_of TEXT;
ALTER TABLE bm_destroyed_retail ADD COLUMN facts_complete INTEGER NOT NULL DEFAULT 0 CHECK(facts_complete IN (0,1));
