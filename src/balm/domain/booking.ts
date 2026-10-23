import { ruleChecker, serviceGuards } from '../scheduling/service-rules'
import {manager,locationWrite} from './role-access'
import { bookingCoverage, bookingEstimate } from '../payments/estimate-requests'
import { checkSelfService, selfServiceSnapshot } from '../scheduling/self-service-policy'
import { cancellationStatements, feeProposalStatements, getVisitPolicy } from '../scheduling/policy'
import { allocateIntake } from './intake-requests'
import { episodeChoice } from '../episodes'
import { capacityGuard, capacityOf, liveVisits, medicareOverlaps, medicareStatements, overflow } from '../scheduling/capacity'
import { attendanceStatements } from './attendance'
import { phoneNumber } from './us-clinic'
import { evaluateSlot, listAvailableSlots, type AvailabilityConstraints } from '../availability/engine'
import { datePlus, hostDateAt, wallClockInstants, zonedParts } from '../availability/timezone'
import { audit, commit, day, email, guard, human, id, insist, integer, need, now, one, optional, practitionerId, rows, sha256, stmt, text, DomainError, type Actor, type Data } from './model'

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
/** Active equipment (SCHED-002), or null when the visit needs none. */
export async function equipmentFor(db: D1Database, key: unknown) {
  if (key === undefined || key === null || key === '') return null
  const item = await one(db, 'SELECT id FROM bm_equipment WHERE id=? AND active=1', text(key, 'equipment', 100))
  insist(item, 'equipment_not_found', 404)
  return item.id as string
}
/** Dial's engine input for one practitioner; `exclude` leaves out visits being moved. Online booking offers quarter-hour
 * starts; staff may place a visit at any start time inside the practitioner's hours. */
async function engineInput(db: D1Database, practitioner: string, duration: number, zone: string, staff: boolean, exclude: string[] = [], minimumNoticeMinutes = 120, overlapAllowed = staff, rule?: Awaited<ReturnType<typeof ruleChecker>>) {
  const [hours, claims] = await Promise.all([
    rows(db, 'SELECT weekday,start_minute AS startMinute,end_minute AS endMinute FROM bm_hours WHERE practitioner_id=?', practitioner),
    rows(db, `SELECT id,start_at AS startAt,end_at AS endAt FROM bm_appointments WHERE practitioner_id=? AND ${live} AND end_at>?`, practitioner, new Date(Date.now() - 86400_000).toISOString()),
  ])
  return {
    hostTimeZone: zone, recurringWindows: hours as any[], overrides: [...(rule?.practitionerOverrides ?? []), ...(rule?.location?.time_zone ? [] : JSON.parse(String((await settings(db)).holidays))).map((h: { date: string }) => ({ hostDate: h.date, mode: 'closed' as const, windows: [] }))],
    constraints: { ...onlineRules, minimumNoticeMinutes, durationMinutes: duration, ...(staff ? { enforceMinimumNotice: false, enforceHorizon: false, slotIncrementMinutes: 1 } : {}) },
    // Where overlap is allowed (staff placement, or an online double-booking service) capacity decides instead (SCHED-010).
    internalClaims: claims.filter(c => !overlapAllowed && !exclude.includes(c.id)).map(c => ({ startAt: c.startAt, endAt: c.endAt, hostDate: hostDateAt(new Date(c.startAt), zone) })), calendarBusy: [],
  }
}

/** Public: open slots for one practitioner and service over a week from a clinic-local date. */
export async function openSlots(db: D1Database, input: Data, exclude: string[] = []) {
  const clinic = await settings(db)
  const { practitioner, service } = await bookable(db, input.practitionerId, input.serviceId)
  const selected=await ruleChecker(db,{serviceId:service.id,practitionerId:practitioner.id,roomId:input.roomId,exclude})
  const zone=selected.zone
  const from = input.from ? day(input.from, 'from') : hostDateAt(new Date(), zone)
  const double = service.online_double_booking === 1
  const listed = listAvailableSlots({ ...await engineInput(db, practitioner.id as string, service.duration_minutes, zone, false, exclude, Math.max(120, Number(service.self_book_notice_minutes)), double,selected), fromHostDate: from, days: 7 })
  // SCHED-010: online double-booking offers only times with capacity left.
  let slots = double ? await withCapacity(db, practitioner.id as string, service.id as string, listed, exclude) : listed
  slots=slots.filter(s=>!selected.problem(s.startAt,s.endAt)&&selected.buffers(s.startAt,s.endAt))
  if(input.roomId&&slots.length){const busy=await resourceBusy(db,{id:'',room_id:input.roomId},slots[0].startAt,slots[slots.length-1].endAt);slots=slots.filter(s=>!busy.some(b=>b.start_at<s.endAt&&b.end_at>s.startAt))}
  return { roomId:input.roomId??null, location:selected.location, from, next: datePlus(from, 7), timeZone: zone, practitioner, service, slots: clinic.booking_open === 1 && service.self_book_enabled === 1 ? slots : [] }
}

