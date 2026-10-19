-- HIPAA-002: reviewed policy and one-use destruction scopes. Audit remains append-only.
CREATE TABLE bm_retention_policy (
 id INTEGER PRIMARY KEY CHECK(id=1), state TEXT NOT NULL, adult_years INTEGER NOT NULL CHECK(adult_years BETWEEN 0 AND 100),
 minor_years INTEGER NOT NULL CHECK(minor_years BETWEEN 0 AND 100), payer_years INTEGER NOT NULL CHECK(payer_years BETWEEN 0 AND 100),
 majority_age INTEGER NOT NULL CHECK(majority_age BETWEEN 18 AND 21), reviewed_rule TEXT NOT NULL DEFAULT '',
 version INTEGER NOT NULL DEFAULT 1, updated_at TEXT NOT NULL, updated_by TEXT NOT NULL
);
CREATE TABLE bm_retention_epoch (id INTEGER PRIMARY KEY CHECK(id=1), version INTEGER NOT NULL);
INSERT INTO bm_retention_epoch VALUES(1,1);
CREATE TABLE bm_retention_holds (client_id TEXT PRIMARY KEY REFERENCES bm_clients(id), reason TEXT NOT NULL, set_at TEXT NOT NULL, set_by TEXT NOT NULL);
CREATE TABLE bm_retention_previews (
 id TEXT PRIMARY KEY, client_id TEXT NOT NULL, digest TEXT NOT NULL UNIQUE, epoch INTEGER NOT NULL,
 policy_version INTEGER NOT NULL, expires_at TEXT NOT NULL, eligible_after TEXT NOT NULL, inventory TEXT NOT NULL CHECK(json_valid(inventory)),
 created_by TEXT NOT NULL, created_at TEXT NOT NULL
);
CREATE TABLE bm_destructions (
 id TEXT PRIMARY KEY, preview_digest TEXT NOT NULL UNIQUE, destroyed_at TEXT NOT NULL, approved_by TEXT NOT NULL,
 policy TEXT NOT NULL CHECK(json_valid(policy)), inventory TEXT NOT NULL CHECK(json_valid(inventory))
);
CREATE TRIGGER bm_destructions_fixed BEFORE UPDATE ON bm_destructions BEGIN SELECT RAISE(ABORT,'destruction_receipt_fixed'); END;
CREATE TRIGGER bm_destructions_kept BEFORE DELETE ON bm_destructions BEGIN SELECT RAISE(ABORT,'destruction_receipt_fixed'); END;
CREATE TABLE bm_destroyed_invoices(id TEXT PRIMARY KEY,anonymous_group TEXT NOT NULL,amount_cents INTEGER NOT NULL,start_at TEXT NOT NULL,open_payer TEXT);
CREATE TABLE bm_destroyed_payments(id TEXT PRIMARY KEY,invoice_id TEXT NOT NULL,amount_cents INTEGER NOT NULL,recorded_at TEXT NOT NULL,kind TEXT NOT NULL,card_payment_id TEXT,remittance_id TEXT);
CREATE TABLE bm_destroyed_adjustments(id TEXT PRIMARY KEY,invoice_id TEXT NOT NULL,amount_cents INTEGER NOT NULL,recorded_at TEXT NOT NULL);
CREATE TABLE bm_destroyed_cards(id TEXT PRIMARY KEY,amount_cents INTEGER NOT NULL,applied_cents INTEGER NOT NULL,succeeded_at TEXT NOT NULL);
CREATE TABLE bm_destroyed_visits(id TEXT PRIMARY KEY,start_at TEXT NOT NULL);
-- These tables exist only inside one authorized transaction and are empty at commit.
CREATE TABLE bm_retention_permits (client_id TEXT PRIMARY KEY, preview_id TEXT NOT NULL REFERENCES bm_retention_previews(id));
CREATE TABLE bm_retention_scope (preview_id TEXT NOT NULL, table_name TEXT NOT NULL, record_rowid INTEGER NOT NULL, PRIMARY KEY(preview_id,table_name,record_rowid));

DROP TRIGGER bm_note_addenda_kept;
CREATE TRIGGER bm_note_addenda_kept BEFORE DELETE ON bm_note_addenda  WHEN NOT EXISTS(SELECT 1 FROM bm_retention_scope s JOIN bm_retention_permits p ON p.preview_id=s.preview_id WHERE s.table_name='bm_note_addenda' AND s.record_rowid=OLD.rowid) BEGIN SELECT RAISE(ABORT,'note_locked'); END;

DROP TRIGGER bm_message_kept;
CREATE TRIGGER bm_message_kept BEFORE DELETE ON bm_messages
  WHEN NOT EXISTS(SELECT 1 FROM bm_retention_scope s JOIN bm_retention_permits p ON p.preview_id=s.preview_id WHERE s.table_name='bm_messages' AND s.record_rowid=OLD.rowid) BEGIN SELECT RAISE(ABORT,'messages_are_health_records'); END;

DROP TRIGGER bm_claim_events_kept;
CREATE TRIGGER bm_claim_events_kept BEFORE DELETE ON bm_claim_events  WHEN NOT EXISTS(SELECT 1 FROM bm_retention_scope s JOIN bm_retention_permits p ON p.preview_id=s.preview_id WHERE s.table_name='bm_claim_events' AND s.record_rowid=OLD.rowid) BEGIN SELECT RAISE(ABORT,'claim_event_fixed'); END;

DROP TRIGGER bm_movein_notes_retained;
CREATE TRIGGER bm_movein_notes_retained BEFORE DELETE ON bm_movein_notes
 WHEN ((SELECT state FROM bm_movein_jobs WHERE id=OLD.job_id)<>'undoing') AND NOT EXISTS(SELECT 1 FROM bm_retention_scope s JOIN bm_retention_permits p ON p.preview_id=s.preview_id WHERE s.table_name='bm_movein_notes' AND s.record_rowid=OLD.rowid) BEGIN SELECT RAISE(ABORT,'imported_records_retained'); END;

DROP TRIGGER bm_movein_balances_retained;
CREATE TRIGGER bm_movein_balances_retained BEFORE DELETE ON bm_movein_balances
 WHEN ((SELECT state FROM bm_movein_jobs WHERE id=OLD.job_id)<>'undoing') AND NOT EXISTS(SELECT 1 FROM bm_retention_scope s JOIN bm_retention_permits p ON p.preview_id=s.preview_id WHERE s.table_name='bm_movein_balances' AND s.record_rowid=OLD.rowid) BEGIN SELECT RAISE(ABORT,'imported_records_retained'); END;

DROP TRIGGER bm_movein_insurance_retained;
CREATE TRIGGER bm_movein_insurance_retained BEFORE DELETE ON bm_movein_insurance
 WHEN ((SELECT state FROM bm_movein_jobs WHERE id=OLD.job_id)<>'undoing') AND NOT EXISTS(SELECT 1 FROM bm_retention_scope s JOIN bm_retention_permits p ON p.preview_id=s.preview_id WHERE s.table_name='bm_movein_insurance' AND s.record_rowid=OLD.rowid) BEGIN SELECT RAISE(ABORT,'imported_records_retained'); END;

DROP TRIGGER bm_home_exercise_kept;
CREATE TRIGGER bm_home_exercise_kept BEFORE DELETE ON bm_home_exercises
  WHEN NOT EXISTS(SELECT 1 FROM bm_retention_scope s JOIN bm_retention_permits p ON p.preview_id=s.preview_id WHERE s.table_name='bm_home_exercises' AND s.record_rowid=OLD.rowid) BEGIN SELECT RAISE(ABORT,'exercises_are_health_records'); END;

DROP TRIGGER bm_home_exercise_done_kept;
CREATE TRIGGER bm_home_exercise_done_kept BEFORE DELETE ON bm_home_exercise_done
  WHEN NOT EXISTS(SELECT 1 FROM bm_retention_scope s JOIN bm_retention_permits p ON p.preview_id=s.preview_id WHERE s.table_name='bm_home_exercise_done' AND s.record_rowid=OLD.rowid) BEGIN SELECT RAISE(ABORT,'exercise_completions_are_health_records'); END;

DROP TRIGGER bm_case_steps_kept;
CREATE TRIGGER bm_case_steps_kept BEFORE DELETE ON bm_case_steps  WHEN NOT EXISTS(SELECT 1 FROM bm_retention_scope s JOIN bm_retention_permits p ON p.preview_id=s.preview_id WHERE s.table_name='bm_case_steps' AND s.record_rowid=OLD.rowid) BEGIN SELECT RAISE(ABORT,'case_step_kept'); END;

