-- Original clinical files and their filing facts are retained health records.
CREATE TABLE bm_chart_documents (
 id TEXT PRIMARY KEY, client_id TEXT NOT NULL REFERENCES bm_clients(id),
 title TEXT NOT NULL, document_type TEXT NOT NULL CHECK(document_type IN ('referral','imaging','order','signed_plan','photo','other')),
 document_date TEXT NOT NULL, search_text TEXT NOT NULL DEFAULT '',
 filename TEXT NOT NULL, mime TEXT NOT NULL CHECK(mime IN ('image/jpeg','image/png','image/webp','application/pdf')),
 byte_length INTEGER NOT NULL CHECK(byte_length BETWEEN 1 AND 1000000),
 content_base64 TEXT NOT NULL, sha256 TEXT NOT NULL,
 created_at TEXT NOT NULL, created_by TEXT NOT NULL
);
CREATE INDEX bm_chart_document_patient ON bm_chart_documents(client_id,document_date,id);
CREATE TRIGGER bm_chart_document_fixed BEFORE UPDATE ON bm_chart_documents BEGIN SELECT RAISE(ABORT,'chart_document_fixed'); END;
CREATE TRIGGER bm_chart_document_kept BEFORE DELETE ON bm_chart_documents BEGIN SELECT RAISE(ABORT,'documents_are_health_records'); END;
