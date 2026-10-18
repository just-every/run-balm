-- Message destinations and patient credentials have the same boundary. Older
-- clinical messages stay visible to the patient's treating practitioners.
ALTER TABLE bm_messages ADD COLUMN route TEXT NOT NULL DEFAULT 'practitioner' CHECK(route IN ('practitioner','front_desk'));
ALTER TABLE bm_messages ADD COLUMN practitioner_id TEXT REFERENCES bm_staff(id);
ALTER TABLE bm_messages ADD COLUMN reply_to TEXT REFERENCES bm_messages(id);
ALTER TABLE bm_messages ADD COLUMN automated INTEGER NOT NULL DEFAULT 0 CHECK(automated IN (0,1));
ALTER TABLE bm_message_links ADD COLUMN route TEXT NOT NULL DEFAULT 'practitioner' CHECK(route IN ('practitioner','front_desk'));
ALTER TABLE bm_message_links ADD COLUMN practitioner_id TEXT REFERENCES bm_staff(id);
DROP INDEX bm_message_link_live;
CREATE UNIQUE INDEX bm_message_link_live ON bm_message_links(client_id,route,COALESCE(practitioner_id,'')) WHERE revoked_at IS NULL;
CREATE TRIGGER bm_message_destination_fixed BEFORE UPDATE ON bm_messages
 WHEN NEW.route IS NOT OLD.route OR NEW.practitioner_id IS NOT OLD.practitioner_id OR NEW.reply_to IS NOT OLD.reply_to OR NEW.automated IS NOT OLD.automated
 BEGIN SELECT RAISE(ABORT,'message_content_fixed'); END;
CREATE TRIGGER bm_message_link_destination_fixed BEFORE UPDATE ON bm_message_links
 WHEN NEW.client_id IS NOT OLD.client_id OR NEW.route IS NOT OLD.route OR NEW.practitioner_id IS NOT OLD.practitioner_id
 BEGIN SELECT RAISE(ABORT,'message_link_destination_fixed'); END;
CREATE UNIQUE INDEX bm_message_automatic_reply ON bm_messages(reply_to) WHERE automated=1;
CREATE TABLE bm_message_attachments (
 id TEXT PRIMARY KEY, message_id TEXT NOT NULL REFERENCES bm_messages(id),
 filename TEXT NOT NULL, mime TEXT NOT NULL CHECK(mime IN ('image/jpeg','image/png','image/webp','application/pdf')),
 byte_length INTEGER NOT NULL CHECK(byte_length BETWEEN 1 AND 1000000),
 content_base64 TEXT NOT NULL, sha256 TEXT NOT NULL
);
CREATE INDEX bm_message_attachment_parent ON bm_message_attachments(message_id);
CREATE TRIGGER bm_message_attachment_fixed BEFORE UPDATE ON bm_message_attachments BEGIN SELECT RAISE(ABORT,'message_content_fixed'); END;
CREATE TRIGGER bm_message_attachment_kept BEFORE DELETE ON bm_message_attachments BEGIN SELECT RAISE(ABORT,'messages_are_health_records'); END;
