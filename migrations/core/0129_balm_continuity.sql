-- Historical review bytes never execute treatment, booking or delivery.
CREATE TABLE bm_continuity_proposals (
 id TEXT PRIMARY KEY, client_id TEXT NOT NULL REFERENCES bm_clients(id),
 series_id TEXT NOT NULL REFERENCES bm_series(id), practitioner_id TEXT NOT NULL REFERENCES bm_staff(id),
 payload TEXT NOT NULL CHECK(json_valid(payload)), digest TEXT NOT NULL,
 prepared_at TEXT NOT NULL, prepared_by TEXT NOT NULL,
 approved_at TEXT, approved_by TEXT,
 review_authority INTEGER NOT NULL DEFAULT 1 CHECK(review_authority IN (0,1))
);
CREATE UNIQUE INDEX bm_continuity_live ON bm_continuity_proposals(series_id,digest) WHERE review_authority=1;
CREATE TRIGGER bm_continuity_fixed BEFORE UPDATE ON bm_continuity_proposals
 WHEN NEW.id IS NOT OLD.id OR NEW.client_id IS NOT OLD.client_id OR NEW.series_id IS NOT OLD.series_id OR NEW.practitioner_id IS NOT OLD.practitioner_id OR NEW.payload IS NOT OLD.payload OR NEW.digest IS NOT OLD.digest OR NEW.prepared_at IS NOT OLD.prepared_at OR NEW.prepared_by IS NOT OLD.prepared_by OR OLD.approved_at IS NOT NULL
 BEGIN SELECT RAISE(ABORT,'continuity_original_kept'); END;
CREATE TRIGGER bm_continuity_kept BEFORE DELETE ON bm_continuity_proposals
 WHEN NOT EXISTS(SELECT 1 FROM bm_retention_scope s JOIN bm_retention_permits p ON p.preview_id=s.preview_id WHERE s.table_name='bm_continuity_proposals' AND s.record_rowid=OLD.rowid)
 BEGIN SELECT RAISE(ABORT,'continuity_original_kept'); END;
