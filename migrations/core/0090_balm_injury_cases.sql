CREATE TABLE bm_injury_cases (
 id TEXT PRIMARY KEY,client_id TEXT NOT NULL REFERENCES bm_clients(id),policy_id TEXT NOT NULL REFERENCES bm_policies(id),
 kind TEXT NOT NULL CHECK(kind IN ('workers_comp','auto_no_fault','personal_injury')),
 claim_number TEXT NOT NULL,adjuster TEXT NOT NULL,adjuster_email TEXT NOT NULL,employer_attorney TEXT NOT NULL,
 billing_requirements TEXT NOT NULL,authorization_requirements TEXT NOT NULL,report_requirements TEXT NOT NULL,
 source TEXT NOT NULL,created_by TEXT NOT NULL,created_at TEXT NOT NULL,UNIQUE(policy_id,claim_number)
);
CREATE TABLE bm_injury_visits (
 appointment_id TEXT PRIMARY KEY REFERENCES bm_appointments(id),case_id TEXT NOT NULL REFERENCES bm_injury_cases(id),
 document_id TEXT NOT NULL REFERENCES bm_chart_documents(id),attachment_control TEXT NOT NULL,
 approved_by TEXT NOT NULL,approved_at TEXT NOT NULL
);
CREATE TRIGGER bm_injury_cases_fixed BEFORE UPDATE ON bm_injury_cases BEGIN SELECT RAISE(ABORT,'injury_case_original_fixed'); END;
CREATE TRIGGER bm_injury_visits_fixed BEFORE UPDATE ON bm_injury_visits BEGIN SELECT RAISE(ABORT,'injury_attachment_original_fixed'); END;
CREATE TRIGGER bm_injury_cases_kept BEFORE DELETE ON bm_injury_cases WHEN NOT EXISTS(SELECT 1 FROM bm_retention_scope s JOIN bm_retention_permits p ON p.preview_id=s.preview_id WHERE s.table_name='bm_injury_cases' AND s.record_rowid=OLD.rowid) BEGIN SELECT RAISE(ABORT,'injury_record_retained'); END;
CREATE TRIGGER bm_injury_visits_kept BEFORE DELETE ON bm_injury_visits WHEN NOT EXISTS(SELECT 1 FROM bm_retention_scope s JOIN bm_retention_permits p ON p.preview_id=s.preview_id WHERE s.table_name='bm_injury_visits' AND s.record_rowid=OLD.rowid) BEGIN SELECT RAISE(ABORT,'injury_record_retained'); END;
CREATE TRIGGER bm_injury_cases_epoch AFTER INSERT ON bm_injury_cases BEGIN UPDATE bm_retention_epoch SET version=version+1 WHERE id=1; END;
CREATE TRIGGER bm_injury_visits_epoch AFTER INSERT ON bm_injury_visits BEGIN UPDATE bm_retention_epoch SET version=version+1 WHERE id=1; END;
