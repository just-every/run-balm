CREATE TRIGGER bm_message_email_changed AFTER UPDATE OF email ON bm_clients
 WHEN NEW.email IS NOT OLD.email BEGIN
 UPDATE bm_message_links SET revoked_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE client_id=NEW.id AND revoked_at IS NULL;
 END;
