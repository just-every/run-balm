// Preparation approval is historical. A separate clinician release and the
// patient's exact-date confirmation are required before any booking.
import { portalGuard, type Patient } from '../portal/auth'
import { appointmentStatements } from '../domain/booking'
import { datePlus, hostDateAt } from '../availability/timezone'
import { preferencesFit } from '../domain/waitlist'
import { patternDates } from '../domain/series'
import { bookable, clockMinute, placeVisit, placementGuards } from '../domain/booking'
import { actor, audit, commit, guard, human, id, insist, now, one, practitionerId, rows, sha256, stmt, text, type Actor, type Data } from '../domain/model'
import { authorizationsFor } from '../insurance/authorization'
import { authorizationCoversCodes, reservationAllowance, selectAuthorization } from '../insurance/authorization-accounting'
import { medicareOverlaps } from '../scheduling/capacity'
import { serviceContext } from '../scheduling/service-rules'

async function clinician(db: D1Database, who: Actor) {
  human(who)
  const live = { ...await actor(db, who.id), sessionId: who.sessionId }
  insist(practitionerId(live) && live.staffKind === 'practitioner', 'continuity_requires_treating_clinician', 403)
  return live
}
const revision = async (db: D1Database) => ({
  source: (await one(db, 'SELECT version FROM bm_continuity_revision WHERE id=1'))!.version,
  schedule: (await one(db, 'SELECT version FROM bm_schedule_revision WHERE id=1'))!.version,
})
const sourceGuards = (db: D1Database, source: Data) => [
  guard(db, 'EXISTS(SELECT 1 FROM bm_continuity_revision WHERE id=1 AND version=?)', source.source),
  guard(db, 'EXISTS(SELECT 1 FROM bm_schedule_revision WHERE id=1 AND version=?)', source.schedule),
]