DROP TRIGGER bm_intake_consent_kept;
CREATE TRIGGER bm_intake_consent_kept BEFORE DELETE ON bm_intake_consents  WHEN NOT EXISTS(SELECT 1 FROM bm_retention_scope s JOIN bm_retention_permits p ON p.preview_id=s.preview_id WHERE s.table_name='bm_intake_consents' AND s.record_rowid=OLD.rowid) BEGIN SELECT RAISE(ABORT,'signed_records_cannot_change'); END;

DROP TRIGGER bm_intake_photo_kept;
CREATE TRIGGER bm_intake_photo_kept BEFORE DELETE ON bm_intake_photos  WHEN NOT EXISTS(SELECT 1 FROM bm_retention_scope s JOIN bm_retention_permits p ON p.preview_id=s.preview_id WHERE s.table_name='bm_intake_photos' AND s.record_rowid=OLD.rowid) BEGIN SELECT RAISE(ABORT,'photo_is_health_record'); END;

DROP TRIGGER bm_intake_insurance_kept;
CREATE TRIGGER bm_intake_insurance_kept BEFORE DELETE ON bm_intake_insurance  WHEN NOT EXISTS(SELECT 1 FROM bm_retention_scope s JOIN bm_retention_permits p ON p.preview_id=s.preview_id WHERE s.table_name='bm_intake_insurance' AND s.record_rowid=OLD.rowid) BEGIN SELECT RAISE(ABORT,'insurance_is_health_record'); END;

DROP TRIGGER bm_intake_identity_kept;
CREATE TRIGGER bm_intake_identity_kept BEFORE DELETE ON bm_intake_identity  WHEN NOT EXISTS(SELECT 1 FROM bm_retention_scope s JOIN bm_retention_permits p ON p.preview_id=s.preview_id WHERE s.table_name='bm_intake_identity' AND s.record_rowid=OLD.rowid) BEGIN SELECT RAISE(ABORT,'identity_is_health_record'); END;

DROP TRIGGER bm_message_attachment_kept;
CREATE TRIGGER bm_message_attachment_kept BEFORE DELETE ON bm_message_attachments  WHEN NOT EXISTS(SELECT 1 FROM bm_retention_scope s JOIN bm_retention_permits p ON p.preview_id=s.preview_id WHERE s.table_name='bm_message_attachments' AND s.record_rowid=OLD.rowid) BEGIN SELECT RAISE(ABORT,'messages_are_health_records'); END;

DROP TRIGGER bm_medicare_abns_fixed_delete;
CREATE TRIGGER bm_medicare_abns_fixed_delete BEFORE DELETE ON bm_medicare_abns  WHEN NOT EXISTS(SELECT 1 FROM bm_retention_scope s JOIN bm_retention_permits p ON p.preview_id=s.preview_id WHERE s.table_name='bm_medicare_abns' AND s.record_rowid=OLD.rowid) BEGIN SELECT RAISE(ABORT,'abn_is_fixed'); END;

DROP TRIGGER bm_disclosures_no_delete;
CREATE TRIGGER bm_disclosures_no_delete BEFORE DELETE ON bm_disclosures
  WHEN NOT EXISTS(SELECT 1 FROM bm_retention_scope s JOIN bm_retention_permits p ON p.preview_id=s.preview_id WHERE s.table_name='bm_disclosures' AND s.record_rowid=OLD.rowid) BEGIN SELECT RAISE(ABORT,'disclosure_append_only'); END;

DROP TRIGGER bm_chart_document_kept;
CREATE TRIGGER bm_chart_document_kept BEFORE DELETE ON bm_chart_documents  WHEN NOT EXISTS(SELECT 1 FROM bm_retention_scope s JOIN bm_retention_permits p ON p.preview_id=s.preview_id WHERE s.table_name='bm_chart_documents' AND s.record_rowid=OLD.rowid) BEGIN SELECT RAISE(ABORT,'documents_are_health_records'); END;

DROP TRIGGER bm_care_grants_no_delete;
CREATE TRIGGER bm_care_grants_no_delete BEFORE DELETE ON bm_care_grants  WHEN NOT EXISTS(SELECT 1 FROM bm_retention_scope s JOIN bm_retention_permits p ON p.preview_id=s.preview_id WHERE s.table_name='bm_care_grants' AND s.record_rowid=OLD.rowid) BEGIN SELECT RAISE(ABORT,'care_grant_fixed'); END;

