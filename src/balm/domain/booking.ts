import { phoneNumber } from './us-clinic'
import { evaluateSlot, listAvailableSlots, type AvailabilityConstraints } from '../availability/engine'
import { datePlus, hostDateAt, wallClockInstants, zonedParts } from '../availability/timezone'
import { audit, commit, day, email, guard, human, id, insist, integer, need, now, one, optional, practitionerId, rows, sha256, stmt, text, type Actor, type Data } from './model'

// Online booking rules (Dial's constraint names; Balm fixes them for the first release).
export const onlineRules: AvailabilityConstraints = { durationMinutes: 0, slotIncrementMinutes: 15, minimumNoticeMinutes: 120, bookingHorizonDays: 60, beforeBufferMinutes: 0, afterBufferMinutes: 0, hostDayBookingLimit: null }
export const live = "status IN ('booked','attended')"

/** The clinic's settings; every booking path needs the time zone the owner chose first. */
export async function settings(db: D1Database) {
  const row = (await one(db, 'SELECT * FROM bm_settings WHERE id=1'))!
  insist(row.time_zone, 'clinic_time_zone_not_set', 409)
  return row
}
export async function bookable(db: D1Database, practitionerKey: unknown, serviceKey: unknown) {
  const practitioner = await one(db, "SELECT id,name,profession,version FROM bm_staff WHERE id=? AND role='practitioner' AND active=1 AND erased_at IS NULL", text(practitionerKey, 'practitioner', 100))
  insist(practitioner, 'practitioner_not_found', 404)
  const service = await one(db, 'SELECT * FROM bm_services WHERE id=? AND active=1', text(serviceKey, 'service', 100))
  insist(service, 'service_not_found', 404)
  return { practitioner, service }
}
/** An active room, or null when none is chosen. */
export async function roomFor(db: D1Database, key: unknown) {
  if (key === undefined || key === null || key === '') return null
  const room = await one(db, 'SELECT id,name FROM bm_rooms WHERE id=? AND active=1', text(key, 'room', 100))
  insist(room, 'room_not_found', 404)
  return room.id as string
}
/** Dial's engine input for one practitioner; `exclude` leaves out visits being moved. Online booking offers quarter-hour
 * starts; staff may place a visit at any start time inside the practitioner's hours. */