async function proposal(db: D1Database, who: Actor, seriesId: unknown) {
  const live = await clinician(db, who), versions = await revision(db)
  const series = await one(db, 'SELECT * FROM bm_series WHERE id=? AND practitioner_id=?', text(seriesId, 'series', 100), practitionerId(live))
  insist(series, 'continuity_series_not_found', 404)
  const client = await one(db, 'SELECT id,version FROM bm_clients WHERE id=? AND erased_at IS NULL', series.client_id)
  insist(client, 'client_not_found', 404)
  const pattern = JSON.parse(series.pattern)
  insist(pattern.planId, 'continuity_needs_plan_derived_series', 409)
  const episode = await one(db, "SELECT e.* FROM bm_episode_records r JOIN bm_episodes e ON e.id=r.episode_id WHERE r.record_kind='plan' AND r.record_id=?", pattern.planId)
  insist(!episode?.closed_at, 'continuity_episode_closed', 409)
  const plan = await one(db, `SELECT p.* FROM bm_plans_of_care p WHERE p.client_id=? AND
    COALESCE((SELECT episode_id FROM bm_episode_records WHERE record_kind='plan' AND record_id=p.id),'')=? ORDER BY p.created_at DESC,p.rowid DESC LIMIT 1`, series.client_id, episode?.id ?? '')
  insist(plan && plan.id === pattern.planId && plan.content_sha256 === pattern.planSha256, 'continuity_plan_changed', 409)
  const content = JSON.parse(plan.content)
  insist(pattern.firstDate === content.startDate && pattern.weeks === content.durationWeeks && pattern.weekdays.length === content.frequencyPerWeek, 'continuity_cadence_changed', 409)
  const lastDate = datePlus(content.startDate, content.durationWeeks * 7 - 1)
  const { zone } = await serviceContext(db, series.service_id, series.practitioner_id, series.room_id)
  const today = hostDateAt(new Date(), zone)
  insist(lastDate >= today && content.certifiedThrough >= today, 'continuity_plan_expired', 409)
  const { service, practitioner } = await bookable(db, series.practitioner_id, series.service_id)
  const visits = await rows(db, 'SELECT * FROM bm_appointments WHERE series_id=? ORDER BY start_at,id', series.id)
  const replaced = await rows(db, `SELECT j.value ->> '$.id' AS id FROM bm_continuity_acceptances a
    JOIN bm_continuity_proposals p ON p.id=a.proposal_id,json_each(p.payload,'$.cancellations') j WHERE a.client_id=?`, client.id)
  const cancelled = visits.filter(v => v.status === 'cancelled' && !replaced.some(r => r.id === v.id))
  insist(cancelled.length >= 2, 'continuity_needs_two_cancellations', 409)
  const after = cancelled.map(v => hostDateAt(new Date(v.start_at), zone)).sort().at(-1)!
  const waitlist = await rows(db, 'SELECT * FROM bm_waitlist WHERE client_id=? AND service_id=? ORDER BY id', client.id, service.id)
  const authorizations = await authorizationsFor(db, series.client_id)
  const policies = await rows(db, 'SELECT p.*,y.version AS payer_version FROM bm_policies p JOIN bm_payers y ON y.id=p.payer_id WHERE p.client_id=? AND p.priority=1 ORDER BY p.id', client.id)
  insist(policies.length === 1, 'continuity_needs_current_primary_policy', 409)
  const policy = policies[0]
  insist(!['inactive', 'changed'].includes(policy.eligibility_status), 'continuity_coverage_requires_review', 409)
  const occurrences: Data[] = [], demand = new Map<string, number>()
  const codes = JSON.parse(service.cpt_defaults).map((c: Data) => c.code)
  const discipline = (await one(db, 'SELECT discipline FROM bm_staff WHERE id=?', practitioner.id))!.discipline
  const active = await rows(db, `SELECT a.start_at,a.end_at,a.practitioner_id,s.discipline,
    COALESCE(r.episode_id,'') AS episode_id FROM bm_appointments a JOIN bm_staff s ON s.id=a.practitioner_id
    LEFT JOIN bm_episode_records r ON r.record_kind='visit' AND r.record_id=a.id
    WHERE a.client_id=? AND a.status IN ('booked','attended')`, client.id)
  const treatment = active.filter(v => v.episode_id === (episode?.id ?? '') &&
    (v.practitioner_id === practitioner.id || discipline && v.discipline === discipline))
  for (const date of patternDates(pattern.firstDate, pattern.weekdays, pattern.weeks)) {
    if (date <= after || date < today || date > content.certifiedThrough) continue
    // The plan's treatment counts against its cadence; other disciplines still
    // block overlapping times without consuming this plan's weekly frequency.
    const week = Math.floor((Date.parse(date) - Date.parse(content.startDate)) / 604800000)
    const sameWeek = (d: string) => Math.floor((Date.parse(d) - Date.parse(content.startDate)) / 604800000) === week
    if (treatment.filter(v => sameWeek(hostDateAt(new Date(v.start_at), zone))).length + occurrences.filter(o => sameWeek(o.date)).length >= content.frequencyPerWeek) continue
    const place = await placeVisit(db, zone, { practitionerId: series.practitioner_id, serviceId: series.service_id, durationMinutes: service.duration_minutes, date, minute: clockMinute(pattern.time), roomId: series.room_id })
    if (place.problem || !place.start || !place.end || place.start.getTime() <= Date.now()) continue
    const startAt = place.start.toISOString(), endAt = place.end.toISOString()
    const preferences = waitlist.filter(w => w.status === 'waiting' && (!w.practitioner_id || w.practitioner_id === series.practitioner_id))
    if (preferences.length && !preferences.some(w => preferencesFit(w, startAt, service.duration_minutes, zone, series.practitioner_id))) continue
    if (active.some(v => v.start_at < endAt && v.end_at > startAt)) continue
    if ((await medicareOverlaps(db, client.id, series.practitioner_id, startAt, endAt)).length) continue
    const authorization = selectAuthorization(authorizations, policy.id, date, series.practitioner_id, episode?.id ?? '')
    if (!authorization || date < policy.starts_on || policy.ends_on && date > policy.ends_on || !authorizationCoversCodes(authorization, codes)) continue
    const needed = (demand.get(authorization.id) ?? 0) + reservationAllowance(authorization)
    if (needed > authorization.remaining_allowance) continue
    demand.set(authorization.id, needed)
    occurrences.push({ date, time: pattern.time, startAt, endAt, authorizationId: authorization.id, allowance: reservationAllowance(authorization) })
    if (occurrences.length === cancelled.length) break
  }
  insist(occurrences.length === cancelled.length, 'continuity_no_feasible_sequence', 409)
  const payload = {
    clientId: client.id, clientVersion: client.version, seriesId: series.id, practitionerId: practitioner.id, practitioner: practitioner.name, practitionerVersion: practitioner.version, serviceId: service.id, service: service.name, serviceVersion: service.version, roomId: series.room_id,
    planId: plan.id, planSha256: plan.content_sha256, planVersion: plan.version, episodeId: episode?.id ?? '', timeZone: zone,
    cadence: { firstDate: content.startDate, lastDate, frequencyPerWeek: content.frequencyPerWeek, weekdays: pattern.weekdays, time: pattern.time },
    policy: { id: policy.id, version: policy.version, payerId: policy.payer_id, payerVersion: policy.payer_version, startsOn: policy.starts_on, endsOn: policy.ends_on, eligibilityStatus: policy.eligibility_status },
    cancellations: cancelled.map(v => ({ id: v.id, startAt: v.start_at, version: v.version })),
    waitlist: waitlist.map(w => ({ id: w.id, status: w.status, practitionerId: w.practitioner_id, earliestDate: w.earliest_date, latestDate: w.latest_date, weekdays: JSON.parse(w.preferred_weekdays), startMinute: w.preferred_start_minute, endMinute: w.preferred_end_minute })),
    authorization: [...demand].map(([key, needed]) => { const a = authorizations.find(a => a.id === key)!; return { id: key, version: a.version, scope: a.cpt_scope, unitsPerVisit: a.units_per_visit, number: a.number, kind: a.allowance_kind, total: a.allowance_total, used: a.used_allowance, reserved: a.reserved_allowance, remaining: a.remaining_allowance, proposed: needed, afterBooking: a.remaining_allowance - needed, startsOn: a.starts_on, endsOn: a.ends_on } }),
    occurrences,
  }
  // Revisions fence the read in the write transaction, but are not review bytes:
  // unrelated clinic changes do not invalidate an otherwise identical proposal.
  const digest = await sha256(JSON.stringify(payload))
  return { live, payload, digest, versions, today }
}

