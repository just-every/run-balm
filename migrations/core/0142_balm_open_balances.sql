-- The minute Cron and every signed-in page read each invoice's balance. Keep the open ones, and mark an invoice
-- stale whenever a payment, adjustment, refund, remittance or approval changes what it owes, so a read costs the
-- open balances and the changes since the last look, not every invoice ever approved.
CREATE TABLE bm_invoice_balance_stale (invoice_id TEXT PRIMARY KEY) WITHOUT ROWID;
CREATE TABLE bm_invoice_open (invoice_id TEXT PRIMARY KEY, balance_cents INTEGER NOT NULL CHECK(balance_cents>0), approved_at TEXT) WITHOUT ROWID;
CREATE INDEX bm_invoice_open_aged ON bm_invoice_open(approved_at);
INSERT INTO bm_invoice_balance_stale(invoice_id) SELECT id FROM bm_invoices WHERE status='approved';
-- A sweep that runs once per period (a clinic day, an hour) however often Cron fires.
CREATE TABLE bm_job_runs (job TEXT PRIMARY KEY, period TEXT NOT NULL) WITHOUT ROWID;

CREATE TRIGGER bm_balance_stale_payments_insert AFTER INSERT ON bm_payments BEGIN INSERT OR IGNORE INTO bm_invoice_balance_stale(invoice_id) SELECT NEW.invoice_id WHERE NEW.invoice_id IS NOT NULL; END;
CREATE TRIGGER bm_balance_stale_payments_update AFTER UPDATE ON bm_payments BEGIN INSERT OR IGNORE INTO bm_invoice_balance_stale(invoice_id) SELECT OLD.invoice_id WHERE OLD.invoice_id IS NOT NULL; INSERT OR IGNORE INTO bm_invoice_balance_stale(invoice_id) SELECT NEW.invoice_id WHERE NEW.invoice_id IS NOT NULL; END;
CREATE TRIGGER bm_balance_stale_payments_delete AFTER DELETE ON bm_payments BEGIN INSERT OR IGNORE INTO bm_invoice_balance_stale(invoice_id) SELECT OLD.invoice_id WHERE OLD.invoice_id IS NOT NULL; END;
CREATE TRIGGER bm_balance_stale_insurance_adjustments_insert AFTER INSERT ON bm_insurance_adjustments BEGIN INSERT OR IGNORE INTO bm_invoice_balance_stale(invoice_id) SELECT NEW.invoice_id WHERE NEW.invoice_id IS NOT NULL; END;
CREATE TRIGGER bm_balance_stale_insurance_adjustments_update AFTER UPDATE ON bm_insurance_adjustments BEGIN INSERT OR IGNORE INTO bm_invoice_balance_stale(invoice_id) SELECT OLD.invoice_id WHERE OLD.invoice_id IS NOT NULL; INSERT OR IGNORE INTO bm_invoice_balance_stale(invoice_id) SELECT NEW.invoice_id WHERE NEW.invoice_id IS NOT NULL; END;
CREATE TRIGGER bm_balance_stale_insurance_adjustments_delete AFTER DELETE ON bm_insurance_adjustments BEGIN INSERT OR IGNORE INTO bm_invoice_balance_stale(invoice_id) SELECT OLD.invoice_id WHERE OLD.invoice_id IS NOT NULL; END;
CREATE TRIGGER bm_balance_stale_account_entries_insert AFTER INSERT ON bm_account_entries BEGIN INSERT OR IGNORE INTO bm_invoice_balance_stale(invoice_id) SELECT NEW.invoice_id WHERE NEW.invoice_id IS NOT NULL; END;
CREATE TRIGGER bm_balance_stale_account_entries_update AFTER UPDATE ON bm_account_entries BEGIN INSERT OR IGNORE INTO bm_invoice_balance_stale(invoice_id) SELECT OLD.invoice_id WHERE OLD.invoice_id IS NOT NULL; INSERT OR IGNORE INTO bm_invoice_balance_stale(invoice_id) SELECT NEW.invoice_id WHERE NEW.invoice_id IS NOT NULL; END;
CREATE TRIGGER bm_balance_stale_account_entries_delete AFTER DELETE ON bm_account_entries BEGIN INSERT OR IGNORE INTO bm_invoice_balance_stale(invoice_id) SELECT OLD.invoice_id WHERE OLD.invoice_id IS NOT NULL; END;
CREATE TRIGGER bm_balance_stale_payer_payment_lines_insert AFTER INSERT ON bm_payer_payment_lines BEGIN INSERT OR IGNORE INTO bm_invoice_balance_stale(invoice_id) SELECT NEW.invoice_id WHERE NEW.invoice_id IS NOT NULL; END;
CREATE TRIGGER bm_balance_stale_payer_payment_lines_update AFTER UPDATE ON bm_payer_payment_lines BEGIN INSERT OR IGNORE INTO bm_invoice_balance_stale(invoice_id) SELECT OLD.invoice_id WHERE OLD.invoice_id IS NOT NULL; INSERT OR IGNORE INTO bm_invoice_balance_stale(invoice_id) SELECT NEW.invoice_id WHERE NEW.invoice_id IS NOT NULL; END;
CREATE TRIGGER bm_balance_stale_payer_payment_lines_delete AFTER DELETE ON bm_payer_payment_lines BEGIN INSERT OR IGNORE INTO bm_invoice_balance_stale(invoice_id) SELECT OLD.invoice_id WHERE OLD.invoice_id IS NOT NULL; END;
CREATE TRIGGER bm_balance_stale_card_refund_allocations_insert AFTER INSERT ON bm_card_refund_allocations BEGIN INSERT OR IGNORE INTO bm_invoice_balance_stale(invoice_id) SELECT NEW.invoice_id WHERE NEW.invoice_id IS NOT NULL; END;
CREATE TRIGGER bm_balance_stale_card_refund_allocations_update AFTER UPDATE ON bm_card_refund_allocations BEGIN INSERT OR IGNORE INTO bm_invoice_balance_stale(invoice_id) SELECT OLD.invoice_id WHERE OLD.invoice_id IS NOT NULL; INSERT OR IGNORE INTO bm_invoice_balance_stale(invoice_id) SELECT NEW.invoice_id WHERE NEW.invoice_id IS NOT NULL; END;
CREATE TRIGGER bm_balance_stale_card_refund_allocations_delete AFTER DELETE ON bm_card_refund_allocations BEGIN INSERT OR IGNORE INTO bm_invoice_balance_stale(invoice_id) SELECT OLD.invoice_id WHERE OLD.invoice_id IS NOT NULL; END;
CREATE TRIGGER bm_balance_stale_runout_opening_credits_insert AFTER INSERT ON bm_runout_opening_credits BEGIN INSERT OR IGNORE INTO bm_invoice_balance_stale(invoice_id) SELECT NEW.invoice_id WHERE NEW.invoice_id IS NOT NULL; END;
CREATE TRIGGER bm_balance_stale_runout_opening_credits_update AFTER UPDATE ON bm_runout_opening_credits BEGIN INSERT OR IGNORE INTO bm_invoice_balance_stale(invoice_id) SELECT OLD.invoice_id WHERE OLD.invoice_id IS NOT NULL; INSERT OR IGNORE INTO bm_invoice_balance_stale(invoice_id) SELECT NEW.invoice_id WHERE NEW.invoice_id IS NOT NULL; END;
CREATE TRIGGER bm_balance_stale_runout_opening_credits_delete AFTER DELETE ON bm_runout_opening_credits BEGIN INSERT OR IGNORE INTO bm_invoice_balance_stale(invoice_id) SELECT OLD.invoice_id WHERE OLD.invoice_id IS NOT NULL; END;
CREATE TRIGGER bm_balance_stale_account_postings_insert AFTER INSERT ON bm_account_postings BEGIN INSERT OR IGNORE INTO bm_invoice_balance_stale(invoice_id) SELECT invoice_id FROM bm_account_entries WHERE id=NEW.entry_id AND invoice_id IS NOT NULL; END;
CREATE TRIGGER bm_balance_stale_account_postings_update AFTER UPDATE ON bm_account_postings BEGIN INSERT OR IGNORE INTO bm_invoice_balance_stale(invoice_id) SELECT invoice_id FROM bm_account_entries WHERE id=OLD.entry_id AND invoice_id IS NOT NULL; INSERT OR IGNORE INTO bm_invoice_balance_stale(invoice_id) SELECT invoice_id FROM bm_account_entries WHERE id=NEW.entry_id AND invoice_id IS NOT NULL; END;
CREATE TRIGGER bm_balance_stale_account_postings_delete AFTER DELETE ON bm_account_postings BEGIN INSERT OR IGNORE INTO bm_invoice_balance_stale(invoice_id) SELECT invoice_id FROM bm_account_entries WHERE id=OLD.entry_id AND invoice_id IS NOT NULL; END;
CREATE TRIGGER bm_balance_stale_cob_reductions_insert AFTER INSERT ON bm_cob_manual_reductions BEGIN INSERT OR IGNORE INTO bm_invoice_balance_stale(invoice_id) SELECT invoice_id FROM bm_payer_payment_lines WHERE id=NEW.line_id AND invoice_id IS NOT NULL; END;
CREATE TRIGGER bm_balance_stale_cob_reductions_update AFTER UPDATE ON bm_cob_manual_reductions BEGIN INSERT OR IGNORE INTO bm_invoice_balance_stale(invoice_id) SELECT invoice_id FROM bm_payer_payment_lines WHERE id=OLD.line_id AND invoice_id IS NOT NULL; INSERT OR IGNORE INTO bm_invoice_balance_stale(invoice_id) SELECT invoice_id FROM bm_payer_payment_lines WHERE id=NEW.line_id AND invoice_id IS NOT NULL; END;
CREATE TRIGGER bm_balance_stale_cob_reductions_delete AFTER DELETE ON bm_cob_manual_reductions BEGIN INSERT OR IGNORE INTO bm_invoice_balance_stale(invoice_id) SELECT invoice_id FROM bm_payer_payment_lines WHERE id=OLD.line_id AND invoice_id IS NOT NULL; END;
-- A closed remittance batch or a confirmed refund counts toward every invoice it names.
CREATE TRIGGER bm_balance_stale_payer_batches_status AFTER UPDATE OF status ON bm_payer_payment_batches BEGIN INSERT OR IGNORE INTO bm_invoice_balance_stale(invoice_id) SELECT invoice_id FROM bm_payer_payment_lines WHERE batch_id=NEW.id AND invoice_id IS NOT NULL; END;
CREATE TRIGGER bm_balance_stale_card_refunds_status AFTER UPDATE OF status ON bm_card_refunds BEGIN INSERT OR IGNORE INTO bm_invoice_balance_stale(invoice_id) SELECT invoice_id FROM bm_card_refund_allocations WHERE refund_id=NEW.id; END;
CREATE TRIGGER bm_balance_stale_invoices_insert AFTER INSERT ON bm_invoices WHEN NEW.status='approved' BEGIN INSERT OR IGNORE INTO bm_invoice_balance_stale(invoice_id) VALUES(NEW.id); END;
CREATE TRIGGER bm_balance_stale_invoices_update AFTER UPDATE OF status,amount_cents,approved_at,client_id ON bm_invoices BEGIN INSERT OR IGNORE INTO bm_invoice_balance_stale(invoice_id) VALUES(NEW.id); END;
CREATE TRIGGER bm_balance_stale_invoices_delete AFTER DELETE ON bm_invoices BEGIN INSERT OR IGNORE INTO bm_invoice_balance_stale(invoice_id) VALUES(OLD.id); END;