DROP TRIGGER bm_break_glass_no_delete;
CREATE TRIGGER bm_break_glass_no_delete BEFORE DELETE ON bm_break_glass  WHEN NOT EXISTS(SELECT 1 FROM bm_retention_scope s JOIN bm_retention_permits p ON p.preview_id=s.preview_id WHERE s.table_name='bm_break_glass' AND s.record_rowid=OLD.rowid) BEGIN SELECT RAISE(ABORT,'break_glass_fixed'); END;
CREATE TRIGGER bm_retention_epoch_appointments_insert AFTER INSERT ON bm_appointments BEGIN UPDATE bm_retention_epoch SET version=version+1 WHERE id=1; END;
CREATE TRIGGER bm_retention_epoch_appointments_update AFTER UPDATE ON bm_appointments BEGIN UPDATE bm_retention_epoch SET version=version+1 WHERE id=1; END;
CREATE TRIGGER bm_retention_epoch_appointments_delete AFTER DELETE ON bm_appointments BEGIN UPDATE bm_retention_epoch SET version=version+1 WHERE id=1; END;
CREATE TRIGGER bm_retention_epoch_approvals_insert AFTER INSERT ON bm_approvals BEGIN UPDATE bm_retention_epoch SET version=version+1 WHERE id=1; END;
CREATE TRIGGER bm_retention_epoch_approvals_update AFTER UPDATE ON bm_approvals BEGIN UPDATE bm_retention_epoch SET version=version+1 WHERE id=1; END;
CREATE TRIGGER bm_retention_epoch_approvals_delete AFTER DELETE ON bm_approvals BEGIN UPDATE bm_retention_epoch SET version=version+1 WHERE id=1; END;
CREATE TRIGGER bm_retention_epoch_authorizations_insert AFTER INSERT ON bm_authorizations BEGIN UPDATE bm_retention_epoch SET version=version+1 WHERE id=1; END;
CREATE TRIGGER bm_retention_epoch_authorizations_update AFTER UPDATE ON bm_authorizations BEGIN UPDATE bm_retention_epoch SET version=version+1 WHERE id=1; END;
CREATE TRIGGER bm_retention_epoch_authorizations_delete AFTER DELETE ON bm_authorizations BEGIN UPDATE bm_retention_epoch SET version=version+1 WHERE id=1; END;
CREATE TRIGGER bm_retention_epoch_balance_notices_insert AFTER INSERT ON bm_balance_notices BEGIN UPDATE bm_retention_epoch SET version=version+1 WHERE id=1; END;
CREATE TRIGGER bm_retention_epoch_balance_notices_update AFTER UPDATE ON bm_balance_notices BEGIN UPDATE bm_retention_epoch SET version=version+1 WHERE id=1; END;
CREATE TRIGGER bm_retention_epoch_balance_notices_delete AFTER DELETE ON bm_balance_notices BEGIN UPDATE bm_retention_epoch SET version=version+1 WHERE id=1; END;
CREATE TRIGGER bm_retention_epoch_balance_reminders_insert AFTER INSERT ON bm_balance_reminders BEGIN UPDATE bm_retention_epoch SET version=version+1 WHERE id=1; END;
CREATE TRIGGER bm_retention_epoch_balance_reminders_update AFTER UPDATE ON bm_balance_reminders BEGIN UPDATE bm_retention_epoch SET version=version+1 WHERE id=1; END;
CREATE TRIGGER bm_retention_epoch_balance_reminders_delete AFTER DELETE ON bm_balance_reminders BEGIN UPDATE bm_retention_epoch SET version=version+1 WHERE id=1; END;
CREATE TRIGGER bm_retention_epoch_balance_review_queue_insert AFTER INSERT ON bm_balance_review_queue BEGIN UPDATE bm_retention_epoch SET version=version+1 WHERE id=1; END;
CREATE TRIGGER bm_retention_epoch_balance_review_queue_update AFTER UPDATE ON bm_balance_review_queue BEGIN UPDATE bm_retention_epoch SET version=version+1 WHERE id=1; END;
CREATE TRIGGER bm_retention_epoch_balance_review_queue_delete AFTER DELETE ON bm_balance_review_queue BEGIN UPDATE bm_retention_epoch SET version=version+1 WHERE id=1; END;
CREATE TRIGGER bm_retention_epoch_break_glass_insert AFTER INSERT ON bm_break_glass BEGIN UPDATE bm_retention_epoch SET version=version+1 WHERE id=1; END;
CREATE TRIGGER bm_retention_epoch_break_glass_update AFTER UPDATE ON bm_break_glass BEGIN UPDATE bm_retention_epoch SET version=version+1 WHERE id=1; END;
CREATE TRIGGER bm_retention_epoch_break_glass_delete AFTER DELETE ON bm_break_glass BEGIN UPDATE bm_retention_epoch SET version=version+1 WHERE id=1; END;
CREATE TRIGGER bm_retention_epoch_card_payments_insert AFTER INSERT ON bm_card_payments BEGIN UPDATE bm_retention_epoch SET version=version+1 WHERE id=1; END;
CREATE TRIGGER bm_retention_epoch_card_payments_update AFTER UPDATE ON bm_card_payments BEGIN UPDATE bm_retention_epoch SET version=version+1 WHERE id=1; END;
CREATE TRIGGER bm_retention_epoch_card_payments_delete AFTER DELETE ON bm_card_payments BEGIN UPDATE bm_retention_epoch SET version=version+1 WHERE id=1; END;
CREATE TRIGGER bm_retention_epoch_card_setups_insert AFTER INSERT ON bm_card_setups BEGIN UPDATE bm_retention_epoch SET version=version+1 WHERE id=1; END;
CREATE TRIGGER bm_retention_epoch_card_setups_update AFTER UPDATE ON bm_card_setups BEGIN UPDATE bm_retention_epoch SET version=version+1 WHERE id=1; END;
CREATE TRIGGER bm_retention_epoch_card_setups_delete AFTER DELETE ON bm_card_setups BEGIN UPDATE bm_retention_epoch SET version=version+1 WHERE id=1; END;
CREATE TRIGGER bm_retention_epoch_cards_insert AFTER INSERT ON bm_cards BEGIN UPDATE bm_retention_epoch SET version=version+1 WHERE id=1; END;
CREATE TRIGGER bm_retention_epoch_cards_update AFTER UPDATE ON bm_cards BEGIN UPDATE bm_retention_epoch SET version=version+1 WHERE id=1; END;
CREATE TRIGGER bm_retention_epoch_cards_delete AFTER DELETE ON bm_cards BEGIN UPDATE bm_retention_epoch SET version=version+1 WHERE id=1; END;
CREATE TRIGGER bm_retention_epoch_care_grants_insert AFTER INSERT ON bm_care_grants BEGIN UPDATE bm_retention_epoch SET version=version+1 WHERE id=1; END;
CREATE TRIGGER bm_retention_epoch_care_grants_update AFTER UPDATE ON bm_care_grants BEGIN UPDATE bm_retention_epoch SET version=version+1 WHERE id=1; END;
CREATE TRIGGER bm_retention_epoch_care_grants_delete AFTER DELETE ON bm_care_grants BEGIN UPDATE bm_retention_epoch SET version=version+1 WHERE id=1; END;
CREATE TRIGGER bm_retention_epoch_case_drafts_insert AFTER INSERT ON bm_case_drafts BEGIN UPDATE bm_retention_epoch SET version=version+1 WHERE id=1; END;
CREATE TRIGGER bm_retention_epoch_case_drafts_update AFTER UPDATE ON bm_case_drafts BEGIN UPDATE bm_retention_epoch SET version=version+1 WHERE id=1; END;
CREATE TRIGGER bm_retention_epoch_case_drafts_delete AFTER DELETE ON bm_case_drafts BEGIN UPDATE bm_retention_epoch SET version=version+1 WHERE id=1; END;
CREATE TRIGGER bm_retention_epoch_case_steps_insert AFTER INSERT ON bm_case_steps BEGIN UPDATE bm_retention_epoch SET version=version+1 WHERE id=1; END;
CREATE TRIGGER bm_retention_epoch_case_steps_update AFTER UPDATE ON bm_case_steps BEGIN UPDATE bm_retention_epoch SET version=version+1 WHERE id=1; END;
CREATE TRIGGER bm_retention_epoch_case_steps_delete AFTER DELETE ON bm_case_steps BEGIN UPDATE bm_retention_epoch SET version=version+1 WHERE id=1; END;
CREATE TRIGGER bm_retention_epoch_chart_documents_insert AFTER INSERT ON bm_chart_documents BEGIN UPDATE bm_retention_epoch SET version=version+1 WHERE id=1; END;
CREATE TRIGGER bm_retention_epoch_chart_documents_update AFTER UPDATE ON bm_chart_documents BEGIN UPDATE bm_retention_epoch SET version=version+1 WHERE id=1; END;
CREATE TRIGGER bm_retention_epoch_chart_documents_delete AFTER DELETE ON bm_chart_documents BEGIN UPDATE bm_retention_epoch SET version=version+1 WHERE id=1; END;
CREATE TRIGGER bm_retention_epoch_claim_batch_items_insert AFTER INSERT ON bm_claim_batch_items BEGIN UPDATE bm_retention_epoch SET version=version+1 WHERE id=1; END;
CREATE TRIGGER bm_retention_epoch_claim_batch_items_update AFTER UPDATE ON bm_claim_batch_items BEGIN UPDATE bm_retention_epoch SET version=version+1 WHERE id=1; END;
CREATE TRIGGER bm_retention_epoch_claim_batch_items_delete AFTER DELETE ON bm_claim_batch_items BEGIN UPDATE bm_retention_epoch SET version=version+1 WHERE id=1; END;
CREATE TRIGGER bm_retention_epoch_claim_batches_insert AFTER INSERT ON bm_claim_batches BEGIN UPDATE bm_retention_epoch SET version=version+1 WHERE id=1; END;
CREATE TRIGGER bm_retention_epoch_claim_batches_update AFTER UPDATE ON bm_claim_batches BEGIN UPDATE bm_retention_epoch SET version=version+1 WHERE id=1; END;
CREATE TRIGGER bm_retention_epoch_claim_batches_delete AFTER DELETE ON bm_claim_batches BEGIN UPDATE bm_retention_epoch SET version=version+1 WHERE id=1; END;
CREATE TRIGGER bm_retention_epoch_claim_events_insert AFTER INSERT ON bm_claim_events BEGIN UPDATE bm_retention_epoch SET version=version+1 WHERE id=1; END;
CREATE TRIGGER bm_retention_epoch_claim_events_update AFTER UPDATE ON bm_claim_events BEGIN UPDATE bm_retention_epoch SET version=version+1 WHERE id=1; END;
CREATE TRIGGER bm_retention_epoch_claim_events_delete AFTER DELETE ON bm_claim_events BEGIN UPDATE bm_retention_epoch SET version=version+1 WHERE id=1; END;
CREATE TRIGGER bm_retention_epoch_claims_insert AFTER INSERT ON bm_claims BEGIN UPDATE bm_retention_epoch SET version=version+1 WHERE id=1; END;
CREATE TRIGGER bm_retention_epoch_claims_update AFTER UPDATE ON bm_claims BEGIN UPDATE bm_retention_epoch SET version=version+1 WHERE id=1; END;
CREATE TRIGGER bm_retention_epoch_claims_delete AFTER DELETE ON bm_claims BEGIN UPDATE bm_retention_epoch SET version=version+1 WHERE id=1; END;
CREATE TRIGGER bm_retention_epoch_client_alerts_insert AFTER INSERT ON bm_client_alerts BEGIN UPDATE bm_retention_epoch SET version=version+1 WHERE id=1; END;
CREATE TRIGGER bm_retention_epoch_client_alerts_update AFTER UPDATE ON bm_client_alerts BEGIN UPDATE bm_retention_epoch SET version=version+1 WHERE id=1; END;
CREATE TRIGGER bm_retention_epoch_client_alerts_delete AFTER DELETE ON bm_client_alerts BEGIN UPDATE bm_retention_epoch SET version=version+1 WHERE id=1; END;
CREATE TRIGGER bm_retention_epoch_clients_insert AFTER INSERT ON bm_clients BEGIN UPDATE bm_retention_epoch SET version=version+1 WHERE id=1; END;
CREATE TRIGGER bm_retention_epoch_clients_update AFTER UPDATE ON bm_clients BEGIN UPDATE bm_retention_epoch SET version=version+1 WHERE id=1; END;
CREATE TRIGGER bm_retention_epoch_clients_delete AFTER DELETE ON bm_clients BEGIN UPDATE bm_retention_epoch SET version=version+1 WHERE id=1; END;
CREATE TRIGGER bm_retention_epoch_consent_declines_insert AFTER INSERT ON bm_consent_declines BEGIN UPDATE bm_retention_epoch SET version=version+1 WHERE id=1; END;
CREATE TRIGGER bm_retention_epoch_consent_declines_update AFTER UPDATE ON bm_consent_declines BEGIN UPDATE bm_retention_epoch SET version=version+1 WHERE id=1; END;
CREATE TRIGGER bm_retention_epoch_consent_declines_delete AFTER DELETE ON bm_consent_declines BEGIN UPDATE bm_retention_epoch SET version=version+1 WHERE id=1; END;
CREATE TRIGGER bm_retention_epoch_consent_links_insert AFTER INSERT ON bm_consent_links BEGIN UPDATE bm_retention_epoch SET version=version+1 WHERE id=1; END;
CREATE TRIGGER bm_retention_epoch_consent_links_update AFTER UPDATE ON bm_consent_links BEGIN UPDATE bm_retention_epoch SET version=version+1 WHERE id=1; END;
CREATE TRIGGER bm_retention_epoch_consent_links_delete AFTER DELETE ON bm_consent_links BEGIN UPDATE bm_retention_epoch SET version=version+1 WHERE id=1; END;
CREATE TRIGGER bm_retention_epoch_disclosures_insert AFTER INSERT ON bm_disclosures BEGIN UPDATE bm_retention_epoch SET version=version+1 WHERE id=1; END;
CREATE TRIGGER bm_retention_epoch_disclosures_update AFTER UPDATE ON bm_disclosures BEGIN UPDATE bm_retention_epoch SET version=version+1 WHERE id=1; END;
CREATE TRIGGER bm_retention_epoch_disclosures_delete AFTER DELETE ON bm_disclosures BEGIN UPDATE bm_retention_epoch SET version=version+1 WHERE id=1; END;
CREATE TRIGGER bm_retention_epoch_draft_requests_insert AFTER INSERT ON bm_draft_requests BEGIN UPDATE bm_retention_epoch SET version=version+1 WHERE id=1; END;
CREATE TRIGGER bm_retention_epoch_draft_requests_update AFTER UPDATE ON bm_draft_requests BEGIN UPDATE bm_retention_epoch SET version=version+1 WHERE id=1; END;
CREATE TRIGGER bm_retention_epoch_draft_requests_delete AFTER DELETE ON bm_draft_requests BEGIN UPDATE bm_retention_epoch SET version=version+1 WHERE id=1; END;
CREATE TRIGGER bm_retention_epoch_drafts_insert AFTER INSERT ON bm_drafts BEGIN UPDATE bm_retention_epoch SET version=version+1 WHERE id=1; END;
CREATE TRIGGER bm_retention_epoch_drafts_update AFTER UPDATE ON bm_drafts BEGIN UPDATE bm_retention_epoch SET version=version+1 WHERE id=1; END;
CREATE TRIGGER bm_retention_epoch_drafts_delete AFTER DELETE ON bm_drafts BEGIN UPDATE bm_retention_epoch SET version=version+1 WHERE id=1; END;
CREATE TRIGGER bm_retention_epoch_eligibility_insert AFTER INSERT ON bm_eligibility BEGIN UPDATE bm_retention_epoch SET version=version+1 WHERE id=1; END;
CREATE TRIGGER bm_retention_epoch_eligibility_update AFTER UPDATE ON bm_eligibility BEGIN UPDATE bm_retention_epoch SET version=version+1 WHERE id=1; END;
CREATE TRIGGER bm_retention_epoch_eligibility_delete AFTER DELETE ON bm_eligibility BEGIN UPDATE bm_retention_epoch SET version=version+1 WHERE id=1; END;
CREATE TRIGGER bm_retention_epoch_followup_attempts_insert AFTER INSERT ON bm_followup_attempts BEGIN UPDATE bm_retention_epoch SET version=version+1 WHERE id=1; END;
CREATE TRIGGER bm_retention_epoch_followup_attempts_update AFTER UPDATE ON bm_followup_attempts BEGIN UPDATE bm_retention_epoch SET version=version+1 WHERE id=1; END;
CREATE TRIGGER bm_retention_epoch_followup_attempts_delete AFTER DELETE ON bm_followup_attempts BEGIN UPDATE bm_retention_epoch SET version=version+1 WHERE id=1; END;
CREATE TRIGGER bm_retention_epoch_followups_insert AFTER INSERT ON bm_followups BEGIN UPDATE bm_retention_epoch SET version=version+1 WHERE id=1; END;
CREATE TRIGGER bm_retention_epoch_followups_update AFTER UPDATE ON bm_followups BEGIN UPDATE bm_retention_epoch SET version=version+1 WHERE id=1; END;
CREATE TRIGGER bm_retention_epoch_followups_delete AFTER DELETE ON bm_followups BEGIN UPDATE bm_retention_epoch SET version=version+1 WHERE id=1; END;
CREATE TRIGGER bm_retention_epoch_home_exercise_done_insert AFTER INSERT ON bm_home_exercise_done BEGIN UPDATE bm_retention_epoch SET version=version+1 WHERE id=1; END;
CREATE TRIGGER bm_retention_epoch_home_exercise_done_update AFTER UPDATE ON bm_home_exercise_done BEGIN UPDATE bm_retention_epoch SET version=version+1 WHERE id=1; END;
CREATE TRIGGER bm_retention_epoch_home_exercise_done_delete AFTER DELETE ON bm_home_exercise_done BEGIN UPDATE bm_retention_epoch SET version=version+1 WHERE id=1; END;
CREATE TRIGGER bm_retention_epoch_home_exercises_insert AFTER INSERT ON bm_home_exercises BEGIN UPDATE bm_retention_epoch SET version=version+1 WHERE id=1; END;
CREATE TRIGGER bm_retention_epoch_home_exercises_update AFTER UPDATE ON bm_home_exercises BEGIN UPDATE bm_retention_epoch SET version=version+1 WHERE id=1; END;
CREATE TRIGGER bm_retention_epoch_home_exercises_delete AFTER DELETE ON bm_home_exercises BEGIN UPDATE bm_retention_epoch SET version=version+1 WHERE id=1; END;
CREATE TRIGGER bm_retention_epoch_import_client_revisions_insert AFTER INSERT ON bm_import_client_revisions BEGIN UPDATE bm_retention_epoch SET version=version+1 WHERE id=1; END;
CREATE TRIGGER bm_retention_epoch_import_client_revisions_update AFTER UPDATE ON bm_import_client_revisions BEGIN UPDATE bm_retention_epoch SET version=version+1 WHERE id=1; END;
CREATE TRIGGER bm_retention_epoch_import_client_revisions_delete AFTER DELETE ON bm_import_client_revisions BEGIN UPDATE bm_retention_epoch SET version=version+1 WHERE id=1; END;
CREATE TRIGGER bm_retention_epoch_insurance_adjustments_insert AFTER INSERT ON bm_insurance_adjustments BEGIN UPDATE bm_retention_epoch SET version=version+1 WHERE id=1; END;
CREATE TRIGGER bm_retention_epoch_insurance_adjustments_update AFTER UPDATE ON bm_insurance_adjustments BEGIN UPDATE bm_retention_epoch SET version=version+1 WHERE id=1; END;
CREATE TRIGGER bm_retention_epoch_insurance_adjustments_delete AFTER DELETE ON bm_insurance_adjustments BEGIN UPDATE bm_retention_epoch SET version=version+1 WHERE id=1; END;
CREATE TRIGGER bm_retention_epoch_intake_consents_insert AFTER INSERT ON bm_intake_consents BEGIN UPDATE bm_retention_epoch SET version=version+1 WHERE id=1; END;
CREATE TRIGGER bm_retention_epoch_intake_consents_update AFTER UPDATE ON bm_intake_consents BEGIN UPDATE bm_retention_epoch SET version=version+1 WHERE id=1; END;
CREATE TRIGGER bm_retention_epoch_intake_consents_delete AFTER DELETE ON bm_intake_consents BEGIN UPDATE bm_retention_epoch SET version=version+1 WHERE id=1; END;
CREATE TRIGGER bm_retention_epoch_intake_identity_insert AFTER INSERT ON bm_intake_identity BEGIN UPDATE bm_retention_epoch SET version=version+1 WHERE id=1; END;
CREATE TRIGGER bm_retention_epoch_intake_identity_update AFTER UPDATE ON bm_intake_identity BEGIN UPDATE bm_retention_epoch SET version=version+1 WHERE id=1; END;
CREATE TRIGGER bm_retention_epoch_intake_identity_delete AFTER DELETE ON bm_intake_identity BEGIN UPDATE bm_retention_epoch SET version=version+1 WHERE id=1; END;
CREATE TRIGGER bm_retention_epoch_intake_insurance_insert AFTER INSERT ON bm_intake_insurance BEGIN UPDATE bm_retention_epoch SET version=version+1 WHERE id=1; END;
CREATE TRIGGER bm_retention_epoch_intake_insurance_update AFTER UPDATE ON bm_intake_insurance BEGIN UPDATE bm_retention_epoch SET version=version+1 WHERE id=1; END;
CREATE TRIGGER bm_retention_epoch_intake_insurance_delete AFTER DELETE ON bm_intake_insurance BEGIN UPDATE bm_retention_epoch SET version=version+1 WHERE id=1; END;
CREATE TRIGGER bm_retention_epoch_intake_photos_insert AFTER INSERT ON bm_intake_photos BEGIN UPDATE bm_retention_epoch SET version=version+1 WHERE id=1; END;
CREATE TRIGGER bm_retention_epoch_intake_photos_update AFTER UPDATE ON bm_intake_photos BEGIN UPDATE bm_retention_epoch SET version=version+1 WHERE id=1; END;
CREATE TRIGGER bm_retention_epoch_intake_photos_delete AFTER DELETE ON bm_intake_photos BEGIN UPDATE bm_retention_epoch SET version=version+1 WHERE id=1; END;
CREATE TRIGGER bm_retention_epoch_intake_responses_insert AFTER INSERT ON bm_intake_responses BEGIN UPDATE bm_retention_epoch SET version=version+1 WHERE id=1; END;
CREATE TRIGGER bm_retention_epoch_intake_responses_update AFTER UPDATE ON bm_intake_responses BEGIN UPDATE bm_retention_epoch SET version=version+1 WHERE id=1; END;
CREATE TRIGGER bm_retention_epoch_intake_responses_delete AFTER DELETE ON bm_intake_responses BEGIN UPDATE bm_retention_epoch SET version=version+1 WHERE id=1; END;
CREATE TRIGGER bm_retention_epoch_invoices_insert AFTER INSERT ON bm_invoices BEGIN UPDATE bm_retention_epoch SET version=version+1 WHERE id=1; END;
CREATE TRIGGER bm_retention_epoch_invoices_update AFTER UPDATE ON bm_invoices BEGIN UPDATE bm_retention_epoch SET version=version+1 WHERE id=1; END;
CREATE TRIGGER bm_retention_epoch_invoices_delete AFTER DELETE ON bm_invoices BEGIN UPDATE bm_retention_epoch SET version=version+1 WHERE id=1; END;
CREATE TRIGGER bm_retention_epoch_mail_attempt_visits_insert AFTER INSERT ON bm_mail_attempt_visits BEGIN UPDATE bm_retention_epoch SET version=version+1 WHERE id=1; END;
CREATE TRIGGER bm_retention_epoch_mail_attempt_visits_update AFTER UPDATE ON bm_mail_attempt_visits BEGIN UPDATE bm_retention_epoch SET version=version+1 WHERE id=1; END;
CREATE TRIGGER bm_retention_epoch_mail_attempt_visits_delete AFTER DELETE ON bm_mail_attempt_visits BEGIN UPDATE bm_retention_epoch SET version=version+1 WHERE id=1; END;
CREATE TRIGGER bm_retention_epoch_mail_attempts_insert AFTER INSERT ON bm_mail_attempts BEGIN UPDATE bm_retention_epoch SET version=version+1 WHERE id=1; END;
CREATE TRIGGER bm_retention_epoch_mail_attempts_update AFTER UPDATE ON bm_mail_attempts BEGIN UPDATE bm_retention_epoch SET version=version+1 WHERE id=1; END;
CREATE TRIGGER bm_retention_epoch_mail_attempts_delete AFTER DELETE ON bm_mail_attempts BEGIN UPDATE bm_retention_epoch SET version=version+1 WHERE id=1; END;
CREATE TRIGGER bm_retention_epoch_mail_reply_links_insert AFTER INSERT ON bm_mail_reply_links BEGIN UPDATE bm_retention_epoch SET version=version+1 WHERE id=1; END;
CREATE TRIGGER bm_retention_epoch_mail_reply_links_update AFTER UPDATE ON bm_mail_reply_links BEGIN UPDATE bm_retention_epoch SET version=version+1 WHERE id=1; END;
CREATE TRIGGER bm_retention_epoch_mail_reply_links_delete AFTER DELETE ON bm_mail_reply_links BEGIN UPDATE bm_retention_epoch SET version=version+1 WHERE id=1; END;
CREATE TRIGGER bm_retention_epoch_medicare_abns_insert AFTER INSERT ON bm_medicare_abns BEGIN UPDATE bm_retention_epoch SET version=version+1 WHERE id=1; END;
CREATE TRIGGER bm_retention_epoch_medicare_abns_update AFTER UPDATE ON bm_medicare_abns BEGIN UPDATE bm_retention_epoch SET version=version+1 WHERE id=1; END;
CREATE TRIGGER bm_retention_epoch_medicare_abns_delete AFTER DELETE ON bm_medicare_abns BEGIN UPDATE bm_retention_epoch SET version=version+1 WHERE id=1; END;
CREATE TRIGGER bm_retention_epoch_medicare_expenses_insert AFTER INSERT ON bm_medicare_expenses BEGIN UPDATE bm_retention_epoch SET version=version+1 WHERE id=1; END;
CREATE TRIGGER bm_retention_epoch_medicare_expenses_update AFTER UPDATE ON bm_medicare_expenses BEGIN UPDATE bm_retention_epoch SET version=version+1 WHERE id=1; END;
CREATE TRIGGER bm_retention_epoch_medicare_expenses_delete AFTER DELETE ON bm_medicare_expenses BEGIN UPDATE bm_retention_epoch SET version=version+1 WHERE id=1; END;
CREATE TRIGGER bm_retention_epoch_medicare_years_insert AFTER INSERT ON bm_medicare_years BEGIN UPDATE bm_retention_epoch SET version=version+1 WHERE id=1; END;
CREATE TRIGGER bm_retention_epoch_medicare_years_update AFTER UPDATE ON bm_medicare_years BEGIN UPDATE bm_retention_epoch SET version=version+1 WHERE id=1; END;
CREATE TRIGGER bm_retention_epoch_medicare_years_delete AFTER DELETE ON bm_medicare_years BEGIN UPDATE bm_retention_epoch SET version=version+1 WHERE id=1; END;
CREATE TRIGGER bm_retention_epoch_message_attachments_insert AFTER INSERT ON bm_message_attachments BEGIN UPDATE bm_retention_epoch SET version=version+1 WHERE id=1; END;
CREATE TRIGGER bm_retention_epoch_message_attachments_update AFTER UPDATE ON bm_message_attachments BEGIN UPDATE bm_retention_epoch SET version=version+1 WHERE id=1; END;
CREATE TRIGGER bm_retention_epoch_message_attachments_delete AFTER DELETE ON bm_message_attachments BEGIN UPDATE bm_retention_epoch SET version=version+1 WHERE id=1; END;
CREATE TRIGGER bm_retention_epoch_message_links_insert AFTER INSERT ON bm_message_links BEGIN UPDATE bm_retention_epoch SET version=version+1 WHERE id=1; END;
CREATE TRIGGER bm_retention_epoch_message_links_update AFTER UPDATE ON bm_message_links BEGIN UPDATE bm_retention_epoch SET version=version+1 WHERE id=1; END;
CREATE TRIGGER bm_retention_epoch_message_links_delete AFTER DELETE ON bm_message_links BEGIN UPDATE bm_retention_epoch SET version=version+1 WHERE id=1; END;
CREATE TRIGGER bm_retention_epoch_messages_insert AFTER INSERT ON bm_messages BEGIN UPDATE bm_retention_epoch SET version=version+1 WHERE id=1; END;
CREATE TRIGGER bm_retention_epoch_messages_update AFTER UPDATE ON bm_messages BEGIN UPDATE bm_retention_epoch SET version=version+1 WHERE id=1; END;
CREATE TRIGGER bm_retention_epoch_messages_delete AFTER DELETE ON bm_messages BEGIN UPDATE bm_retention_epoch SET version=version+1 WHERE id=1; END;
CREATE TRIGGER bm_retention_epoch_movein_balances_insert AFTER INSERT ON bm_movein_balances BEGIN UPDATE bm_retention_epoch SET version=version+1 WHERE id=1; END;
CREATE TRIGGER bm_retention_epoch_movein_balances_update AFTER UPDATE ON bm_movein_balances BEGIN UPDATE bm_retention_epoch SET version=version+1 WHERE id=1; END;
CREATE TRIGGER bm_retention_epoch_movein_balances_delete AFTER DELETE ON bm_movein_balances BEGIN UPDATE bm_retention_epoch SET version=version+1 WHERE id=1; END;
CREATE TRIGGER bm_retention_epoch_movein_insurance_insert AFTER INSERT ON bm_movein_insurance BEGIN UPDATE bm_retention_epoch SET version=version+1 WHERE id=1; END;
CREATE TRIGGER bm_retention_epoch_movein_insurance_update AFTER UPDATE ON bm_movein_insurance BEGIN UPDATE bm_retention_epoch SET version=version+1 WHERE id=1; END;
CREATE TRIGGER bm_retention_epoch_movein_insurance_delete AFTER DELETE ON bm_movein_insurance BEGIN UPDATE bm_retention_epoch SET version=version+1 WHERE id=1; END;
CREATE TRIGGER bm_retention_epoch_movein_jobs_insert AFTER INSERT ON bm_movein_jobs BEGIN UPDATE bm_retention_epoch SET version=version+1 WHERE id=1; END;
CREATE TRIGGER bm_retention_epoch_movein_jobs_update AFTER UPDATE ON bm_movein_jobs BEGIN UPDATE bm_retention_epoch SET version=version+1 WHERE id=1; END;
CREATE TRIGGER bm_retention_epoch_movein_jobs_delete AFTER DELETE ON bm_movein_jobs BEGIN UPDATE bm_retention_epoch SET version=version+1 WHERE id=1; END;
CREATE TRIGGER bm_retention_epoch_movein_notes_insert AFTER INSERT ON bm_movein_notes BEGIN UPDATE bm_retention_epoch SET version=version+1 WHERE id=1; END;
CREATE TRIGGER bm_retention_epoch_movein_notes_update AFTER UPDATE ON bm_movein_notes BEGIN UPDATE bm_retention_epoch SET version=version+1 WHERE id=1; END;
CREATE TRIGGER bm_retention_epoch_movein_notes_delete AFTER DELETE ON bm_movein_notes BEGIN UPDATE bm_retention_epoch SET version=version+1 WHERE id=1; END;
CREATE TRIGGER bm_retention_epoch_movein_payloads_insert AFTER INSERT ON bm_movein_payloads BEGIN UPDATE bm_retention_epoch SET version=version+1 WHERE id=1; END;
CREATE TRIGGER bm_retention_epoch_movein_payloads_update AFTER UPDATE ON bm_movein_payloads BEGIN UPDATE bm_retention_epoch SET version=version+1 WHERE id=1; END;
CREATE TRIGGER bm_retention_epoch_movein_payloads_delete AFTER DELETE ON bm_movein_payloads BEGIN UPDATE bm_retention_epoch SET version=version+1 WHERE id=1; END;
CREATE TRIGGER bm_retention_epoch_movein_records_insert AFTER INSERT ON bm_movein_records BEGIN UPDATE bm_retention_epoch SET version=version+1 WHERE id=1; END;
CREATE TRIGGER bm_retention_epoch_movein_records_update AFTER UPDATE ON bm_movein_records BEGIN UPDATE bm_retention_epoch SET version=version+1 WHERE id=1; END;
CREATE TRIGGER bm_retention_epoch_movein_records_delete AFTER DELETE ON bm_movein_records BEGIN UPDATE bm_retention_epoch SET version=version+1 WHERE id=1; END;
CREATE TRIGGER bm_retention_epoch_note_addenda_insert AFTER INSERT ON bm_note_addenda BEGIN UPDATE bm_retention_epoch SET version=version+1 WHERE id=1; END;
CREATE TRIGGER bm_retention_epoch_note_addenda_update AFTER UPDATE ON bm_note_addenda BEGIN UPDATE bm_retention_epoch SET version=version+1 WHERE id=1; END;
CREATE TRIGGER bm_retention_epoch_note_addenda_delete AFTER DELETE ON bm_note_addenda BEGIN UPDATE bm_retention_epoch SET version=version+1 WHERE id=1; END;
CREATE TRIGGER bm_retention_epoch_note_revisions_insert AFTER INSERT ON bm_note_revisions BEGIN UPDATE bm_retention_epoch SET version=version+1 WHERE id=1; END;
CREATE TRIGGER bm_retention_epoch_note_revisions_update AFTER UPDATE ON bm_note_revisions BEGIN UPDATE bm_retention_epoch SET version=version+1 WHERE id=1; END;
CREATE TRIGGER bm_retention_epoch_note_revisions_delete AFTER DELETE ON bm_note_revisions BEGIN UPDATE bm_retention_epoch SET version=version+1 WHERE id=1; END;
CREATE TRIGGER bm_retention_epoch_notes_insert AFTER INSERT ON bm_notes BEGIN UPDATE bm_retention_epoch SET version=version+1 WHERE id=1; END;
CREATE TRIGGER bm_retention_epoch_notes_update AFTER UPDATE ON bm_notes BEGIN UPDATE bm_retention_epoch SET version=version+1 WHERE id=1; END;
CREATE TRIGGER bm_retention_epoch_notes_delete AFTER DELETE ON bm_notes BEGIN UPDATE bm_retention_epoch SET version=version+1 WHERE id=1; END;
CREATE TRIGGER bm_retention_epoch_offer_recipients_insert AFTER INSERT ON bm_offer_recipients BEGIN UPDATE bm_retention_epoch SET version=version+1 WHERE id=1; END;
CREATE TRIGGER bm_retention_epoch_offer_recipients_update AFTER UPDATE ON bm_offer_recipients BEGIN UPDATE bm_retention_epoch SET version=version+1 WHERE id=1; END;
CREATE TRIGGER bm_retention_epoch_offer_recipients_delete AFTER DELETE ON bm_offer_recipients BEGIN UPDATE bm_retention_epoch SET version=version+1 WHERE id=1; END;
CREATE TRIGGER bm_retention_epoch_offers_insert AFTER INSERT ON bm_offers BEGIN UPDATE bm_retention_epoch SET version=version+1 WHERE id=1; END;
CREATE TRIGGER bm_retention_epoch_offers_update AFTER UPDATE ON bm_offers BEGIN UPDATE bm_retention_epoch SET version=version+1 WHERE id=1; END;
CREATE TRIGGER bm_retention_epoch_offers_delete AFTER DELETE ON bm_offers BEGIN UPDATE bm_retention_epoch SET version=version+1 WHERE id=1; END;
CREATE TRIGGER bm_retention_epoch_pay_links_insert AFTER INSERT ON bm_pay_links BEGIN UPDATE bm_retention_epoch SET version=version+1 WHERE id=1; END;
CREATE TRIGGER bm_retention_epoch_pay_links_update AFTER UPDATE ON bm_pay_links BEGIN UPDATE bm_retention_epoch SET version=version+1 WHERE id=1; END;
CREATE TRIGGER bm_retention_epoch_pay_links_delete AFTER DELETE ON bm_pay_links BEGIN UPDATE bm_retention_epoch SET version=version+1 WHERE id=1; END;
CREATE TRIGGER bm_retention_epoch_payment_plans_insert AFTER INSERT ON bm_payment_plans BEGIN UPDATE bm_retention_epoch SET version=version+1 WHERE id=1; END;
CREATE TRIGGER bm_retention_epoch_payment_plans_update AFTER UPDATE ON bm_payment_plans BEGIN UPDATE bm_retention_epoch SET version=version+1 WHERE id=1; END;
CREATE TRIGGER bm_retention_epoch_payment_plans_delete AFTER DELETE ON bm_payment_plans BEGIN UPDATE bm_retention_epoch SET version=version+1 WHERE id=1; END;
CREATE TRIGGER bm_retention_epoch_payments_insert AFTER INSERT ON bm_payments BEGIN UPDATE bm_retention_epoch SET version=version+1 WHERE id=1; END;
CREATE TRIGGER bm_retention_epoch_payments_update AFTER UPDATE ON bm_payments BEGIN UPDATE bm_retention_epoch SET version=version+1 WHERE id=1; END;
CREATE TRIGGER bm_retention_epoch_payments_delete AFTER DELETE ON bm_payments BEGIN UPDATE bm_retention_epoch SET version=version+1 WHERE id=1; END;
CREATE TRIGGER bm_retention_epoch_plan_installments_insert AFTER INSERT ON bm_plan_installments BEGIN UPDATE bm_retention_epoch SET version=version+1 WHERE id=1; END;
CREATE TRIGGER bm_retention_epoch_plan_installments_update AFTER UPDATE ON bm_plan_installments BEGIN UPDATE bm_retention_epoch SET version=version+1 WHERE id=1; END;
CREATE TRIGGER bm_retention_epoch_plan_installments_delete AFTER DELETE ON bm_plan_installments BEGIN UPDATE bm_retention_epoch SET version=version+1 WHERE id=1; END;
CREATE TRIGGER bm_retention_epoch_plans_of_care_insert AFTER INSERT ON bm_plans_of_care BEGIN UPDATE bm_retention_epoch SET version=version+1 WHERE id=1; END;
CREATE TRIGGER bm_retention_epoch_plans_of_care_update AFTER UPDATE ON bm_plans_of_care BEGIN UPDATE bm_retention_epoch SET version=version+1 WHERE id=1; END;
CREATE TRIGGER bm_retention_epoch_plans_of_care_delete AFTER DELETE ON bm_plans_of_care BEGIN UPDATE bm_retention_epoch SET version=version+1 WHERE id=1; END;
CREATE TRIGGER bm_retention_epoch_policies_insert AFTER INSERT ON bm_policies BEGIN UPDATE bm_retention_epoch SET version=version+1 WHERE id=1; END;
CREATE TRIGGER bm_retention_epoch_policies_update AFTER UPDATE ON bm_policies BEGIN UPDATE bm_retention_epoch SET version=version+1 WHERE id=1; END;
CREATE TRIGGER bm_retention_epoch_policies_delete AFTER DELETE ON bm_policies BEGIN UPDATE bm_retention_epoch SET version=version+1 WHERE id=1; END;
CREATE TRIGGER bm_retention_epoch_portal_links_insert AFTER INSERT ON bm_portal_links BEGIN UPDATE bm_retention_epoch SET version=version+1 WHERE id=1; END;
CREATE TRIGGER bm_retention_epoch_portal_links_update AFTER UPDATE ON bm_portal_links BEGIN UPDATE bm_retention_epoch SET version=version+1 WHERE id=1; END;
CREATE TRIGGER bm_retention_epoch_portal_links_delete AFTER DELETE ON bm_portal_links BEGIN UPDATE bm_retention_epoch SET version=version+1 WHERE id=1; END;
CREATE TRIGGER bm_retention_epoch_portal_sessions_insert AFTER INSERT ON bm_portal_sessions BEGIN UPDATE bm_retention_epoch SET version=version+1 WHERE id=1; END;
CREATE TRIGGER bm_retention_epoch_portal_sessions_update AFTER UPDATE ON bm_portal_sessions BEGIN UPDATE bm_retention_epoch SET version=version+1 WHERE id=1; END;
CREATE TRIGGER bm_retention_epoch_portal_sessions_delete AFTER DELETE ON bm_portal_sessions BEGIN UPDATE bm_retention_epoch SET version=version+1 WHERE id=1; END;
CREATE TRIGGER bm_retention_epoch_referrals_insert AFTER INSERT ON bm_referrals BEGIN UPDATE bm_retention_epoch SET version=version+1 WHERE id=1; END;
CREATE TRIGGER bm_retention_epoch_referrals_update AFTER UPDATE ON bm_referrals BEGIN UPDATE bm_retention_epoch SET version=version+1 WHERE id=1; END;
CREATE TRIGGER bm_retention_epoch_referrals_delete AFTER DELETE ON bm_referrals BEGIN UPDATE bm_retention_epoch SET version=version+1 WHERE id=1; END;
CREATE TRIGGER bm_retention_epoch_remittance_claims_insert AFTER INSERT ON bm_remittance_claims BEGIN UPDATE bm_retention_epoch SET version=version+1 WHERE id=1; END;
CREATE TRIGGER bm_retention_epoch_remittance_claims_update AFTER UPDATE ON bm_remittance_claims BEGIN UPDATE bm_retention_epoch SET version=version+1 WHERE id=1; END;
CREATE TRIGGER bm_retention_epoch_remittance_claims_delete AFTER DELETE ON bm_remittance_claims BEGIN UPDATE bm_retention_epoch SET version=version+1 WHERE id=1; END;
CREATE TRIGGER bm_retention_epoch_retention_holds_insert AFTER INSERT ON bm_retention_holds BEGIN UPDATE bm_retention_epoch SET version=version+1 WHERE id=1; END;
CREATE TRIGGER bm_retention_epoch_retention_holds_update AFTER UPDATE ON bm_retention_holds BEGIN UPDATE bm_retention_epoch SET version=version+1 WHERE id=1; END;
CREATE TRIGGER bm_retention_epoch_retention_holds_delete AFTER DELETE ON bm_retention_holds BEGIN UPDATE bm_retention_epoch SET version=version+1 WHERE id=1; END;
CREATE TRIGGER bm_retention_epoch_retention_policy_insert AFTER INSERT ON bm_retention_policy BEGIN UPDATE bm_retention_epoch SET version=version+1 WHERE id=1; END;
CREATE TRIGGER bm_retention_epoch_retention_policy_update AFTER UPDATE ON bm_retention_policy BEGIN UPDATE bm_retention_epoch SET version=version+1 WHERE id=1; END;
CREATE TRIGGER bm_retention_epoch_retention_policy_delete AFTER DELETE ON bm_retention_policy BEGIN UPDATE bm_retention_epoch SET version=version+1 WHERE id=1; END;
CREATE TRIGGER bm_retention_epoch_series_insert AFTER INSERT ON bm_series BEGIN UPDATE bm_retention_epoch SET version=version+1 WHERE id=1; END;
CREATE TRIGGER bm_retention_epoch_series_update AFTER UPDATE ON bm_series BEGIN UPDATE bm_retention_epoch SET version=version+1 WHERE id=1; END;
CREATE TRIGGER bm_retention_epoch_series_delete AFTER DELETE ON bm_series BEGIN UPDATE bm_retention_epoch SET version=version+1 WHERE id=1; END;
CREATE TRIGGER bm_retention_epoch_stripe_customers_insert AFTER INSERT ON bm_stripe_customers BEGIN UPDATE bm_retention_epoch SET version=version+1 WHERE id=1; END;
CREATE TRIGGER bm_retention_epoch_stripe_customers_update AFTER UPDATE ON bm_stripe_customers BEGIN UPDATE bm_retention_epoch SET version=version+1 WHERE id=1; END;
CREATE TRIGGER bm_retention_epoch_stripe_customers_delete AFTER DELETE ON bm_stripe_customers BEGIN UPDATE bm_retention_epoch SET version=version+1 WHERE id=1; END;
CREATE TRIGGER bm_retention_epoch_visit_cancellations_insert AFTER INSERT ON bm_visit_cancellations BEGIN UPDATE bm_retention_epoch SET version=version+1 WHERE id=1; END;
CREATE TRIGGER bm_retention_epoch_visit_cancellations_update AFTER UPDATE ON bm_visit_cancellations BEGIN UPDATE bm_retention_epoch SET version=version+1 WHERE id=1; END;
CREATE TRIGGER bm_retention_epoch_visit_cancellations_delete AFTER DELETE ON bm_visit_cancellations BEGIN UPDATE bm_retention_epoch SET version=version+1 WHERE id=1; END;
CREATE TRIGGER bm_retention_epoch_visit_codes_insert AFTER INSERT ON bm_visit_codes BEGIN UPDATE bm_retention_epoch SET version=version+1 WHERE id=1; END;
CREATE TRIGGER bm_retention_epoch_visit_codes_update AFTER UPDATE ON bm_visit_codes BEGIN UPDATE bm_retention_epoch SET version=version+1 WHERE id=1; END;
CREATE TRIGGER bm_retention_epoch_visit_codes_delete AFTER DELETE ON bm_visit_codes BEGIN UPDATE bm_retention_epoch SET version=version+1 WHERE id=1; END;
CREATE TRIGGER bm_retention_epoch_visit_fees_insert AFTER INSERT ON bm_visit_fees BEGIN UPDATE bm_retention_epoch SET version=version+1 WHERE id=1; END;
CREATE TRIGGER bm_retention_epoch_visit_fees_update AFTER UPDATE ON bm_visit_fees BEGIN UPDATE bm_retention_epoch SET version=version+1 WHERE id=1; END;
CREATE TRIGGER bm_retention_epoch_visit_fees_delete AFTER DELETE ON bm_visit_fees BEGIN UPDATE bm_retention_epoch SET version=version+1 WHERE id=1; END;
CREATE TRIGGER bm_retention_epoch_visit_reminders_insert AFTER INSERT ON bm_visit_reminders BEGIN UPDATE bm_retention_epoch SET version=version+1 WHERE id=1; END;
CREATE TRIGGER bm_retention_epoch_visit_reminders_update AFTER UPDATE ON bm_visit_reminders BEGIN UPDATE bm_retention_epoch SET version=version+1 WHERE id=1; END;
CREATE TRIGGER bm_retention_epoch_visit_reminders_delete AFTER DELETE ON bm_visit_reminders BEGIN UPDATE bm_retention_epoch SET version=version+1 WHERE id=1; END;
CREATE TRIGGER bm_retention_epoch_visit_reply_links_insert AFTER INSERT ON bm_visit_reply_links BEGIN UPDATE bm_retention_epoch SET version=version+1 WHERE id=1; END;
CREATE TRIGGER bm_retention_epoch_visit_reply_links_update AFTER UPDATE ON bm_visit_reply_links BEGIN UPDATE bm_retention_epoch SET version=version+1 WHERE id=1; END;
CREATE TRIGGER bm_retention_epoch_visit_reply_links_delete AFTER DELETE ON bm_visit_reply_links BEGIN UPDATE bm_retention_epoch SET version=version+1 WHERE id=1; END;
CREATE TRIGGER bm_retention_epoch_waitlist_insert AFTER INSERT ON bm_waitlist BEGIN UPDATE bm_retention_epoch SET version=version+1 WHERE id=1; END;
CREATE TRIGGER bm_retention_epoch_waitlist_update AFTER UPDATE ON bm_waitlist BEGIN UPDATE bm_retention_epoch SET version=version+1 WHERE id=1; END;
CREATE TRIGGER bm_retention_epoch_waitlist_delete AFTER DELETE ON bm_waitlist BEGIN UPDATE bm_retention_epoch SET version=version+1 WHERE id=1; END;

