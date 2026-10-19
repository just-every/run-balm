-- PAY-006: patient-authorized monthly card plans and consented balance notices.
CREATE TABLE bm_payment_plans (
 id TEXT PRIMARY KEY, client_id TEXT NOT NULL REFERENCES bm_clients(id),
 amount_cents INTEGER NOT NULL CHECK(amount_cents BETWEEN 50 AND 10000000),
 months INTEGER NOT NULL CHECK(months BETWEEN 1 AND 60), first_due TEXT NOT NULL,
 authorized_by TEXT NOT NULL, authorized_on TEXT NOT NULL, authorization_evidence TEXT NOT NULL,
 authorization_text TEXT NOT NULL, card_id TEXT NOT NULL REFERENCES bm_cards(id),
 status TEXT NOT NULL CHECK(status IN ('active','completed','stopped')),
 created_by TEXT NOT NULL, created_at TEXT NOT NULL, stopped_by TEXT, stopped_at TEXT, stop_reason TEXT
);
CREATE UNIQUE INDEX bm_payment_plans_active ON bm_payment_plans(client_id) WHERE status='active';
CREATE TABLE bm_plan_installments (
 id TEXT PRIMARY KEY, plan_id TEXT NOT NULL REFERENCES bm_payment_plans(id),
 sequence INTEGER NOT NULL, due_on TEXT NOT NULL,
 status TEXT NOT NULL CHECK(status IN ('scheduled','reserved','paid','review','skipped')),
 payment_id TEXT UNIQUE, amount_cents INTEGER, outcome TEXT, reserved_at TEXT,
 UNIQUE(plan_id,sequence)
);
CREATE INDEX bm_plan_installments_due ON bm_plan_installments(status,due_on);
CREATE TABLE bm_balance_reminders (
 id TEXT PRIMARY KEY, client_id TEXT NOT NULL REFERENCES bm_clients(id),
 every_days INTEGER NOT NULL CHECK(every_days BETWEEN 1 AND 365), next_on TEXT NOT NULL,
 consent_evidence TEXT NOT NULL, consented_by TEXT NOT NULL, consented_on TEXT NOT NULL,
 status TEXT NOT NULL CHECK(status IN ('active','paid','stopped')),
 created_by TEXT NOT NULL, created_at TEXT NOT NULL, stopped_by TEXT, stopped_at TEXT, stop_reason TEXT
);
CREATE UNIQUE INDEX bm_balance_reminders_active ON bm_balance_reminders(client_id) WHERE status='active';
CREATE TABLE bm_balance_notices (
 id TEXT PRIMARY KEY, reminder_id TEXT NOT NULL REFERENCES bm_balance_reminders(id), due_on TEXT NOT NULL,
 balance_cents INTEGER NOT NULL, status TEXT NOT NULL, outcome TEXT, reserved_at TEXT NOT NULL,
 UNIQUE(reminder_id,due_on)
);
CREATE TABLE bm_balance_review_settings (
 id INTEGER PRIMARY KEY CHECK(id=1), after_days INTEGER NOT NULL CHECK(after_days BETWEEN 1 AND 3650)
);
INSERT INTO bm_balance_review_settings VALUES(1,90);
CREATE TABLE bm_balance_review_queue (
 client_id TEXT PRIMARY KEY REFERENCES bm_clients(id), after_days INTEGER NOT NULL,
 age_days INTEGER NOT NULL, oldest_at TEXT NOT NULL, listed_at TEXT NOT NULL
);
