// Matching patients take ordered email turns. A durable hold expires before
// the next turn starts; accepting closes the opening in the booking batch.
import { hostDateAt, weekdayForDate, zonedParts } from '../availability/timezone'
import { appointmentStatements, intakeToken, placementGuards, placeVisit, settings } from './booking'
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
  const offers = await rows(db, `SELECT o.*,p.name AS practitioner,(SELECT json_group_array(json_object('entryId',r.entry_id,'delivery',r.delivery,'outcome',r.outcome,'takenNotice',r.taken_notice,'expiresAt',r.expires_at,'position',r.position))
    FROM (SELECT * FROM bm_offer_recipients WHERE offer_id=o.id ORDER BY position) r) AS recipients FROM bm_offers o JOIN bm_staff p ON p.id=o.practitioner_id
    WHERE (? OR o.practitioner_id=?) ORDER BY o.created_at DESC LIMIT 100`, desk ? 1 : 0, own)
  return { entries, offers: offers.map(o => ({ ...o, recipients: JSON.parse(o.recipients as string) })) }
}

export type OfferMail = { offerId: string; entryId: string; expiresAt?: string; email: string; firstName: string; token: string; service: string; practitioner: string; startAt: string }
/** Snapshot the matching order; only the current recipient receives a capability. */
export async function offerFreedSlots(db: D1Database, appointmentIds: string[]): Promise<OfferMail[]> {
  if (!appointmentIds.length) return []
  const zone = (await settings(db)).time_zone, mails: OfferMail[] = []
  const freed = await rows(db, "SELECT a.*,p.name AS practitioner FROM bm_appointments a JOIN bm_staff p ON p.id=a.practitioner_id WHERE a.id IN (SELECT value FROM json_each(?)) AND a.status='cancelled' AND a.start_at>? ORDER BY a.start_at",
    JSON.stringify(appointmentIds), new Date(Date.now() + offerNoticeMinutes * 60_000).toISOString())
  for (const slot of freed) {
    const date = hostDateAt(new Date(slot.start_at), zone)
    const candidates = await rows(db, `SELECT w.*,c.email,c.first_name,s.name AS service,s.duration_minutes FROM bm_waitlist w JOIN bm_clients c ON c.id=w.client_id JOIN bm_services s ON s.id=w.service_id
      WHERE w.status='waiting' AND (w.practitioner_id IS NULL OR w.practitioner_id=?) AND w.earliest_date<=? AND w.latest_date>=? AND s.active=1
      AND c.erased_at IS NULL AND c.email IS NOT NULL AND w.client_id<>? ORDER BY w.created_at,w.rowid`, slot.practitioner_id, date, date, slot.client_id)
    const fits = candidates.filter(entry=>preferencesFit(entry,slot.start_at,entry.duration_minutes,zone,slot.practitioner_id))
    if (!fits.length) continue
    const offerId = id()
    await commit(db, null, [
      guard(db,'NOT EXISTS(SELECT 1 FROM bm_offers WHERE source_appointment_id=?)',slot.id),
      stmt(db, "INSERT INTO bm_offers(id,source_appointment_id,practitioner_id,room_id,start_at,status,created_at,ordered) VALUES(?,?,?,?,?,'open',?,1)", offerId, slot.id, slot.practitioner_id, slot.room_id, slot.start_at, now()),
      ...fits.map((entry,i)=>stmt(db,"INSERT INTO bm_offer_recipients(offer_id,entry_id,offer_token_hash,position,delivery) VALUES(?,?,?,?,'queued')",offerId,entry.id,'queued:'+id(),i)),
    ])
    mails.push(...await advanceOffers(db,[offerId]))
  }
  return mails
}

