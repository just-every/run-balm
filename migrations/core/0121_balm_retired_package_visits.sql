-- Retiring a retail original must never make an already covered visit billable again.
CREATE TABLE bm_retired_package_visits (appointment_id TEXT PRIMARY KEY);
CREATE TRIGGER bm_retired_package_visits_fixed BEFORE UPDATE ON bm_retired_package_visits BEGIN SELECT RAISE(ABORT,'anonymous_business_fact_fixed'); END;
CREATE TRIGGER bm_retired_package_visits_kept BEFORE DELETE ON bm_retired_package_visits BEGIN SELECT RAISE(ABORT,'anonymous_business_fact_fixed'); END;
-- Opaque transaction fingerprints refuse replay without retaining receipt text or identity.
CREATE TABLE bm_retired_retail_references (kind TEXT NOT NULL CHECK(kind IN ('sale','settlement')), digest TEXT NOT NULL, PRIMARY KEY(kind,digest));
CREATE TRIGGER bm_retired_retail_references_fixed BEFORE UPDATE ON bm_retired_retail_references BEGIN SELECT RAISE(ABORT,'retired_transaction_fixed'); END;
CREATE TRIGGER bm_retired_retail_references_kept BEFORE DELETE ON bm_retired_retail_references BEGIN SELECT RAISE(ABORT,'retired_transaction_fixed'); END;
