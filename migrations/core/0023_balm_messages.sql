-- Secure message content stays in the clinic database. Only token hashes live
-- here; private links are credentials and are excluded from clinic archives.
CREATE TABLE bm_message_links (
 id TEXT PRIMARY KEY, client_id TEXT NOT NULL REFERENCES bm_clients(id),
 token_hash TEXT NOT NULL UNIQUE, created_by TEXT NOT NULL, created_at TEXT NOT NULL,
 expires_at TEXT NOT NULL, revoked_at TEXT, opened_at TEXT,
 delivery TEXT NOT NULL CHECK(delivery IN ('email','shown')),
 delivery_state TEXT NOT NULL CHECK(delivery_state IN ('pending','sent','shown','no_email','mail_unavailable'))
);
CREATE UNIQUE INDEX bm_message_link_live ON bm_message_links(client_id) WHERE revoked_at IS NULL;

CREATE TABLE bm_messages (
 sequence INTEGER PRIMARY KEY AUTOINCREMENT, id TEXT NOT NULL UNIQUE,
 client_id TEXT NOT NULL REFERENCES bm_clients(id),
 sender TEXT NOT NULL CHECK(sender IN ('clinic','patient')),
 author_name TEXT NOT NULL, body TEXT NOT NULL CHECK(length(body) BETWEEN 1 AND 10000),
 sent_at TEXT NOT NULL,
 notification_state TEXT NOT NULL CHECK(notification_state IN ('pending','sent','shown','no_email','mail_unavailable')),
 notified_at TEXT
);
CREATE INDEX bm_messages_client ON bm_messages(client_id,sequence);

-- Retain the conversation as part of the health record, including after staff
-- access changes. Delivery metadata can change; the message itself cannot.
CREATE TRIGGER bm_message_content_fixed BEFORE UPDATE ON bm_messages
 WHEN NEW.id IS NOT OLD.id OR NEW.sequence IS NOT OLD.sequence OR NEW.client_id IS NOT OLD.client_id
 OR NEW.sender IS NOT OLD.sender OR NEW.author_name IS NOT OLD.author_name OR NEW.body IS NOT OLD.body OR NEW.sent_at IS NOT OLD.sent_at
 BEGIN SELECT RAISE(ABORT,'message_content_fixed'); END;
CREATE TRIGGER bm_message_kept BEFORE DELETE ON bm_messages
 BEGIN SELECT RAISE(ABORT,'messages_are_health_records'); END;
CREATE TRIGGER bm_message_client_retained BEFORE UPDATE OF erased_at ON bm_clients
 WHEN NEW.erased_at IS NOT NULL AND EXISTS(SELECT 1 FROM bm_messages WHERE client_id=OLD.id)
 BEGIN SELECT RAISE(ABORT,'clients_with_health_records_are_retained'); END;