export async function continuityCommand(db: D1Database, who: Actor, name: string, input: Data) {
  if (name === 'continuity.read') return continuityFor(db, who, input.clientId, true)
  if (name === 'continuity.offer' || name === 'continuity.withdraw') return releaseContinuity(db, who, name, input)
  if (name === 'continuity.prepare') {
    const p = await proposal(db, who, input.seriesId)
    const prior = await one(db, 'SELECT * FROM bm_continuity_proposals WHERE series_id=? AND digest=? AND review_authority=1', p.payload.seriesId, p.digest)
    const key = prior?.id ?? id()
    await commit(db, p.live, [...sourceGuards(db, p.versions),
      ...(prior ? [] : [stmt(db, 'INSERT INTO bm_continuity_proposals(id,client_id,series_id,practitioner_id,payload,digest,prepared_at,prepared_by) VALUES(?,?,?,?,?,?,?,?)', key, p.payload.clientId, p.payload.seriesId, p.payload.practitionerId, JSON.stringify(p.payload), p.digest, now(), p.live.email)]),
      audit(db, p.live, 'continuity.prepared', p.payload.clientId, key, p.digest)])
    return { id: key, digest: p.digest, payload: p.payload, booked: false, reserved: false, outbound: false }
  }
  insist(name === 'continuity.approve', 'unknown_command', 404)
  const live = await clinician(db, who)
  const stored = await one(db, 'SELECT * FROM bm_continuity_proposals WHERE id=? AND practitioner_id=?', text(input.id, 'proposal', 100), practitionerId(live))
  insist(stored, 'continuity_proposal_not_found', 404)
  insist(stored.review_authority === 1 && !stored.approved_at, 'continuity_review_not_active', 409)
  insist(input.confirm === true || input.confirm === 'on', 'confirm_exact_continuity_preparation')
  insist(input.digest === stored.digest, 'continuity_changed_review_again', 409)
  const p = await proposal(db, live, stored.series_id)
  insist(p.digest === stored.digest, 'continuity_changed_review_again', 409)
  await commit(db, p.live, [...sourceGuards(db, p.versions),
    guard(db, 'EXISTS(SELECT 1 FROM bm_clients WHERE id=? AND version=? AND erased_at IS NULL)', p.payload.clientId, p.payload.clientVersion),
    guard(db, 'EXISTS(SELECT 1 FROM bm_continuity_proposals WHERE id=? AND digest=? AND approved_at IS NULL AND review_authority=1)', stored.id, p.digest),
    ...((await Promise.all(p.payload.occurrences.map(o => placementGuards(db, { practitionerId: p.payload.practitionerId, serviceId: p.payload.serviceId, roomId: p.payload.roomId, startAt: o.startAt, endAt: o.endAt })))).flat()),
    stmt(db, 'UPDATE bm_continuity_proposals SET approved_at=?,approved_by=? WHERE id=?', now(), live.email, stored.id),
    audit(db, live, 'continuity.preparation_approved', stored.client_id, stored.id, stored.digest)])
  return { id: stored.id, approved: true, booked: false, reserved: false, outbound: false }
}

