-- Explicit reviewed links can cite prior-period portions, never future settlements.
DROP TRIGGER bm_finance_payout_link_valid;
CREATE TRIGGER bm_finance_payout_link_valid BEFORE INSERT ON bm_finance_payout_links BEGIN
 SELECT CASE WHEN NOT EXISTS(
  SELECT 1 FROM bm_finance_payouts p JOIN bm_finance_sources s ON s.id=NEW.source_id
  JOIN bm_finance_observations o ON o.id=NEW.observation_id JOIN bm_clients c ON c.id=s.client_id
  WHERE p.id=NEW.payout_id AND s.kind='payout' AND o.kind='card' AND c.erased_at IS NULL
  AND s.client_id=o.client_id AND s.source_reference=o.source_reference
  AND s.amount_cents+s.fee_cents=o.amount_cents
  AND s.occurred_on<=p.occurred_on AND o.occurred_on<=p.occurred_on
  AND s.amount_cents+COALESCE((SELECT SUM(x.amount_cents) FROM bm_finance_payout_links l JOIN bm_finance_sources x ON x.id=l.source_id WHERE l.payout_id=p.id),0)<=p.net_cents
  AND s.fee_cents+COALESCE((SELECT SUM(x.fee_cents) FROM bm_finance_payout_links l JOIN bm_finance_sources x ON x.id=l.source_id WHERE l.payout_id=p.id),0)<=p.fee_cents
 ) THEN RAISE(ABORT,'bm_assert') END;
END;
