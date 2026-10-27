-- Preserve the operator's explicit check-in selection on the original payment.
ALTER TABLE bm_card_payments ADD COLUMN collection_purpose TEXT CHECK(collection_purpose IN ('balance','coinsurance'));
