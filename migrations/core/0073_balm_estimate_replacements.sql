-- Keep originals and link one explicit replacement request to the prior estimate.
ALTER TABLE bm_estimate_requests ADD COLUMN supersedes_id TEXT;
ALTER TABLE bm_estimate_requests ADD COLUMN change_reason TEXT;
CREATE UNIQUE INDEX bm_estimate_replacement_once ON bm_estimate_requests(supersedes_id) WHERE supersedes_id IS NOT NULL;
CREATE TRIGGER bm_estimate_six_year_floor BEFORE DELETE ON bm_estimates
WHEN date(OLD.issued_at,'+6 years')>=date('now')
BEGIN SELECT RAISE(ABORT,'estimate_six_year_retention'); END;