/** The minute scheduler and native cancellation share the same durable turn claim. */
export async function advanceOffers(db: D1Database, offerIds?: string[]): Promise<OfferMail[]> {
 const mails: OfferMail[]=[]
 const offers=await rows(db,`SELECT * FROM bm_offers WHERE status='open' AND ordered=1
 AND EXISTS(SELECT 1 FROM bm_offer_recipients WHERE offer_id=bm_offers.id AND offer_authority=1)
 ${offerIds?'AND id IN (SELECT value FROM json_each(?))':''} ORDER BY created_at LIMIT 100`,...(offerIds?[JSON.stringify(offerIds)]:[]))
 for(const offer of offers){
  const unchanged=await selfServiceSnapshot(db),zone=(await settings(db)).time_zone
  const at=now(),current=await one(db,`SELECT w.*,r.offer_authority,r.outcome,c.erased_at FROM bm_waitlist w JOIN bm_offer_recipients r ON r.entry_id=w.id JOIN bm_clients c ON c.id=w.client_id WHERE r.offer_id=? AND r.entry_id=?`,offer.id,offer.active_entry_id??'')
  if(current&&current.offer_authority===1&&current.outcome===null&&current.erased_at===null&&offer.hold_until>at&&preferencesFit(current,offer.start_at,Math.round((Date.parse(offer.hold_end_at)-Date.parse(offer.start_at))/60000),zone,offer.practitioner_id))continue
  const candidates=Date.parse(at)<closesAt(offer)?await rows(db,`SELECT w.*,r.position,c.email,c.first_name,s.name AS service,s.duration_minutes,p.name AS practitioner FROM bm_offer_recipients r
   JOIN bm_waitlist w ON w.id=r.entry_id JOIN bm_clients c ON c.id=w.client_id JOIN bm_services s ON s.id=w.service_id JOIN bm_staff p ON p.id=?
   WHERE r.offer_id=? AND r.offer_authority=1 AND r.activated_at IS NULL AND r.outcome IS NULL AND w.status='waiting' AND c.erased_at IS NULL AND c.email IS NOT NULL AND s.active=1 AND p.active=1 AND p.erased_at IS NULL ORDER BY r.position`,offer.practitioner_id,offer.id):[]
  let next: Data|undefined
  for(const entry of candidates){
   if(!preferencesFit(entry,offer.start_at,entry.duration_minutes,zone,offer.practitioner_id))continue
   const warnings=await bookingWarnings(db,entry.client_id,hostDateAt(new Date(offer.start_at),zone),offer.practitioner_id)
   if(warnings.some(w=>w.blocking))continue
   const place=await placeVisit(db,zone,{practitionerId:offer.practitioner_id,serviceId:entry.service_id,durationMinutes:entry.duration_minutes,date:hostDateAt(new Date(offer.start_at),zone),minute:localMinute(offer.start_at,zone),roomId:offer.room_id,offerId:offer.id})
   if(place.problem||place.start!.toISOString()!==offer.start_at)continue
   if((await medicareOverlaps(db,entry.client_id,offer.practitioner_id,offer.start_at,place.end!.toISOString())).length)continue
   next={...entry,endAt:place.end!.toISOString()};break
  }
  const token=intakeToken(),expires=new Date(Math.min(Date.now()+15*60000,closesAt(offer))).toISOString()
  try{
   await commit(db,null,[unchanged,
    guard(db,"EXISTS(SELECT 1 FROM bm_offers WHERE id=? AND status='open' AND revision=?)",offer.id,offer.revision),
    ...(current?[stmt(db,"UPDATE bm_offer_recipients SET outcome='too_late',responded_at=? WHERE offer_id=? AND entry_id=? AND outcome IS NULL",at,offer.id,offer.active_entry_id),audit(db,{email:'balm',role:'waitlist'},'waitlist.turn_ended',current.client_id,offer.id)]:[]),
    ...(next?[
     ...await placementGuards(db,{practitionerId:offer.practitioner_id,serviceId:next.service_id,startAt:offer.start_at,endAt:next.endAt,roomId:offer.room_id,offerId:offer.id}),
     guard(db,"EXISTS(SELECT 1 FROM bm_offer_recipients WHERE offer_id=? AND entry_id=? AND offer_authority=1 AND activated_at IS NULL AND outcome IS NULL)",offer.id,next.id),
     stmt(db,'UPDATE bm_offers SET active_entry_id=?,hold_until=?,hold_end_at=?,revision=revision+1 WHERE id=?',next.id,expires,next.endAt,offer.id),
     stmt(db,"UPDATE bm_offer_recipients SET offer_token_hash=?,activated_at=?,expires_at=?,delivery='pending' WHERE offer_id=? AND entry_id=?",await sha256(token),at,expires,offer.id,next.id),
     audit(db,{email:'balm',role:'waitlist'},'waitlist.offered',next.client_id,offer.id,offer.start_at),
    ]:[stmt(db,"UPDATE bm_offers SET status='closed',closed_at=?,active_entry_id=NULL,hold_until=NULL,hold_end_at=NULL,revision=revision+1 WHERE id=?",at,offer.id)]),
   ])
   if(next)mails.push({offerId:offer.id,entryId:next.id,email:next.email,firstName:next.first_name,service:next.service,practitioner:next.practitioner,startAt:offer.start_at,token,expiresAt:expires})
  }catch(error){if(!(error instanceof DomainError&&error.status===409))throw error}
 }
 return mails
}
export async function recordDelivery(db: D1Database, offerId: string, entryId: string, column: 'delivery' | 'taken_notice', value: string) {
  const updates = [stmt(db, `UPDATE bm_offer_recipients SET ${column}=? WHERE offer_id=? AND entry_id=?`, value, offerId, entryId)]
  // An install that suppresses mail cannot send its queued turns either. Keep
  // that outcome separate from activation and expiry, which still track order.
  if (column === 'delivery' && value === 'suppressed') updates.push(stmt(db,
    "UPDATE bm_offer_recipients SET delivery='suppressed' WHERE offer_id=? AND activated_at IS NULL AND delivery='queued'", offerId))
  await db.batch(updates)
}

