-- Explicit owner-recorded pauses preserve every unused visit and original receipt.
CREATE TABLE bm_membership_events (
 id TEXT PRIMARY KEY, sale_id TEXT NOT NULL REFERENCES bm_retail_sales(id),
 client_id TEXT NOT NULL REFERENCES bm_clients(id),
 state TEXT NOT NULL CHECK(state IN ('active','paused')),
 previous_id TEXT, reason TEXT NOT NULL, consent_evidence TEXT NOT NULL,
 recorded_by TEXT NOT NULL, recorded_at TEXT NOT NULL
);
CREATE UNIQUE INDEX bm_membership_next ON bm_membership_events(sale_id,COALESCE(previous_id,''));
CREATE TRIGGER bm_membership_events_fixed BEFORE UPDATE ON bm_membership_events BEGIN SELECT RAISE(ABORT,'original_record_is_immutable'); END;
CREATE TRIGGER bm_membership_events_epoch AFTER INSERT ON bm_membership_events BEGIN UPDATE bm_retention_epoch SET version=version+1 WHERE id=1; END;
CREATE TRIGGER bm_membership_events_kept BEFORE DELETE ON bm_membership_events WHEN NOT EXISTS(SELECT 1 FROM bm_retention_scope s JOIN bm_retention_permits p ON p.preview_id=s.preview_id WHERE s.table_name='bm_membership_events' AND s.record_rowid=OLD.rowid) BEGIN SELECT RAISE(ABORT,'membership_original_kept'); END;