-- Owner-approved retention only: remove free text; preserve the complete audit spine.
DROP TRIGGER bm_audit_no_update;
CREATE TRIGGER bm_audit_no_update BEFORE UPDATE ON bm_audit
WHEN NOT (NEW.detail='' AND NEW.sequence IS OLD.sequence AND NEW.at IS OLD.at
 AND NEW.actor_email IS OLD.actor_email AND NEW.actor_role IS OLD.actor_role
 AND NEW.action IS OLD.action AND NEW.client_id IS OLD.client_id AND NEW.subject_id IS OLD.subject_id
 AND EXISTS(SELECT 1 FROM bm_retention_permits p JOIN bm_retention_previews v ON v.id=p.preview_id
   WHERE p.client_id=OLD.client_id AND v.client_id=OLD.client_id))
BEGIN SELECT RAISE(ABORT,'audit_append_only'); END;

CREATE TRIGGER bm_destroyed_invoices_fixed BEFORE UPDATE ON bm_destroyed_invoices BEGIN SELECT RAISE(ABORT,'anonymous_business_fact_fixed'); END;
CREATE TRIGGER bm_destroyed_invoices_kept BEFORE DELETE ON bm_destroyed_invoices BEGIN SELECT RAISE(ABORT,'anonymous_business_fact_fixed'); END;

