CREATE TABLE bm_statement_preferences (
 client_id TEXT PRIMARY KEY REFERENCES bm_clients(id),channel TEXT NOT NULL CHECK(channel IN ('email','text','mail')),
 address TEXT NOT NULL,hold INTEGER NOT NULL DEFAULT 0,returned_at TEXT,consent_evidence TEXT NOT NULL,recorded_by TEXT NOT NULL,recorded_at TEXT NOT NULL
);
CREATE TABLE bm_statement_cycles (id TEXT PRIMARY KEY,cycle_on TEXT NOT NULL UNIQUE,created_at TEXT NOT NULL,created_by TEXT NOT NULL);
CREATE TABLE bm_cycle_statements (
 id TEXT PRIMARY KEY,client_id TEXT NOT NULL REFERENCES bm_clients(id),cycle_id TEXT NOT NULL REFERENCES bm_statement_cycles(id),
 due_on TEXT NOT NULL,amount_cents INTEGER NOT NULL,original_base64 TEXT NOT NULL,issued_at TEXT NOT NULL,
 channel TEXT NOT NULL,address TEXT NOT NULL,patient_name TEXT NOT NULL,age_days INTEGER NOT NULL,dunning TEXT NOT NULL,
 UNIQUE(client_id,cycle_id)
);
CREATE TABLE bm_statement_deliveries (
 id TEXT PRIMARY KEY,statement_id TEXT NOT NULL REFERENCES bm_cycle_statements(id),channel TEXT NOT NULL,
 outcome TEXT NOT NULL,occurred_at TEXT NOT NULL,recorded_by TEXT NOT NULL,reference TEXT NOT NULL
);
CREATE TABLE bm_statement_cycle_settings (id INTEGER PRIMARY KEY CHECK(id=1),minimum_cents INTEGER NOT NULL DEFAULT 500);
INSERT INTO bm_statement_cycle_settings(id) VALUES(1);
CREATE TRIGGER bm_cycle_statements_fixed BEFORE UPDATE ON bm_cycle_statements BEGIN SELECT RAISE(ABORT,'statement_record_fixed'); END;
CREATE TRIGGER bm_cycle_statements_kept BEFORE DELETE ON bm_cycle_statements WHEN NOT EXISTS(SELECT 1 FROM bm_retention_scope s JOIN bm_retention_permits p ON p.preview_id=s.preview_id WHERE s.table_name='bm_cycle_statements' AND s.record_rowid=OLD.rowid) BEGIN SELECT RAISE(ABORT,'statement_record_retained'); END;
CREATE TRIGGER bm_statement_deliveries_fixed BEFORE UPDATE ON bm_statement_deliveries BEGIN SELECT RAISE(ABORT,'statement_record_fixed'); END;
CREATE TRIGGER bm_statement_deliveries_kept BEFORE DELETE ON bm_statement_deliveries WHEN NOT EXISTS(SELECT 1 FROM bm_retention_scope s JOIN bm_retention_permits p ON p.preview_id=s.preview_id WHERE s.table_name='bm_statement_deliveries' AND s.record_rowid=OLD.rowid) BEGIN SELECT RAISE(ABORT,'statement_record_retained'); END;
CREATE TRIGGER bm_retention_epoch_bm_statement_preferences_insert AFTER INSERT ON bm_statement_preferences BEGIN UPDATE bm_retention_epoch SET version=version+1 WHERE id=1; END;
CREATE TRIGGER bm_retention_epoch_bm_statement_preferences_update AFTER UPDATE ON bm_statement_preferences BEGIN UPDATE bm_retention_epoch SET version=version+1 WHERE id=1; END;
CREATE TRIGGER bm_retention_epoch_bm_statement_preferences_delete AFTER DELETE ON bm_statement_preferences BEGIN UPDATE bm_retention_epoch SET version=version+1 WHERE id=1; END;
CREATE TRIGGER bm_retention_epoch_bm_cycle_statements_insert AFTER INSERT ON bm_cycle_statements BEGIN UPDATE bm_retention_epoch SET version=version+1 WHERE id=1; END;
CREATE TRIGGER bm_retention_epoch_bm_cycle_statements_update AFTER UPDATE ON bm_cycle_statements BEGIN UPDATE bm_retention_epoch SET version=version+1 WHERE id=1; END;
CREATE TRIGGER bm_retention_epoch_bm_cycle_statements_delete AFTER DELETE ON bm_cycle_statements BEGIN UPDATE bm_retention_epoch SET version=version+1 WHERE id=1; END;
CREATE TRIGGER bm_retention_epoch_bm_statement_deliveries_insert AFTER INSERT ON bm_statement_deliveries BEGIN UPDATE bm_retention_epoch SET version=version+1 WHERE id=1; END;
CREATE TRIGGER bm_retention_epoch_bm_statement_deliveries_update AFTER UPDATE ON bm_statement_deliveries BEGIN UPDATE bm_retention_epoch SET version=version+1 WHERE id=1; END;
CREATE TRIGGER bm_retention_epoch_bm_statement_deliveries_delete AFTER DELETE ON bm_statement_deliveries BEGIN UPDATE bm_retention_epoch SET version=version+1 WHERE id=1; END;
CREATE TRIGGER bm_retention_epoch_statement_cycle_settings AFTER UPDATE ON bm_statement_cycle_settings BEGIN UPDATE bm_retention_epoch SET version=version+1 WHERE id=1; END;
