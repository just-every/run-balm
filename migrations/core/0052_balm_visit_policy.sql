ALTER TABLE bm_settings ADD COLUMN cancellation_notice_hours INTEGER NOT NULL DEFAULT 24 CHECK(cancellation_notice_hours BETWEEN 0 AND 8760);
ALTER TABLE bm_settings ADD COLUMN late_cancel_fee_cents INTEGER NOT NULL DEFAULT 0 CHECK(late_cancel_fee_cents >= 0);
ALTER TABLE bm_settings ADD COLUMN no_show_fee_cents INTEGER NOT NULL DEFAULT 0 CHECK(no_show_fee_cents >= 0);
CREATE TABLE bm_visit_cancellations (
  appointment_id TEXT PRIMARY KEY REFERENCES bm_appointments(id),
  reason TEXT NOT NULL CHECK(length(trim(reason)) > 0),
  actor_email TEXT NOT NULL, actor_role TEXT NOT NULL, cancelled_at TEXT NOT NULL
);
CREATE TABLE bm_visit_fees (
  id TEXT PRIMARY KEY,
  appointment_id TEXT NOT NULL UNIQUE REFERENCES bm_appointments(id),
  client_id TEXT NOT NULL REFERENCES bm_clients(id),
  kind TEXT NOT NULL CHECK(kind IN ('late_cancel','no_show')),
  amount_cents INTEGER NOT NULL CHECK(amount_cents >= 50),
  notice_hours INTEGER NOT NULL,
  proposed_at TEXT NOT NULL,
  confirmed_at TEXT, confirmed_by TEXT, authorization_record TEXT,
  payment_id TEXT UNIQUE,
  invoice_id TEXT UNIQUE
);
