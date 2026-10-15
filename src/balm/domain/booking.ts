import { evaluateSlot, listAvailableSlots, type AvailabilityConstraints } from '../availability/engine'
import { datePlus, hostDateAt, wallClockInstants, zonedParts } from '../availability/timezone'
import { audit, commit, day, email, guard, id, insist, need, now, one, optional, practitionerId, rows, sha256, stmt, text, type Actor, type Data } from './model'

// Online booking rules (Dial's constraint names; Balm fixes them for the first release).
export const onlineRules: AvailabilityConstraints = { durationMinutes: 0, slotIncrementMinutes: 15, minimumNoticeMinutes: 120, bookingHorizonDays: 60, beforeBufferMinutes: 0, afterBufferMinutes: 0, hostDayBookingLimit: null }
const live = "status IN ('booked','attended')"

async function settings(db: D1Database) { return (await one(db, 'SELECT * FROM bm_settings WHERE id=1'))! }
async function bookable(db: D1Database, practitionerKey: unknown, serviceKey: unknown) {
  const practitioner = await one(db, "SELECT id,name,profession,version FROM bm_staff WHERE id=? AND role='practitioner' AND active=1 AND erased_at IS NULL", text(practitionerKey, 'practitioner', 100))
  insist(practitioner, 'practitioner_not_found', 404)
  const service = await one(db, 'SELECT * FROM bm_services WHERE id=? AND active=1', text(serviceKey, 'service', 100))
  insist(service, 'service_not_found', 404)
  return { practitioner, service }
}
async function engineInput(db: D1Database, practitioner: string, duration: number, zone: string, staff: boolean) {
  const [hours, claims] = await Promise.all([
    rows(db, 'SELECT weekday,start_minute AS startMinute,end_minute AS endMinute FROM bm_hours WHERE practitioner_id=?', practitioner),
    rows(db, `SELECT start_at AS startAt,end_at AS endAt FROM bm_appointments WHERE practitioner_id=? AND ${live} AND end_at>?`, practitioner, new Date(Date.now() - 86400_000).toISOString()),
  ])
  return {
    hostTimeZone: zone, recurringWindows: hours as any[], overrides: [],
    constraints: { ...onlineRules, durationMinutes: duration, ...(staff ? { enforceMinimumNotice: false, enforceHorizon: false } : {}) },
    internalClaims: claims.map(c => ({ startAt: c.startAt, endAt: c.endAt, hostDate: hostDateAt(new Date(c.startAt), zone) })), calendarBusy: [],
  }
}

/** Public: open slots for one practitioner and service over a week from a clinic-local date. */
export async function openSlots(db: D1Database, input: Data) {
  const clinic = await settings(db)
  const { practitioner, service } = await bookable(db, input.practitionerId, input.serviceId)
  const from = input.from ? day(input.from, 'from') : hostDateAt(new Date(), clinic.time_zone)
  const slots = listAvailableSlots({ ...await engineInput(db, practitioner.id as string, service.duration_minutes, clinic.time_zone, false), fromHostDate: from, days: 7 })
  return { from, next: datePlus(from, 7), timeZone: clinic.time_zone, practitioner, service, slots }
}

