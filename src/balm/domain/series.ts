import { bookingCoverage } from '../payments/estimate-requests'
import { cancellationStatements, getVisitPolicy } from '../scheduling/policy'
// Recurring visits: one request books a whole series (e.g. twice a week for six
// weeks). Every date is checked before anything is saved; a date that would
// overlap or fall outside hours is shown, and the series saves only when each
// such date was moved to a free time or skipped by a person, never dropped.
import { datePlus, hostDateAt, weekdayForDate } from '../availability/timezone'
import { medicareStatements } from '../scheduling/capacity'
import { appointmentStatements, bookable, clockMinute, intakeToken, placementGuards, placeVisit, roomFor, settings, visibleAppointment } from './booking'
import { audit, commit, day, DomainError, guard, human, id, insist, integer, need, one, practitionerId, rows, sha256, stmt, text, type Actor, type Data } from './model'

const maxVisits = 366
type Occurrence = { date: string; time: string; skip: boolean; startAt?: string; endAt?: string; problem?: string; clash?: Data }
const clock = (minute: number) => `${String(Math.floor(minute / 60)).padStart(2, '0')}:${String(minute % 60).padStart(2, '0')}`

function weekdaysFrom(input: Data) {
  const raw = Array.isArray(input.weekdays) ? input.weekdays : typeof input.weekdays === 'string' ? input.weekdays.split(',') : [0, 1, 2, 3, 4, 5, 6].filter(d => input['weekday_' + d] === 'on')
  const days = [...new Set(raw.map((d: unknown) => integer(d, 'weekday', 0, 6)))].sort() as number[]
  insist(days.length > 0, 'choose_at_least_one_weekday')
  return days
}
/** The pattern's dates: each chosen weekday from the first date, for the number of weeks. */
function patternDates(first: string, weekdays: number[], weeks: number) {
  const dates = []
  for (let offset = 0; offset < weeks * 7; offset++) {
    const date = datePlus(first, offset)
    if (weekdays.includes(weekdayForDate(date))) dates.push(date)
  }
  return dates
}
/** The occurrences a person reviewed (date_N, time_N, skip_N from the preview form, or an `occurrences` array). */
function reviewed(input: Data): { date: string; time: string; skip: boolean }[] | null {
  const list = Array.isArray(input.occurrences) ? input.occurrences
    : Object.keys(input).filter(k => /^date_\d+$/.test(k)).sort((a, b) => +a.slice(5) - +b.slice(5)).map(k => ({ date: input[k], time: input['time_' + k.slice(5)], skip: input['skip_' + k.slice(5)] }))
  if (!list.length) return null
  insist(list.length <= maxVisits, 'too_many_visits_in_one_series')
  return list.map((o: Data) => ({ date: day(o?.date, 'date'), time: clock(clockMinute(o?.time)), skip: o?.skip === true || o?.skip === 'on' || o?.skip === 'yes' }))
}

async function basis(db: D1Database, who: Actor, input: Data) {
  need(who, 'owner', 'reception', 'practitioner'); human(who)
  const clinic = await settings(db)
  const { practitioner, service } = await bookable(db, input.practitionerId, input.serviceId)
  insist(who.role === 'owner' || who.staffRole === 'reception' || practitionerId(who) === practitioner.id, 'practitioners_book_their_own_diary', 403)
  const client = await one(db, 'SELECT id,first_name,last_name FROM bm_clients WHERE id=? AND erased_at IS NULL', text(input.clientId, 'client', 100))
  insist(client, 'client_not_found', 404)
  const plan = input.planId ? await one(db, 'SELECT id,content,content_sha256 FROM bm_plans_of_care WHERE id=? AND client_id=? AND author_id=?', text(input.planId, 'plan', 100), client.id, practitioner.id) : null
  if (input.planId) {
    insist(who.role === 'owner' || !!practitionerId(who), 'plans_are_clinical', 403)
    insist(plan, 'plan_of_care_not_found', 404)
  }
  const content = plan ? JSON.parse(plan.content as string) : null
  const weekdays = weekdaysFrom(input), weeks = content ? content.durationWeeks : integer(input.weeks, 'weeks', 1, 52), firstDate = content ? content.startDate : day(input.firstDate, 'first_date'), time = clock(clockMinute(input.time))
  if (content) {
    insist(weekdays.length === content.frequencyPerWeek, 'choose_the_plan_frequency_of_weekdays')
    await commit(db, who, [audit(db, who, 'plan.read', client.id as string, plan!.id as string)])
  }
  return { coverage:bookingCoverage(input), zone: clinic.time_zone as string, practitioner, service, client, roomId: await roomFor(db, input.roomId), pattern: { firstDate, weekdays, weeks, time, ...(plan ? { planId: plan.id, planSha256: plan.content_sha256 } : {}) } }
}

