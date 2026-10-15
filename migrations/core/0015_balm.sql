-- Balm: one allied-health clinic. Clinical rows (intake answers, notes) are
-- readable only through server handlers that write an audit row per access.
CREATE TABLE bm_settings (
 id INTEGER PRIMARY KEY CHECK(id=1), clinic_name TEXT NOT NULL, time_zone TEXT NOT NULL,
 abn TEXT NOT NULL DEFAULT '', address TEXT NOT NULL DEFAULT '',
 booking_open INTEGER NOT NULL DEFAULT 1 CHECK(booking_open IN (0,1)), version INTEGER NOT NULL DEFAULT 1
);
INSERT INTO bm_settings(id,clinic_name,time_zone) VALUES(1,'My clinic','Australia/Brisbane');

CREATE TABLE bm_staff (
 id TEXT PRIMARY KEY, name TEXT NOT NULL, email TEXT NOT NULL,
 role TEXT NOT NULL CHECK(role IN ('practitioner','reception')),
 profession TEXT NOT NULL DEFAULT '', provider_number TEXT NOT NULL DEFAULT '',
 active INTEGER NOT NULL DEFAULT 1 CHECK(active IN (0,1)), version INTEGER NOT NULL DEFAULT 1, erased_at INTEGER
);
CREATE UNIQUE INDEX bm_staff_email ON bm_staff(lower(email));

CREATE TABLE bm_services (
 id TEXT PRIMARY KEY, name TEXT NOT NULL,
 duration_minutes INTEGER NOT NULL CHECK(duration_minutes BETWEEN 5 AND 480),
 price_cents INTEGER NOT NULL CHECK(price_cents BETWEEN 0 AND 10000000),
 active INTEGER NOT NULL DEFAULT 1 CHECK(active IN (0,1)), version INTEGER NOT NULL DEFAULT 1
);

