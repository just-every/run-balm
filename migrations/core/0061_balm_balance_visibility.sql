ALTER TABLE bm_staff ADD COLUMN balance_visibility INTEGER NOT NULL DEFAULT 0 CHECK(balance_visibility IN (0,1));
