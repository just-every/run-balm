-- Syntax receipts are separate from claim status, submission and money.
CREATE TABLE bm_functional_acknowledgments (
 id TEXT PRIMARY KEY,
 batch_id TEXT NOT NULL REFERENCES bm_claim_batches(id),
 body TEXT NOT NULL,
 sha256 TEXT NOT NULL UNIQUE,
 interchange_control TEXT NOT NULL,
 group_control TEXT NOT NULL,
 transaction_control TEXT NOT NULL,
 syntax_status TEXT NOT NULL CHECK(syntax_status IN ('accepted','accepted_with_errors','rejected')),
 reasons TEXT NOT NULL CHECK(json_valid(reasons)),
 imported_by TEXT NOT NULL,
 imported_at TEXT NOT NULL,
 UNIQUE(batch_id,interchange_control,group_control,transaction_control)
);
CREATE TRIGGER bm_functional_acknowledgments_fixed BEFORE UPDATE ON bm_functional_acknowledgments BEGIN SELECT RAISE(ABORT,'functional_acknowledgment_fixed'); END;
CREATE TRIGGER bm_functional_acknowledgments_kept BEFORE DELETE ON bm_functional_acknowledgments WHEN NOT EXISTS(SELECT 1 FROM bm_retention_scope s JOIN bm_retention_permits p ON p.preview_id=s.preview_id WHERE s.table_name='bm_functional_acknowledgments' AND s.record_rowid=OLD.rowid) BEGIN SELECT RAISE(ABORT,'functional_acknowledgment_requires_retention_review'); END;
CREATE TRIGGER bm_functional_acknowledgments_epoch AFTER INSERT ON bm_functional_acknowledgments BEGIN UPDATE bm_retention_epoch SET version=version+1 WHERE id=1; END;