-- Weekly practitioner hours in the clinic time zone (Dial's recurring windows).
CREATE TABLE bm_hours (
 practitioner_id TEXT NOT NULL REFERENCES bm_staff(id), weekday INTEGER NOT NULL CHECK(weekday BETWEEN 0 AND 6),
 start_minute INTEGER NOT NULL, end_minute INTEGER NOT NULL,
 CHECK(start_minute>=0 AND end_minute<=1440 AND start_minute<end_minute),
 PRIMARY KEY(practitioner_id,weekday,start_minute)
);

CREATE TABLE bm_clients (
 id TEXT PRIMARY KEY, first_name TEXT NOT NULL, last_name TEXT NOT NULL, date_of_birth TEXT,
 email TEXT, phone TEXT, created_at TEXT NOT NULL,
 created_via TEXT NOT NULL CHECK(created_via IN ('online','staff','import')),
 version INTEGER NOT NULL DEFAULT 1, erased_at INTEGER
);
CREATE INDEX bm_clients_email ON bm_clients(lower(email));
CREATE TABLE bm_import_client_revisions (client_id TEXT PRIMARY KEY REFERENCES bm_clients(id), revision TEXT NOT NULL);

CREATE TABLE bm_appointments (
 id TEXT PRIMARY KEY, client_id TEXT NOT NULL REFERENCES bm_clients(id),
 practitioner_id TEXT NOT NULL REFERENCES bm_staff(id), service_id TEXT NOT NULL REFERENCES bm_services(id),
 start_at TEXT NOT NULL, end_at TEXT NOT NULL,
 status TEXT NOT NULL CHECK(status IN ('booked','attended','cancelled','no_show')),
 booked_via TEXT NOT NULL CHECK(booked_via IN ('online','staff')),
 intake_token_hash TEXT UNIQUE, created_at TEXT NOT NULL, created_by TEXT NOT NULL,
 version INTEGER NOT NULL DEFAULT 1
);
CREATE INDEX bm_appointments_practitioner ON bm_appointments(practitioner_id,start_at);
CREATE INDEX bm_appointments_client ON bm_appointments(client_id);

-- Immutable intake form versions; the highest number is current.
CREATE TABLE bm_intake_forms (
 id TEXT PRIMARY KEY, number INTEGER NOT NULL UNIQUE, title TEXT NOT NULL,
 questions TEXT NOT NULL CHECK(json_valid(questions)), published_at TEXT NOT NULL, published_by TEXT NOT NULL
);
INSERT INTO bm_intake_forms(id,number,title,questions,published_at,published_by) VALUES('intake-v1',1,'New client intake',
 '[{"id":"reason","label":"What brings you in?","type":"long","required":true},{"id":"history","label":"How long has this been going on, and has it happened before?","type":"long","required":false},{"id":"conditions","label":"Medical conditions, injuries or surgeries we should know about","type":"long","required":false},{"id":"medications","label":"Current medications","type":"long","required":false},{"id":"emergency","label":"Emergency contact name and phone","type":"short","required":true},{"id":"consent","label":"I consent to assessment and treatment, and I understand I can ask questions or stop at any time.","type":"yes","required":true}]',
 '2026-10-16T00:00:00.000Z','Balm default');

CREATE TABLE bm_intake_responses (
 id TEXT PRIMARY KEY, appointment_id TEXT NOT NULL UNIQUE REFERENCES bm_appointments(id),
 client_id TEXT NOT NULL REFERENCES bm_clients(id), form_id TEXT NOT NULL REFERENCES bm_intake_forms(id),
 answers TEXT NOT NULL CHECK(json_valid(answers)), submitted_at TEXT NOT NULL
);

-- Treatment notes keep every revision; only the author and the owner read them.
CREATE TABLE bm_notes (
 id TEXT PRIMARY KEY, client_id TEXT NOT NULL REFERENCES bm_clients(id),
 appointment_id TEXT REFERENCES bm_appointments(id), author_id TEXT NOT NULL REFERENCES bm_staff(id),
 created_at TEXT NOT NULL
);
CREATE TABLE bm_note_revisions (
 note_id TEXT NOT NULL REFERENCES bm_notes(id), number INTEGER NOT NULL, body TEXT NOT NULL,
 reason TEXT NOT NULL DEFAULT '', written_at TEXT NOT NULL, PRIMARY KEY(note_id,number)
);

CREATE TABLE bm_invoices (
 id TEXT PRIMARY KEY, number INTEGER UNIQUE, appointment_id TEXT NOT NULL REFERENCES bm_appointments(id),
 client_id TEXT NOT NULL REFERENCES bm_clients(id),
 status TEXT NOT NULL CHECK(status IN ('draft','approved','void')),
 amount_cents INTEGER NOT NULL CHECK(amount_cents BETWEEN 0 AND 10000000),
 snapshot TEXT NOT NULL CHECK(json_valid(snapshot)), artifact TEXT, artifact_sha256 TEXT,
 prepared_by TEXT NOT NULL, prepared_role TEXT NOT NULL, prepared_at TEXT NOT NULL,
 approved_by TEXT, approved_at TEXT, void_reason TEXT, version INTEGER NOT NULL DEFAULT 1
);
CREATE UNIQUE INDEX bm_invoice_live ON bm_invoices(appointment_id) WHERE status<>'void';
CREATE TABLE bm_payments (
 id TEXT PRIMARY KEY, invoice_id TEXT NOT NULL REFERENCES bm_invoices(id),
 amount_cents INTEGER NOT NULL CHECK(amount_cents>0), reference TEXT NOT NULL UNIQUE,
 recorded_by TEXT NOT NULL, recorded_at TEXT NOT NULL
);

-- Agent or staff preparations awaiting a person's decision.
CREATE TABLE bm_drafts (
 id TEXT PRIMARY KEY, type TEXT NOT NULL CHECK(type IN ('intake','reminder')),
 status TEXT NOT NULL CHECK(status IN ('draft','approved')),
 payload TEXT NOT NULL CHECK(json_valid(payload)), basis TEXT NOT NULL DEFAULT '', client_id TEXT,
 prepared_by TEXT NOT NULL, prepared_role TEXT NOT NULL, prepared_at TEXT NOT NULL
);
CREATE TABLE bm_approvals (
 id TEXT PRIMARY KEY, subject_type TEXT NOT NULL, subject_id TEXT NOT NULL UNIQUE,
 prepared_by TEXT NOT NULL, prepared_role TEXT NOT NULL, approved_by TEXT NOT NULL,
 approved_at TEXT NOT NULL, sha256 TEXT NOT NULL
);

-- Append-only access audit. Details never carry client personal details.
CREATE TABLE bm_audit (
 sequence INTEGER PRIMARY KEY AUTOINCREMENT, at TEXT NOT NULL, actor_email TEXT NOT NULL,
 actor_role TEXT NOT NULL, action TEXT NOT NULL, client_id TEXT, subject_id TEXT, detail TEXT NOT NULL DEFAULT ''
);
CREATE INDEX bm_audit_client ON bm_audit(client_id,sequence);
CREATE TRIGGER bm_audit_no_update BEFORE UPDATE ON bm_audit BEGIN SELECT RAISE(ABORT,'audit_append_only'); END;
CREATE TRIGGER bm_audit_no_delete BEFORE DELETE ON bm_audit BEGIN SELECT RAISE(ABORT,'audit_append_only'); END;

CREATE TABLE bm_erasure_journal (identity_hash TEXT PRIMARY KEY, kind TEXT NOT NULL, erased_at INTEGER NOT NULL);
CREATE TABLE bm_assert (value INTEGER NOT NULL CHECK(value=1));
CREATE TABLE bm_agent_keys (
 id TEXT PRIMARY KEY, owner_id TEXT NOT NULL REFERENCES oa_operators(id),
 owner_version INTEGER NOT NULL, label TEXT NOT NULL, token_hash TEXT NOT NULL UNIQUE,
 created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL, revoked_at INTEGER
);
