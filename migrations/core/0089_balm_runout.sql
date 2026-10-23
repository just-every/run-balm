-- Reviewed legacy receivables stay separate from newly issued Balm invoices.
CREATE TABLE bm_migrated_claims (
 id TEXT PRIMARY KEY, source TEXT NOT NULL, source_claim TEXT NOT NULL,
 client_id TEXT NOT NULL REFERENCES bm_clients(id), payer_id TEXT NOT NULL REFERENCES bm_payers(id),
 source_hash TEXT NOT NULL, patient_control TEXT NOT NULL, payer_control TEXT NOT NULL, service_date TEXT NOT NULL,
 billed_cents INTEGER NOT NULL CHECK(billed_cents>0), initial_cents INTEGER NOT NULL CHECK(initial_cents>=0),
 balance_cents INTEGER NOT NULL CHECK(balance_cents>=0), status TEXT NOT NULL,
 imported_by TEXT NOT NULL, imported_at TEXT NOT NULL, version INTEGER NOT NULL DEFAULT 1,
 UNIQUE(source,source_claim)
);
CREATE INDEX bm_migrated_controls ON bm_migrated_claims(payer_id,patient_control,payer_control);
CREATE TABLE bm_runout_postings (
 id TEXT PRIMARY KEY, import_id TEXT NOT NULL REFERENCES bm_insurance_imports(id),
 migrated_id TEXT NOT NULL REFERENCES bm_migrated_claims(id),
 paid_cents INTEGER NOT NULL, adjustment_cents INTEGER NOT NULL, pr_cents INTEGER NOT NULL,
 detail TEXT NOT NULL, created_at TEXT NOT NULL, UNIQUE(import_id,migrated_id)
);
CREATE TABLE bm_remittance_suspense (
 id TEXT PRIMARY KEY, import_id TEXT NOT NULL REFERENCES bm_insurance_imports(id),
 payer_id TEXT NOT NULL REFERENCES bm_payers(id), patient_control TEXT NOT NULL,
 paid_cents INTEGER NOT NULL CHECK(paid_cents>=0), detail TEXT NOT NULL, reason TEXT NOT NULL,
 resolved_claim TEXT REFERENCES bm_migrated_claims(id), created_at TEXT NOT NULL,
 UNIQUE(import_id,patient_control)
);
CREATE TABLE bm_runout_closures (id TEXT PRIMARY KEY, closed_by TEXT NOT NULL, closed_at TEXT NOT NULL);
-- Numeric deposit custody does not retain patient metadata.
CREATE TABLE bm_runout_deposits (import_id TEXT PRIMARY KEY REFERENCES bm_insurance_imports(id),native_cents INTEGER NOT NULL CHECK(native_cents>=0));
CREATE TRIGGER bm_migrated_claims_epoch_insert AFTER INSERT ON bm_migrated_claims BEGIN UPDATE bm_retention_epoch SET version=version+1 WHERE id=1; END;
CREATE TRIGGER bm_migrated_claims_epoch_update AFTER UPDATE ON bm_migrated_claims BEGIN UPDATE bm_retention_epoch SET version=version+1 WHERE id=1; END;
CREATE TRIGGER bm_migrated_claims_epoch_delete AFTER DELETE ON bm_migrated_claims BEGIN UPDATE bm_retention_epoch SET version=version+1 WHERE id=1; END;
CREATE TRIGGER bm_migrated_claims_kept BEFORE DELETE ON bm_migrated_claims WHEN NOT EXISTS(SELECT 1 FROM bm_retention_scope s JOIN bm_retention_permits p ON p.preview_id=s.preview_id WHERE s.table_name='bm_migrated_claims' AND s.record_rowid=OLD.rowid) BEGIN SELECT RAISE(ABORT,'runout_record_retained'); END;
CREATE TRIGGER bm_runout_postings_epoch_insert AFTER INSERT ON bm_runout_postings BEGIN UPDATE bm_retention_epoch SET version=version+1 WHERE id=1; END;
CREATE TRIGGER bm_runout_postings_epoch_update AFTER UPDATE ON bm_runout_postings BEGIN UPDATE bm_retention_epoch SET version=version+1 WHERE id=1; END;
CREATE TRIGGER bm_runout_postings_epoch_delete AFTER DELETE ON bm_runout_postings BEGIN UPDATE bm_retention_epoch SET version=version+1 WHERE id=1; END;
CREATE TRIGGER bm_runout_postings_kept BEFORE DELETE ON bm_runout_postings WHEN NOT EXISTS(SELECT 1 FROM bm_retention_scope s JOIN bm_retention_permits p ON p.preview_id=s.preview_id WHERE s.table_name='bm_runout_postings' AND s.record_rowid=OLD.rowid) BEGIN SELECT RAISE(ABORT,'runout_record_retained'); END;
CREATE TRIGGER bm_remittance_suspense_epoch_insert AFTER INSERT ON bm_remittance_suspense BEGIN UPDATE bm_retention_epoch SET version=version+1 WHERE id=1; END;
CREATE TRIGGER bm_remittance_suspense_epoch_update AFTER UPDATE ON bm_remittance_suspense BEGIN UPDATE bm_retention_epoch SET version=version+1 WHERE id=1; END;
CREATE TRIGGER bm_remittance_suspense_epoch_delete AFTER DELETE ON bm_remittance_suspense BEGIN UPDATE bm_retention_epoch SET version=version+1 WHERE id=1; END;
CREATE TRIGGER bm_remittance_suspense_kept BEFORE DELETE ON bm_remittance_suspense WHEN NOT EXISTS(SELECT 1 FROM bm_retention_scope s JOIN bm_retention_permits p ON p.preview_id=s.preview_id WHERE s.table_name='bm_remittance_suspense' AND s.record_rowid=OLD.rowid) BEGIN SELECT RAISE(ABORT,'runout_record_retained'); END;
