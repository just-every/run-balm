// The waitlist: clients waiting for a practitioner (or anyone) and a service in
// a date window. When a booked visit is canceled, its freed time is offered to
// every matching entry at once by email; the first to accept is booked in the
// same batch that closes the offer, and the others are told it is taken.
import { hostDateAt, weekdayForDate, zonedParts } from '../availability/timezone'
import { appointmentStatements, intakeToken, placeVisit, settings } from './booking'
import { medicareOverlaps } from '../scheduling/capacity'
import { clientVisible } from './clients'
import { selfServiceSnapshot } from '../scheduling/self-service-policy'
import { bookingWarnings } from '../insurance/authorization'
import { bookedIntake, type IntakeRequest } from './intake-requests'
import { audit, commit, day, DomainError, guard, human, id, insist, integer, need, now, one, optional, practitionerId, rows, sha256, stmt, text, type Actor, type Data } from './model'

/** Offers go out only for times at least this far ahead, and close this long before the visit. */
const offerNoticeMinutes = 120, acceptCloseMinutes = 60
const localMinute = (iso: string, zone: string) => { const p = zonedParts(new Date(iso), zone); return p.hour * 60 + p.minute }
const everyDay = [0, 1, 2, 3, 4, 5, 6]

function preferences(input: Data) {
  const chosen = input.weekdaysSelected === 'on' || everyDay.some(d => input['weekday_' + d] !== undefined)
  const raw = input.weekdays === undefined ? chosen ? everyDay.filter(d => input['weekday_' + d] === 'on') : everyDay : input.weekdays
  insist(Array.isArray(raw) && raw.length > 0, 'choose_at_least_one_weekday')
  const weekdays = [...new Set(raw.map((d: unknown) => {
    insist(typeof d === 'number' || typeof d === 'string' && /^[0-6]$/.test(d), 'invalid_weekday')
    return integer(d, 'weekday', 0, 6)
  }))].sort()
  const minute = (value: unknown, fallback: number, end = false) => {
    if (value === undefined || value === '') return fallback
    insist(typeof value === 'string' && (/^([01]\d|2[0-3]):[0-5]\d$/.test(value) || end && value === '24:00'), 'invalid_preferred_time')
    const [h, m] = value.split(':').map(Number)
    return h * 60 + m
  }
  const from = minute(input.timeFrom, 0), until = minute(input.timeUntil, 1440, true)
  insist(from < until, 'preferred_end_must_follow_start')
  return { weekdays: JSON.stringify(weekdays), from, until }
}

/** Check every real minute, so a repeated DST hour cannot hide time outside the window. */
export function preferencesFit(entry: Data, startAt: string, duration: number, zone: string, practitioner: string) {
  const date = hostDateAt(new Date(startAt), zone), days = JSON.parse(entry.preferred_weekdays)
  if (entry.status !== 'waiting' || entry.practitioner_id && entry.practitioner_id !== practitioner || date < entry.earliest_date || date > entry.latest_date || !days.includes(weekdayForDate(date))) return false
  const start = Date.parse(startAt), end = start + duration * 60_000
  for (let at = start; at < end; at += 60_000) {
    const instant = new Date(at), p = zonedParts(instant, zone), minute = p.hour * 60 + p.minute
    if (hostDateAt(instant, zone) !== date || minute < entry.preferred_start_minute || minute >= entry.preferred_end_minute) return false
  }
  return duration > 0
}


