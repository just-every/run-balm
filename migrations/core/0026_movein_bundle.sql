-- Multi-source move-in is one atomic cutover, separate from the legacy kit.
CREATE TABLE bm_movein_jobs (
 id TEXT PRIMARY KEY, provider TEXT NOT NULL, fingerprint TEXT NOT NULL UNIQUE,
 state TEXT NOT NULL CHECK(state IN ('applied','undoing','undone')),
 created_at TEXT NOT NULL, created_by TEXT NOT NULL, undone_at TEXT,
 acceptance_reason TEXT NOT NULL DEFAULT '', source_json TEXT NOT NULL CHECK(json_valid(source_json)),
 report_json TEXT NOT NULL CHECK(json_valid(report_json))
);
CREATE TABLE bm_movein_records (
 job_id TEXT NOT NULL REFERENCES bm_movein_jobs(id), provider TEXT NOT NULL,
 kind TEXT NOT NULL, source_id TEXT NOT NULL, target_table TEXT NOT NULL, target_id TEXT NOT NULL,
 snapshot TEXT NOT NULL CHECK(json_valid(snapshot)),
 PRIMARY KEY(job_id,kind,source_id), UNIQUE(provider,kind,source_id)
);
CREATE TABLE bm_movein_notes (
 id TEXT PRIMARY KEY, job_id TEXT NOT NULL REFERENCES bm_movein_jobs(id),
 client_id TEXT NOT NULL REFERENCES bm_clients(id), source_id TEXT NOT NULL,
 title TEXT NOT NULL, body TEXT NOT NULL, source_date TEXT, read_only INTEGER NOT NULL DEFAULT 1 CHECK(read_only=1)
);
CREATE INDEX bm_movein_notes_client ON bm_movein_notes(client_id);
CREATE TABLE bm_movein_balances (
 id TEXT PRIMARY KEY, job_id TEXT NOT NULL REFERENCES bm_movein_jobs(id),
 client_id TEXT NOT NULL REFERENCES bm_clients(id), source_id TEXT NOT NULL,
 amount_cents INTEGER NOT NULL, currency TEXT NOT NULL DEFAULT 'USD' CHECK(currency='USD')
);
CREATE INDEX bm_movein_balances_client ON bm_movein_balances(client_id);
CREATE TABLE bm_movein_insurance (
 id TEXT PRIMARY KEY, job_id TEXT NOT NULL REFERENCES bm_movein_jobs(id),
 client_id TEXT NOT NULL REFERENCES bm_clients(id), source_id TEXT NOT NULL,
 payer TEXT NOT NULL, member_id TEXT NOT NULL, group_number TEXT
);
CREATE INDEX bm_movein_insurance_client ON bm_movein_insurance(client_id);
CREATE TRIGGER bm_movein_notes_readonly BEFORE UPDATE ON bm_movein_notes BEGIN SELECT RAISE(ABORT,'imported_records_read_only'); END;
CREATE TRIGGER bm_movein_balances_readonly BEFORE UPDATE ON bm_movein_balances BEGIN SELECT RAISE(ABORT,'imported_records_read_only'); END;
CREATE TRIGGER bm_movein_insurance_readonly BEFORE UPDATE ON bm_movein_insurance BEGIN SELECT RAISE(ABORT,'imported_records_read_only'); END;
CREATE TRIGGER bm_movein_notes_retained BEFORE DELETE ON bm_movein_notes
 WHEN (SELECT state FROM bm_movein_jobs WHERE id=OLD.job_id)<>'undoing' BEGIN SELECT RAISE(ABORT,'imported_records_retained'); END;
CREATE TRIGGER bm_movein_balances_retained BEFORE DELETE ON bm_movein_balances
 WHEN (SELECT state FROM bm_movein_jobs WHERE id=OLD.job_id)<>'undoing' BEGIN SELECT RAISE(ABORT,'imported_records_retained'); END;
CREATE TRIGGER bm_movein_insurance_retained BEFORE DELETE ON bm_movein_insurance
 WHEN (SELECT state FROM bm_movein_jobs WHERE id=OLD.job_id)<>'undoing' BEGIN SELECT RAISE(ABORT,'imported_records_retained'); END;
