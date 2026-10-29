-- Existing simultaneous offers retain their original terms. New openings use
-- one fifteen-minute turn at a time, with durable order and expiry history.
ALTER TABLE bm_offers ADD COLUMN ordered INTEGER NOT NULL DEFAULT 0 CHECK(ordered IN (0,1));
ALTER TABLE bm_offers ADD COLUMN revision INTEGER NOT NULL DEFAULT 1;
ALTER TABLE bm_offers ADD COLUMN active_entry_id TEXT;
ALTER TABLE bm_offers ADD COLUMN hold_until TEXT;
ALTER TABLE bm_offers ADD COLUMN hold_end_at TEXT;
ALTER TABLE bm_offer_recipients ADD COLUMN position INTEGER NOT NULL DEFAULT 0;
ALTER TABLE bm_offer_recipients ADD COLUMN activated_at TEXT;
ALTER TABLE bm_offer_recipients ADD COLUMN expires_at TEXT;
CREATE INDEX bm_offers_due ON bm_offers(status,ordered,hold_until);
