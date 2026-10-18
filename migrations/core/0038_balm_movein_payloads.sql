-- Large reviewed source files and reports stay below D1's per-value size limit.
CREATE TABLE bm_movein_payloads (
 job_id TEXT NOT NULL REFERENCES bm_movein_jobs(id),
 kind TEXT NOT NULL CHECK(kind IN ('source','report')),
 part INTEGER NOT NULL, data TEXT NOT NULL,
 PRIMARY KEY(job_id,kind,part)
);