async function offerByToken(db: D1Database, token: string) {
  const row = await one(db, `SELECT r.offer_id,r.entry_id,r.outcome,r.expires_at,o.ordered,o.active_entry_id,o.hold_until,o.status,o.start_at,o.practitioner_id,o.room_id,o.appointment_id,w.client_id,w.service_id,w.status AS entry_status,w.version AS entry_version,w.practitioner_id AS preferred_practitioner,w.earliest_date,w.latest_date,w.preferred_weekdays,w.preferred_start_minute,w.preferred_end_minute,
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
  const state = offer.outcome === 'accepted' ? 'yours' : offer.status !== 'open' || !preferencesFit({ ...offer, status: offer.entry_status, practitioner_id: offer.preferred_practitioner }, offer.start_at, offer.duration_minutes, offer.time_zone, offer.practitioner_id) ? 'taken' : offer.ordered && (offer.active_entry_id !== offer.entry_id || Date.now() >= Date.parse(offer.hold_until) || offer.outcome === 'too_late') ? 'expired' : Date.now() >= closesAt(offer) ? 'past' : 'open'
  return { offer, state }
}

export type Accepted = { appointmentId: string; intakeToken: string | null; intake: IntakeRequest; offerId: string; clientId: string; startAt: string }
/** The first acceptance books the visit and closes the offer in one batch; every later one is refused. */
export async function acceptOffer(db: D1Database, token: string): Promise<Accepted> {
  const unchanged = await selfServiceSnapshot(db)
  const { offer, state } = await offerView(db, token)
  if (state !== 'open') {
    if (state === 'taken') await stmt(db, "UPDATE bm_offer_recipients SET outcome='too_late',responded_at=? WHERE offer_id=? AND entry_id=? AND outcome IS NULL AND EXISTS(SELECT 1 FROM bm_offers o WHERE o.id=offer_id AND (o.ordered=0 OR o.status<>'open' OR o.active_entry_id<>entry_id OR o.hold_until<=strftime('%Y-%m-%dT%H:%M:%fZ','now')))", now(), offer.offer_id, offer.entry_id).run()
    throw new DomainError(state === 'yours' ? 'already_booked' : state === 'past' ? 'offer_closed' : 'time_taken', 409)
  }
  const zone = offer.time_zone, date = hostDateAt(new Date(offer.start_at), zone)
  const warnings = await bookingWarnings(db, offer.client_id, date, offer.practitioner_id)
  if (warnings.some(w => w.blocking)) throw new DomainError('time_taken', 409)
  const minute = localMinute(offer.start_at, zone)
  const place = await placeVisit(db, zone, { practitionerId: offer.practitioner_id, serviceId: offer.service_id, durationMinutes: offer.duration_minutes, date, minute, roomId: offer.room_id, offerId: offer.offer_id })
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
      guard(db, "EXISTS(SELECT 1 FROM bm_offers WHERE id=? AND status='open' AND (ordered=0 OR (active_entry_id=? AND hold_until>strftime('%Y-%m-%dT%H:%M:%fZ','now'))))", offer.offer_id,offer.entry_id),
      guard(db,'EXISTS(SELECT 1 FROM bm_offer_recipients WHERE offer_id=? AND entry_id=? AND offer_authority=1 AND offer_token_hash=?)',offer.offer_id,offer.entry_id,await sha256(token)),
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
      await stmt(db, "UPDATE bm_offer_recipients SET outcome='too_late',responded_at=? WHERE offer_id=? AND entry_id=? AND outcome IS NULL AND EXISTS(SELECT 1 FROM bm_offers o WHERE o.id=offer_id AND (o.ordered=0 OR o.status<>'open' OR o.active_entry_id<>entry_id OR o.hold_until<=strftime('%Y-%m-%dT%H:%M:%fZ','now')))", now(), offer.offer_id, offer.entry_id).run()
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
    WHERE r.offer_id=? AND r.offer_authority=1 AND c.erased_at IS NULL AND w.status='waiting' AND (r.outcome IS NULL OR r.outcome='too_late') AND r.taken_notice IS NULL AND c.email IS NOT NULL`, offerId)
}
