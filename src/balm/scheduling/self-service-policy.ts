import { hostDateAt } from '../availability/timezone'
import { bookable, settings } from '../domain/booking'
import { guard, insist, one, text } from '../domain/model'
import { authorizationsFor, bookingWarnings } from '../insurance/authorization'

/** Read before the facts it protects, and execute before any domain write. */
export async function selfServiceSnapshot(db: D1Database) {
  const epoch = await one(db, 'SELECT version FROM bm_retention_epoch WHERE id=1')
  insist(epoch, 'scheduling_state_unavailable', 409)
  return guard(db, 'EXISTS(SELECT 1 FROM bm_retention_epoch WHERE id=1 AND version=?)', epoch.version)
}

export async function selfServiceRules(db: D1Database, serviceId: string) {
  const service = await one(db, 'SELECT * FROM bm_services WHERE id=? AND active=1', text(serviceId, 'service', 100))
  insist(service, 'service_not_found', 404)
  return {
    enabled: service.self_book_enabled === 1,
    noticeMinutes: Math.max(120, Number(service.self_book_notice_minutes)),
    requirePlan: service.self_book_plan_required === 1,
    requireAuthorization: service.self_book_auth_required === 1,
    service,
  }
}

type SelfServiceInput = { clientId?: string; practitionerId: string; serviceId: string; startAt: string; excludeAppointmentId?: string }

/** Eligibility returns only scheduling facts: no plan content or diagnoses. */
export async function checkSelfService(db: D1Database, input: SelfServiceInput) {
  const unchanged = await selfServiceSnapshot(db)
  const start = text(input.startAt, 'start', 40)
  insist(/^\d{4}-\d\d-\d\dT\d\d:\d\d(:\d\d(\.\d{1,3})?)?Z$/.test(start) && Number.isFinite(Date.parse(start)), 'invalid_start')
  const [rules, clinic, target] = await Promise.all([
    selfServiceRules(db, input.serviceId), settings(db), bookable(db, input.practitionerId, input.serviceId),
  ])
  insist(clinic.booking_open === 1, 'online_booking_closed', 409)
  insist(rules.enabled, 'service_self_booking_disabled', 409)
  insist(Date.parse(start) >= Date.now() + rules.noticeMinutes * 60_000, 'self_booking_notice_required', 409)
  const localDate = hostDateAt(new Date(start), clinic.time_zone)
  if (input.clientId) {
    insist(await one(db, 'SELECT 1 FROM bm_clients WHERE id=? AND erased_at IS NULL', input.clientId), 'client_not_found', 404)
  }
  if (rules.requirePlan) {
    insist(input.clientId && await one(db, `SELECT 1 FROM bm_plans_of_care WHERE client_id=? AND author_id=? AND status='certified'
      AND json_extract(content,'$.startDate')<=? AND json_extract(content,'$.certifiedThrough')>=? LIMIT 1`,
    input.clientId, target.practitioner.id, localDate, localDate), 'contact_clinic_about_plan_of_care', 409)
  }
  if (input.clientId) {
    const warnings = await bookingWarnings(db, input.clientId, localDate, input.practitionerId, input.excludeAppointmentId)
    insist(!warnings.some(w => w.code === 'authorization_exhausted' || w.code === 'authorization_outside_dates'), 'contact_clinic_about_visit_authorization', 409)
  }
  if (rules.requireAuthorization) {
    insist(input.clientId, 'contact_clinic_about_visit_authorization', 409)
    const [auths, excluded] = await Promise.all([
      authorizationsFor(db, input.clientId),
      input.excludeAppointmentId ? one(db, "SELECT start_at,practitioner_id FROM bm_appointments WHERE id=? AND client_id=? AND status='booked'", input.excludeAppointmentId, input.clientId) : Promise.resolve(null),
    ])
    // Release the old reservation from exactly the authorizations which own it.
    if (excluded) {
      const oldDate = hostDateAt(new Date(excluded.start_at), clinic.time_zone), seen = new Set<string>()
      for (const a of auths) if (!seen.has(a.policy_id) && a.starts_on <= oldDate && a.ends_on >= oldDate && (!a.practitioner_id || a.practitioner_id === excluded.practitioner_id)) {
        seen.add(a.policy_id); a.reserved_visits = Math.max(0, a.reserved_visits - 1)
      }
    }
    const seen = new Set<string>()
    const covering = auths.filter(a => {
      if (seen.has(a.policy_id) || a.starts_on > localDate || a.ends_on < localDate || (a.practitioner_id && a.practitioner_id !== input.practitionerId)) return false
      seen.add(a.policy_id)
      return true
    })
    insist(covering.some(a => a.visits - a.used_visits - a.reserved_visits >= 1), 'contact_clinic_about_visit_authorization', 409)
  }
  return {
    startAt: new Date(start).toISOString(), rules, clinic, practitioner: target.practitioner, service: rules.service, localDate,
    guards: [
      unchanged,
      guard(db, 'EXISTS(SELECT 1 FROM bm_settings WHERE id=1 AND version=? AND time_zone=? AND booking_open=1)', clinic.version, clinic.time_zone),
      guard(db, 'EXISTS(SELECT 1 FROM bm_services WHERE id=? AND active=1 AND version=? AND self_book_enabled=1)', rules.service.id, rules.service.version),
      guard(db, "EXISTS(SELECT 1 FROM bm_staff WHERE id=? AND role='practitioner' AND active=1 AND erased_at IS NULL AND version=?)", target.practitioner.id, target.practitioner.version),
      guard(db, "julianday(?)>=julianday('now')+?/1440.0", start, rules.noticeMinutes),
      ...(input.clientId ? [guard(db, 'EXISTS(SELECT 1 FROM bm_clients WHERE id=? AND erased_at IS NULL)', input.clientId)] : []),
    ],
  }
}