export async function addToWaitlist(db: D1Database, who: Actor, input: Data) {
  need(who, 'owner', 'reception', 'practitioner'); human(who)
  const client = await clientVisible(db, who, input.clientId)
  const own = practitionerId(who), desk = who.role === 'owner' || who.staffRole === 'reception'
  const practitioner = input.practitionerId ? text(input.practitionerId, 'practitioner', 100) : null
  insist(desk || (own && practitioner === own), 'practitioners_book_their_own_diary', 403)
  if (practitioner) insist(await one(db, "SELECT 1 FROM bm_staff WHERE id=? AND role='practitioner' AND active=1 AND erased_at IS NULL", practitioner), 'practitioner_not_found', 404)
  const service = await one(db, 'SELECT id FROM bm_services WHERE id=? AND active=1', text(input.serviceId, 'service', 100))
  insist(service, 'service_not_found', 404)
  const zone = (await settings(db)).time_zone
  const earliest = input.earliestDate ? day(input.earliestDate, 'earliest_date') : hostDateAt(new Date(), zone), latest = day(input.latestDate, 'latest_date')
  insist(earliest <= latest, 'latest_date_before_earliest_date')
  insist(client.email, 'client_needs_an_email_for_offers', 409)
  const entryId = id(), preferred = preferences(input)
  await commit(db, who, [
    guard(db, "NOT EXISTS(SELECT 1 FROM bm_waitlist WHERE client_id=? AND service_id=? AND practitioner_id IS ? AND status='waiting')", client.id, service.id, practitioner),
    stmt(db, "INSERT INTO bm_waitlist(id,client_id,practitioner_id,service_id,earliest_date,latest_date,note,preferred_weekdays,preferred_start_minute,preferred_end_minute,status,created_at,created_by) VALUES(?,?,?,?,?,?,?,?,?,?,'waiting',?,?)",
      entryId, client.id, practitioner, service.id, earliest, latest, optional(input.note, 'note', 300) ?? '', preferred.weekdays, preferred.from, preferred.until, now(), who.email),
    audit(db, who, 'waitlist.added', client.id as string, entryId),
  ])
  return { id: entryId }
}

async function visibleEntry(db: D1Database, who: Actor, key: unknown) {
  const entry = await one(db, 'SELECT * FROM bm_waitlist WHERE id=?', text(key, 'entry', 100))
  insist(entry && (who.role === 'owner' || who.staffRole === 'reception' || entry.practitioner_id === practitionerId(who)), 'waitlist_entry_not_found', 404)
  return entry
}
export async function removeFromWaitlist(db: D1Database, who: Actor, input: Data) {
  need(who, 'owner', 'reception', 'practitioner'); human(who)
  const entry = await visibleEntry(db, who, input.id)
  insist(entry.status === 'waiting', 'entry_not_waiting', 409)
  await commit(db, who, [
    stmt(db, "UPDATE bm_waitlist SET status='removed',version=version+1 WHERE id=? AND status='waiting'", entry.id),
    guard(db, "EXISTS(SELECT 1 FROM bm_waitlist WHERE id=? AND status='removed')", entry.id),
    audit(db, who, 'waitlist.removed', entry.client_id, entry.id),
  ])
  return { id: entry.id, status: 'removed' }
}

/** Role-scoped waitlist and recent offers, for the signed-in screens. */
export async function waitlistFor(db: D1Database, who: Actor) {
  const desk = who.role === 'owner' || who.staffRole === 'reception', own = practitionerId(who) ?? ''
  if (!desk && !own) return { entries: [], offers: [] }
  const entries = await rows(db, `SELECT w.*,c.first_name||' '||c.last_name AS client,s.name AS service,p.name AS practitioner FROM bm_waitlist w
    JOIN bm_clients c ON c.id=w.client_id JOIN bm_services s ON s.id=w.service_id LEFT JOIN bm_staff p ON p.id=w.practitioner_id
    WHERE (? OR w.practitioner_id=?) ORDER BY w.status='waiting' DESC,w.created_at DESC LIMIT 300`, desk ? 1 : 0, own)
  const offers = await rows(db, `SELECT o.*,p.name AS practitioner,(SELECT json_group_array(json_object('entryId',r.entry_id,'delivery',r.delivery,'outcome',r.outcome,'takenNotice',r.taken_notice))
    FROM bm_offer_recipients r WHERE r.offer_id=o.id) AS recipients FROM bm_offers o JOIN bm_staff p ON p.id=o.practitioner_id
    WHERE (? OR o.practitioner_id=?) ORDER BY o.created_at DESC LIMIT 100`, desk ? 1 : 0, own)
  return { entries, offers: offers.map(o => ({ ...o, recipients: JSON.parse(o.recipients as string) })) }
}

