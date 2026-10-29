-- Whole recorded EFTs cite existing imported remittances without changing adjudication.
CREATE TABLE bm_finance_efts (
 id TEXT PRIMARY KEY, account_reference TEXT NOT NULL, payer_id TEXT NOT NULL REFERENCES bm_payers(id), trace TEXT NOT NULL,
 amount_cents INTEGER NOT NULL CHECK(amount_cents>0), occurred_on TEXT NOT NULL, evidence TEXT NOT NULL,
 recorded_by TEXT NOT NULL, recorded_at TEXT NOT NULL, UNIQUE(account_reference,payer_id,trace)
);
CREATE TABLE bm_finance_eft_eras (
 id TEXT PRIMARY KEY, eft_id TEXT NOT NULL UNIQUE REFERENCES bm_finance_efts(id), import_id TEXT NOT NULL UNIQUE REFERENCES bm_insurance_imports(id),
 recorded_by TEXT NOT NULL, recorded_at TEXT NOT NULL
);
CREATE TABLE bm_finance_eft_sources (
 id TEXT PRIMARY KEY, eft_id TEXT NOT NULL REFERENCES bm_finance_efts(id), source_id TEXT NOT NULL UNIQUE REFERENCES bm_finance_sources(id),
 recorded_by TEXT NOT NULL, recorded_at TEXT NOT NULL
);
CREATE TABLE bm_finance_eft_reviews (
 id TEXT PRIMARY KEY, eft_id TEXT NOT NULL REFERENCES bm_finance_efts(id), payload TEXT NOT NULL, sha256 TEXT NOT NULL,
 prepared_by TEXT NOT NULL, prepared_at TEXT NOT NULL, UNIQUE(eft_id,sha256)
);
CREATE TABLE bm_finance_eft_approvals (
 review_id TEXT PRIMARY KEY REFERENCES bm_finance_eft_reviews(id), approved_by TEXT NOT NULL, approved_at TEXT NOT NULL
);
CREATE TRIGGER bm_finance_eft_era_valid BEFORE INSERT ON bm_finance_eft_eras BEGIN
 SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM bm_finance_efts e JOIN bm_insurance_imports m ON m.id=NEW.import_id
 JOIN bm_runout_deposits d ON d.import_id=m.id WHERE e.id=NEW.eft_id AND m.kind='835' AND m.payer_id=e.payer_id AND m.trace=e.trace)
 THEN RAISE(ABORT,'bm_assert') END;
END;
CREATE TRIGGER bm_finance_eft_source_valid BEFORE INSERT ON bm_finance_eft_sources BEGIN
 SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM bm_finance_efts e JOIN bm_finance_sources s ON s.id=NEW.source_id
 JOIN bm_clients c ON c.id=s.client_id WHERE e.id=NEW.eft_id AND s.kind IN ('charge','accounting')
 AND s.source_reference=e.trace AND substr(s.occurred_on,1,7)<=substr(e.occurred_on,1,7) AND c.erased_at IS NULL)
 THEN RAISE(ABORT,'bm_assert') END;
END;
CREATE TRIGGER bm_finance_efts_fixed BEFORE UPDATE ON bm_finance_efts BEGIN SELECT RAISE(ABORT,'original_record_is_immutable'); END;
CREATE TRIGGER bm_finance_efts_kept BEFORE DELETE ON bm_finance_efts BEGIN SELECT RAISE(ABORT,'finance_original_kept'); END;
CREATE TRIGGER bm_finance_efts_epoch AFTER INSERT ON bm_finance_efts BEGIN UPDATE bm_retention_epoch SET version=version+1 WHERE id=1; END;
CREATE TRIGGER bm_finance_eft_eras_fixed BEFORE UPDATE ON bm_finance_eft_eras BEGIN SELECT RAISE(ABORT,'original_record_is_immutable'); END;
CREATE TRIGGER bm_finance_eft_eras_kept BEFORE DELETE ON bm_finance_eft_eras BEGIN SELECT RAISE(ABORT,'finance_original_kept'); END;
CREATE TRIGGER bm_finance_eft_eras_epoch AFTER INSERT ON bm_finance_eft_eras BEGIN UPDATE bm_retention_epoch SET version=version+1 WHERE id=1; END;
CREATE TRIGGER bm_finance_eft_sources_fixed BEFORE UPDATE ON bm_finance_eft_sources BEGIN SELECT RAISE(ABORT,'original_record_is_immutable'); END;
CREATE TRIGGER bm_finance_eft_sources_kept BEFORE DELETE ON bm_finance_eft_sources BEGIN SELECT RAISE(ABORT,'finance_original_kept'); END;
CREATE TRIGGER bm_finance_eft_sources_epoch AFTER INSERT ON bm_finance_eft_sources BEGIN UPDATE bm_retention_epoch SET version=version+1 WHERE id=1; END;
CREATE TRIGGER bm_finance_eft_reviews_fixed BEFORE UPDATE ON bm_finance_eft_reviews BEGIN SELECT RAISE(ABORT,'original_record_is_immutable'); END;
CREATE TRIGGER bm_finance_eft_reviews_kept BEFORE DELETE ON bm_finance_eft_reviews BEGIN SELECT RAISE(ABORT,'finance_original_kept'); END;
CREATE TRIGGER bm_finance_eft_reviews_epoch AFTER INSERT ON bm_finance_eft_reviews BEGIN UPDATE bm_retention_epoch SET version=version+1 WHERE id=1; END;
CREATE TRIGGER bm_finance_eft_approvals_fixed BEFORE UPDATE ON bm_finance_eft_approvals BEGIN SELECT RAISE(ABORT,'original_record_is_immutable'); END;
CREATE TRIGGER bm_finance_eft_approvals_kept BEFORE DELETE ON bm_finance_eft_approvals BEGIN SELECT RAISE(ABORT,'finance_original_kept'); END;
CREATE TRIGGER bm_finance_eft_approvals_epoch AFTER INSERT ON bm_finance_eft_approvals BEGIN UPDATE bm_retention_epoch SET version=version+1 WHERE id=1; END;

-- Preserve complete original 835 arithmetic without patient identifiers. Older imports remain explicitly incomplete.
ALTER TABLE bm_runout_deposits ADD COLUMN billed_cents INTEGER CHECK(billed_cents>=0);
ALTER TABLE bm_runout_deposits ADD COLUMN adjustment_cents INTEGER CHECK(adjustment_cents>=0);
ALTER TABLE bm_runout_deposits ADD COLUMN responsibility_cents INTEGER CHECK(responsibility_cents>=0);
ALTER TABLE bm_runout_deposits ADD COLUMN claim_count INTEGER CHECK(claim_count>0);
CREATE TRIGGER bm_runout_deposits_fixed BEFORE UPDATE ON bm_runout_deposits BEGIN SELECT RAISE(ABORT,'original_record_is_immutable'); END;
CREATE TRIGGER bm_runout_deposits_epoch AFTER INSERT ON bm_runout_deposits BEGIN UPDATE bm_retention_epoch SET version=version+1 WHERE id=1; END;
