import type { Bindings } from '../../auth.server'
import { openSlots, patientPlacement, placementGuards } from '../domain/booking'
import { audit, commit, guard, insist, now, one, sha256, stmt, text, type Data } from '../domain/model'
import { liveVisitLink, visitReplyView } from '../reminders/replies'
import { bookingWarnings } from '../insurance/authorization'
import { hostDateAt } from '../availability/timezone'
import { settings } from '../domain/booking'
import { getVisitPolicy } from './policy'

const patient = { email: 'Patient via private visit link', role: 'patient' }
export async function patientVisitSlots(env: Bindings, token: string, input: Data) {
  const { appointment: a } = await visitReplyView(env, token)
  const policy = await getVisitPolicy(env.DB)
  const editableAfter = new Date(Date.now() + policy.noticeHours * 3600_000).toISOString()
  const available = await openSlots(env.DB, { ...input, practitionerId: a.practitioner_id, serviceId: a.service_id }, [a.id])
  return { ...available, policy, canMove: a.start_at >= editableAfter, slots: available.slots.filter(s => s.startAt >= editableAfter) }
}
/** The private reminder/confirmation bearer authorizes only its own visit. A successful move revokes it. */
export async function movePatientAppointment(env: Bindings, token: string, input: Data) {
  const { appointment: a } = await visitReplyView(env, token)
  return moveOwnAppointment(env.DB, a.client_id, { ...input, id: a.id }, [guard(env.DB, `EXISTS(SELECT 1 FROM (${liveVisitLink}))`, await sha256(token), now())], patient)
}
/** Portal supplies a live-session guard in the same batch; callers cannot choose another patient's file. */
export async function moveOwnAppointment(db: D1Database, clientId: string, input: Data, authority: D1PreparedStatement[], who = { email: 'Patient via portal', role: 'patient' }) {
  insist(authority.length > 0, 'patient_authority_required', 403)
  const a = await one(db, "SELECT * FROM bm_appointments WHERE id=? AND client_id=? AND status='booked'", text(input.id, 'appointment', 100), clientId)
  insist(a, 'appointment_not_found', 404)
  const policy = await getVisitPolicy(db), threshold = new Date(Date.now() + policy.noticeHours * 3600_000).toISOString()
  insist(a.start_at >= threshold, 'contact_clinic_inside_cancellation_notice', 409)
  const placement = await patientPlacement(db, a, input)
  const warnings = await bookingWarnings(db, clientId, hostDateAt(new Date(placement.startAt), (await settings(db)).time_zone), a.practitioner_id, a.id)
  insist(!warnings.some(w => w.code === 'authorization_exhausted' || w.code === 'authorization_outside_dates'), 'contact_clinic_about_visit_authorization', 409)
  insist(placement.startAt >= threshold, 'new_time_inside_cancellation_notice', 409)
  await commit(db, null, [
    ...authority,
    guard(db, 'EXISTS(SELECT 1 FROM bm_settings WHERE id=1 AND cancellation_notice_hours=?)', policy.noticeHours),
    guard(db, "EXISTS(SELECT 1 FROM bm_appointments WHERE id=? AND client_id=? AND status='booked' AND version=? AND start_at>=?)", a.id, clientId, a.version, threshold),
    ...placementGuards(db, { practitionerId: a.practitioner_id, roomId: a.room_id, ...placement, except: a.id }),
    stmt(db, "UPDATE bm_appointments SET start_at=?,end_at=?,patient_response='confirmed',patient_response_at=?,version=version+1 WHERE id=?", placement.startAt, placement.endAt, now(), a.id),
    audit(db, who, 'appointment.moved', clientId, a.id, `${a.start_at} -> ${placement.startAt}`),
  ])
  return { id: a.id, ...placement }
}