async function check(db: D1Database, b: Awaited<ReturnType<typeof basis>>, list: { date: string; time: string; skip: boolean }[]) {
  const checked: Occurrence[] = [], kept: { start: number; end: number }[] = []
  for (const o of list) {
    const place = await placeVisit(db, b.zone, { practitionerId: b.practitioner.id as string, serviceId: b.service.id as string, durationMinutes: b.service.duration_minutes, date: o.date, minute: clockMinute(o.time), roomId: b.roomId })
    const occurrence: Occurrence = { ...o, startAt: place.start?.toISOString(), endAt: place.end?.toISOString(), ...(place.problem ? { problem: place.problem } : {}), ...(place.clash ? { clash: place.clash } : {}) }
    if (!occurrence.problem && place.start && kept.some(k => k.start < place.end!.getTime() && k.end > place.start!.getTime())) occurrence.problem = 'overlaps_another_visit_in_this_series'
    if (!occurrence.problem && !o.skip && place.start) kept.push({ start: place.start.getTime(), end: place.end!.getTime() })
    checked.push(occurrence)
  }
  return checked
}

function summary(b: Awaited<ReturnType<typeof basis>>, occurrences: Occurrence[]) {
  return { clientId: b.client.id, client: `${b.client.first_name} ${b.client.last_name}`, practitionerId: b.practitioner.id, practitioner: b.practitioner.name, serviceId: b.service.id, service: b.service.name,
    roomId: b.roomId, ...b.coverage, timeZone: b.zone, pattern: b.pattern, occurrences, conflicts: occurrences.filter(o => o.problem && !o.skip).length }
}

/** Every date of a series with its verdict; nothing is saved. */
export async function previewSeries(db: D1Database, who: Actor, input: Data) {
  const b = await basis(db, who, input)
  const list = reviewed(input) ?? patternDates(b.pattern.firstDate, b.pattern.weekdays, b.pattern.weeks).map(date => ({ date, time: b.pattern.time, skip: false }))
  insist(list.length > 0, 'no_dates_in_this_pattern')
  insist(list.length <= maxVisits, 'too_many_visits_in_one_series')
  return { preview: true, ...summary(b, await check(db, b, list)) }
}

/** Books every reviewed date in one batch, or nothing while any unskipped date conflicts. */
export async function bookSeries(db: D1Database, who: Actor, input: Data) {
  const b = await basis(db, who, input)
  const list = reviewed(input)
  insist(list, 'review_the_dates_first')
  if (b.pattern.planId) insist(list.length === patternDates(b.pattern.firstDate, b.pattern.weekdays, b.pattern.weeks).length, 'review_every_plan_visit')
  const occurrences = await check(db, b, list)
  const result = summary(b, occurrences)
  if (result.conflicts) throw new DomainError('series_has_conflicts', 409, { preview: true, ...result })
  const kept = occurrences.filter(o => !o.skip), skipped = occurrences.filter(o => o.skip).map(o => o.date)
  insist(kept.length > 0, 'every_date_is_skipped')
  const seriesId = id(), token = intakeToken(), ids = kept.map(() => id())
  const medicare = (await Promise.all(kept.map((o, i) => medicareStatements(db, who, { clientId: b.client.id as string, practitionerId: b.practitioner.id as string, startAt: o.startAt!, endAt: o.endAt!, appointmentId: ids[i] }, input.acknowledgeMedicareOverlap)))).flat()
  await commit(db, who, [
    stmt(db, 'INSERT INTO bm_series(id,client_id,practitioner_id,service_id,room_id,pattern,skipped,created_at,created_by) VALUES(?,?,?,?,?,?,?,?,?)',
      seriesId, b.client.id, b.practitioner.id, b.service.id, b.roomId, JSON.stringify(b.pattern), JSON.stringify(skipped), new Date().toISOString(), who.email),
    // The intake link goes with the first visit only.
    ...(await Promise.all(kept.map(async (o, i) => appointmentStatements(db, who, { id: ids[i], clientId: b.client.id, practitionerId: b.practitioner.id, serviceId: b.service.id,
      startAt: o.startAt, endAt: o.endAt, bookedVia: 'staff', tokenHash: i === 0 ? await sha256(token) : null, roomId: b.roomId, seriesId, ...b.coverage, timeZone:b.zone })))).flat(),
    ...medicare,
    audit(db, who, 'series.booked', b.client.id as string, seriesId, `${kept.length} visits, ${skipped.length} skipped`),
  ])
  return { seriesId, booked: kept.length, skipped, appointmentIds: ids, appointmentId: ids[0], token, startAt: kept[0].startAt, clientId: b.client.id }
}

