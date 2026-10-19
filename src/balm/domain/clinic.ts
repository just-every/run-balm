// @ts-ignore The pinned Base module is JavaScript without declarations.
import { createPortability } from '@runeditrun/rer/modules/portability'
// @ts-ignore The CLI and Worker share this JavaScript archive policy.
import archivePolicy from '../archive-policy.mjs'
import { holidayRanges } from './holidays'
import { clinicIdentity } from './us-clinic'
import { template } from '../charting/templates'
import { validNpi } from '../payments/codes'
import { audit, commit, email, guard, human, id, insist, integer, need, now, one, optional, sha256, stmt, text, type Actor, type Data } from './model'

export function validTimeZone(value: unknown) {
  const zone = text(value, 'time_zone', 64)
  try { new Intl.DateTimeFormat('en-US', { timeZone: zone }).format(0) } catch { insist(false, 'invalid_time_zone') }
  return zone
}

export async function saveSettings(db: D1Database, who: Actor, input: Data) {
  need(who, 'owner'); human(who)
  const current = await one(db, 'SELECT * FROM bm_settings WHERE id=1')
  const zone = validTimeZone(input.timeZone)
  // Booked visits are stored as exact moments, so they keep their moment and show
  // in the new zone; weekly hours stay clock times. The owner confirms that change
  // when upcoming visits would show at new clock times.
  if (zone !== current!.time_zone && await one(db, "SELECT 1 FROM bm_appointments WHERE status='booked' AND end_at>? LIMIT 1", now())) {
    insist(input.confirmTimeZone === 'on' || input.confirmTimeZone === true, 'confirm_the_time_zone_change', 409)
  }
  const identity = clinicIdentity(input, current!)
  const values = [text(input.clinicName, 'clinic_name', 120), zone, identity.taxId, identity.address, input.bookingOpen === false || input.bookingOpen === 'false' ? 0 : 1, identity.taxType, identity.npi, identity.street, identity.city, identity.state, identity.zip]
  await commit(db, who, [
    guard(db, 'EXISTS(SELECT 1 FROM bm_settings WHERE id=1 AND version=?)', current!.version),
    stmt(db, 'UPDATE bm_settings SET clinic_name=?,time_zone=?,abn=?,address=?,booking_open=?,tax_id_type=?,practice_npi=?,street_address=?,city=?,state=?,postal_code=?,time_zone_chosen=1,version=version+1 WHERE id=1', ...values),
    stmt(db, 'UPDATE bm_settings SET holidays=? WHERE id=1', JSON.stringify(holidayRanges(JSON.parse(current!.holidays as string), zone))),
    audit(db, who, 'settings.saved', null, null, zone !== current!.time_zone ? `time zone ${current!.time_zone} to ${zone}` : ''),
  ])
  return { saved: true }
}

export async function saveStaff(db: D1Database, who: Actor, input: Data) {
  need(who, 'owner'); human(who)
  const previous = input.id ? await one(db, 'SELECT * FROM bm_staff WHERE id=? AND erased_at IS NULL', text(input.id, 'id', 100)) : null
  if (input.id) insist(previous, 'staff_not_found', 404)
  const address = email(input.email), role = input.role ?? previous?.role ?? 'practitioner'
  insist(role === 'practitioner' || role === 'reception', 'invalid_role')
  const active = input.active === undefined ? (previous ? previous.active : 1) : (input.active === true || input.active === 'true' ? 1 : 0)
  insist(!await one(db, 'SELECT 1 FROM bm_staff WHERE lower(email)=? AND id<>?', address, previous?.id ?? ''), 'email_already_used', 409)
  const identity = await sha256('staff:' + address)
  const staffId = previous?.id ?? id(), providerNumber = optional(input.providerNumber, 'provider_number', 40) ?? ''
  await commit(db, who, [
    guard(db, 'NOT EXISTS(SELECT 1 FROM bm_erasure_journal WHERE identity_hash=?)', identity),
    ...(previous ? [guard(db, 'EXISTS(SELECT 1 FROM bm_staff WHERE id=? AND version=?)', previous.id, input.version === undefined ? previous.version : integer(input.version, 'version', 1, Number.MAX_SAFE_INTEGER))] : []),
    stmt(db, `INSERT INTO bm_staff(id,name,email,role,profession,provider_number,credentials,active,version) VALUES(?,?,?,?,?,?,?,?,1)
      ON CONFLICT(id) DO UPDATE SET name=excluded.name,email=excluded.email,role=excluded.role,profession=excluded.profession,
      provider_number=excluded.provider_number,credentials=excluded.credentials,active=excluded.active,version=bm_staff.version+1`,
    staffId, text(input.name, 'name', 160), address, role, optional(input.profession, 'profession', 80) ?? '', providerNumber,
    input.credentials === undefined ? previous?.credentials ?? '' : optional(input.credentials, 'credentials', 60) ?? '', active),
    // A provider number that is an NPI also fills the practitioner's empty NPI (Billing identifiers), so it is asked once.
    ...(role === 'practitioner' && validNpi(providerNumber) ? [stmt(db, "UPDATE bm_staff SET npi=? WHERE id=? AND npi=''", providerNumber, staffId)] : []),
    audit(db, who, previous ? 'staff.updated' : 'staff.added', null, staffId),
  ])
  return { id: staffId, name: input.name, email: address, role, active: !!active }
}

