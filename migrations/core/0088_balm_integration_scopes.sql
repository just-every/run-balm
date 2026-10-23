-- NULL retains the original documented agent-key capabilities for old keys.
-- Explicit scope lists can only narrow that authority; no clinical scope exists.
ALTER TABLE bm_agent_keys ADD COLUMN scopes TEXT CHECK(scopes IS NULL OR json_valid(scopes));
CREATE TABLE bm_integration_hooks (
 id TEXT PRIMARY KEY, owner_id TEXT NOT NULL, owner_version INTEGER NOT NULL,
 url TEXT NOT NULL, secret_sealed TEXT NOT NULL, consent_at TEXT NOT NULL,
 created_at TEXT NOT NULL, revoked_at TEXT
);
-- Events contain only an opaque record id. They are picked up after the
-- appointment transaction commits; a failed booking cannot enqueue an event.
CREATE TABLE bm_integration_events (
 id TEXT PRIMARY KEY, appointment_id TEXT NOT NULL REFERENCES bm_appointments(id),
 client_id TEXT NOT NULL REFERENCES bm_clients(id), created_at TEXT NOT NULL
);
CREATE TRIGGER bm_integration_booking AFTER INSERT ON bm_appointments BEGIN
 INSERT INTO bm_integration_events(id,appointment_id,client_id,created_at)
 VALUES(NEW.id,NEW.id,NEW.client_id,NEW.created_at);
 END;
CREATE TABLE bm_integration_deliveries (
 id TEXT PRIMARY KEY, hook_id TEXT NOT NULL,
 event_id TEXT NOT NULL REFERENCES bm_integration_events(id),
 approved_by TEXT NOT NULL, approved_at TEXT NOT NULL,
 outcome TEXT NOT NULL CHECK(outcome IN ('pending','accepted','refused','uncertain')),
 response_status INTEGER, finished_at TEXT,
 UNIQUE(hook_id,event_id)
);

CREATE TRIGGER bm_integration_events_kept BEFORE DELETE ON bm_integration_events WHEN NOT EXISTS(SELECT 1 FROM bm_retention_scope s JOIN bm_retention_permits p ON p.preview_id=s.preview_id WHERE s.table_name='bm_integration_events' AND s.record_rowid=OLD.rowid) BEGIN SELECT RAISE(ABORT,'integration_history_kept'); END;
CREATE TRIGGER bm_integration_events_epoch_insert AFTER INSERT ON bm_integration_events BEGIN UPDATE bm_retention_epoch SET version=version+1 WHERE id=1; END;
CREATE TRIGGER bm_integration_events_epoch_update AFTER UPDATE ON bm_integration_events BEGIN UPDATE bm_retention_epoch SET version=version+1 WHERE id=1; END;
CREATE TRIGGER bm_integration_events_epoch_delete AFTER DELETE ON bm_integration_events BEGIN UPDATE bm_retention_epoch SET version=version+1 WHERE id=1; END;

CREATE TRIGGER bm_integration_deliveries_kept BEFORE DELETE ON bm_integration_deliveries WHEN NOT EXISTS(SELECT 1 FROM bm_retention_scope s JOIN bm_retention_permits p ON p.preview_id=s.preview_id WHERE s.table_name='bm_integration_deliveries' AND s.record_rowid=OLD.rowid) BEGIN SELECT RAISE(ABORT,'integration_history_kept'); END;
CREATE TRIGGER bm_integration_deliveries_epoch_insert AFTER INSERT ON bm_integration_deliveries BEGIN UPDATE bm_retention_epoch SET version=version+1 WHERE id=1; END;
CREATE TRIGGER bm_integration_deliveries_epoch_update AFTER UPDATE ON bm_integration_deliveries BEGIN UPDATE bm_retention_epoch SET version=version+1 WHERE id=1; END;
CREATE TRIGGER bm_integration_deliveries_epoch_delete AFTER DELETE ON bm_integration_deliveries BEGIN UPDATE bm_retention_epoch SET version=version+1 WHERE id=1; END;
