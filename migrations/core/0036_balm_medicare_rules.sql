-- Annual CMS policy is separate from a beneficiary's reconciled expenses.
CREATE TABLE bm_medicare_settings (
 year INTEGER NOT NULL, therapy_group TEXT NOT NULL CHECK(therapy_group IN ('pt_slp','ot')),
 starts_on TEXT NOT NULL, ends_on TEXT NOT NULL,
 threshold_cents INTEGER NOT NULL CHECK(threshold_cents>0), review_cents INTEGER NOT NULL CHECK(review_cents>=threshold_cents),
 source TEXT NOT NULL, published_on TEXT NOT NULL, version INTEGER NOT NULL DEFAULT 1,
 PRIMARY KEY(year,therapy_group), CHECK(starts_on<=ends_on)
);
INSERT INTO bm_medicare_settings(year,therapy_group,starts_on,ends_on,threshold_cents,review_cents,source,published_on) VALUES
 (2026,'pt_slp','2026-01-01','2026-12-31',248000,300000,'https://www.cms.gov/files/document/R13437CP.pdf; https://www.cms.gov/medicare/coding-billing/therapy-services','2025-10-30'),
 (2026,'ot','2026-01-01','2026-12-31',248000,300000,'https://www.cms.gov/files/document/R13437CP.pdf; https://www.cms.gov/medicare/coding-billing/therapy-services','2025-10-30');
CREATE TABLE bm_medicare_expenses (
 claim_id TEXT PRIMARY KEY REFERENCES bm_claims(id), recognized_cents INTEGER NOT NULL CHECK(recognized_cents>=0),
 source TEXT NOT NULL, recorded_at TEXT NOT NULL, version INTEGER NOT NULL DEFAULT 1
);
-- The signed CMS-R-131 stays with the claim's clinical record, never audit detail.
CREATE TABLE bm_medicare_abns (
 id TEXT PRIMARY KEY, claim_id TEXT NOT NULL REFERENCES bm_claims(id),
 record TEXT NOT NULL CHECK(json_valid(record)), document TEXT NOT NULL, mime TEXT NOT NULL,
 created_by TEXT NOT NULL, created_at TEXT NOT NULL
);
CREATE TRIGGER bm_medicare_abns_fixed_update BEFORE UPDATE ON bm_medicare_abns BEGIN SELECT RAISE(ABORT,'abn_is_fixed'); END;
CREATE TRIGGER bm_medicare_abns_fixed_delete BEFORE DELETE ON bm_medicare_abns BEGIN SELECT RAISE(ABORT,'abn_is_fixed'); END;