export async function saveService(db: D1Database, who: Actor, input: Data) {
  need(who, 'owner'); human(who)
  const serviceId = input.id ? text(input.id, 'id', 100) : id()
  const previous = input.id ? await one(db, 'SELECT note_template FROM bm_services WHERE id=?', serviceId) : null
  if (input.id) insist(previous, 'service_not_found', 404)
  // The note template a visit of this service starts from (for example pt.evaluation).
  const noteTemplate = input.noteTemplate === undefined ? previous?.note_template ?? '' : String(input.noteTemplate)
  insist(!noteTemplate || template(noteTemplate), 'unknown_template')
  await commit(db, who, [
    stmt(db, `INSERT INTO bm_services(id,name,duration_minutes,price_cents,active,note_template) VALUES(?,?,?,?,?,?)
      ON CONFLICT(id) DO UPDATE SET name=excluded.name,duration_minutes=excluded.duration_minutes,price_cents=excluded.price_cents,active=excluded.active,note_template=excluded.note_template,version=bm_services.version+1`,
    serviceId, text(input.name, 'name', 120), integer(input.durationMinutes, 'duration_minutes', 5, 480), integer(input.priceCents, 'price_cents', 0, 10_000_000), input.active === false || input.active === 'false' ? 0 : 1, noteTemplate),
    audit(db, who, 'service.saved', null, serviceId),
  ])
  return { id: serviceId }
}

const clock = (value: unknown, field: string) => {
  const v = text(value, field, 5)
  insist(/^([01]\d|2[0-3]):[0-5]\d$|^24:00$/.test(v), `invalid_${field}`)
  const [h, m] = v.split(':').map(Number)
  return h * 60 + m
}
/** Replaces one practitioner's weekly hours. Rows: [{weekday 0-6 (Sunday 0), start "09:00", end "17:00"}]. */
export async function saveHours(db: D1Database, who: Actor, input: Data) {
  need(who, 'owner'); human(who)
  const practitioner = await one(db, "SELECT id FROM bm_staff WHERE id=? AND role='practitioner' AND erased_at IS NULL", text(input.practitionerId, 'practitioner', 100))
  insist(practitioner, 'practitioner_not_found', 404)
  let windows = input.hours
  if (typeof windows === 'string') { try { windows = JSON.parse(windows) } catch { insist(false, 'invalid_hours') } }
  insist(Array.isArray(windows) && windows.length <= 50, 'invalid_hours')
  const parsed = windows.map((w: Data) => ({ weekday: integer(w?.weekday, 'weekday', 0, 6), start: clock(w?.start, 'start'), end: clock(w?.end, 'end') }))
  for (const w of parsed) {
    insist(w.start < w.end, 'invalid_hours')
    insist(!parsed.some((o: typeof w) => o !== w && o.weekday === w.weekday && o.start < w.end && o.end > w.start), 'overlapping_hours')
  }
  await commit(db, who, [
    stmt(db, 'DELETE FROM bm_hours WHERE practitioner_id=?', practitioner.id),
    ...parsed.map((w: typeof parsed[number]) => stmt(db, 'INSERT INTO bm_hours(practitioner_id,weekday,start_minute,end_minute) VALUES(?,?,?,?)', practitioner.id, w.weekday, w.start, w.end)),
    audit(db, who, 'hours.saved', null, practitioner.id as string),
  ])
  return { practitionerId: practitioner.id, windows: parsed.length }
}

/** Only staff never invited and never used in clinic work can be erased; others are deactivated. */
export async function eraseStaff(db: D1Database, who: Actor, input: Data) {
  need(who, 'owner'); human(who)
  const staff = await one(db, 'SELECT * FROM bm_staff WHERE id=? AND erased_at IS NULL', text(input.id, 'id', 100))
  insist(staff, 'staff_not_found', 404)
  const unused = `NOT EXISTS(SELECT 1 FROM bm_appointments WHERE practitioner_id=?) AND NOT EXISTS(SELECT 1 FROM bm_notes WHERE author_id=?)
    AND NOT EXISTS(SELECT 1 FROM oa_operators WHERE lower(email)=lower(?)) AND NOT EXISTS(SELECT 1 FROM bm_hours WHERE practitioner_id=?)`
  const args = [staff.id, staff.id, staff.email, staff.id]
  insist((await one<{ ok: number }>(db, `SELECT CASE WHEN (${unused}) THEN 1 ELSE 0 END AS ok`, ...args))?.ok === 1, 'only_unused_uninvited_staff_can_be_erased', 409)
  const portability = await createPortability({ db, policy: archivePolicy })
  await commit(db, who, [
    guard(db, unused, ...args),
    ...await portability.redactionStatements(), ...await portability.invalidateTransfersStatements(),
    stmt(db, 'INSERT INTO bm_erasure_journal(identity_hash,kind,erased_at) VALUES(?,?,?)', await sha256('staff:' + String(staff.email).toLowerCase()), 'staff', Date.now()),
    stmt(db, "UPDATE bm_staff SET name='Erased staff member',email=?,profession='',provider_number='',credentials='',active=0,version=version+1,erased_at=? WHERE id=?", `erased-${staff.id}@invalid.local`, Date.now(), staff.id),
    audit(db, who, 'staff.erased', null, staff.id as string),
  ])
  return { id: staff.id, erased: true }
}

/** Treatment rooms; a room holds one visit at a time. */
export async function saveRoom(db: D1Database, who: Actor, input: Data) {
  need(who, 'owner'); human(who)
  const roomId = input.id ? text(input.id, 'id', 100) : id()
  if (input.id) insist(await one(db, 'SELECT 1 FROM bm_rooms WHERE id=?', roomId), 'room_not_found', 404)
  await commit(db, who, [
    stmt(db, `INSERT INTO bm_rooms(id,name,active) VALUES(?,?,?) ON CONFLICT(id) DO UPDATE SET name=excluded.name,active=excluded.active,version=bm_rooms.version+1`,
      roomId, text(input.name, 'name', 80), input.active === false || input.active === 'false' ? 0 : 1),
    audit(db, who, 'room.saved', null, roomId),
  ])
  return { id: roomId }
}