export async function continuityFor(db: D1Database, who: Actor, clientId: string, required = false) {
  if (!practitionerId(who) || who.staffKind !== 'practitioner') {
    insist(!required, 'continuity_requires_treating_clinician', 403)
    return null
  }
  const live = await clinician(db, who)
  const series = await rows(db, `SELECT s.id,s.pattern,p.name AS practitioner,v.name AS service FROM bm_series s JOIN bm_staff p ON p.id=s.practitioner_id JOIN bm_services v ON v.id=s.service_id JOIN bm_clients c ON c.id=s.client_id WHERE s.client_id=? AND s.practitioner_id=? AND c.erased_at IS NULL ORDER BY s.created_at DESC,s.id`, text(clientId, 'client', 100), practitionerId(live))
  if (required) insist(series.length, 'continuity_series_not_found', 404)
  if (!series.length) return null
  const proposals = await rows(db, 'SELECT * FROM bm_continuity_proposals WHERE client_id=? AND practitioner_id=? ORDER BY prepared_at DESC,id', clientId, practitionerId(live))
  const offers = await rows(db, `SELECT o.*,a.accepted_at,a.appointment_ids,a.authorization FROM bm_continuity_offers o
    LEFT JOIN bm_continuity_acceptances a ON a.offer_id=o.id WHERE o.client_id=? AND o.practitioner_id=? ORDER BY o.released_at DESC`, clientId, practitionerId(live))
  await commit(db, live, [guard(db, 'EXISTS(SELECT 1 FROM bm_clients WHERE id=? AND erased_at IS NULL)', clientId), audit(db, live, 'continuity.read', clientId)])
  return { series: series.filter(s => JSON.parse(s.pattern).planId), proposals: proposals.map(p => ({ ...p, payload: JSON.parse(p.payload), offers: offers.filter(o => o.proposal_id === p.id) })) }
}

