-- Cohorts retain preparation provenance; each patient's links follow request custody.
ALTER TABLE bm_eligibility ADD COLUMN policy_basis TEXT;
ALTER TABLE bm_eligibility ADD COLUMN cohort_key TEXT;
CREATE UNIQUE INDEX bm_eligibility_cohort_once ON bm_eligibility(cohort_key) WHERE cohort_key IS NOT NULL;
CREATE TABLE bm_eligibility_cohorts (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL CHECK(kind IN ('next_business_day','monthly')),
  as_of_date TEXT NOT NULL,
  service_date TEXT NOT NULL,
  time_zone TEXT NOT NULL,
  holidays TEXT NOT NULL,
  digest TEXT NOT NULL UNIQUE,
  prepared_at TEXT NOT NULL
);
CREATE TABLE bm_eligibility_cohort_items (
  batch_id TEXT NOT NULL REFERENCES bm_eligibility_cohorts(id),
  policy_id TEXT NOT NULL REFERENCES bm_policies(id),
  eligibility_id TEXT NOT NULL REFERENCES bm_eligibility(id),
  client_id TEXT NOT NULL REFERENCES bm_clients(id),
  PRIMARY KEY(batch_id,policy_id)
);