CREATE TRIGGER bm_destroyed_payments_fixed BEFORE UPDATE ON bm_destroyed_payments BEGIN SELECT RAISE(ABORT,'anonymous_business_fact_fixed'); END;
CREATE TRIGGER bm_destroyed_payments_kept BEFORE DELETE ON bm_destroyed_payments BEGIN SELECT RAISE(ABORT,'anonymous_business_fact_fixed'); END;

CREATE TRIGGER bm_destroyed_adjustments_fixed BEFORE UPDATE ON bm_destroyed_adjustments BEGIN SELECT RAISE(ABORT,'anonymous_business_fact_fixed'); END;
CREATE TRIGGER bm_destroyed_adjustments_kept BEFORE DELETE ON bm_destroyed_adjustments BEGIN SELECT RAISE(ABORT,'anonymous_business_fact_fixed'); END;

CREATE TRIGGER bm_destroyed_cards_fixed BEFORE UPDATE ON bm_destroyed_cards BEGIN SELECT RAISE(ABORT,'anonymous_business_fact_fixed'); END;
CREATE TRIGGER bm_destroyed_cards_kept BEFORE DELETE ON bm_destroyed_cards BEGIN SELECT RAISE(ABORT,'anonymous_business_fact_fixed'); END;

CREATE TRIGGER bm_destroyed_visits_fixed BEFORE UPDATE ON bm_destroyed_visits BEGIN SELECT RAISE(ABORT,'anonymous_business_fact_fixed'); END;
CREATE TRIGGER bm_destroyed_visits_kept BEFORE DELETE ON bm_destroyed_visits BEGIN SELECT RAISE(ABORT,'anonymous_business_fact_fixed'); END;

