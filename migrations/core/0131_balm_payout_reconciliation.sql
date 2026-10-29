-- Owner-recorded whole payouts and cited portions are evidence, never payment instructions.
CREATE TABLE bm_finance_payouts (
 id TEXT PRIMARY KEY, account_reference TEXT NOT NULL, payout_reference TEXT NOT NULL,
 gross_cents INTEGER NOT NULL CHECK(gross_cents>0), fee_cents INTEGER NOT NULL CHECK(fee_cents>=0),
 net_cents INTEGER NOT NULL CHECK(net_cents>=0 AND net_cents=gross_cents-fee_cents),
 occurred_on TEXT NOT NULL, evidence TEXT NOT NULL, recorded_by TEXT NOT NULL, recorded_at TEXT NOT NULL,
 UNIQUE(account_reference,payout_reference)
);
CREATE TABLE bm_finance_payout_links (
 id TEXT PRIMARY KEY, payout_id TEXT NOT NULL REFERENCES bm_finance_payouts(id),
 source_id TEXT NOT NULL UNIQUE REFERENCES bm_finance_sources(id),
 observation_id TEXT NOT NULL UNIQUE REFERENCES bm_finance_observations(id),
 recorded_by TEXT NOT NULL, recorded_at TEXT NOT NULL
);
CREATE TABLE bm_finance_payout_reviews (
 id TEXT PRIMARY KEY, payout_id TEXT NOT NULL REFERENCES bm_finance_payouts(id),
 payload TEXT NOT NULL, sha256 TEXT NOT NULL, prepared_by TEXT NOT NULL, prepared_at TEXT NOT NULL,
 UNIQUE(payout_id,sha256)
);
CREATE TABLE bm_finance_payout_approvals (
 review_id TEXT PRIMARY KEY REFERENCES bm_finance_payout_reviews(id),
 approved_by TEXT NOT NULL, approved_at TEXT NOT NULL
);
CREATE TRIGGER bm_finance_payout_link_valid BEFORE INSERT ON bm_finance_payout_links BEGIN
 SELECT CASE WHEN NOT EXISTS(
  SELECT 1 FROM bm_finance_payouts p JOIN bm_finance_sources s ON s.id=NEW.source_id
  JOIN bm_finance_observations o ON o.id=NEW.observation_id JOIN bm_clients c ON c.id=s.client_id
  WHERE p.id=NEW.payout_id AND s.kind='payout' AND o.kind='card' AND c.erased_at IS NULL
  AND s.client_id=o.client_id AND s.source_reference=o.source_reference
  AND s.amount_cents+s.fee_cents=o.amount_cents
  AND substr(s.occurred_on,1,7)=substr(p.occurred_on,1,7)
  AND substr(o.occurred_on,1,7)=substr(p.occurred_on,1,7)
  AND s.amount_cents+COALESCE((SELECT SUM(x.amount_cents) FROM bm_finance_payout_links l JOIN bm_finance_sources x ON x.id=l.source_id WHERE l.payout_id=p.id),0)<=p.net_cents
  AND s.fee_cents+COALESCE((SELECT SUM(x.fee_cents) FROM bm_finance_payout_links l JOIN bm_finance_sources x ON x.id=l.source_id WHERE l.payout_id=p.id),0)<=p.fee_cents
 ) THEN RAISE(ABORT,'bm_assert') END;
END;
CREATE TRIGGER bm_finance_payouts_fixed BEFORE UPDATE ON bm_finance_payouts BEGIN SELECT RAISE(ABORT,'original_record_is_immutable'); END;
CREATE TRIGGER bm_finance_payouts_kept BEFORE DELETE ON bm_finance_payouts BEGIN SELECT RAISE(ABORT,'finance_payout_original_kept'); END;
CREATE TRIGGER bm_finance_payouts_epoch AFTER INSERT ON bm_finance_payouts BEGIN UPDATE bm_retention_epoch SET version=version+1 WHERE id=1; END;
CREATE TRIGGER bm_finance_payout_links_fixed BEFORE UPDATE ON bm_finance_payout_links BEGIN SELECT RAISE(ABORT,'original_record_is_immutable'); END;
CREATE TRIGGER bm_finance_payout_links_kept BEFORE DELETE ON bm_finance_payout_links BEGIN SELECT RAISE(ABORT,'finance_payout_original_kept'); END;
CREATE TRIGGER bm_finance_payout_links_epoch AFTER INSERT ON bm_finance_payout_links BEGIN UPDATE bm_retention_epoch SET version=version+1 WHERE id=1; END;
CREATE TRIGGER bm_finance_payout_reviews_fixed BEFORE UPDATE ON bm_finance_payout_reviews BEGIN SELECT RAISE(ABORT,'original_record_is_immutable'); END;
CREATE TRIGGER bm_finance_payout_reviews_kept BEFORE DELETE ON bm_finance_payout_reviews BEGIN SELECT RAISE(ABORT,'finance_payout_original_kept'); END;
CREATE TRIGGER bm_finance_payout_reviews_epoch AFTER INSERT ON bm_finance_payout_reviews BEGIN UPDATE bm_retention_epoch SET version=version+1 WHERE id=1; END;
CREATE TRIGGER bm_finance_payout_approvals_fixed BEFORE UPDATE ON bm_finance_payout_approvals BEGIN SELECT RAISE(ABORT,'original_record_is_immutable'); END;
CREATE TRIGGER bm_finance_payout_approvals_kept BEFORE DELETE ON bm_finance_payout_approvals BEGIN SELECT RAISE(ABORT,'finance_payout_original_kept'); END;
CREATE TRIGGER bm_finance_payout_approvals_epoch AFTER INSERT ON bm_finance_payout_approvals BEGIN UPDATE bm_retention_epoch SET version=version+1 WHERE id=1; END;