export type OfferMail = { offerId: string; entryId: string; email: string; firstName: string; token: string; service: string; practitioner: string; startAt: string }
/**
 * Opens one offer per freed visit (canceled, far enough ahead) to every waiting
 * entry whose practitioner, service, dates and local preferences fit that time, and returns the
 * messages to send. Tokens exist only in the returned messages; rows keep hashes.
 */
export async function offerFreedSlots(db: D1Database, appointmentIds: string[]): Promise<OfferMail[]> {
  if (!appointmentIds.length) return []
  const zone = (await settings(db)).time_zone, mails: OfferMail[] = []
  const freed = await rows(db, "SELECT a.*,p.name AS practitioner FROM bm_appointments a JOIN bm_staff p ON p.id=a.practitioner_id WHERE a.id IN (SELECT value FROM json_each(?)) AND a.status='cancelled' AND a.start_at>? ORDER BY a.start_at",
    JSON.stringify(appointmentIds), new Date(Date.now() + offerNoticeMinutes * 60_000).toISOString())
  for (const slot of freed) {
    const date = hostDateAt(new Date(slot.start_at), zone)
    const candidates = await rows(db, `SELECT w.*,c.email,c.first_name,s.name AS service,s.duration_minutes FROM bm_waitlist w JOIN bm_clients c ON c.id=w.client_id JOIN bm_services s ON s.id=w.service_id
      WHERE w.status='waiting' AND (w.practitioner_id IS NULL OR w.practitioner_id=?) AND w.earliest_date<=? AND w.latest_date>=? AND s.active=1
      AND c.erased_at IS NULL AND c.email IS NOT NULL AND w.client_id<>? ORDER BY w.created_at`, slot.practitioner_id, date, date, slot.client_id)
    const minute = localMinute(slot.start_at, zone)
    const fits = []
    for (const entry of candidates) {
      if (!preferencesFit(entry, slot.start_at, entry.duration_minutes, zone, slot.practitioner_id)) continue
      // The waiting client's own service must fit at that start: inside hours, clear of other visits and of the room.
      const place = await placeVisit(db, zone, { practitionerId: slot.practitioner_id, serviceId: entry.service_id, durationMinutes: entry.duration_minutes, date, minute, roomId: slot.room_id })
      if (!place.problem && place.start!.toISOString() === slot.start_at) fits.push(entry)
    }
    if (!fits.length) continue
    const offerId = id(), tokens = fits.map(() => intakeToken())
    await commit(db, null, [
      stmt(db, "INSERT INTO bm_offers(id,source_appointment_id,practitioner_id,room_id,start_at,status,created_at) VALUES(?,?,?,?,?,'open',?)", offerId, slot.id, slot.practitioner_id, slot.room_id, slot.start_at, now()),
      ...(await Promise.all(fits.map(async (entry, i) => stmt(db, 'INSERT INTO bm_offer_recipients(offer_id,entry_id,offer_token_hash) VALUES(?,?,?)', offerId, entry.id, await sha256(tokens[i]))))),
      ...fits.map(entry => audit(db, { email: 'balm', role: 'waitlist' }, 'waitlist.offered', entry.client_id, offerId, slot.start_at)),
    ])
    fits.forEach((entry, i) => mails.push({ offerId, entryId: entry.id, email: entry.email, firstName: entry.first_name, token: tokens[i], service: entry.service, practitioner: slot.practitioner, startAt: slot.start_at }))
  }
  return mails
}
export async function recordDelivery(db: D1Database, offerId: string, entryId: string, column: 'delivery' | 'taken_notice', value: string) {
  await db.prepare(`UPDATE bm_offer_recipients SET ${column}=? WHERE offer_id=? AND entry_id=?`).bind(value, offerId, entryId).run()
}