CREATE TABLE bm_continuity_revision(id INTEGER PRIMARY KEY CHECK(id=1),version INTEGER NOT NULL);
INSERT INTO bm_continuity_revision VALUES(1,1);
CREATE TRIGGER bm_continuity_bm_plans_of_care_insert AFTER INSERT ON bm_plans_of_care BEGIN UPDATE bm_continuity_revision SET version=version+1 WHERE id=1; END;
CREATE TRIGGER bm_continuity_bm_plans_of_care_update AFTER UPDATE ON bm_plans_of_care BEGIN UPDATE bm_continuity_revision SET version=version+1 WHERE id=1; END;
CREATE TRIGGER bm_continuity_bm_plans_of_care_delete AFTER DELETE ON bm_plans_of_care BEGIN UPDATE bm_continuity_revision SET version=version+1 WHERE id=1; END;
CREATE TRIGGER bm_continuity_bm_series_insert AFTER INSERT ON bm_series BEGIN UPDATE bm_continuity_revision SET version=version+1 WHERE id=1; END;
CREATE TRIGGER bm_continuity_bm_series_update AFTER UPDATE ON bm_series BEGIN UPDATE bm_continuity_revision SET version=version+1 WHERE id=1; END;
CREATE TRIGGER bm_continuity_bm_series_delete AFTER DELETE ON bm_series BEGIN UPDATE bm_continuity_revision SET version=version+1 WHERE id=1; END;
CREATE TRIGGER bm_continuity_bm_appointments_insert AFTER INSERT ON bm_appointments BEGIN UPDATE bm_continuity_revision SET version=version+1 WHERE id=1; END;
CREATE TRIGGER bm_continuity_bm_appointments_update AFTER UPDATE ON bm_appointments BEGIN UPDATE bm_continuity_revision SET version=version+1 WHERE id=1; END;
CREATE TRIGGER bm_continuity_bm_appointments_delete AFTER DELETE ON bm_appointments BEGIN UPDATE bm_continuity_revision SET version=version+1 WHERE id=1; END;
CREATE TRIGGER bm_continuity_bm_policies_insert AFTER INSERT ON bm_policies BEGIN UPDATE bm_continuity_revision SET version=version+1 WHERE id=1; END;
CREATE TRIGGER bm_continuity_bm_policies_update AFTER UPDATE ON bm_policies BEGIN UPDATE bm_continuity_revision SET version=version+1 WHERE id=1; END;
CREATE TRIGGER bm_continuity_bm_policies_delete AFTER DELETE ON bm_policies BEGIN UPDATE bm_continuity_revision SET version=version+1 WHERE id=1; END;
CREATE TRIGGER bm_continuity_bm_authorizations_insert AFTER INSERT ON bm_authorizations BEGIN UPDATE bm_continuity_revision SET version=version+1 WHERE id=1; END;
CREATE TRIGGER bm_continuity_bm_authorizations_update AFTER UPDATE ON bm_authorizations BEGIN UPDATE bm_continuity_revision SET version=version+1 WHERE id=1; END;
CREATE TRIGGER bm_continuity_bm_authorizations_delete AFTER DELETE ON bm_authorizations BEGIN UPDATE bm_continuity_revision SET version=version+1 WHERE id=1; END;
CREATE TRIGGER bm_continuity_bm_episode_records_insert AFTER INSERT ON bm_episode_records BEGIN UPDATE bm_continuity_revision SET version=version+1 WHERE id=1; END;
CREATE TRIGGER bm_continuity_bm_episode_records_update AFTER UPDATE ON bm_episode_records BEGIN UPDATE bm_continuity_revision SET version=version+1 WHERE id=1; END;
CREATE TRIGGER bm_continuity_bm_episode_records_delete AFTER DELETE ON bm_episode_records BEGIN UPDATE bm_continuity_revision SET version=version+1 WHERE id=1; END;
CREATE TRIGGER bm_continuity_bm_episodes_insert AFTER INSERT ON bm_episodes BEGIN UPDATE bm_continuity_revision SET version=version+1 WHERE id=1; END;
CREATE TRIGGER bm_continuity_bm_episodes_update AFTER UPDATE ON bm_episodes BEGIN UPDATE bm_continuity_revision SET version=version+1 WHERE id=1; END;
CREATE TRIGGER bm_continuity_bm_episodes_delete AFTER DELETE ON bm_episodes BEGIN UPDATE bm_continuity_revision SET version=version+1 WHERE id=1; END;
CREATE TRIGGER bm_continuity_bm_waitlist_insert AFTER INSERT ON bm_waitlist BEGIN UPDATE bm_continuity_revision SET version=version+1 WHERE id=1; END;
CREATE TRIGGER bm_continuity_bm_waitlist_update AFTER UPDATE ON bm_waitlist BEGIN UPDATE bm_continuity_revision SET version=version+1 WHERE id=1; END;
CREATE TRIGGER bm_continuity_bm_waitlist_delete AFTER DELETE ON bm_waitlist BEGIN UPDATE bm_continuity_revision SET version=version+1 WHERE id=1; END;
CREATE TRIGGER bm_continuity_bm_notes_insert AFTER INSERT ON bm_notes BEGIN UPDATE bm_continuity_revision SET version=version+1 WHERE id=1; END;
CREATE TRIGGER bm_continuity_bm_notes_update AFTER UPDATE ON bm_notes BEGIN UPDATE bm_continuity_revision SET version=version+1 WHERE id=1; END;
CREATE TRIGGER bm_continuity_bm_notes_delete AFTER DELETE ON bm_notes BEGIN UPDATE bm_continuity_revision SET version=version+1 WHERE id=1; END;
CREATE TRIGGER bm_continuity_bm_note_revisions_insert AFTER INSERT ON bm_note_revisions BEGIN UPDATE bm_continuity_revision SET version=version+1 WHERE id=1; END;
CREATE TRIGGER bm_continuity_bm_note_revisions_update AFTER UPDATE ON bm_note_revisions BEGIN UPDATE bm_continuity_revision SET version=version+1 WHERE id=1; END;
CREATE TRIGGER bm_continuity_bm_note_revisions_delete AFTER DELETE ON bm_note_revisions BEGIN UPDATE bm_continuity_revision SET version=version+1 WHERE id=1; END;
CREATE TRIGGER bm_continuity_bm_booking_payments_insert AFTER INSERT ON bm_booking_payments BEGIN UPDATE bm_continuity_revision SET version=version+1 WHERE id=1; END;
CREATE TRIGGER bm_continuity_bm_booking_payments_update AFTER UPDATE ON bm_booking_payments BEGIN UPDATE bm_continuity_revision SET version=version+1 WHERE id=1; END;
CREATE TRIGGER bm_continuity_bm_booking_payments_delete AFTER DELETE ON bm_booking_payments BEGIN UPDATE bm_continuity_revision SET version=version+1 WHERE id=1; END;
CREATE TRIGGER bm_continuity_bm_clients_insert AFTER INSERT ON bm_clients BEGIN UPDATE bm_continuity_revision SET version=version+1 WHERE id=1; END;
CREATE TRIGGER bm_continuity_bm_clients_update AFTER UPDATE ON bm_clients BEGIN UPDATE bm_continuity_revision SET version=version+1 WHERE id=1; END;
CREATE TRIGGER bm_continuity_bm_clients_delete AFTER DELETE ON bm_clients BEGIN UPDATE bm_continuity_revision SET version=version+1 WHERE id=1; END;
CREATE TRIGGER bm_continuity_epoch_insert AFTER INSERT ON bm_continuity_proposals BEGIN UPDATE bm_retention_epoch SET version=version+1 WHERE id=1; END;
CREATE TRIGGER bm_continuity_epoch_update AFTER UPDATE ON bm_continuity_proposals BEGIN UPDATE bm_retention_epoch SET version=version+1 WHERE id=1; END;
CREATE TRIGGER bm_continuity_epoch_delete AFTER DELETE ON bm_continuity_proposals BEGIN UPDATE bm_retention_epoch SET version=version+1 WHERE id=1; END;
CREATE TRIGGER bm_continuity_bm_billing_schedules_insert AFTER INSERT ON bm_billing_schedules BEGIN UPDATE bm_continuity_revision SET version=version+1 WHERE id=1; END;
CREATE TRIGGER bm_continuity_bm_billing_schedules_update AFTER UPDATE ON bm_billing_schedules BEGIN UPDATE bm_continuity_revision SET version=version+1 WHERE id=1; END;
CREATE TRIGGER bm_continuity_bm_billing_schedules_delete AFTER DELETE ON bm_billing_schedules BEGIN UPDATE bm_continuity_revision SET version=version+1 WHERE id=1; END;
