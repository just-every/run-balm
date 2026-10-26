-- Terminal uses the existing card-payment reservation, receipt and invoice ledger.
-- Declines and unknown sends retain that reservation until Stripe confirms cancel
-- or success. Reader status alone never proves money moved.
CREATE TABLE bm_terminal_reader (
 id INTEGER PRIMARY KEY CHECK(id=1), account_id TEXT NOT NULL,
 reader_id TEXT NOT NULL, location_id TEXT NOT NULL, device_type TEXT NOT NULL,
 livemode INTEGER NOT NULL CHECK(livemode IN (0,1)),
 reader_status TEXT NOT NULL, checked_at TEXT NOT NULL,
 configured_by TEXT NOT NULL, configured_at TEXT NOT NULL
);
CREATE TABLE bm_terminal_payments (
 payment_id TEXT PRIMARY KEY REFERENCES bm_card_payments(id),
 account_id TEXT NOT NULL, reader_id TEXT NOT NULL,
 livemode INTEGER NOT NULL CHECK(livemode IN (0,1)),
 state TEXT NOT NULL CHECK(state IN ('reserved','intent_created','sent','unknown','succeeded','canceled')),
 reader_status TEXT, action_status TEXT, failure TEXT,
 created_at TEXT NOT NULL, checked_at TEXT NOT NULL
);
CREATE UNIQUE INDEX bm_terminal_reader_reserved ON bm_terminal_payments(account_id,reader_id)
 WHERE state NOT IN ('succeeded','canceled');
