-- Balm patient payments through the clinic's own Stripe account: cards saved
-- with the patient's consent, copays charged at check-in, pay links for any
-- balance, and the codes a superbill needs. Card numbers never reach Balm.
ALTER TABLE bm_staff ADD COLUMN npi TEXT NOT NULL DEFAULT '';
ALTER TABLE bm_clients ADD COLUMN copay_cents INTEGER CHECK(copay_cents IS NULL OR copay_cents BETWEEN 0 AND 1000000);
ALTER TABLE bm_appointments ADD COLUMN checked_in_at TEXT;
ALTER TABLE bm_appointments ADD COLUMN checked_in_by TEXT;

-- The visit's billing codes: CPT lines with units and modifiers, ICD-10 diagnoses in order.
CREATE TABLE bm_visit_codes (
 appointment_id TEXT NOT NULL REFERENCES bm_appointments(id), kind TEXT NOT NULL CHECK(kind IN ('cpt','icd10')),
 position INTEGER NOT NULL CHECK(position BETWEEN 1 AND 12), code TEXT NOT NULL,
 modifiers TEXT NOT NULL DEFAULT '', units INTEGER CHECK(units IS NULL OR units BETWEEN 1 AND 99),
 saved_by TEXT NOT NULL, saved_at TEXT NOT NULL, PRIMARY KEY(appointment_id,kind,position)
);

-- The clinic's Stripe connection; the key and webhook secret are sealed with the session secret.
CREATE TABLE bm_stripe (
 id INTEGER PRIMARY KEY CHECK(id=1), key_sealed TEXT NOT NULL, key_hint TEXT NOT NULL, livemode INTEGER NOT NULL CHECK(livemode IN (0,1)),
 account_id TEXT NOT NULL, account_name TEXT NOT NULL, country TEXT NOT NULL,
 webhook_id TEXT, webhook_secret_sealed TEXT, connected_by TEXT NOT NULL, connected_at TEXT NOT NULL
);
CREATE TABLE bm_stripe_customers (
 client_id TEXT NOT NULL REFERENCES bm_clients(id), account_id TEXT NOT NULL, customer_id TEXT NOT NULL,
 created_at TEXT NOT NULL, PRIMARY KEY(client_id,account_id)
);

-- One live card on file per patient, kept with the exact consent the patient gave.
CREATE TABLE bm_cards (
 id TEXT PRIMARY KEY, client_id TEXT NOT NULL REFERENCES bm_clients(id), account_id TEXT NOT NULL,
 customer_id TEXT NOT NULL, setup_intent TEXT NOT NULL UNIQUE,
 brand TEXT NOT NULL, last4 TEXT NOT NULL, exp_month INTEGER NOT NULL, exp_year INTEGER NOT NULL,
 consent_text TEXT NOT NULL, consent_sha256 TEXT NOT NULL, consented_at TEXT NOT NULL,
 saved_at TEXT NOT NULL, removed_at TEXT, removed_by TEXT
);
CREATE UNIQUE INDEX bm_cards_live ON bm_cards(client_id) WHERE removed_at IS NULL;

-- A patient's private link: statement, pay any balance, save a card. Stored only as a hash.
-- Links are bearer credentials and stay out of archives, so link_id below is not a foreign key.
CREATE TABLE bm_pay_links (
 id TEXT PRIMARY KEY, token_hash TEXT NOT NULL UNIQUE, client_id TEXT NOT NULL REFERENCES bm_clients(id),
 purpose TEXT NOT NULL CHECK(purpose IN ('balance','card')), created_by TEXT NOT NULL, created_at TEXT NOT NULL,
 expires_at TEXT NOT NULL, delivery TEXT NOT NULL CHECK(delivery IN ('email','text','shown')),
 delivery_result TEXT NOT NULL DEFAULT '', opened_at TEXT
);
CREATE INDEX bm_pay_links_client ON bm_pay_links(client_id,created_at);

-- A card form the patient opened from a link, after ticking the consent shown to them.
CREATE TABLE bm_card_setups (
 id TEXT PRIMARY KEY, link_id TEXT NOT NULL, client_id TEXT NOT NULL REFERENCES bm_clients(id),
 consent_text TEXT NOT NULL, consented_at TEXT NOT NULL,
 status TEXT NOT NULL CHECK(status IN ('open','saved','expired')), card_id TEXT, created_at TEXT NOT NULL
);

-- Money taken through Stripe. applied_cents is the part posted to invoices as bm_payments
-- rows; the rest is the patient's credit, applied when the next invoice is approved.
CREATE TABLE bm_card_payments (
 id TEXT PRIMARY KEY, client_id TEXT NOT NULL REFERENCES bm_clients(id),
 kind TEXT NOT NULL CHECK(kind IN ('copay','charge','link')),
 appointment_id TEXT REFERENCES bm_appointments(id), invoice_id TEXT REFERENCES bm_invoices(id), link_id TEXT,
 amount_cents INTEGER NOT NULL CHECK(amount_cents BETWEEN 50 AND 10000000), applied_cents INTEGER NOT NULL DEFAULT 0,
 status TEXT NOT NULL CHECK(status IN ('open','processing','requires_action','succeeded','failed','expired')),
 checkout_session TEXT UNIQUE, payment_intent TEXT UNIQUE, card_brand TEXT, card_last4 TEXT, failure TEXT,
 receipt_number INTEGER UNIQUE, receipt_delivery TEXT NOT NULL DEFAULT '', created_by TEXT NOT NULL, created_at TEXT NOT NULL, succeeded_at TEXT, updated_at TEXT NOT NULL,
 CHECK(applied_cents BETWEEN 0 AND amount_cents)
);
CREATE INDEX bm_card_payments_client ON bm_card_payments(client_id,created_at);
ALTER TABLE bm_payments ADD COLUMN card_payment_id TEXT REFERENCES bm_card_payments(id);

-- Every Stripe event Balm accepted, once.
CREATE TABLE bm_stripe_events (id TEXT PRIMARY KEY, type TEXT NOT NULL, received_at TEXT NOT NULL);
