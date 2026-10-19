/** Read the provider's atomic state directly; there is no second projection write to lose. */
export async function mailHistory(db: D1Database, clientId: string, appointmentIds: string[]) {
  const result = await db.prepare(`SELECT a.id,a.client_id,a.kind,a.provider,a.submission_state,a.created_at,a.completed_at,
    CASE WHEN a.submission_state='sending' THEN 'uncertain' ELSE a.submission_state END AS state,
    e.status AS delivery_state,e.occurred_at AS delivery_at,r.lead_minutes,r.start_at,r.due_at
    FROM bm_mail_attempts a LEFT JOIN rer_mail_event_states e ON e.rowid=(
      SELECT s.rowid FROM rer_mail_event_states s JOIN rer_mail_event_receipts r ON r.provider=s.provider AND r.tenant_id=s.tenant_id
        AND r.event_namespace=s.event_namespace AND r.event_id=s.event_id
      WHERE s.provider=a.provider AND s.tenant_id=a.tenant_id AND s.event_namespace=a.event_namespace AND s.recipient=a.recipient
        AND ((a.provider='resend' AND s.provider_message_id=a.provider_message_id)
          OR (a.provider='sendgrid' AND json_extract(r.event_json,'$.deliveryId')=a.id))
      ORDER BY s.terminal DESC,s.occurred_at DESC,s.event_id LIMIT 1)
    LEFT JOIN bm_visit_reminders r ON r.id=a.id
    WHERE a.client_id=? AND EXISTS(SELECT 1 FROM bm_mail_attempt_visits v WHERE v.delivery_id=a.id AND v.appointment_id IN (SELECT value FROM json_each(?))) ORDER BY a.created_at DESC,a.id LIMIT 200`).bind(clientId, JSON.stringify(appointmentIds)).all<any>()
  return result.results.map(row => ({ ...row, state: row.delivery_state ?? row.state }))
}
