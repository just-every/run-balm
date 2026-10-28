-- Unused gift-funded visits return value only to the same patient's original gift.
ALTER TABLE bm_membership_settlements ADD COLUMN tender TEXT NOT NULL DEFAULT 'cash' CHECK(tender IN ('cash','gift'));
ALTER TABLE bm_membership_settlements ADD COLUMN gift_id TEXT REFERENCES bm_retail_sales(id);
CREATE TRIGGER bm_membership_settlement_funding BEFORE INSERT ON bm_membership_settlements BEGIN
 SELECT CASE WHEN (NEW.tender='cash' AND NEW.gift_id IS NOT NULL) OR
 (NEW.tender='gift' AND NOT EXISTS(SELECT 1 FROM bm_retail_sales s JOIN bm_retail_sales g ON g.id=s.gift_id
  WHERE s.id=NEW.sale_id AND s.client_id=NEW.client_id AND g.id=NEW.gift_id AND g.client_id=NEW.client_id AND g.kind='gift_card'))
 THEN RAISE(ABORT,'bm_assert') END;
END;