async function offerByToken(db: D1Database, token: string) {
  const row = await one(db, `SELECT r.offer_id,r.entry_id,r.outcome,o.status,o.start_at,o.practitioner_id,o.room_id,o.appointment_id,w.client_id,w.service_id,w.status AS entry_status,w.version AS entry_version,w.practitioner_id AS preferred_practitioner,w.earliest_date,w.latest_date,w.preferred_weekdays,w.preferred_start_minute,w.preferred_end_minute,
    c.first_name,c.email,s.name AS service,s.duration_minutes,p.name AS practitioner,st.clinic_name,st.time_zone,
    (SELECT 1 FROM bm_intake_responses i WHERE i.client_id=w.client_id AND i.form_id=(SELECT id FROM bm_intake_forms ORDER BY number DESC LIMIT 1) LIMIT 1) AS intake_on_file,
    (SELECT a.intake_token_hash IS NOT NULL FROM bm_appointments a WHERE a.id=o.appointment_id) AS intake_requested
    FROM bm_offer_recipients r JOIN bm_offers o ON o.id=r.offer_id JOIN bm_waitlist w ON w.id=r.entry_id JOIN bm_clients c ON c.id=w.client_id
    JOIN bm_services s ON s.id=w.service_id JOIN bm_staff p ON p.id=o.practitioner_id, bm_settings st WHERE c.erased_at IS NULL AND r.offer_authority=1 AND r.offer_token_hash=?`, await sha256(token))
  insist(row, 'offer_not_found', 404)
  return row
}
const closesAt = (offer: Data) => Date.parse(offer.start_at) - acceptCloseMinutes * 60_000

/** What the offer link shows: open, taken, yours, or past. */
export async function offerView(db: D1Database, token: string) {
  const offer = await offerByToken(db, token)
  const state = offer.outcome === 'accepted' ? 'yours' : offer.status !== 'open' || !preferencesFit({ ...offer, status: offer.entry_status, practitioner_id: offer.preferred_practitioner }, offer.start_at, offer.duration_minutes, offer.time_zone, offer.practitioner_id) ? 'taken' : Date.now() > closesAt(offer) ? 'past' : 'open'
  return { offer, state }
}