async function withCapacity<T extends { startAt: string; endAt: string }>(db: D1Database, practitionerId: string, serviceId: string, slots: T[], exclude: string[] = []) {
  if (!slots.length) return slots
  const { capacity } = await capacityOf(db, practitionerId, serviceId)
  const visits = await liveVisits(db, practitionerId, slots[0].startAt, slots[slots.length - 1].endAt, exclude)
  return slots.filter(x => !overflow(visits, capacity, x.startAt, x.endAt))
}
/** Patient doors offer a double-booking time only with capacity left, and never over another Medicare patient's minutes. */
async function patientFits(db: D1Database, clientId: string | null, practitionerId: string, serviceId: string, startAt: string, endAt: string, exclude: string[] = []) {
  if (!(await withCapacity(db, practitionerId, serviceId, [{ startAt, endAt }], exclude)).length) return false
  return !clientId || !(await medicareOverlaps(db, clientId, practitionerId, startAt, endAt, exclude)).length
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
/** Live visits holding a moved visit's room or equipment (SCHED-002); patient doors never offer or take those times. */
export async function resourceBusy(db: D1Database, row: Data, from: string, to: string) {
  if (!row.room_id && !row.equipment_id) return []
  return rows(db, `SELECT start_at,end_at FROM bm_appointments WHERE id<>? AND ${live} AND start_at<? AND end_at>? AND ((room_id IS NOT NULL AND room_id=?) OR (equipment_id IS NOT NULL AND equipment_id=?))`,
    row.id, to, from, row.room_id ?? null, row.equipment_id ?? null)
}
/** Patient moves use the online slot engine, excluding only their existing appointment. */
export async function patientPlacement(db: D1Database, row: Data, input: Data) {
  const clinic = await settings(db), start = instant(input.start)
  const service = (await bookable(db, row.practitioner_id, row.service_id)).service
  const selected=await ruleChecker(db,{serviceId:row.service_id,practitionerId:row.practitioner_id,roomId:row.room_id,exclude:[row.id]})
  const end = new Date(start.getTime() + Date.parse(row.end_at) - Date.parse(row.start_at))
  const double = service.online_double_booking === 1
  const engine = await engineInput(db, row.practitioner_id, Math.round((Date.parse(row.end_at)-Date.parse(row.start_at))/60_000), selected.zone, false, [row.id], Math.max(120, Number(service.self_book_notice_minutes)), double,selected)
  insist(!selected.problem(start.toISOString(),end.toISOString())&&selected.buffers(start.toISOString(),end.toISOString()),'slot_unavailable',409)
  insist(checkSlot(engine, start, end, selected.zone).valid, 'slot_unavailable', 409)
  if (double) insist(await patientFits(db, row.client_id, row.practitioner_id, row.service_id, start.toISOString(), end.toISOString(), [row.id]), 'slot_unavailable', 409)
  insist(!(await resourceBusy(db, row, start.toISOString(), end.toISOString())).length, 'slot_unavailable', 409)
  return { startAt: start.toISOString(), endAt: end.toISOString() }
}
/** Same-batch fences: neither the practitioner, the room nor the equipment holds another live visit then. */
export async function placementGuards(db: D1Database, v: { practitionerId: unknown; serviceId: unknown; roomId?: unknown; equipmentId?: unknown; startAt: string; endAt: string; except?: string }) {
  return [
    guard(db, "NOT EXISTS(SELECT 1 FROM bm_settings,json_each(bm_settings.holidays) h WHERE json_extract(h.value,'$.startAt')<? AND json_extract(h.value,'$.endAt')>?)", v.endAt, v.startAt),
    ...await serviceGuards(db,v),
    capacityGuard(db, v),
    guard(db, "EXISTS(SELECT 1 FROM bm_staff WHERE id=? AND role='practitioner' AND active=1 AND erased_at IS NULL)", v.practitionerId),
    ...(v.roomId ? [
      guard(db, `NOT EXISTS(SELECT 1 FROM bm_appointments WHERE room_id=? AND ${live} AND start_at<? AND end_at>? AND id<>?)`, v.roomId, v.endAt, v.startAt, v.except ?? ''),
      guard(db, 'EXISTS(SELECT 1 FROM bm_rooms WHERE id=? AND active=1)', v.roomId),
    ] : []),
    ...(v.equipmentId ? [
      guard(db, `NOT EXISTS(SELECT 1 FROM bm_appointments WHERE equipment_id=? AND ${live} AND start_at<? AND end_at>? AND id<>?)`, v.equipmentId, v.endAt, v.startAt, v.except ?? ''),
      guard(db, 'EXISTS(SELECT 1 FROM bm_equipment WHERE id=? AND active=1)', v.equipmentId),
    ] : []),
  ]
}
export async function appointmentStatements(db: D1Database, who: Actor | { email: string; role: string }, appointment: Data) {
  return [
    // Rechecked in the batch: no other live appointment for this practitioner or room overlaps.
    ...await placementGuards(db, appointment as any),
    stmt(db, `INSERT INTO bm_appointments(id,client_id,practitioner_id,service_id,start_at,end_at,status,booked_via,intake_token_hash,created_at,created_by,room_id,series_id,offer_id,equipment_id,coverage_choice)
      VALUES(?,?,?,?,?,?,'booked',?,?,?,?,?,?,?,?,?)`, appointment.id, appointment.clientId, appointment.practitionerId, appointment.serviceId,
    appointment.startAt, appointment.endAt, appointment.bookedVia, null, now(), who.email, appointment.roomId ?? null, appointment.seriesId ?? null, appointment.offerId ?? null, appointment.equipmentId ?? null, appointment.coverageChoice ?? 'unknown'),
    ...bookingEstimate(db, who, appointment),
    ...(appointment.tokenHash ? [allocateIntake(db, appointment.id, appointment.clientId, appointment.startAt, appointment.tokenHash)] : []),
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
export async function placeVisit(db: D1Database, zone: string, v: { practitionerId: string; serviceId: string; durationMinutes: number; date: string; minute: number; roomId: string | null; equipmentId?: string | null; exclude?: string[] }): Promise<Placement> {
  let selected:Awaited<ReturnType<typeof ruleChecker>>
  try{selected=await ruleChecker(db,v)}catch(error){if(error instanceof DomainError)return {problem:error.code};throw error}
  const candidates = wallClockInstants(v.date, v.minute, zone)
  if (candidates.length !== 1) return { problem: 'ambiguous_or_missing_local_time' }
  const start = candidates[0], end = new Date(start.getTime() + v.durationMinutes * 60_000)
  if (start.getTime() <= Date.now() - 86400_000) return { start, end, problem: 'start_too_far_in_past' }
  const holiday = JSON.parse(String((await settings(db)).holidays)).find((h: { startAt: string; endAt: string }) => h.startAt < end.toISOString() && h.endAt > start.toISOString())
  if (holiday) return { start, end, problem: 'clinic_holiday', clash: holiday }
  const problem=selected.problem(start.toISOString(),end.toISOString())
  if(problem)return {start,end,problem}
  if(!selected.buffers(start.toISOString(),end.toISOString()))return {start,end,problem:'service_buffer_conflict'}
  const except = v.exclude ?? []
  const overlapping = (column: string, key: string) => one(db, `SELECT a.id,a.start_at,a.end_at,s.name AS service FROM bm_appointments a JOIN bm_services s ON s.id=a.service_id
    WHERE a.${column}=? AND ${live.replace(/status/, 'a.status')} AND a.start_at<? AND a.end_at>? AND a.id NOT IN (SELECT value FROM json_each(?)) LIMIT 1`, key, end.toISOString(), start.toISOString(), JSON.stringify(except))
  // SCHED-010: up to the practitioner's and services' capacity at every instant.
  const { capacity } = await capacityOf(db, v.practitionerId, v.serviceId)
  const full = overflow(await liveVisits(db, v.practitionerId, start.toISOString(), end.toISOString(), except), capacity, start.toISOString(), end.toISOString())
  if (full) return { start, end, problem: 'practitioner_already_booked', clash: await overlapping('practitioner_id', v.practitionerId) ?? undefined }
  if (v.roomId) {
    const clash = await overlapping('room_id', v.roomId)
    if (clash) return { start, end, problem: 'room_in_use', clash }
  }
  if (v.equipmentId) {
    const clash = await overlapping('equipment_id', v.equipmentId)
    if (clash) return { start, end, problem: 'equipment_in_use', clash }
  }
  return { start, end }
}
export function intakeToken() {
  const bytes = crypto.getRandomValues(new Uint8Array(24))
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

/** A practitioner takes on a patient already in their care, or one no practitioner has seen yet. Binds client, practitioner, client. */
const inCare = 'EXISTS(SELECT 1 FROM bm_appointments WHERE client_id=? AND practitioner_id=?) OR NOT EXISTS(SELECT 1 FROM bm_appointments WHERE client_id=?)'

/** The desk books any patient; a practitioner books within their care, so a booking never opens another practitioner's
 * patient. Checked before any warning or preview reads the patient's records; the guards repeat it in the write. */
export async function bookingScope(db: D1Database, who: Actor, clientId: string) {
  const own = who.role === 'owner' ? undefined : practitionerId(who)
  if (!own) return []
  insist(await one(db, `SELECT 1 FROM bm_clients WHERE id=? AND erased_at IS NULL AND (${inCare})`, clientId, clientId, own, clientId), 'client_not_found', 404)
  return [guard(db, inCare, clientId, own, clientId)]
}
/** The patient a staff booking is for, with the booking-scope guards for its write. */
export async function bookingClient(db: D1Database, who: Actor, key: unknown) {
  const client = await one(db, 'SELECT * FROM bm_clients WHERE id=? AND erased_at IS NULL', text(key, 'client', 100))
  insist(client, 'client_not_found', 404)
  return { client, guards: await bookingScope(db, who, client.id as string) }
}

/** Public online booking for a new client. Returns the one-time intake link token. */
export async function bookOnline(db: D1Database, input: Data) {
  const unchanged = await selfServiceSnapshot(db)
  const clinic = await settings(db)
  insist(clinic.booking_open === 1, 'online_booking_closed', 409)
  const { practitioner, service } = await bookable(db, input.practitionerId, input.serviceId)
  const start = instant(input.start), end = new Date(start.getTime() + service.duration_minutes * 60_000)
  const holiday = JSON.parse(String((await settings(db)).holidays)).find((h: { startAt: string; endAt: string }) => h.startAt < end.toISOString() && h.endAt > start.toISOString())
  insist(!holiday, 'clinic_holiday', 409)
  const selected=await ruleChecker(db,{serviceId:service.id,practitionerId:practitioner.id,roomId:input.roomId})
  const double = service.online_double_booking === 1
  insist(!selected.problem(start.toISOString(),end.toISOString())&&selected.buffers(start.toISOString(),end.toISOString()),'slot_unavailable',409)
  const verdict = checkSlot(await engineInput(db, practitioner.id as string, service.duration_minutes, selected.zone, false, [], Math.max(120, Number(service.self_book_notice_minutes)), double,selected), start, end, selected.zone)
  insist(verdict.valid, 'slot_unavailable', 409)
  const client = { firstName: text(input.firstName, 'first_name', 80), lastName: text(input.lastName, 'last_name', 80), dateOfBirth: day(input.dateOfBirth, 'date_of_birth'), email: email(input.email), phone: phoneNumber(input.phone) }
  insist(input.privacy === true || input.privacy === 'on' || input.privacy === 'yes', 'privacy_acknowledgement_required')
  const pending = await one<{ n: number }>(db, `SELECT COUNT(*) AS n FROM bm_appointments a JOIN bm_clients c ON c.id=a.client_id WHERE lower(c.email)=? AND a.status='booked' AND a.start_at>?`, client.email, now())
  insist((pending?.n ?? 0) < 3, 'too_many_online_bookings', 429)
  // An exact match on name, birth date and email continues that client's file.
  const matches = await rows(db, 'SELECT id FROM bm_clients WHERE erased_at IS NULL AND lower(first_name)=lower(?) AND lower(last_name)=lower(?) AND date_of_birth=? AND lower(email)=? LIMIT 2', client.firstName, client.lastName, client.dateOfBirth, client.email)
  insist(matches.length <= 1, 'contact_clinic_about_matching_patient_files', 409)
  const existing = matches[0]
  // A returning patient adds a practitioner from the patient portal, where their email is proven.
  if (existing) insist(await one(db, 'SELECT 1 WHERE ' + inCare, existing.id, practitioner.id, existing.id), 'book_a_new_practitioner_from_the_patient_portal', 409)
  // An address nobody has proven never starts a second file beside the patient who has it: they sign in to the portal.
  const unclaimed = 'NOT EXISTS(SELECT 1 FROM bm_clients WHERE lower(email)=? AND erased_at IS NULL)'
  if (!existing) insist(await one(db, 'SELECT 1 WHERE ' + unclaimed, client.email), 'this_email_is_already_on_a_patient_file', 409)
  if (double) insist(await patientFits(db, existing?.id as string ?? null, practitioner.id as string, service.id as string, start.toISOString(), end.toISOString()), 'slot_unavailable', 409)
  const eligibility = await checkSelfService(db, { clientId: existing?.id as string | undefined, practitionerId: practitioner.id, serviceId: service.id, startAt: start.toISOString() })
  const clientId = (existing?.id as string) ?? id(), token = intakeToken(), appointmentId = id(), visitor = { email: client.email, role: 'online booking' }
  await commit(db, null, [
    unchanged, ...eligibility.guards,
    guard(db, `((SELECT COUNT(*) FROM bm_appointments a JOIN bm_clients c ON c.id=a.client_id WHERE lower(c.email)=? AND a.status='booked' AND a.start_at>?)<3)`, client.email, now()),
    ...(existing ? [guard(db, inCare, existing.id, practitioner.id, existing.id)] : [
      guard(db, unclaimed, client.email),
      stmt(db, "INSERT INTO bm_clients(id,first_name,last_name,date_of_birth,email,phone,created_at,created_via) VALUES(?,?,?,?,?,?,?,'online')", clientId, client.firstName, client.lastName, client.dateOfBirth, client.email, client.phone, now()),
      audit(db, visitor, 'client.created', clientId, clientId, 'online booking'),
    ]),
    ...await appointmentStatements(db, visitor, { id: appointmentId, clientId, practitionerId: practitioner.id, serviceId: service.id, startAt: start.toISOString(), endAt: end.toISOString(), bookedVia: 'online', roomId:await roomFor(db,input.roomId), tokenHash: await sha256(token), ...bookingCoverage(input), timeZone:clinic.time_zone }),
  ])
  return { appointmentId, clientId, token, startAt: start.toISOString(), practitioner: practitioner.name, service: service.name, timeZone: clinic.time_zone, email: client.email, firstName: client.firstName }
}

/** Staff book an existing client inside the practitioner's hours; the notice and horizon do not apply. */
export async function bookForClient(db: D1Database, who: Actor, input: Data) {
  need(who, 'owner', 'reception', 'practitioner')
  const clinic = await settings(db)
  const { practitioner, service } = await bookable(db, input.practitionerId, input.serviceId)
  insist(who.role === 'owner' || who.staffRole === 'reception' || practitionerId(who) === practitioner.id, 'practitioners_book_their_own_diary', 403)
  const { client, guards } = await bookingClient(db, who, input.clientId)
  const roomId = await roomFor(db, input.roomId), equipmentId = await equipmentFor(db, input.equipmentId)
  const locationGuards=await locationWrite(db,who,roomId,client.id)
  const place = await placeVisit(db, clinic.time_zone, { practitionerId: practitioner.id as string, serviceId: service.id as string, durationMinutes: service.duration_minutes, date: day(input.date, 'date'), minute: clockMinute(input.time), roomId, equipmentId })
  insist(!place.problem, place.problem!, 409)
  const token = intakeToken(), appointmentId = id()
  const filing = await episodeChoice(db, who, client.id as string, 'visit', appointmentId, input.episodeId)
  filing.push(...await medicareStatements(db, who, { clientId: client.id as string, practitionerId: practitioner.id as string, startAt: place.start!.toISOString(), endAt: place.end!.toISOString(), appointmentId }, input.acknowledgeMedicareOverlap))
  await commit(db, who, [...guards,...locationGuards,...await appointmentStatements(db, who, { id: appointmentId, clientId: client.id, practitionerId: practitioner.id, serviceId: service.id, startAt: place.start!.toISOString(), endAt: place.end!.toISOString(), bookedVia: 'staff', tokenHash: await sha256(token), roomId, equipmentId, ...bookingCoverage(input), timeZone:clinic.time_zone }), ...filing])
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
  const equipmentId = 'equipmentId' in input ? await equipmentFor(db, input.equipmentId) : row.equipment_id as string | null
  const locationGuards=await locationWrite(db,who,roomId)
  const duration = Math.round((Date.parse(row.end_at) - Date.parse(row.start_at)) / 60_000)
  const place = await placeVisit(db, clinic.time_zone, { practitionerId: target, serviceId: row.service_id, durationMinutes: duration, date: day(input.date, 'date'), minute: clockMinute(input.time), roomId, equipmentId, exclude: [row.id] })
  insist(!place.problem, place.problem!, 409)
  const medicare = await medicareStatements(db, who, { clientId: row.client_id, practitionerId: target, startAt: place.start!.toISOString(), endAt: place.end!.toISOString(), appointmentId: row.id, except: [row.id] }, input.acknowledgeMedicareOverlap)
  const version = input.version === undefined ? row.version : integer(input.version, 'version', 1, Number.MAX_SAFE_INTEGER)
  const startAt = place.start!.toISOString(), endAt = place.end!.toISOString()
  await commit(db, who, [
    ...await locationWrite(db,who,row.room_id),...locationGuards,
    guard(db, "EXISTS(SELECT 1 FROM bm_appointments WHERE id=? AND status='booked' AND version=?)", row.id, version),
    ...await placementGuards(db, { practitionerId: target, serviceId: row.service_id, roomId, equipmentId, startAt, endAt, except: row.id }),
    stmt(db, 'UPDATE bm_appointments SET practitioner_id=?,room_id=?,equipment_id=?,start_at=?,end_at=?,version=version+1 WHERE id=?', target, roomId, equipmentId, startAt, endAt, row.id),
    ...medicare,
    audit(db, who, 'appointment.moved', row.client_id, row.id, `${row.start_at} -> ${startAt}${target !== row.practitioner_id ? ' new practitioner' : ''}${roomId !== row.room_id ? ' new room' : ''}${equipmentId !== row.equipment_id ? ' new equipment' : ''}`),
  ])
  return { id: row.id, startAt, practitionerId: target, roomId, equipmentId }
}

/** The appointment row the actor may act on, or a 404 for anyone else. */
export async function visibleAppointment(db: D1Database, who: Actor, key: unknown) {
  const row = await one(db, 'SELECT * FROM bm_appointments WHERE id=?', text(key, 'appointment', 100))
  insist(row && (who.role === 'owner' || who.role === 'agent' || who.staffRole === 'reception' || row.practitioner_id === practitionerId(who)), 'appointment_not_found', 404)
  await locationWrite(db,who,row.room_id)
  return row
}
export async function setAppointmentStatus(db: D1Database, who: Actor, input: Data, status: 'cancelled' | 'attended' | 'no_show') {
  need(who, 'owner', 'reception', 'practitioner'); human(who)
  const row = await visibleAppointment(db, who, input.id)
  insist(row.status === 'booked', 'appointment_not_booked', 409)
  if (status !== 'cancelled') insist(Date.parse(row.start_at) <= Date.now() + 3600_000, 'appointment_not_started', 409)
  insist(!manager(who)||status==='cancelled','location_manager_action_refused',403)
  const started = status === 'attended' ? await attendanceStatements(db, who, row) : []
  const policy = await getVisitPolicy(db)
  const policyWrites = status === 'cancelled' ? cancellationStatements(db, who, row, input.reason, policy) : status === 'no_show' ? feeProposalStatements(db, who, row, status, policy) : []
  await commit(db, who, [
    ...await locationWrite(db,who,row.room_id),
    guard(db, "EXISTS(SELECT 1 FROM bm_appointments WHERE id=? AND status='booked' AND version=?)", row.id, row.version),
    stmt(db, "UPDATE bm_appointments SET status=?,version=version+1 WHERE id=? AND status='booked' AND version=?", status, row.id, row.version),
    guard(db, 'changes()=1'),
    ...started,
    ...policyWrites,
    audit(db, who, 'appointment.' + status, row.client_id, row.id),
  ])
  return { id: row.id, status }
}
