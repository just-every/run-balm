-- Filing limits are payer instructions recorded by a person, never defaults.
-- New entries supersede older entries for the same service dates; keep provenance.
CREATE TABLE bm_claim_filing_rules (
 id TEXT PRIMARY KEY,
 payer_id TEXT NOT NULL REFERENCES bm_payers(id),
 kind TEXT NOT NULL CHECK(kind IN ('initial','correction','appeal')),
 basis TEXT NOT NULL CHECK(basis IN ('service_date','adjudication_date')),
 days INTEGER NOT NULL CHECK(days BETWEEN 0 AND 3660),
 effective_from TEXT NOT NULL,
 effective_to TEXT,
 source TEXT NOT NULL,
 recorded_by TEXT NOT NULL,
 recorded_at TEXT NOT NULL,
 CHECK(effective_to IS NULL OR effective_to >= effective_from),
 CHECK(kind <> 'initial' OR basis = 'service_date')
);
CREATE INDEX bm_claim_filing_rules_payer ON bm_claim_filing_rules(payer_id,kind,effective_from);
CREATE TRIGGER bm_claim_filing_rules_fixed BEFORE UPDATE ON bm_claim_filing_rules BEGIN SELECT RAISE(ABORT,'filing_rule_fixed'); END;
CREATE TRIGGER bm_claim_filing_rules_kept BEFORE DELETE ON bm_claim_filing_rules BEGIN SELECT RAISE(ABORT,'filing_rule_fixed'); END;