export type Accepted = { appointmentId: string; intakeToken: string | null; intake: IntakeRequest; offerId: string; clientId: string; startAt: string }
/** The first acceptance books the visit and closes the offer in one batch; every later one is refused. */
export async function acceptOffer(db: D1Database, token: string): Promise<Accepted> {
  const unchanged = await selfServiceSnapshot(db)
  const { offer, state } = await offerView(db, token)
  if (state !== 'open') {
    if (state === 'taken') await stmt(db, "UPDATE bm_offer_recipients SET outcome='too_late',responded_at=? WHERE offer_id=? AND entry_id=? AND outcome IS NULL", now(), offer.offer_id, offer.entry_id).run()
    throw new DomainError(state === 'yours' ? 'already_booked' : state === 'past' ? 'offer_closed' : 'time_taken', 409)
  }
  const zone = offer.time_zone, date = hostDateAt(new Date(offer.start_at), zone)
  const warnings = await bookingWarnings(db, offer.client_id, date, offer.practitioner_id)
  if (warnings.some(w => w.blocking)) throw new DomainError('time_taken', 409)
  const minute = localMinute(offer.start_at, zone)
  const place = await placeVisit(db, zone, { practitionerId: offer.practitioner_id, serviceId: offer.service_id, durationMinutes: offer.duration_minutes, date, minute, roomId: offer.room_id })
  // SCHED-010: a patient's acceptance never overlaps two Medicare patients; no person is there to decide.
  if (!place.problem && (await medicareOverlaps(db, offer.client_id, offer.practitioner_id, place.start!.toISOString(), place.end!.toISOString())).length) throw new DomainError('time_taken', 409)
  const visitor = { email: offer.email, role: 'waitlist offer' }
  if (place.problem) {
    // Someone booked into the time another way: the offer closes and nobody else can take it.
    await commit(db, null, [stmt(db, "UPDATE bm_offers SET status='closed',closed_at=? WHERE id=? AND status='open'", now(), offer.offer_id)])
    throw new DomainError('time_taken', 409)
  }
  const appointmentId = id(), startAt = place.start!.toISOString()
  const tokenForIntake = intakeToken()
  try {
    await commit(db, null, [
      unchanged,
      guard(db, "EXISTS(SELECT 1 FROM bm_offers WHERE id=? AND status='open')", offer.offer_id),
      guard(db, "EXISTS(SELECT 1 FROM bm_waitlist WHERE id=? AND status='waiting' AND version=? AND client_id=? AND service_id=? AND practitioner_id IS ? AND earliest_date=? AND latest_date=? AND preferred_weekdays=? AND preferred_start_minute=? AND preferred_end_minute=?)", offer.entry_id, offer.entry_version, offer.client_id, offer.service_id, offer.preferred_practitioner, offer.earliest_date, offer.latest_date, offer.preferred_weekdays, offer.preferred_start_minute, offer.preferred_end_minute),
      guard(db, 'EXISTS(SELECT 1 FROM bm_settings WHERE id=1 AND time_zone=?)', zone),
      guard(db, 'EXISTS(SELECT 1 FROM bm_services WHERE id=? AND active=1 AND duration_minutes=?)', offer.service_id, offer.duration_minutes),
      ...await appointmentStatements(db, visitor, { id: appointmentId, clientId: offer.client_id, practitionerId: offer.practitioner_id, serviceId: offer.service_id, startAt, endAt: place.end!.toISOString(), bookedVia: 'online', tokenHash: tokenForIntake ? await sha256(tokenForIntake) : null, roomId: offer.room_id, offerId: offer.offer_id }),
      stmt(db, "UPDATE bm_offers SET status='taken',appointment_id=?,closed_at=? WHERE id=?", appointmentId, now(), offer.offer_id),
      stmt(db, "UPDATE bm_offer_recipients SET outcome='accepted',responded_at=? WHERE offer_id=? AND entry_id=?", now(), offer.offer_id, offer.entry_id),
      stmt(db, "UPDATE bm_waitlist SET status='booked',appointment_id=?,version=version+1 WHERE id=?", appointmentId, offer.entry_id),
      audit(db, visitor, 'waitlist.accepted', offer.client_id, offer.offer_id),
    ])
  } catch (error) {
    if (error instanceof DomainError && error.status === 409) {
      await stmt(db, "UPDATE bm_offer_recipients SET outcome='too_late',responded_at=? WHERE offer_id=? AND entry_id=? AND outcome IS NULL", now(), offer.offer_id, offer.entry_id).run()
      throw new DomainError('time_taken', 409)
    }
    throw error
  }
  const intake = await bookedIntake(db, offer.client_id, appointmentId, startAt, [appointmentId])
  return { appointmentId, intakeToken: intake === 'ask' ? tokenForIntake : null, intake, offerId: offer.offer_id, clientId: offer.client_id, startAt }
}

/** Everyone else offered that time, still waiting and not yet told. */
export async function takenNotices(db: D1Database, offerId: string) {
  return rows(db, `SELECT r.entry_id,c.email,c.first_name,o.start_at,s.name AS service FROM bm_offer_recipients r JOIN bm_offers o ON o.id=r.offer_id
    JOIN bm_waitlist w ON w.id=r.entry_id JOIN bm_clients c ON c.id=w.client_id JOIN bm_services s ON s.id=w.service_id
    WHERE r.offer_id=? AND (r.outcome IS NULL OR r.outcome='too_late') AND r.taken_notice IS NULL AND c.email IS NOT NULL`, offerId)
}
