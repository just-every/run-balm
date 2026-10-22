CREATE TABLE bm_assistant_daily_rules (
 id TEXT PRIMARY KEY,staff_id TEXT NOT NULL REFERENCES bm_staff(id),state TEXT NOT NULL,payer_id TEXT,
 starts_on TEXT NOT NULL,ends_on TEXT NOT NULL,state_source TEXT NOT NULL,payer_source TEXT NOT NULL,
 recorded_at TEXT NOT NULL,recorded_by TEXT NOT NULL
);
CREATE TABLE bm_assistant_daily_revocations (rule_id TEXT PRIMARY KEY REFERENCES bm_assistant_daily_rules(id),revoked_at TEXT NOT NULL,revoked_by TEXT NOT NULL);
CREATE TABLE bm_assistant_signed_notes (
 note_id TEXT PRIMARY KEY REFERENCES bm_notes(id),supervisor_id TEXT NOT NULL REFERENCES bm_staff(id),
 rule_id TEXT NOT NULL REFERENCES bm_assistant_daily_rules(id),rule_snapshot TEXT NOT NULL,
 author_discipline TEXT NOT NULL,plan_id TEXT
);
CREATE TABLE bm_assistant_supervision (
 note_id TEXT PRIMARY KEY REFERENCES bm_assistant_signed_notes(note_id),supervision_given TEXT NOT NULL CHECK(supervision_given IN ('in_room','on_site','general')),
 supervisor_name TEXT NOT NULL,supervisor_credentials TEXT NOT NULL,attested_at TEXT NOT NULL,sha256 TEXT NOT NULL
);
CREATE TRIGGER bm_assistant_rule_fixed BEFORE UPDATE ON bm_assistant_daily_rules BEGIN SELECT RAISE(ABORT,'supervision_rule_immutable'); END;
CREATE TRIGGER bm_assistant_rule_kept BEFORE DELETE ON bm_assistant_daily_rules BEGIN SELECT RAISE(ABORT,'supervision_rule_immutable'); END;
CREATE TRIGGER bm_assistant_revocation_fixed BEFORE UPDATE ON bm_assistant_daily_revocations BEGIN SELECT RAISE(ABORT,'supervision_rule_immutable'); END;
CREATE TRIGGER bm_assistant_revocation_kept BEFORE DELETE ON bm_assistant_daily_revocations BEGIN SELECT RAISE(ABORT,'supervision_rule_immutable'); END;
CREATE TRIGGER bm_assistant_signed_notes_fixed BEFORE UPDATE ON bm_assistant_signed_notes BEGIN SELECT RAISE(ABORT,'note_locked'); END;
CREATE TRIGGER bm_assistant_signed_notes_kept BEFORE DELETE ON bm_assistant_signed_notes WHEN NOT EXISTS(SELECT 1 FROM bm_retention_scope s JOIN bm_retention_permits p ON p.preview_id=s.preview_id WHERE s.table_name='bm_assistant_signed_notes' AND s.record_rowid=OLD.rowid) BEGIN SELECT RAISE(ABORT,'note_locked'); END;
CREATE TRIGGER bm_assistant_signed_notes_epoch_insert AFTER INSERT ON bm_assistant_signed_notes BEGIN UPDATE bm_retention_epoch SET version=version+1 WHERE id=1; END;
CREATE TRIGGER bm_assistant_signed_notes_epoch_update AFTER UPDATE ON bm_assistant_signed_notes BEGIN UPDATE bm_retention_epoch SET version=version+1 WHERE id=1; END;
CREATE TRIGGER bm_assistant_signed_notes_epoch_delete AFTER DELETE ON bm_assistant_signed_notes BEGIN UPDATE bm_retention_epoch SET version=version+1 WHERE id=1; END;
CREATE TRIGGER bm_assistant_supervision_fixed BEFORE UPDATE ON bm_assistant_supervision BEGIN SELECT RAISE(ABORT,'note_locked'); END;
CREATE TRIGGER bm_assistant_supervision_kept BEFORE DELETE ON bm_assistant_supervision WHEN NOT EXISTS(SELECT 1 FROM bm_retention_scope s JOIN bm_retention_permits p ON p.preview_id=s.preview_id WHERE s.table_name='bm_assistant_supervision' AND s.record_rowid=OLD.rowid) BEGIN SELECT RAISE(ABORT,'note_locked'); END;
CREATE TRIGGER bm_assistant_supervision_epoch_insert AFTER INSERT ON bm_assistant_supervision BEGIN UPDATE bm_retention_epoch SET version=version+1 WHERE id=1; END;
CREATE TRIGGER bm_assistant_supervision_epoch_update AFTER UPDATE ON bm_assistant_supervision BEGIN UPDATE bm_retention_epoch SET version=version+1 WHERE id=1; END;
CREATE TRIGGER bm_assistant_supervision_epoch_delete AFTER DELETE ON bm_assistant_supervision BEGIN UPDATE bm_retention_epoch SET version=version+1 WHERE id=1; END;
