// SCHED-010 practitioner capacity. At every instant a practitioner may carry as many
// live (booked or attended) visits as the lowest of their own capacity and the
// capacity of each visit's service there; both default to 1, so overlap stays refused
// until the owner raises both. The same rule runs in code (to offer and explain) and in
// the D1 batch that inserts or moves a visit (so two people racing get one booking).
import { hostDateAt } from '../availability/timezone'
import { DomainError, audit, commit, guard, human, insist, integer, need, now, one, rows, stmt, text, type Actor, type Data } from '../domain/model'

const live = "status IN ('booked','attended')"
type Visit = { id: string; start_at: string; end_at: string; capacity: number }

/** The first visit already there at an instant where one more would exceed capacity, or null. */
export function overflow(others: Visit[], capacity: number, startAt: string, endAt: string) {
  const inside = others.filter(o => o.start_at < endAt && o.end_at > startAt)
  for (const t of [startAt, ...inside.map(o => o.start_at).filter(t => t > startAt)]) {
    const there = inside.filter(o => o.start_at <= t && o.end_at > t)
    if (there.length + 1 > Math.min(capacity, ...there.map(o => Number(o.capacity)))) return there[0]
  }
  return null
}

export async function capacityOf(db: D1Database, practitionerId: string, serviceId: string) {
  const row = await one(db, 'SELECT MIN(p.capacity,s.capacity) AS capacity,s.online_double_booking FROM bm_staff p,bm_services s WHERE p.id=? AND s.id=?', practitionerId, serviceId)
  return { capacity: Number(row?.capacity ?? 1), onlineDoubleBooking: row?.online_double_booking === 1 }
}

/** A practitioner's live visits over a span, with their services' capacities. */
export const liveVisits = (db: D1Database, practitionerId: string, from: string, to: string, except: string[] = []) => rows<Visit & Data>(db,
  `SELECT a.id,a.start_at,a.end_at,s.capacity,s.name AS service FROM bm_appointments a JOIN bm_services s ON s.id=a.service_id
   WHERE a.practitioner_id=? AND a.${live} AND a.start_at<? AND a.end_at>? AND a.id NOT IN (SELECT value FROM json_each(?)) ORDER BY a.start_at,a.id`, practitionerId, to, from, JSON.stringify(except))

/** The same rule as `overflow`, rechecked inside the batch that writes the visit. */
export function capacityGuard(db: D1Database, v: { practitionerId: unknown; serviceId: unknown; startAt: string; endAt: string; except?: string }) {
  const at = `a.practitioner_id=?1 AND a.${live} AND a.start_at<=p.t AND a.end_at>p.t AND a.id<>?4`
  return guard(db, `NOT EXISTS(SELECT 1 FROM (SELECT ?2 AS t UNION SELECT start_at FROM bm_appointments a WHERE a.practitioner_id=?1 AND a.${live} AND a.start_at>?2 AND a.start_at<?3 AND a.id<>?4) p
    WHERE (SELECT COUNT(*) FROM bm_appointments a WHERE ${at})+1 > MIN((SELECT capacity FROM bm_staff WHERE id=?1),(SELECT capacity FROM bm_services WHERE id=?5),
      COALESCE((SELECT MIN(s.capacity) FROM bm_appointments a JOIN bm_services s ON s.id=a.service_id WHERE ${at}),10)))`,
  v.practitionerId, v.startAt, v.endAt, v.except ?? '', v.serviceId)
}

/** Medicare Part B patients: a primary policy with a Medicare payer covering the visit date. */
const medicareOn = (clientColumn: string) => `EXISTS(SELECT 1 FROM bm_policies p JOIN bm_payers y ON y.id=p.payer_id WHERE p.client_id=${clientColumn} AND p.priority=1 AND y.medicare=1 AND p.starts_on<=?d AND (p.ends_on IS NULL OR p.ends_on='' OR p.ends_on>=?d))`