async function releaseContinuity(db: D1Database, who: Actor, name: string, input: Data) {
  const live = await clinician(db, who)
  if (name === 'continuity.withdraw') {
    const offer = await one(db, 'SELECT * FROM bm_continuity_offers WHERE id=? AND practitioner_id=?', text(input.id, 'offer', 100), practitionerId(live))
    insist(offer, 'continuity_offer_not_found', 404)
    await commit(db, live, [
      guard(db, 'NOT EXISTS(SELECT 1 FROM bm_continuity_acceptances WHERE offer_id=?)', offer.id),
      stmt(db, 'UPDATE bm_continuity_offers SET revoked_at=COALESCE(revoked_at,?) WHERE id=?', now(), offer.id),
      audit(db, live, 'continuity.offer_withdrawn', offer.client_id, offer.id),
    ])
    return { withdrawn: true }
  }
  const stored = await one(db, 'SELECT * FROM bm_continuity_proposals WHERE id=? AND practitioner_id=?', text(input.id, 'proposal', 100), practitionerId(live))
  insist(stored, 'continuity_proposal_not_found', 404)
  insist(stored.review_authority === 1 && stored.approved_at && stored.approved_by === live.email, 'continuity_review_not_active', 409)
  insist(input.confirm === true || input.confirm === 'on', 'confirm_exact_continuity_offer')
  insist(input.digest === stored.digest, 'continuity_changed_review_again', 409)
  const p = await proposal(db, live, stored.series_id)
  insist(p.digest === stored.digest, 'continuity_changed_review_again', 409)
  const prior = await one(db, `SELECT id,expires_at FROM bm_continuity_offers WHERE proposal_id=? AND execution_authority=1
    AND revoked_at IS NULL AND expires_at>? AND operator_version=? AND staff_version=? AND session_id IS ? ORDER BY released_at DESC LIMIT 1`, stored.id, now(), live.operatorVersion, live.staffVersion, live.sessionId ?? null)
  const key = prior?.id ?? id(), at = now()
  const expiresAt = prior?.expires_at ?? new Date(Math.min(Date.now() + 86400_000, Date.parse(p.payload.occurrences[0].startAt) - 120 * 60_000)).toISOString()
  insist(expiresAt > at, 'continuity_offer_expired', 409)
  await commit(db, live, [...sourceGuards(db, p.versions),
    guard(db, 'NOT EXISTS(SELECT 1 FROM bm_continuity_acceptances WHERE proposal_id=?)', stored.id),
    ...(prior ? [] : [stmt(db, `INSERT INTO bm_continuity_offers(id,proposal_id,client_id,practitioner_id,released_at,released_by,operator_id,operator_version,staff_version,session_id,expires_at)
      VALUES(?,?,?,?,?,?,?,?,?,?,?)`, key, stored.id, stored.client_id, practitionerId(live), at, live.email, live.id, live.operatorVersion, live.staffVersion, live.sessionId ?? null, expiresAt)]),
    audit(db, live, 'continuity.offered_in_portal', stored.client_id, key, stored.digest),
  ])
  return { id: key, expiresAt, booked: false, reserved: false, outbound: false }
}

// The portal receives only scheduling facts, never the clinician's source packet.
export async function patientContinuity(db: D1Database, patient: Patient) {
  if (patient.guardianEmail) return []
  const list = await rows(db, `SELECT o.id,o.expires_at,o.revoked_at,o.execution_authority,p.payload,a.accepted_at,a.appointment_ids
    FROM bm_continuity_offers o JOIN bm_continuity_proposals p ON p.id=o.proposal_id
    LEFT JOIN bm_continuity_acceptances a ON a.offer_id=o.id WHERE o.client_id=?
    AND (a.accepted_at IS NOT NULL OR (o.execution_authority=1 AND o.revoked_at IS NULL AND o.expires_at>?)) ORDER BY o.released_at DESC`, patient.clientId, now())
  await commit(db, null, [portalGuard(db, patient), audit(db, { email: 'patient-portal', role: 'patient' }, 'continuity.offers_read', patient.clientId)])
  return list.map(o => {
    const p = JSON.parse(o.payload)
    return { id: o.id, service: p.service, practitioner: p.practitioner, timeZone: p.timeZone, occurrences: p.occurrences.map((v: Data) => ({ startAt: v.startAt, endAt: v.endAt })), expiresAt: o.expires_at, acceptedAt: o.accepted_at }
  })
}

