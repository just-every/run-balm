-- Owner-recorded cash sales. Gift value is patient-bound, never general credit.
CREATE TABLE bm_retail_sales (
 id TEXT PRIMARY KEY, client_id TEXT NOT NULL REFERENCES bm_clients(id),
 kind TEXT NOT NULL CHECK(kind IN ('package','membership','product','gift_card')),
 label TEXT NOT NULL, service_id TEXT REFERENCES bm_services(id), units INTEGER NOT NULL DEFAULT 0 CHECK(units>=0),
 amount_cents INTEGER NOT NULL CHECK(amount_cents>0), tax_cents INTEGER NOT NULL CHECK(tax_cents>=0),
 tax_basis_points INTEGER NOT NULL CHECK(tax_basis_points BETWEEN 0 AND 10000), tax_state TEXT NOT NULL, tax_evidence TEXT NOT NULL,
 gift_id TEXT REFERENCES bm_retail_sales(id), reference TEXT NOT NULL UNIQUE,
 recorded_at TEXT NOT NULL, recorded_by TEXT NOT NULL, receipt_base64 TEXT NOT NULL
);
CREATE TABLE bm_package_assignments (
 appointment_id TEXT PRIMARY KEY REFERENCES bm_appointments(id), sale_id TEXT NOT NULL REFERENCES bm_retail_sales(id),
 client_id TEXT NOT NULL REFERENCES bm_clients(id), assigned_by TEXT NOT NULL, assigned_at TEXT NOT NULL
);
CREATE TABLE bm_package_uses (
 appointment_id TEXT PRIMARY KEY REFERENCES bm_appointments(id), sale_id TEXT NOT NULL REFERENCES bm_retail_sales(id),
 client_id TEXT NOT NULL REFERENCES bm_clients(id), used_at TEXT NOT NULL
);
CREATE INDEX bm_retail_patient ON bm_retail_sales(client_id,recorded_at);
CREATE INDEX bm_package_sale ON bm_package_uses(sale_id);
CREATE TRIGGER bm_retail_sales_epoch_insert AFTER INSERT ON bm_retail_sales BEGIN UPDATE bm_retention_epoch SET version=version+1 WHERE id=1; END;
CREATE TRIGGER bm_retail_sales_immutable BEFORE UPDATE ON bm_retail_sales BEGIN SELECT RAISE(ABORT,'original_record_is_immutable'); END;
CREATE TRIGGER bm_retail_sales_client_live BEFORE INSERT ON bm_retail_sales BEGIN SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM bm_clients WHERE id=NEW.client_id AND erased_at IS NULL) THEN RAISE(ABORT,'bm_assert') END; END;
CREATE TRIGGER bm_package_assignments_epoch_insert AFTER INSERT ON bm_package_assignments BEGIN UPDATE bm_retention_epoch SET version=version+1 WHERE id=1; END;
CREATE TRIGGER bm_package_assignments_immutable BEFORE UPDATE ON bm_package_assignments BEGIN SELECT RAISE(ABORT,'original_record_is_immutable'); END;
CREATE TRIGGER bm_package_assignments_client_live BEFORE INSERT ON bm_package_assignments BEGIN SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM bm_clients WHERE id=NEW.client_id AND erased_at IS NULL) THEN RAISE(ABORT,'bm_assert') END; END;
CREATE TRIGGER bm_package_uses_epoch_insert AFTER INSERT ON bm_package_uses BEGIN UPDATE bm_retention_epoch SET version=version+1 WHERE id=1; END;
CREATE TRIGGER bm_package_uses_immutable BEFORE UPDATE ON bm_package_uses BEGIN SELECT RAISE(ABORT,'original_record_is_immutable'); END;
CREATE TRIGGER bm_package_uses_client_live BEFORE INSERT ON bm_package_uses BEGIN SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM bm_clients WHERE id=NEW.client_id AND erased_at IS NULL) THEN RAISE(ABORT,'bm_assert') END; END;
CREATE TRIGGER bm_retail_sales_retain_client BEFORE UPDATE OF erased_at ON bm_clients WHEN NEW.erased_at IS NOT NULL AND EXISTS(SELECT 1 FROM bm_retail_sales WHERE client_id=NEW.id) BEGIN SELECT RAISE(ABORT,'bm_assert'); END;
