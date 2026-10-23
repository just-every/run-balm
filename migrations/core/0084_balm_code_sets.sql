-- CODE-001: privately installed licensed data and public CMS releases. Staging
-- rows never participate in billing; completion publishes a whole release.
CREATE TABLE bm_code_releases (
 id TEXT PRIMARY KEY, kind TEXT NOT NULL CHECK(kind IN ('icd10','hcpcs','cpt','ptp','mue')),
 version TEXT NOT NULL, effective_on TEXT NOT NULL, next_due_on TEXT NOT NULL,
 source_page TEXT NOT NULL, files TEXT NOT NULL CHECK(json_valid(files)),
 sha256 TEXT NOT NULL, status TEXT NOT NULL CHECK(status IN ('loading','ready')),
 license_basis TEXT NOT NULL DEFAULT '', loaded_by TEXT NOT NULL, loaded_at TEXT NOT NULL,
 completed_at TEXT, row_count INTEGER NOT NULL DEFAULT 0, UNIQUE(kind,effective_on,sha256)
);
CREATE INDEX bm_code_release_date ON bm_code_releases(kind,status,effective_on,completed_at);
CREATE TABLE bm_code_items (
 release_id TEXT NOT NULL REFERENCES bm_code_releases(id), item_key TEXT NOT NULL,
 code TEXT NOT NULL, description TEXT NOT NULL DEFAULT '', billable INTEGER,
 code2 TEXT, effective_on TEXT NOT NULL, deleted_on TEXT, modifier INTEGER,
 max_units INTEGER, adjudication INTEGER, timed INTEGER,
 payload TEXT NOT NULL CHECK(json_valid(payload)), PRIMARY KEY(release_id,item_key)
);
CREATE INDEX bm_code_lookup ON bm_code_items(release_id,code,code2);
CREATE TABLE bm_code_synonyms (
 kind TEXT NOT NULL CHECK(kind IN ('icd10','hcpcs','cpt')), code TEXT NOT NULL,
 term TEXT NOT NULL, created_by TEXT NOT NULL, created_at TEXT NOT NULL,
 PRIMARY KEY(kind,code,term)
);
CREATE TABLE bm_code_epoch(id INTEGER PRIMARY KEY CHECK(id=1),version INTEGER NOT NULL);
INSERT INTO bm_code_epoch VALUES(1,1);
CREATE TRIGGER bm_code_ready_fixed BEFORE UPDATE ON bm_code_releases WHEN OLD.status='ready' BEGIN SELECT RAISE(ABORT,'code_release_fixed'); END;
CREATE TRIGGER bm_code_release_kept BEFORE DELETE ON bm_code_releases BEGIN SELECT RAISE(ABORT,'code_release_retained'); END;
CREATE TRIGGER bm_code_item_fixed BEFORE UPDATE ON bm_code_items BEGIN SELECT RAISE(ABORT,'code_row_fixed'); END;
CREATE TRIGGER bm_code_item_ready_insert BEFORE INSERT ON bm_code_items WHEN (SELECT status FROM bm_code_releases WHERE id=NEW.release_id)='ready' BEGIN SELECT RAISE(ABORT,'code_release_fixed'); END;
CREATE TRIGGER bm_code_item_kept BEFORE DELETE ON bm_code_items BEGIN SELECT RAISE(ABORT,'code_row_fixed'); END;
CREATE TRIGGER bm_code_ready_epoch AFTER UPDATE ON bm_code_releases WHEN NEW.status='ready' BEGIN UPDATE bm_code_epoch SET version=version+1 WHERE id=1; END;
