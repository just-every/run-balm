ALTER TABLE bm_claim_batches ADD COLUMN format TEXT NOT NULL DEFAULT '837P' CHECK(format IN ('837P','837I'));
CREATE TRIGGER bm_claim_batch_format_fixed BEFORE UPDATE OF format ON bm_claim_batches WHEN NEW.format<>OLD.format BEGIN SELECT RAISE(ABORT,'claim_batch_format_fixed'); END;

-- Recorded institutional instructions are historical facts, never provider authority.
CREATE TABLE bm_institutional_settings (
 id TEXT PRIMARY KEY, bill_type TEXT NOT NULL CHECK(bill_type='741'),
 revenue_mappings TEXT NOT NULL CHECK(json_valid(revenue_mappings)), plan_span_code TEXT NOT NULL,
 source TEXT NOT NULL, enrollment_reference TEXT NOT NULL, active INTEGER NOT NULL CHECK(active IN (0,1)),
 created_by TEXT NOT NULL, created_at TEXT NOT NULL
);
CREATE TABLE bm_institutional_visits (
 id TEXT PRIMARY KEY, client_id TEXT NOT NULL REFERENCES bm_clients(id),
 appointment_id TEXT NOT NULL REFERENCES bm_appointments(id), policy_id TEXT NOT NULL REFERENCES bm_policies(id),
 plan_id TEXT NOT NULL REFERENCES bm_plans_of_care(id), attending_first TEXT NOT NULL, attending_last TEXT NOT NULL, attending_npi TEXT NOT NULL, patient_status TEXT NOT NULL CHECK(patient_status='01'),
 occurrences TEXT NOT NULL CHECK(json_valid(occurrences)), source TEXT NOT NULL,
 created_by TEXT NOT NULL, created_at TEXT NOT NULL
);
CREATE TRIGGER bm_institutional_settings_fixed BEFORE UPDATE ON bm_institutional_settings BEGIN SELECT RAISE(ABORT,'institutional_instruction_original_fixed'); END;
CREATE TRIGGER bm_institutional_settings_kept BEFORE DELETE ON bm_institutional_settings BEGIN SELECT RAISE(ABORT,'institutional_instruction_original_retained'); END;
CREATE TRIGGER bm_institutional_visits_fixed BEFORE UPDATE ON bm_institutional_visits BEGIN SELECT RAISE(ABORT,'institutional_visit_original_fixed'); END;
CREATE TRIGGER bm_institutional_visits_kept BEFORE DELETE ON bm_institutional_visits WHEN NOT EXISTS(SELECT 1 FROM bm_retention_scope s JOIN bm_retention_permits p ON p.preview_id=s.preview_id WHERE s.table_name='bm_institutional_visits' AND s.record_rowid=OLD.rowid) BEGIN SELECT RAISE(ABORT,'institutional_visit_requires_retention_review'); END;
CREATE TRIGGER bm_institutional_visits_epoch AFTER INSERT ON bm_institutional_visits BEGIN UPDATE bm_retention_epoch SET version=version+1 WHERE id=1; END;
-- Only the established patient-destruction transaction may withdraw stored bytes.
CREATE TRIGGER bm_institutional_batch_fixed BEFORE UPDATE OF body,sha256 ON bm_claim_batches
WHEN OLD.format='837I' AND (NEW.body IS NOT OLD.body OR NEW.sha256 IS NOT OLD.sha256)
AND NOT (NEW.body='' AND NEW.sha256='' AND EXISTS(
 SELECT 1 FROM bm_retention_permits p JOIN bm_claims c ON c.client_id=p.client_id
 JOIN bm_claim_batch_items b ON b.claim_id=c.id WHERE b.batch_id=OLD.id
)) BEGIN SELECT RAISE(ABORT,'institutional_batch_original_fixed'); END;
