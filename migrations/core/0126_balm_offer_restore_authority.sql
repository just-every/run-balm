-- Offer history travels; a restored archive never grants a patient capability.
ALTER TABLE bm_offer_recipients ADD COLUMN offer_authority INTEGER NOT NULL DEFAULT 1 CHECK(offer_authority IN (0,1));