async function rest(db: D1Database, who: Actor, input: Data) {
  need(who, 'owner', 'reception', 'practitioner'); human(who)
  const row = await visibleAppointment(db, who, input.appointmentId)
  insist(row.series_id, 'not_part_of_a_series', 409)
  insist(row.status === 'booked', 'appointment_not_booked', 409)
  const later = await rows(db, "SELECT * FROM bm_appointments WHERE series_id=? AND status='booked' AND (? OR start_at>=?) ORDER BY start_at", row.series_id, input.scope === 'all' ? 1 : 0, row.start_at)
  insist(who.role === 'owner' || who.staffRole === 'reception' || later.every(a => a.practitioner_id === practitionerId(who)), 'practitioners_book_their_own_diary', 403)
  return { row, later }
}

/** Cancels this visit and every later booked visit in its series. */
export async function cancelRest(db: D1Database, who: Actor, input: Data) {
  const { row, later } = await rest(db, who, input)
  const policy = await getVisitPolicy(db), reason = text(input.reason, 'cancellation_reason', 500)
  await commit(db, who, [
    ...later.flatMap(a => [
      guard(db, "EXISTS(SELECT 1 FROM bm_appointments WHERE id=? AND status='booked' AND version=?)", a.id, a.version),
      stmt(db, "UPDATE bm_appointments SET status='cancelled',version=version+1 WHERE id=?", a.id),
      audit(db, who, 'appointment.cancelled', a.client_id, a.id, 'rest of series'),
      ...cancellationStatements(db, who, a, reason, policy),
    ]),
    audit(db, who, 'series.cancelled_rest', row.client_id, row.series_id, `${later.length} visits`),
  ])
  return { seriesId: row.series_id, cancelled: later.map(a => a.id) }
}

/** Moves this visit and every later one in the series to a new time (and practitioner or room); any conflict refuses all. */
export async function moveRest(db: D1Database, who: Actor, input: Data) {
  const { row, later } = await rest(db, who, input)
  const clinic = await settings(db), minute = clockMinute(input.time)
  const target = input.practitionerId ? text(input.practitionerId, 'practitioner', 100) : row.practitioner_id as string
  insist(who.role === 'owner' || who.staffRole === 'reception' || target === row.practitioner_id, 'practitioners_book_their_own_diary', 403)
  const roomId = 'roomId' in input ? await roomFor(db, input.roomId) : row.room_id as string | null
  const exclude = later.map(a => a.id as string), occurrences: (Occurrence & { id: string; version: number; equipmentId: string | null })[] = []
  for (const a of later) {
    const date = hostDateAt(new Date(a.start_at), clinic.time_zone)
    const place = await placeVisit(db, clinic.time_zone, { practitionerId: target, serviceId: a.service_id, durationMinutes: Math.round((Date.parse(a.end_at) - Date.parse(a.start_at)) / 60_000), date, minute, roomId, equipmentId: a.equipment_id, exclude })
    occurrences.push({ id: a.id, version: a.version, equipmentId: a.equipment_id, date, time: clock(minute), skip: false, startAt: place.start?.toISOString(), endAt: place.end?.toISOString(), ...(place.problem ? { problem: place.problem, clash: place.clash } : {}) })
  }
  const conflicts = occurrences.filter(o => o.problem)
  if (conflicts.length) throw new DomainError('series_has_conflicts', 409, { moveRest: true, occurrences, conflicts: conflicts.length })
  // SCHED-010: moving over another Medicare patient's minutes needs the same acknowledgement as booking.
  const medicare = new Map<string, D1PreparedStatement[]>()
  for (const o of occurrences) medicare.set(o.id, await medicareStatements(db, who, { clientId: row.client_id, practitionerId: target, startAt: o.startAt!, endAt: o.endAt!, appointmentId: o.id, except: exclude }, input.acknowledgeMedicareOverlap))
  await commit(db, who, [
    ...occurrences.flatMap(o => [
      guard(db, "EXISTS(SELECT 1 FROM bm_appointments WHERE id=? AND status='booked' AND version=?)", o.id, o.version),
      ...placementGuards(db, { practitionerId: target, serviceId: row.service_id, roomId, equipmentId: o.equipmentId, startAt: o.startAt!, endAt: o.endAt!, except: o.id }),
      ...medicare.get(o.id)!,
      stmt(db, 'UPDATE bm_appointments SET practitioner_id=?,room_id=?,start_at=?,end_at=?,version=version+1 WHERE id=?', target, roomId, o.startAt, o.endAt, o.id),
      audit(db, who, 'appointment.moved', row.client_id, o.id, `rest of series; ${o.startAt}`),
    ]),
    audit(db, who, 'series.moved_rest', row.client_id, row.series_id, `${occurrences.length} visits to ${clock(minute)}`),
  ])
  return { seriesId: row.series_id, moved: occurrences.length, appointmentIds: occurrences.map(o => o.id) }
}
