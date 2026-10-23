-- CHART-002: template versions are immutable; a note keeps the exact schema it uses.
CREATE TABLE bm_clinical_templates (
 id TEXT NOT NULL, version INTEGER NOT NULL CHECK(version>0),
 definition TEXT NOT NULL CHECK(json_valid(definition)), created_by TEXT NOT NULL, created_at TEXT NOT NULL,
 PRIMARY KEY(id,version)
);
CREATE TRIGGER bm_clinical_template_fixed BEFORE UPDATE ON bm_clinical_templates BEGIN SELECT RAISE(ABORT,'template_version_fixed'); END;
CREATE TRIGGER bm_clinical_template_kept BEFORE DELETE ON bm_clinical_templates BEGIN SELECT RAISE(ABORT,'template_version_fixed'); END;
ALTER TABLE bm_notes ADD COLUMN template_snapshot TEXT CHECK(template_snapshot IS NULL OR json_valid(template_snapshot));
ALTER TABLE bm_note_revisions ADD COLUMN clinical TEXT CHECK(clinical IS NULL OR json_valid(clinical));