function checkSlot(input: Awaited<ReturnType<typeof engineInput>>, start: Date, end: Date, zone: string) {
  const parts = zonedParts(start, zone)
  return evaluateSlot(input, hostDateAt(start, zone), parts.hour * 60 + parts.minute, start, end)
}
function instant(value: unknown) {
  const v = text(value, 'start', 40)
  insist(/^\d{4}-\d\d-\d\dT\d\d:\d\d(:\d\d(\.\d{1,3})?)?Z$/.test(v) && Number.isFinite(Date.parse(v)), 'invalid_start')
  return new Date(v)
}
function appointmentStatements(db: D1Database, who: Actor | { email: string; role: string }, appointment: Data) {
  return [
    // Rechecked in the batch: no other live appointment for this practitioner overlaps.
    guard(db, `NOT EXISTS(SELECT 1 FROM bm_appointments WHERE practitioner_id=? AND ${live} AND start_at<? AND end_at>?)`, appointment.practitionerId, appointment.endAt, appointment.startAt),
    guard(db, "EXISTS(SELECT 1 FROM bm_staff WHERE id=? AND role='practitioner' AND active=1 AND erased_at IS NULL)", appointment.practitionerId),
    stmt(db, `INSERT INTO bm_appointments(id,client_id,practitioner_id,service_id,start_at,end_at,status,booked_via,intake_token_hash,created_at,created_by)
      VALUES(?,?,?,?,?,?,'booked',?,?,?,?)`, appointment.id, appointment.clientId, appointment.practitionerId, appointment.serviceId,
    appointment.startAt, appointment.endAt, appointment.bookedVia, appointment.tokenHash, now(), who.email),
    audit(db, who, 'appointment.booked', appointment.clientId, appointment.id, `${appointment.bookedVia} ${appointment.startAt}`),
  ]
}
export function intakeToken() {
  const bytes = crypto.getRandomValues(new Uint8Array(24))
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

/** Public online booking for a new client. Returns the one-time intake link token. */
export async function bookOnline(db: D1Database, input: Data) {
  const clinic = await settings(db)
  insist(clinic.booking_open === 1, 'online_booking_closed', 409)
  const { practitioner, service } = await bookable(db, input.practitionerId, input.serviceId)
  const start = instant(input.start), end = new Date(start.getTime() + service.duration_minutes * 60_000)
  const verdict = checkSlot(await engineInput(db, practitioner.id as string, service.duration_minutes, clinic.time_zone, false), start, end, clinic.time_zone)
  insist(verdict.valid, 'slot_unavailable', 409)
  const client = { firstName: text(input.firstName, 'first_name', 80), lastName: text(input.lastName, 'last_name', 80), dateOfBirth: day(input.dateOfBirth, 'date_of_birth'), email: email(input.email), phone: optional(input.phone, 'phone', 40) }
  insist(input.privacy === true || input.privacy === 'on' || input.privacy === 'yes', 'privacy_acknowledgement_required')
  const pending = await one<{ n: number }>(db, `SELECT COUNT(*) AS n FROM bm_appointments a JOIN bm_clients c ON c.id=a.client_id WHERE lower(c.email)=? AND a.status='booked' AND a.start_at>?`, client.email, now())
  insist((pending?.n ?? 0) < 3, 'too_many_online_bookings', 429)
  // An exact match on name, birth date and email continues that client's file.
  const existing = await one(db, 'SELECT id FROM bm_clients WHERE erased_at IS NULL AND lower(first_name)=lower(?) AND lower(last_name)=lower(?) AND date_of_birth=? AND lower(email)=?', client.firstName, client.lastName, client.dateOfBirth, client.email)
  const clientId = (existing?.id as string) ?? id(), token = intakeToken(), appointmentId = id(), visitor = { email: client.email, role: 'online booking' }
  await commit(db, null, [
    ...(existing ? [] : [
      stmt(db, "INSERT INTO bm_clients(id,first_name,last_name,date_of_birth,email,phone,created_at,created_via) VALUES(?,?,?,?,?,?,?,'online')", clientId, client.firstName, client.lastName, client.dateOfBirth, client.email, client.phone, now()),
      audit(db, visitor, 'client.created', clientId, clientId, 'online booking'),
    ]),
    ...appointmentStatements(db, visitor, { id: appointmentId, clientId, practitionerId: practitioner.id, serviceId: service.id, startAt: start.toISOString(), endAt: end.toISOString(), bookedVia: 'online', tokenHash: await sha256(token) }),
  ])
  return { appointmentId, clientId, token, startAt: start.toISOString(), practitioner: practitioner.name, service: service.name, timeZone: clinic.time_zone, email: client.email, firstName: client.firstName }
}

/** Staff book an existing client inside the practitioner's hours; the notice and horizon do not apply. */
export async function bookForClient(db: D1Database, who: Actor, input: Data) {
  need(who, 'owner', 'reception', 'practitioner')
  const clinic = await settings(db)
  const { practitioner, service } = await bookable(db, input.practitionerId, input.serviceId)
  insist(who.role === 'owner' || who.staffRole === 'reception' || practitionerId(who) === practitioner.id, 'practitioners_book_their_own_diary', 403)
  const client = await one(db, 'SELECT id FROM bm_clients WHERE id=? AND erased_at IS NULL', text(input.clientId, 'client', 100))
  insist(client, 'client_not_found', 404)
  const minute = text(input.time, 'time', 5)
  insist(/^([01]\d|2[0-3]):[0-5]\d$/.test(minute), 'invalid_time')
  const [hour, min] = minute.split(':').map(Number)
  const candidates = wallClockInstants(day(input.date, 'date'), hour * 60 + min, clinic.time_zone)
  insist(candidates.length === 1, 'ambiguous_or_missing_local_time', 409)
  const start = candidates[0], end = new Date(start.getTime() + service.duration_minutes * 60_000)
  insist(start.getTime() > Date.now() - 86400_000, 'start_too_far_in_past', 409)
  const verdict = checkSlot(await engineInput(db, practitioner.id as string, service.duration_minutes, clinic.time_zone, true), start, end, clinic.time_zone)
  insist(verdict.valid, verdict.exclusions.includes('dial_booking') ? 'practitioner_already_booked' : 'outside_practitioner_hours', 409)
  const token = intakeToken(), appointmentId = id()
  await commit(db, who, appointmentStatements(db, who, { id: appointmentId, clientId: client.id, practitionerId: practitioner.id, serviceId: service.id, startAt: start.toISOString(), endAt: end.toISOString(), bookedVia: 'staff', tokenHash: await sha256(token) }))
  return { appointmentId, token, startAt: start.toISOString() }
}

/** The appointment row the actor may act on, or a 404 for anyone else. */
export async function visibleAppointment(db: D1Database, who: Actor, key: unknown) {
  const row = await one(db, 'SELECT * FROM bm_appointments WHERE id=?', text(key, 'appointment', 100))
  insist(row && (who.role === 'owner' || who.role === 'agent' || who.staffRole === 'reception' || row.practitioner_id === practitionerId(who)), 'appointment_not_found', 404)
  return row
}
export async function setAppointmentStatus(db: D1Database, who: Actor, input: Data, status: 'cancelled' | 'attended' | 'no_show') {
  need(who, 'owner', 'reception', 'practitioner');
  const row = await visibleAppointment(db, who, input.id)
  insist(row.status === 'booked', 'appointment_not_booked', 409)
  if (status !== 'cancelled') insist(Date.parse(row.start_at) <= Date.now() + 3600_000, 'appointment_not_started', 409)
  await commit(db, who, [
    stmt(db, "UPDATE bm_appointments SET status=?,version=version+1 WHERE id=? AND status='booked' AND version=?", status, row.id, row.version),
    guard(db, 'EXISTS(SELECT 1 FROM bm_appointments WHERE id=? AND status=?)', row.id, status),
    audit(db, who, 'appointment.' + status, row.client_id, row.id),
  ])
  return { id: row.id, status }
}
