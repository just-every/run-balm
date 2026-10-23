-- An import undo may remove derived notifications only before any approval.
-- Approved deliveries remain retained, regardless of their transport outcome.
DROP TRIGGER bm_integration_events_kept;
CREATE TRIGGER bm_integration_events_kept BEFORE DELETE ON bm_integration_events
WHEN NOT EXISTS (
 SELECT 1 FROM bm_retention_scope s JOIN bm_retention_permits p ON p.preview_id=s.preview_id
 WHERE s.table_name='bm_integration_events' AND s.record_rowid=OLD.rowid
) AND NOT (
 NOT EXISTS(SELECT 1 FROM bm_integration_deliveries d WHERE d.event_id=OLD.id)
 AND EXISTS(SELECT 1 FROM bm_movein_jobs j JOIN bm_movein_records r ON r.job_id=j.id
  WHERE j.state='undoing' AND r.target_table='bm_appointments' AND r.target_id=OLD.appointment_id)
)
BEGIN SELECT RAISE(ABORT,'integration_history_kept'); END;
