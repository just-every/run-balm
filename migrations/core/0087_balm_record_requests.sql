-- Patient access requests: never send a record automatically. An owner reviews
-- a fixed package and explicitly releases that exact digest to the patient.
CREATE TABLE bm_record_requests (
 id TEXT PRIMARY KEY, client_id TEXT NOT NULL REFERENCES bm_clients(id),
 requested_at TEXT NOT NULL, due_at TEXT NOT NULL,
 released_at TEXT, released_by TEXT, package_id TEXT,
 CHECK((released_at IS NULL AND released_by IS NULL AND package_id IS NULL)
 OR (released_at IS NOT NULL AND released_by IS NOT NULL AND package_id IS NOT NULL))
);
CREATE UNIQUE INDEX bm_record_request_open ON bm_record_requests(client_id) WHERE released_at IS NULL;
CREATE TABLE bm_record_packages (
 id TEXT PRIMARY KEY, request_id TEXT NOT NULL REFERENCES bm_record_requests(id),
 client_id TEXT NOT NULL REFERENCES bm_clients(id), prepared_at TEXT NOT NULL,
 prepared_by TEXT NOT NULL, sha256 TEXT NOT NULL, pdf_sha256 TEXT NOT NULL, fhir_sha256 TEXT NOT NULL
);
CREATE TABLE bm_record_parts (
 package_id TEXT NOT NULL REFERENCES bm_record_packages(id),
 format TEXT NOT NULL CHECK(format IN ('pdf','fhir')), part INTEGER NOT NULL,
 content TEXT NOT NULL, PRIMARY KEY(package_id,format,part)
);
CREATE TRIGGER bm_record_request_fixed BEFORE UPDATE ON bm_record_requests
 WHEN NEW.id IS NOT OLD.id OR NEW.client_id IS NOT OLD.client_id OR NEW.requested_at IS NOT OLD.requested_at
 OR NEW.due_at IS NOT OLD.due_at OR OLD.released_at IS NOT NULL
 BEGIN SELECT RAISE(ABORT,'record_request_fixed'); END;
CREATE TRIGGER bm_record_package_fixed BEFORE UPDATE ON bm_record_packages BEGIN SELECT RAISE(ABORT,'record_package_fixed'); END;
CREATE TRIGGER bm_record_part_fixed BEFORE UPDATE ON bm_record_parts BEGIN SELECT RAISE(ABORT,'record_package_fixed'); END;
CREATE TRIGGER bm_record_request_kept BEFORE DELETE ON bm_record_requests
 WHEN NOT EXISTS(SELECT 1 FROM bm_retention_scope s JOIN bm_retention_permits p ON p.preview_id=s.preview_id WHERE s.table_name='bm_record_requests' AND s.record_rowid=OLD.rowid)
 BEGIN SELECT RAISE(ABORT,'record_requests_are_health_records'); END;
CREATE TRIGGER bm_record_package_kept BEFORE DELETE ON bm_record_packages
 WHEN NOT EXISTS(SELECT 1 FROM bm_retention_scope s JOIN bm_retention_permits p ON p.preview_id=s.preview_id WHERE s.table_name='bm_record_packages' AND s.record_rowid=OLD.rowid)
 BEGIN SELECT RAISE(ABORT,'record_packages_are_health_records'); END;
CREATE TRIGGER bm_record_part_kept BEFORE DELETE ON bm_record_parts
 WHEN NOT EXISTS(SELECT 1 FROM bm_retention_scope s JOIN bm_retention_permits p ON p.preview_id=s.preview_id WHERE s.table_name='bm_record_parts' AND s.record_rowid=OLD.rowid)
 BEGIN SELECT RAISE(ABORT,'record_packages_are_health_records'); END;
CREATE TRIGGER bm_record_client_retained BEFORE UPDATE OF erased_at ON bm_clients
 WHEN NEW.erased_at IS NOT NULL AND EXISTS(SELECT 1 FROM bm_record_requests WHERE client_id=OLD.id)
 BEGIN SELECT RAISE(ABORT,'clients_with_health_records_are_retained'); END;
CREATE TRIGGER bm_record_request_epoch_insert AFTER INSERT ON bm_record_requests BEGIN UPDATE bm_retention_epoch SET version=version+1 WHERE id=1; END;
CREATE TRIGGER bm_record_request_epoch_update AFTER UPDATE ON bm_record_requests BEGIN UPDATE bm_retention_epoch SET version=version+1 WHERE id=1; END;
CREATE TRIGGER bm_record_request_epoch_delete AFTER DELETE ON bm_record_requests BEGIN UPDATE bm_retention_epoch SET version=version+1 WHERE id=1; END;
CREATE TRIGGER bm_record_package_epoch_insert AFTER INSERT ON bm_record_packages BEGIN UPDATE bm_retention_epoch SET version=version+1 WHERE id=1; END;
CREATE TRIGGER bm_record_package_epoch_delete AFTER DELETE ON bm_record_packages BEGIN UPDATE bm_retention_epoch SET version=version+1 WHERE id=1; END;
CREATE TRIGGER bm_record_part_epoch_insert AFTER INSERT ON bm_record_parts BEGIN UPDATE bm_retention_epoch SET version=version+1 WHERE id=1; END;
CREATE TRIGGER bm_record_part_epoch_delete AFTER DELETE ON bm_record_parts BEGIN UPDATE bm_retention_epoch SET version=version+1 WHERE id=1; END;
