-- Insurance records contain PHI. Reads use the same live-role and audit fences
-- as the patient file. X12 exports remain available without provider egress.
CREATE TABLE bm_insurance_settings (
 id INTEGER PRIMARY KEY CHECK(id=1), billing_npi TEXT NOT NULL, tax_id TEXT NOT NULL,
 address TEXT NOT NULL, city TEXT NOT NULL, state TEXT NOT NULL, postal_code TEXT NOT NULL,
 sender_id TEXT NOT NULL, contact_name TEXT NOT NULL, contact_phone TEXT NOT NULL,
 production INTEGER NOT NULL DEFAULT 0 CHECK(production IN (0,1)), version INTEGER NOT NULL DEFAULT 1
);
CREATE TABLE bm_payers (
 id TEXT PRIMARY KEY, name TEXT NOT NULL, payer_id TEXT NOT NULL UNIQUE, receiver_id TEXT NOT NULL,
 medicare INTEGER NOT NULL DEFAULT 0 CHECK(medicare IN (0,1)),
 unit_method TEXT CHECK(unit_method IN ('cms','ama')), requires_referral INTEGER NOT NULL DEFAULT 0 CHECK(requires_referral IN (0,1)),
 version INTEGER NOT NULL DEFAULT 1
);
CREATE TABLE bm_payer_fees (
 payer_id TEXT NOT NULL REFERENCES bm_payers(id), code TEXT NOT NULL,
 cents INTEGER NOT NULL CHECK(cents>0), PRIMARY KEY(payer_id,code)
);
CREATE TABLE bm_payer_enrollments (
 payer_id TEXT NOT NULL REFERENCES bm_payers(id), practitioner_id TEXT NOT NULL REFERENCES bm_staff(id),
 taxonomy TEXT NOT NULL, active INTEGER NOT NULL DEFAULT 1 CHECK(active IN (0,1)), PRIMARY KEY(payer_id,practitioner_id)
);
CREATE TABLE bm_policies (
 id TEXT PRIMARY KEY, client_id TEXT NOT NULL REFERENCES bm_clients(id), payer_id TEXT NOT NULL REFERENCES bm_payers(id),
 member_id TEXT NOT NULL, group_number TEXT NOT NULL DEFAULT '', plan_name TEXT NOT NULL DEFAULT '',
 relationship TEXT NOT NULL CHECK(relationship IN ('18','01','19')),
 subscriber_first TEXT NOT NULL, subscriber_last TEXT NOT NULL, subscriber_dob TEXT NOT NULL, subscriber_sex TEXT NOT NULL CHECK(subscriber_sex IN ('M','F','U')),
 patient_sex TEXT NOT NULL CHECK(patient_sex IN ('M','F','U')), address TEXT NOT NULL, city TEXT NOT NULL, state TEXT NOT NULL, postal_code TEXT NOT NULL,
 starts_on TEXT NOT NULL, ends_on TEXT, priority INTEGER NOT NULL DEFAULT 1 CHECK(priority BETWEEN 1 AND 3),
 eligibility_status TEXT NOT NULL DEFAULT 'unknown', eligibility_checked_at TEXT, copay_cents INTEGER, deductible_cents INTEGER,
 version INTEGER NOT NULL DEFAULT 1
);
CREATE INDEX bm_policies_client ON bm_policies(client_id,priority);
CREATE TABLE bm_authorizations (
 id TEXT PRIMARY KEY, policy_id TEXT NOT NULL REFERENCES bm_policies(id), number TEXT NOT NULL,
 starts_on TEXT NOT NULL, ends_on TEXT NOT NULL, visits INTEGER NOT NULL CHECK(visits>0),
 practitioner_id TEXT REFERENCES bm_staff(id), booking_action TEXT NOT NULL CHECK(booking_action IN ('warn','block')),
 version INTEGER NOT NULL DEFAULT 1
);
CREATE TABLE bm_eligibility (
 id TEXT PRIMARY KEY, policy_id TEXT NOT NULL REFERENCES bm_policies(id), service_date TEXT NOT NULL,
 trace TEXT NOT NULL UNIQUE, request TEXT NOT NULL, response TEXT, response_sha256 TEXT UNIQUE,
 benefits TEXT CHECK(benefits IS NULL OR json_valid(benefits)), status TEXT NOT NULL DEFAULT 'prepared',
 created_at TEXT NOT NULL, checked_at TEXT, version INTEGER NOT NULL DEFAULT 1
);
CREATE TABLE bm_medicare_years (
 client_id TEXT NOT NULL REFERENCES bm_clients(id), year INTEGER NOT NULL, therapy_group TEXT NOT NULL CHECK(therapy_group IN ('pt_slp','ot')),
 threshold_cents INTEGER NOT NULL CHECK(threshold_cents>0), external_used_cents INTEGER NOT NULL DEFAULT 0 CHECK(external_used_cents>=0),
 source TEXT NOT NULL, version INTEGER NOT NULL DEFAULT 1, PRIMARY KEY(client_id,year,therapy_group)
);
CREATE TABLE bm_claims (
 id TEXT PRIMARY KEY, client_id TEXT NOT NULL REFERENCES bm_clients(id), appointment_id TEXT NOT NULL REFERENCES bm_appointments(id),
 policy_id TEXT NOT NULL REFERENCES bm_policies(id), invoice_id TEXT NOT NULL REFERENCES bm_invoices(id),
 replaces_id TEXT REFERENCES bm_claims(id), payer_control TEXT NOT NULL DEFAULT '',
 snapshot TEXT NOT NULL CHECK(json_valid(snapshot)), errors TEXT NOT NULL DEFAULT '[]' CHECK(json_valid(errors)),
 status TEXT NOT NULL CHECK(status IN ('draft','ready','batched','exported','submitted','accepted','rejected','paid','partial','denied','corrected')),
 amount_cents INTEGER NOT NULL CHECK(amount_cents>0), therapy_group TEXT NOT NULL CHECK(therapy_group IN ('pt_slp','ot')),
 service_date TEXT NOT NULL, medical_necessity TEXT NOT NULL DEFAULT '', appeal TEXT NOT NULL DEFAULT '',
 created_by TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, version INTEGER NOT NULL DEFAULT 1
);
CREATE UNIQUE INDEX bm_claim_live_visit ON bm_claims(appointment_id,policy_id) WHERE status<>'corrected';
CREATE INDEX bm_claims_client ON bm_claims(client_id,service_date);
CREATE TABLE bm_claim_batches (
 id TEXT PRIMARY KEY, payer_id TEXT NOT NULL REFERENCES bm_payers(id), body TEXT NOT NULL, sha256 TEXT NOT NULL,
 status TEXT NOT NULL CHECK(status IN ('prepared','exported','sending','submitted','uncertain')), reference TEXT,
 created_by TEXT NOT NULL, created_at TEXT NOT NULL, version INTEGER NOT NULL DEFAULT 1
);
CREATE TABLE bm_claim_batch_items (
 batch_id TEXT NOT NULL REFERENCES bm_claim_batches(id), claim_id TEXT NOT NULL UNIQUE REFERENCES bm_claims(id), PRIMARY KEY(batch_id,claim_id)
);
CREATE TABLE bm_insurance_imports (
 id TEXT PRIMARY KEY, kind TEXT NOT NULL CHECK(kind IN ('277CA','835')), sha256 TEXT NOT NULL UNIQUE,
 trace TEXT NOT NULL, payer_id TEXT NOT NULL REFERENCES bm_payers(id), amount_cents INTEGER,
 imported_by TEXT NOT NULL, imported_at TEXT NOT NULL, UNIQUE(kind,payer_id,trace)
);
CREATE TABLE bm_remittance_claims (
 import_id TEXT NOT NULL REFERENCES bm_insurance_imports(id), claim_id TEXT NOT NULL REFERENCES bm_claims(id),
 paid_cents INTEGER NOT NULL, co_cents INTEGER NOT NULL, pr_cents INTEGER NOT NULL,
 payer_control TEXT NOT NULL, adjustments TEXT NOT NULL CHECK(json_valid(adjustments)),
 PRIMARY KEY(import_id,claim_id), UNIQUE(claim_id)
);
CREATE TABLE bm_insurance_adjustments (
 id TEXT PRIMARY KEY, invoice_id TEXT NOT NULL REFERENCES bm_invoices(id), amount_cents INTEGER NOT NULL CHECK(amount_cents>0),
 reason TEXT NOT NULL, remittance_id TEXT NOT NULL REFERENCES bm_insurance_imports(id), recorded_by TEXT NOT NULL, recorded_at TEXT NOT NULL
);
CREATE INDEX bm_insurance_adjustments_invoice ON bm_insurance_adjustments(invoice_id);
CREATE TABLE bm_claim_events (
 id TEXT PRIMARY KEY, claim_id TEXT NOT NULL REFERENCES bm_claims(id), kind TEXT NOT NULL,
 detail TEXT NOT NULL CHECK(json_valid(detail)), created_at TEXT NOT NULL
);
CREATE TRIGGER bm_claim_events_fixed BEFORE UPDATE ON bm_claim_events BEGIN SELECT RAISE(ABORT,'claim_event_fixed'); END;
CREATE TRIGGER bm_claim_events_kept BEFORE DELETE ON bm_claim_events BEGIN SELECT RAISE(ABORT,'claim_event_fixed'); END;