CREATE TABLE bm_destroyed_operations(id TEXT PRIMARY KEY,anonymous_group TEXT NOT NULL,practitioner_id TEXT NOT NULL,service_id TEXT NOT NULL,service TEXT NOT NULL,start_at TEXT NOT NULL,end_at TEXT NOT NULL,status TEXT NOT NULL);
CREATE TABLE bm_destroyed_evaluations(id TEXT PRIMARY KEY,author_id TEXT NOT NULL,template TEXT NOT NULL,performed_at TEXT NOT NULL);
CREATE TABLE bm_destroyed_plans(id TEXT PRIMARY KEY,anonymous_group TEXT NOT NULL,author_id TEXT NOT NULL,start_date TEXT,per_week INTEGER,weeks INTEGER);
CREATE TRIGGER bm_destroyed_operations_fixed BEFORE UPDATE ON bm_destroyed_operations BEGIN SELECT RAISE(ABORT,'anonymous_business_fact_fixed'); END;
CREATE TRIGGER bm_destroyed_operations_kept BEFORE DELETE ON bm_destroyed_operations BEGIN SELECT RAISE(ABORT,'anonymous_business_fact_fixed'); END;
CREATE TRIGGER bm_destroyed_evaluations_fixed BEFORE UPDATE ON bm_destroyed_evaluations BEGIN SELECT RAISE(ABORT,'anonymous_business_fact_fixed'); END;
CREATE TRIGGER bm_destroyed_evaluations_kept BEFORE DELETE ON bm_destroyed_evaluations BEGIN SELECT RAISE(ABORT,'anonymous_business_fact_fixed'); END;
CREATE TRIGGER bm_destroyed_plans_fixed BEFORE UPDATE ON bm_destroyed_plans BEGIN SELECT RAISE(ABORT,'anonymous_business_fact_fixed'); END;
CREATE TRIGGER bm_destroyed_plans_kept BEFORE DELETE ON bm_destroyed_plans BEGIN SELECT RAISE(ABORT,'anonymous_business_fact_fixed'); END;

CREATE TRIGGER bm_signed_note_retained BEFORE DELETE ON bm_notes
WHEN OLD.signed_at IS NOT NULL AND NOT EXISTS(SELECT 1 FROM bm_retention_scope s JOIN bm_retention_permits p ON p.preview_id=s.preview_id WHERE s.table_name='bm_notes' AND s.record_rowid=OLD.rowid)
BEGIN SELECT RAISE(ABORT,'note_locked'); END;
CREATE TRIGGER bm_signed_revision_retained BEFORE DELETE ON bm_note_revisions
WHEN (SELECT signed_at FROM bm_notes WHERE id=OLD.note_id) IS NOT NULL AND NOT EXISTS(SELECT 1 FROM bm_retention_scope s JOIN bm_retention_permits p ON p.preview_id=s.preview_id WHERE s.table_name='bm_note_revisions' AND s.record_rowid=OLD.rowid)
BEGIN SELECT RAISE(ABORT,'note_locked'); END;