/** Other Medicare patients' live visits with this practitioner over the same minutes, when this patient is a Medicare patient too. */
export async function medicareOverlaps(db: D1Database, clientId: string, practitionerId: string, startAt: string, endAt: string, except: string[] = []) {
  const zone = (await one(db, 'SELECT time_zone FROM bm_settings WHERE id=1'))!.time_zone as string, date = hostDateAt(new Date(startAt), zone)
  const sql = (s: string) => s.replace(/\?d/g, `'${date}'`)
  if (!await one(db, sql(`SELECT 1 WHERE ${medicareOn('?')}`), clientId)) return []
  return (await rows(db, sql(`SELECT a.id FROM bm_appointments a WHERE a.practitioner_id=? AND a.${live} AND a.start_at<? AND a.end_at>? AND a.client_id<>?
    AND a.id NOT IN (SELECT value FROM json_each(?)) AND ${medicareOn('a.client_id')}`), practitionerId, endAt, startAt, clientId, JSON.stringify(except))).map(r => r.id as string)
}

/** Staff are warned before saving; booking anyway records who decided on both visits. Patient doors never overlap two Medicare patients. */
export async function medicareStatements(db: D1Database, who: Actor, v: { clientId: string; practitionerId: string; startAt: string; endAt: string; appointmentId: string; except?: string[] }, acknowledged: unknown) {
  const others = await medicareOverlaps(db, v.clientId, v.practitionerId, v.startAt, v.endAt, v.except)
  if (!others.length) return []
  if (!(acknowledged === true || acknowledged === 'on')) throw new DomainError('medicare_overlap_warning', 409, { medicareOverlap: { count: others.length } })
  const clients = await rows(db, 'SELECT id,client_id FROM bm_appointments WHERE id IN (SELECT value FROM json_each(?))', JSON.stringify(others)), at = now()
  return clients.flatMap(o => [
    stmt(db, 'INSERT OR IGNORE INTO bm_medicare_overlaps(appointment_id,other_appointment_id,client_id,acknowledged_by,acknowledged_at) VALUES(?,?,?,?,?)', v.appointmentId, o.id, v.clientId, who.email, at),
    stmt(db, 'INSERT OR IGNORE INTO bm_medicare_overlaps(appointment_id,other_appointment_id,client_id,acknowledged_by,acknowledged_at) VALUES(?,?,?,?,?)', o.id, v.appointmentId, o.client_id, who.email, at),
    audit(db, who, 'appointment.medicare_overlap_booked', v.clientId, v.appointmentId, 'overlaps another Medicare patient; one-on-one timed codes cannot be billed for both'),
    audit(db, who, 'appointment.medicare_overlap_booked', o.client_id as string, o.id as string, 'overlaps another Medicare patient; one-on-one timed codes cannot be billed for both'),
  ])
}

/** Owner settings: a practitioner's capacity, and a service's capacity and online double-booking. */
export async function saveCapacity(db: D1Database, who: Actor, input: Data) {
  human(who); need(who, 'owner')
  const capacity = integer(input.capacity, 'capacity', 1, 10)
  if (input.practitionerId) {
    const key = text(input.practitionerId, 'practitioner', 100)
    insist(await one(db, "SELECT 1 FROM bm_staff WHERE id=? AND role='practitioner' AND erased_at IS NULL", key), 'practitioner_not_found', 404)
    await commit(db, who, [stmt(db, 'UPDATE bm_staff SET capacity=? WHERE id=?', capacity, key), audit(db, who, 'capacity.practitioner_saved', null, key, String(capacity))])
    return { practitionerId: key, capacity }
  }
  const key = text(input.serviceId, 'service', 100), online = input.onlineDoubleBooking === true || input.onlineDoubleBooking === 'on' || input.onlineDoubleBooking === 'true'
  insist(await one(db, 'SELECT 1 FROM bm_services WHERE id=?', key), 'service_not_found', 404)
  await commit(db, who, [stmt(db, 'UPDATE bm_services SET capacity=?,online_double_booking=? WHERE id=?', capacity, online ? 1 : 0, key), audit(db, who, 'capacity.service_saved', null, key, `${capacity}${online ? ' online double-booking' : ''}`)])
  return { serviceId: key, capacity, onlineDoubleBooking: online }
}
