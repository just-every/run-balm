import { audit, commit, guard, insist, now, one, stmt, text, type Data } from '../domain/model'
import { cancellationStatements, getVisitPolicy } from './policy'
import { selfServiceSnapshot } from './self-service-policy'

/** Cancellation remains available when self-booking or clinical eligibility changes. */
export async function cancelOwnAppointment(db: D1Database, clientId: string, input: Data, authority: D1PreparedStatement[], who = { email: 'Patient via portal', role: 'patient' }) {
  insist(authority.length > 0, 'patient_authority_required', 403)
  insist(input.confirm === 'on' || input.confirm === true, 'confirm_cancellation')
  const unchanged = await selfServiceSnapshot(db)
  const appointment = await one(db, "SELECT * FROM bm_appointments WHERE id=? AND client_id=? AND status='booked'", text(input.id, 'appointment', 100), clientId)
  insist(appointment, 'appointment_not_found', 404)
  const policy = await getVisitPolicy(db), at = now()
  insist(Date.parse(appointment.start_at) >= Date.parse(at) + policy.noticeHours * 3600_000, 'contact_clinic_inside_cancellation_notice', 409)
  const cancellation = cancellationStatements(db, who, appointment, input.reason, policy)
  await commit(db, null, [
    ...authority, unchanged,
    guard(db, "EXISTS(SELECT 1 FROM bm_appointments WHERE id=? AND client_id=? AND status='booked' AND version=? AND julianday(start_at)>=julianday('now')+?/24.0)", appointment.id, clientId, appointment.version, policy.noticeHours),
    guard(db, 'EXISTS(SELECT 1 FROM bm_settings WHERE id=1 AND cancellation_notice_hours=? AND late_cancel_fee_cents=? AND no_show_fee_cents=?)', policy.noticeHours, policy.lateCancelFeeCents, policy.noShowFeeCents),
    ...cancellation,
    stmt(db, "UPDATE bm_appointments SET status='cancelled',version=version+1 WHERE id=? AND client_id=? AND status='booked' AND version=?", appointment.id, clientId, appointment.version),
    guard(db, 'changes()=1'),
    audit(db, who, 'appointment.cancelled', clientId, appointment.id),
  ])
  return { id: appointment.id, clientId, appointment, status: 'cancelled' as const }
}