/** Exact reviewed dates and their allowance commit together, or no visit does. */
export async function acceptContinuity(db: D1Database, patient: Patient, input: Data) {
  insist(!patient.guardianEmail, 'continuity_patient_confirmation_required', 403)
  const offer = await one(db, `SELECT o.*,p.series_id,p.digest,p.review_authority FROM bm_continuity_offers o
    JOIN bm_continuity_proposals p ON p.id=o.proposal_id WHERE o.id=? AND o.client_id=?`, text(input.id, 'offer', 100), patient.clientId)
  insist(offer, 'continuity_offer_not_found', 404)
  insist(offer.execution_authority === 1 && offer.review_authority === 1 && !offer.revoked_at && offer.expires_at > now(), 'continuity_offer_not_active', 409)
  insist(!await one(db, 'SELECT 1 FROM bm_continuity_acceptances WHERE proposal_id=?', offer.proposal_id), 'continuity_already_accepted', 409)
  insist(input.confirm === true || input.confirm === 'on', 'confirm_all_continuity_dates')
  const live = await actor(db, offer.operator_id)
  insist(live.operatorVersion === offer.operator_version && live.staffVersion === offer.staff_version && practitionerId(live) === offer.practitioner_id, 'continuity_clinician_authority_changed', 409)
  const p = await proposal(db, live, offer.series_id)
  insist(p.digest === offer.digest, 'continuity_changed_review_again', 409)
  const ids = p.payload.occurrences.map(() => id()), at = now()
  const patientActor = { email: 'patient-portal', role: 'patient' }
  await commit(db, p.live, [portalGuard(db, patient), ...sourceGuards(db, p.versions),
    guard(db, 'EXISTS(SELECT 1 FROM bm_staff WHERE id=? AND version=? AND active=1 AND erased_at IS NULL)', offer.practitioner_id, offer.staff_version),
    guard(db, `EXISTS(SELECT 1 FROM bm_continuity_offers WHERE id=? AND execution_authority=1 AND revoked_at IS NULL AND expires_at>?)`, offer.id, at),
    ...(offer.session_id ? [guard(db, 'EXISTS(SELECT 1 FROM oa_sessions WHERE id=? AND revoked_at IS NULL AND expires_at>?)', offer.session_id, Date.now())] : []),
    guard(db, 'NOT EXISTS(SELECT 1 FROM bm_continuity_acceptances WHERE proposal_id=?)', offer.proposal_id),
    // Source revisions cover all existing bookings and signed usage before any
    // insert. Each appointment then reserves its normal visit or unit allowance.
    ...(await Promise.all(p.payload.occurrences.map(async (v: Data, i: number) => [
      guard(db, "julianday(?)>julianday('now')+120.0/1440", v.startAt),
      ...await appointmentStatements(db, patientActor, { id: ids[i], clientId: patient.clientId, practitionerId: p.payload.practitionerId,
        serviceId: p.payload.serviceId, roomId: p.payload.roomId, startAt: v.startAt, endAt: v.endAt, seriesId: p.payload.seriesId, bookedVia: 'online', coverageChoice: 'insured_claim' }),
      ...(p.payload.episodeId ? [stmt(db, `INSERT INTO bm_episode_records(record_kind,record_id,client_id,episode_id,assigned_at,assigned_by) VALUES('visit',?,?,?,?,?)
        ON CONFLICT(record_kind,record_id) DO UPDATE SET episode_id=excluded.episode_id`, ids[i], patient.clientId, p.payload.episodeId, at, 'clinician-reviewed continuity')]
        // The ordinary insert trigger chooses the only open episode. A plan
        // that predates it must retain its reviewed unassigned authorization.
        : [stmt(db, "DELETE FROM bm_episode_records WHERE record_kind='visit' AND record_id=?", ids[i])]),
    ]))).flat(),
    stmt(db, 'INSERT INTO bm_continuity_acceptances(proposal_id,offer_id,client_id,accepted_at,appointment_ids,authorization) VALUES(?,?,?,?,?,?)', offer.proposal_id, offer.id, patient.clientId, at, JSON.stringify(ids), JSON.stringify(p.payload.authorization)),
    audit(db, patientActor, 'continuity.accepted_and_booked', patient.clientId, offer.id, offer.digest),
  ])
  return { redirect: '/portal/home?scheduled=1#visits' }
}
