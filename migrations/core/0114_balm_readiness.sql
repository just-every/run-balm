CREATE TABLE bm_readiness (
 id INTEGER PRIMARY KEY CHECK(id=1),
 privacy_officer TEXT NOT NULL DEFAULT '', security_officer TEXT NOT NULL DEFAULT '',
 risk_analysis TEXT NOT NULL DEFAULT '', risk_reviewed_on TEXT NOT NULL DEFAULT '',
 encryption_at_rest TEXT NOT NULL DEFAULT '', encryption_in_transit TEXT NOT NULL DEFAULT '',
 updated_at TEXT NOT NULL, updated_by TEXT NOT NULL
);
CREATE TABLE bm_baa_records (
 id TEXT PRIMARY KEY, processor TEXT NOT NULL, provider TEXT NOT NULL,
 plan TEXT NOT NULL, reference TEXT NOT NULL, signed_on TEXT NOT NULL,
 recorded_at TEXT NOT NULL, recorded_by TEXT NOT NULL, revoked_at TEXT
);
CREATE INDEX bm_baa_processor ON bm_baa_records(processor,recorded_at);
