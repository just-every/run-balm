-- Private preparation originals and review receipts confer no execution authority.
CREATE TABLE bm_inbox_preparations (
 id TEXT PRIMARY KEY, client_id TEXT NOT NULL REFERENCES bm_clients(id),
 message_id TEXT NOT NULL REFERENCES bm_messages(id), source_digest TEXT NOT NULL,
 digest TEXT NOT NULL, payload TEXT NOT NULL,
 state TEXT NOT NULL CHECK(state IN ('prepared','review','clinical')),
 prepared_by TEXT NOT NULL, prepared_at TEXT NOT NULL,
 authority INTEGER NOT NULL DEFAULT 1 CHECK(authority IN (0,1)),
 UNIQUE(message_id,source_digest)
);
CREATE TABLE bm_inbox_approvals (
 preparation_id TEXT PRIMARY KEY REFERENCES bm_inbox_preparations(id),
 client_id TEXT NOT NULL REFERENCES bm_clients(id), digest TEXT NOT NULL,
 approved_by TEXT NOT NULL, approved_at TEXT NOT NULL
);
CREATE INDEX bm_inbox_patient ON bm_inbox_preparations(client_id,message_id);
CREATE TRIGGER bm_inbox_preparations_fixed BEFORE UPDATE ON bm_inbox_preparations BEGIN SELECT RAISE(ABORT,'inbox_original_fixed'); END;
CREATE TRIGGER bm_inbox_approvals_fixed BEFORE UPDATE ON bm_inbox_approvals BEGIN SELECT RAISE(ABORT,'inbox_original_fixed'); END;
CREATE TRIGGER bm_inbox_preparations_live BEFORE INSERT ON bm_inbox_preparations BEGIN
 SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM bm_clients WHERE id=NEW.client_id AND erased_at IS NULL) THEN RAISE(ABORT,'bm_assert') END;
END;
CREATE TRIGGER bm_inbox_approvals_live BEFORE INSERT ON bm_inbox_approvals BEGIN
 SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM bm_clients WHERE id=NEW.client_id AND erased_at IS NULL) THEN RAISE(ABORT,'bm_assert') END;
END;
CREATE TRIGGER bm_inbox_preparations_epoch AFTER INSERT ON bm_inbox_preparations BEGIN UPDATE bm_retention_epoch SET version=version+1 WHERE id=1; END;
CREATE TRIGGER bm_inbox_approvals_epoch AFTER INSERT ON bm_inbox_approvals BEGIN UPDATE bm_retention_epoch SET version=version+1 WHERE id=1; END;
CREATE TRIGGER bm_inbox_preparations_kept BEFORE DELETE ON bm_inbox_preparations
 WHEN NOT EXISTS(SELECT 1 FROM bm_retention_scope s JOIN bm_retention_permits p ON p.preview_id=s.preview_id WHERE s.table_name='bm_inbox_preparations' AND s.record_rowid=OLD.rowid)
 BEGIN SELECT RAISE(ABORT,'inbox_requires_retention_review'); END;
CREATE TRIGGER bm_inbox_approvals_kept BEFORE DELETE ON bm_inbox_approvals
 WHEN NOT EXISTS(SELECT 1 FROM bm_retention_scope s JOIN bm_retention_permits p ON p.preview_id=s.preview_id WHERE s.table_name='bm_inbox_approvals' AND s.record_rowid=OLD.rowid)
 BEGIN SELECT RAISE(ABORT,'inbox_requires_retention_review'); END;
