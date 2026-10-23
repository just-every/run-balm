-- Only a ready release is available to billing. Durable import state is private
-- working material; source manifests and license provenance stay on completion.
CREATE TABLE bm_code_imports (
 release_id TEXT PRIMARY KEY REFERENCES bm_code_releases(id),
 owner_id TEXT NOT NULL,
 spec TEXT NOT NULL CHECK(json_valid(spec)),
 manifest TEXT NOT NULL DEFAULT '[]' CHECK(json_valid(manifest)),
 file_index INTEGER NOT NULL DEFAULT 0,
 row_cursor INTEGER NOT NULL DEFAULT 0,
 row_count INTEGER NOT NULL DEFAULT 0,
 phase TEXT NOT NULL DEFAULT 'download' CHECK(phase IN ('download','parse','publish','complete')),
 version INTEGER NOT NULL DEFAULT 1,
 receipt TEXT CHECK(receipt IS NULL OR json_valid(receipt))
);
CREATE TRIGGER bm_code_import_manifest_fixed BEFORE UPDATE OF spec,owner_id,release_id ON bm_code_imports BEGIN SELECT RAISE(ABORT,'code_import_manifest_fixed'); END;
CREATE TABLE bm_code_import_chunks (
 release_id TEXT NOT NULL REFERENCES bm_code_imports(release_id),
 file_index INTEGER NOT NULL,
 chunk_index INTEGER NOT NULL,
 body BLOB NOT NULL CHECK(length(body)>0 AND length(body)<=512000),
 PRIMARY KEY(release_id,file_index,chunk_index)
);
