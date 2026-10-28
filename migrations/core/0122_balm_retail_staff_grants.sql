-- A named reception or billing person may record sales only under a current owner grant.
-- Approval originals travel as evidence; they grant no authority after a restore.
CREATE TABLE bm_retail_staff_approvals (
 id TEXT PRIMARY KEY, staff_id TEXT NOT NULL, staff_version INTEGER NOT NULL,
 owner_id TEXT NOT NULL, owner_version INTEGER NOT NULL, granted_at TEXT NOT NULL,
 expires_at TEXT NOT NULL, reason TEXT NOT NULL, tax_rules TEXT NOT NULL CHECK(json_valid(tax_rules))
);
CREATE TRIGGER bm_retail_staff_approvals_fixed BEFORE UPDATE ON bm_retail_staff_approvals BEGIN SELECT RAISE(ABORT,'original_record_is_immutable'); END;
CREATE TRIGGER bm_retail_staff_approvals_kept BEFORE DELETE ON bm_retail_staff_approvals BEGIN SELECT RAISE(ABORT,'retail_authority_original_kept'); END;
CREATE TABLE bm_retail_staff_grants (
 staff_id TEXT PRIMARY KEY REFERENCES bm_staff(id), approval_id TEXT NOT NULL REFERENCES bm_retail_staff_approvals(id), staff_version INTEGER NOT NULL,
 owner_id TEXT NOT NULL, owner_version INTEGER NOT NULL, granted_at TEXT NOT NULL,
 expires_at TEXT NOT NULL, reason TEXT NOT NULL, tax_rules TEXT NOT NULL DEFAULT '[]' CHECK(json_valid(tax_rules))
);
CREATE TRIGGER bm_retail_staff_grants_epoch_insert AFTER INSERT ON bm_retail_staff_grants BEGIN UPDATE bm_retention_epoch SET version=version+1 WHERE id=1; END;
CREATE TRIGGER bm_retail_staff_grants_epoch_update AFTER UPDATE ON bm_retail_staff_grants BEGIN UPDATE bm_retention_epoch SET version=version+1 WHERE id=1; END;
CREATE TRIGGER bm_retail_staff_grants_epoch_delete AFTER DELETE ON bm_retail_staff_grants BEGIN UPDATE bm_retention_epoch SET version=version+1 WHERE id=1; END;
ALTER TABLE bm_retail_sales ADD COLUMN staff_approval_id TEXT REFERENCES bm_retail_staff_approvals(id);
