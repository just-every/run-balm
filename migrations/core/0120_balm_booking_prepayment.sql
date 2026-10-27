ALTER TABLE bm_services ADD COLUMN prepay_mode TEXT NOT NULL DEFAULT 'none' CHECK(prepay_mode IN ('none','deposit','full'));
ALTER TABLE bm_services ADD COLUMN deposit_cents INTEGER NOT NULL DEFAULT 0 CHECK(deposit_cents>=0);
CREATE TABLE bm_booking_payments (
 id TEXT PRIMARY KEY, client_id TEXT NOT NULL REFERENCES bm_clients(id),
 payment_id TEXT NOT NULL UNIQUE REFERENCES bm_card_payments(id), appointment_id TEXT NOT NULL UNIQUE,
 practitioner_id TEXT NOT NULL REFERENCES bm_staff(id), service_id TEXT NOT NULL REFERENCES bm_services(id), room_id TEXT,
 start_at TEXT NOT NULL, end_at TEXT NOT NULL, price_cents INTEGER NOT NULL, amount_cents INTEGER NOT NULL,
 receipt_facts TEXT NOT NULL, mode TEXT NOT NULL CHECK(mode IN ('deposit','full')), visit_json TEXT NOT NULL,
 state TEXT NOT NULL DEFAULT 'reserved' CHECK(state IN ('reserved','booked','review','closed')),
 created_at TEXT NOT NULL, expires_at TEXT NOT NULL, attempted_at TEXT, checkout_expires_at TEXT, checkout_url TEXT, review_reason TEXT
);
CREATE INDEX bm_booking_payment_slots ON bm_booking_payments(practitioner_id,start_at,end_at,state);
CREATE TRIGGER bm_booking_terms_fixed BEFORE UPDATE OF client_id,payment_id,appointment_id,practitioner_id,service_id,room_id,start_at,end_at,price_cents,amount_cents,mode,visit_json,receipt_facts,created_at,expires_at ON bm_booking_payments
BEGIN SELECT RAISE(ABORT,'booking_payment_terms_fixed'); END;
CREATE TRIGGER bm_booking_payment_retained BEFORE DELETE ON bm_booking_payments WHEN NOT EXISTS(SELECT 1 FROM bm_retention_scope s JOIN bm_retention_permits p ON p.preview_id=s.preview_id WHERE s.table_name='bm_booking_payments' AND s.record_rowid=OLD.rowid)
BEGIN SELECT RAISE(ABORT,'booking_payment_retained'); END;
CREATE TRIGGER bm_booking_epoch_insert AFTER INSERT ON bm_booking_payments BEGIN UPDATE bm_retention_epoch SET version=version+1 WHERE id=1; END;
CREATE TRIGGER bm_booking_epoch_update AFTER UPDATE ON bm_booking_payments BEGIN UPDATE bm_retention_epoch SET version=version+1 WHERE id=1; END;
CREATE TRIGGER bm_booking_epoch_delete AFTER DELETE ON bm_booking_payments BEGIN UPDATE bm_retention_epoch SET version=version+1 WHERE id=1; END;
CREATE TABLE bm_booking_payment_tokens (id TEXT PRIMARY KEY REFERENCES bm_booking_payments(id), token_hash TEXT NOT NULL UNIQUE);
CREATE TRIGGER bm_booking_checkout_expiry_fixed BEFORE UPDATE OF checkout_expires_at ON bm_booking_payments WHEN OLD.checkout_expires_at IS NOT NULL AND NEW.checkout_expires_at IS NOT OLD.checkout_expires_at BEGIN SELECT RAISE(ABORT,'booking_checkout_expiry_fixed'); END;
