ALTER TABLE bm_clients ADD COLUMN portal_language TEXT NOT NULL DEFAULT 'en' CHECK(portal_language IN ('en','es'));