-- Indexes the balance sums and per-patient ledgers need, and the work lists Cron reads each minute.
CREATE INDEX bm_invoices_client ON bm_invoices(client_id,status);
CREATE INDEX bm_payments_invoice ON bm_payments(invoice_id);
CREATE INDEX bm_payer_payment_lines_invoice ON bm_payer_payment_lines(invoice_id);
CREATE INDEX bm_account_entries_invoice ON bm_account_entries(invoice_id);
CREATE INDEX bm_card_refund_allocations_invoice ON bm_card_refund_allocations(invoice_id);
CREATE INDEX bm_runout_opening_credits_invoice ON bm_runout_opening_credits(invoice_id);
CREATE INDEX bm_balance_reminders_due ON bm_balance_reminders(next_on) WHERE status='active';
CREATE INDEX bm_balance_notices_sending ON bm_balance_notices(reserved_at) WHERE status='sending';
CREATE INDEX bm_statement_preferences_live ON bm_statement_preferences(client_id) WHERE hold=0 AND returned_at IS NULL;
CREATE INDEX bm_followups_active ON bm_followups(kind,enrolled_at,id) WHERE state='active';
CREATE INDEX bm_visit_reminders_pending_sms ON bm_visit_reminders(start_at) WHERE state='pending' AND channel='sms';
