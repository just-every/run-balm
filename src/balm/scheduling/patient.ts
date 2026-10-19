import type { Bindings } from '../../auth.server'
import { openSlots, patientPlacement, placementGuards } from '../domain/booking'
import { audit, commit, DomainError, guard, insist, now, one, sha256, stmt, text, type Data } from '../domain/model'
import { liveVisitLink, visitReplyView } from '../reminders/replies'
import { getVisitPolicy } from './policy'
import { checkSelfService, selfServiceRules, selfServiceSnapshot } from './self-service-policy'
import { cancelOwnAppointment } from './patient-cancellation'

const eligibilityRefusals = new Set(['online_booking_closed', 'service_self_booking_disabled', 'self_booking_notice_required', 'contact_clinic_about_plan_of_care', 'contact_clinic_about_visit_authorization'])
/** A week's slots need at most one clinical eligibility read per clinic-local day. */
export async function eligiblePatientSlots(db: D1Database, clientId: string, input: Data, excludeAppointmentId?: string) {
  const rules = await selfServiceRules(db, text(input.serviceId, 'service', 100))
  const available = await openSlots(db, input, excludeAppointmentId ? [excludeAppointmentId] : [])
  const candidates = available.slots.filter(s => rules.enabled && Date.parse(s.startAt) >= Date.now() + rules.noticeMinutes * 60_000)
  const firstByDay = new Map(candidates.map(s => [s.hostDate, s]))
  const allowed = new Set<string>()
  await Promise.all([...firstByDay].map(async ([date, slot]) => {
    try {
      await checkSelfService(db, { clientId, practitionerId: available.practitioner.id, serviceId: available.service.id, startAt: slot.startAt, excludeAppointmentId })
      allowed.add(date)
    } catch (error) {
      if (!(error instanceof DomainError) || !eligibilityRefusals.has(error.code)) throw error
    }
  }))
  return { ...available, selfService: rules, slots: candidates.filter(s => allowed.has(s.hostDate)) }
}

const patient = { email: 'Patient via private visit link', role: 'patient' }
export async function patientVisitSlots(env: Bindings, token: string, input: Data) {
  const { appointment: a } = await visitReplyView(env, token)
  const policy = await getVisitPolicy(env.DB)
  const editableAfter = new Date(Date.now() + policy.noticeHours * 3600_000).toISOString()
  const published = await one(env.DB, `SELECT 1 FROM bm_services s,bm_staff p WHERE s.id=? AND s.active=1 AND p.id=? AND p.active=1 AND p.erased_at IS NULL AND p.role='practitioner'`, a.service_id, a.practitioner_id)
  if (!published) return { policy, canCancel: a.start_at >= editableAfter, canMove: false, slots: [], next: undefined }
  const available = await eligiblePatientSlots(env.DB, a.client_id, { ...input, practitionerId: a.practitioner_id, serviceId: a.service_id }, a.id)
  return { ...available, policy, canCancel: a.start_at >= editableAfter, canMove: a.start_at >= editableAfter && available.selfService.enabled, slots: available.slots.filter(s => s.startAt >= editableAfter) }
}
/** The private reminder/confirmation bearer authorizes only its own visit. A successful move revokes it. */
export async function movePatientAppointment(env: Bindings, token: string, input: Data) {
  const { appointment: a } = await visitReplyView(env, token)
  return moveOwnAppointment(env.DB, a.client_id, { ...input, id: a.id }, [guard(env.DB, `EXISTS(SELECT 1 FROM (${liveVisitLink}))`, await sha256(token), now())], patient)
}
export async function cancelPatientAppointment(env: Bindings, token: string, input: Data) {
  const { appointment: a } = await visitReplyView(env, token)
  return cancelOwnAppointment(env.DB, a.client_id, { ...input, id: a.id }, [guard(env.DB, `EXISTS(SELECT 1 FROM (${liveVisitLink}))`, await sha256(token), now())], patient)
}
/** Portal supplies a live-session guard in the same batch; callers cannot choose another patient's file. */
export async function moveOwnAppointment(db: D1Database, clientId: string, input: Data, authority: D1PreparedStatement[], who = { email: 'Patient via portal', role: 'patient' }) {
  insist(authority.length > 0, 'patient_authority_required', 403)
  const unchanged = await selfServiceSnapshot(db)
  const a = await one(db, "SELECT * FROM bm_appointments WHERE id=? AND client_id=? AND status='booked'", text(input.id, 'appointment', 100), clientId)
  insist(a, 'appointment_not_found', 404)
  const policy = await getVisitPolicy(db), threshold = new Date(Date.now() + policy.noticeHours * 3600_000).toISOString()
  insist(a.start_at >= threshold, 'contact_clinic_inside_cancellation_notice', 409)
  const eligibility = await checkSelfService(db, { clientId, practitionerId: a.practitioner_id, serviceId: a.service_id, startAt: input.start, excludeAppointmentId: a.id })
  const placement = await patientPlacement(db, a, input)
  insist(placement.startAt >= threshold, 'new_time_inside_cancellation_notice', 409)
  await commit(db, null, [
    ...authority, unchanged, ...eligibility.guards,
    guard(db, 'EXISTS(SELECT 1 FROM bm_settings WHERE id=1 AND cancellation_notice_hours=?)', policy.noticeHours),
    guard(db, "EXISTS(SELECT 1 FROM bm_appointments WHERE id=? AND client_id=? AND status='booked' AND version=? AND start_at>=?)", a.id, clientId, a.version, threshold),
    guard(db, "julianday(?)>=julianday('now')+?/24.0 AND julianday(?)>=julianday('now')+?/24.0", a.start_at, policy.noticeHours, placement.startAt, policy.noticeHours),
    ...placementGuards(db, { practitionerId: a.practitioner_id, roomId: a.room_id, ...placement, except: a.id }),
    stmt(db, "UPDATE bm_appointments SET start_at=?,end_at=?,patient_response='confirmed',patient_response_at=?,version=version+1 WHERE id=?", placement.startAt, placement.endAt, now(), a.id),
    audit(db, who, 'appointment.moved', clientId, a.id, `${a.start_at} -> ${placement.startAt}`),
  ])
  return { id: a.id, ...placement }
}