async function engineInput(db: D1Database, practitioner: string, duration: number, zone: string, staff: boolean, exclude: string[] = []) {
  const [hours, claims] = await Promise.all([
    rows(db, 'SELECT weekday,start_minute AS startMinute,end_minute AS endMinute FROM bm_hours WHERE practitioner_id=?', practitioner),
    rows(db, `SELECT id,start_at AS startAt,end_at AS endAt FROM bm_appointments WHERE practitioner_id=? AND ${live} AND end_at>?`, practitioner, new Date(Date.now() - 86400_000).toISOString()),
  ])
  return {
    hostTimeZone: zone, recurringWindows: hours as any[], overrides: [],
    constraints: { ...onlineRules, durationMinutes: duration, ...(staff ? { enforceMinimumNotice: false, enforceHorizon: false, slotIncrementMinutes: 1 } : {}) },
    internalClaims: claims.filter(c => !exclude.includes(c.id)).map(c => ({ startAt: c.startAt, endAt: c.endAt, hostDate: hostDateAt(new Date(c.startAt), zone) })), calendarBusy: [],
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
/** Same-batch fences: neither the practitioner nor the room holds another live visit then. */
export function placementGuards(db: D1Database, v: { practitionerId: unknown; roomId?: unknown; startAt: string; endAt: string; except?: string }) {
  return [
    guard(db, `NOT EXISTS(SELECT 1 FROM bm_appointments WHERE practitioner_id=? AND ${live} AND start_at<? AND end_at>? AND id<>?)`, v.practitionerId, v.endAt, v.startAt, v.except ?? ''),
    guard(db, "EXISTS(SELECT 1 FROM bm_staff WHERE id=? AND role='practitioner' AND active=1 AND erased_at IS NULL)", v.practitionerId),
    ...(v.roomId ? [
      guard(db, `NOT EXISTS(SELECT 1 FROM bm_appointments WHERE room_id=? AND ${live} AND start_at<? AND end_at>? AND id<>?)`, v.roomId, v.endAt, v.startAt, v.except ?? ''),
      guard(db, 'EXISTS(SELECT 1 FROM bm_rooms WHERE id=? AND active=1)', v.roomId),
    ] : []),
  ]
}
export function appointmentStatements(db: D1Database, who: Actor | { email: string; role: string }, appointment: Data) {
  return [
    // Rechecked in the batch: no other live appointment for this practitioner or room overlaps.
    ...placementGuards(db, appointment as any),
    stmt(db, `INSERT INTO bm_appointments(id,client_id,practitioner_id,service_id,start_at,end_at,status,booked_via,intake_token_hash,created_at,created_by,room_id,series_id,offer_id)
      VALUES(?,?,?,?,?,?,'booked',?,?,?,?,?,?,?)`, appointment.id, appointment.clientId, appointment.practitionerId, appointment.serviceId,
    appointment.startAt, appointment.endAt, appointment.bookedVia, appointment.tokenHash ?? null, now(), who.email, appointment.roomId ?? null, appointment.seriesId ?? null, appointment.offerId ?? null),
    audit(db, who, 'appointment.booked', appointment.clientId, appointment.id, `${appointment.bookedVia}${appointment.seriesId ? ' series' : ''}${appointment.offerId ? ' waitlist offer' : ''} ${appointment.startAt}`),
  ]
}
/** A clinic wall-clock time, HH:MM. */
export function clockMinute(value: unknown) {
  const minute = text(value, 'time', 5)
  insist(/^([01]\d|2[0-3]):[0-5]\d$/.test(minute), 'invalid_time')
  const [hour, min] = minute.split(':').map(Number)
  return hour * 60 + min
}
export type Placement = { start?: Date; end?: Date; problem?: string; clash?: Data }
/** Where a staff-placed visit would land and, if it cannot, why: the same checks booking and moving refuse on. */
export async function placeVisit(db: D1Database, zone: string, v: { practitionerId: string; durationMinutes: number; date: string; minute: number; roomId: string | null; exclude?: string[] }): Promise<Placement> {
  const candidates = wallClockInstants(v.date, v.minute, zone)
  if (candidates.length !== 1) return { problem: 'ambiguous_or_missing_local_time' }
  const start = candidates[0], end = new Date(start.getTime() + v.durationMinutes * 60_000)
  if (start.getTime() <= Date.now() - 86400_000) return { start, end, problem: 'start_too_far_in_past' }
  const verdict = checkSlot(await engineInput(db, v.practitionerId, v.durationMinutes, zone, true, v.exclude), start, end, zone)
  const except = v.exclude ?? []
  const overlapping = (column: string, key: string) => one(db, `SELECT a.id,a.start_at,a.end_at,s.name AS service FROM bm_appointments a JOIN bm_services s ON s.id=a.service_id
    WHERE a.${column}=? AND ${live.replace(/status/, 'a.status')} AND a.start_at<? AND a.end_at>? AND a.id NOT IN (SELECT value FROM json_each(?)) LIMIT 1`, key, end.toISOString(), start.toISOString(), JSON.stringify(except))
  if (verdict.exclusions.includes('dial_booking')) return { start, end, problem: 'practitioner_already_booked', clash: await overlapping('practitioner_id', v.practitionerId) ?? undefined }
  if (!verdict.valid) return { start, end, problem: 'outside_practitioner_hours' }
  if (v.roomId) {
    const clash = await overlapping('room_id', v.roomId)
    if (clash) return { start, end, problem: 'room_in_use', clash }
  }
  return { start, end }
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
  const client = { firstName: text(input.firstName, 'first_name', 80), lastName: text(input.lastName, 'last_name', 80), dateOfBirth: day(input.dateOfBirth, 'date_of_birth'), email: email(input.email), phone: phoneNumber(input.phone) }
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
  const roomId = await roomFor(db, input.roomId)
  const place = await placeVisit(db, clinic.time_zone, { practitionerId: practitioner.id as string, durationMinutes: service.duration_minutes, date: day(input.date, 'date'), minute: clockMinute(input.time), roomId })
  insist(!place.problem, place.problem!, 409)
  const token = intakeToken(), appointmentId = id()
  await commit(db, who, appointmentStatements(db, who, { id: appointmentId, clientId: client.id, practitionerId: practitioner.id, serviceId: service.id, startAt: place.start!.toISOString(), endAt: place.end!.toISOString(), bookedVia: 'staff', tokenHash: await sha256(token), roomId }))
  return { appointmentId, token, startAt: place.start!.toISOString() }
}

/** Move one booked visit to another time, practitioner or room; overlaps and closed hours are refused as at booking. */
export async function moveAppointment(db: D1Database, who: Actor, input: Data) {
  need(who, 'owner', 'reception', 'practitioner'); human(who)
  const row = await visibleAppointment(db, who, input.id)
  insist(row.status === 'booked', 'appointment_not_booked', 409)
  const clinic = await settings(db)
  const target = input.practitionerId ? text(input.practitionerId, 'practitioner', 100) : row.practitioner_id as string
  insist(who.role === 'owner' || who.staffRole === 'reception' || target === row.practitioner_id, 'practitioners_book_their_own_diary', 403)
  const roomId = 'roomId' in input ? await roomFor(db, input.roomId) : row.room_id as string | null
  const duration = Math.round((Date.parse(row.end_at) - Date.parse(row.start_at)) / 60_000)
  const place = await placeVisit(db, clinic.time_zone, { practitionerId: target, durationMinutes: duration, date: day(input.date, 'date'), minute: clockMinute(input.time), roomId, exclude: [row.id] })
  insist(!place.problem, place.problem!, 409)
  const version = input.version === undefined ? row.version : integer(input.version, 'version', 1, Number.MAX_SAFE_INTEGER)
  const startAt = place.start!.toISOString(), endAt = place.end!.toISOString()
  await commit(db, who, [
    guard(db, "EXISTS(SELECT 1 FROM bm_appointments WHERE id=? AND status='booked' AND version=?)", row.id, version),
    ...placementGuards(db, { practitionerId: target, roomId, startAt, endAt, except: row.id }),
    stmt(db, 'UPDATE bm_appointments SET practitioner_id=?,room_id=?,start_at=?,end_at=?,version=version+1 WHERE id=?', target, roomId, startAt, endAt, row.id),
    audit(db, who, 'appointment.moved', row.client_id, row.id, `${row.start_at} -> ${startAt}${target !== row.practitioner_id ? ' new practitioner' : ''}${roomId !== row.room_id ? ' new room' : ''}`),
  ])
  return { id: row.id, startAt, practitionerId: target, roomId }
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
