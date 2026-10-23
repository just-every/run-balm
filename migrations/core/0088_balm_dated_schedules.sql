-- Immutable owner-entered contract revisions; legacy setup remains a labelled baseline.
CREATE TABLE bm_billing_schedules (
 id TEXT PRIMARY KEY,payer_id TEXT NOT NULL REFERENCES bm_payers(id),plan_name TEXT NOT NULL DEFAULT '',
 effective_on TEXT NOT NULL,kind TEXT NOT NULL CHECK(kind IN ('standard','contracted')),
 unit_method TEXT CHECK(unit_method IN ('cms','ama','fixed')),fixed_unit_minutes INTEGER,
 fees TEXT NOT NULL,source TEXT NOT NULL,recorded_by TEXT NOT NULL,recorded_at TEXT NOT NULL,
 CHECK((unit_method='fixed' AND fixed_unit_minutes>0) OR (unit_method IS NOT 'fixed' AND fixed_unit_minutes IS NULL)),
 UNIQUE(payer_id,plan_name,effective_on,kind)
);
CREATE TABLE bm_provider_licenses (
 id TEXT PRIMARY KEY,practitioner_id TEXT NOT NULL REFERENCES bm_staff(id),state TEXT NOT NULL,
 number TEXT NOT NULL,starts_on TEXT NOT NULL,ends_on TEXT NOT NULL,source TEXT NOT NULL,
 recorded_by TEXT NOT NULL,recorded_at TEXT NOT NULL,CHECK(ends_on>=starts_on)
);
