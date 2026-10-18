CREATE TABLE bm_client_alerts (
 id TEXT PRIMARY KEY, client_id TEXT NOT NULL REFERENCES bm_clients(id),
 kind TEXT NOT NULL CHECK(kind IN ('medical','precaution','important')),
 text TEXT NOT NULL, active INTEGER NOT NULL DEFAULT 1 CHECK(active IN (0,1)),
 version INTEGER NOT NULL DEFAULT 1,
 created_at TEXT NOT NULL, created_by TEXT NOT NULL,
 updated_at TEXT NOT NULL, updated_by TEXT NOT NULL
);
CREATE INDEX bm_client_alerts_patient ON bm_client_alerts(client_id,active,created_at);
