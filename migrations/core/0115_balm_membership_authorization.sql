-- Historical events retain unknown authorization fields; new transitions require them.
ALTER TABLE bm_membership_events ADD COLUMN effective_at TEXT;
ALTER TABLE bm_membership_events ADD COLUMN authorized_at TEXT;
ALTER TABLE bm_membership_events ADD COLUMN authorization_method TEXT;
ALTER TABLE bm_membership_events ADD COLUMN visits_left INTEGER;
CREATE TABLE bm_membership_cancellations (
 sale_id TEXT PRIMARY KEY REFERENCES bm_retail_sales(id),
 client_id TEXT NOT NULL REFERENCES bm_clients(id),
 effective_at TEXT NOT NULL, authorized_at TEXT NOT NULL,
 authorization_method TEXT NOT NULL, consent_evidence TEXT NOT NULL,
 reason TEXT NOT NULL, recorded_by TEXT NOT NULL, recorded_at TEXT NOT NULL,
 visits_left INTEGER NOT NULL CHECK(visits_left=0)
);
CREATE TRIGGER bm_membership_cancellations_fixed BEFORE UPDATE ON bm_membership_cancellations BEGIN SELECT RAISE(ABORT,'original_record_is_immutable'); END;
CREATE TRIGGER bm_membership_cancellations_epoch AFTER INSERT ON bm_membership_cancellations BEGIN UPDATE bm_retention_epoch SET version=version+1 WHERE id=1; END;
CREATE TRIGGER bm_membership_cancellations_kept BEFORE DELETE ON bm_membership_cancellations WHEN NOT EXISTS(SELECT 1 FROM bm_retention_scope s JOIN bm_retention_permits p ON p.preview_id=s.preview_id WHERE s.table_name='bm_membership_cancellations' AND s.record_rowid=OLD.rowid) BEGIN SELECT RAISE(ABORT,'membership_original_kept'); END;
