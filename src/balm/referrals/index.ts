// REF-001: each episode of care starts from a referral or a direct-access entry. A
// referral's stage comes from its episode's own records, so it cannot drift: received
// (no live visit yet), scheduled (a booked or attended visit filed to the episode),
// evaluated (a signed initial evaluation on one of those visits), discharged (the
// episode closed); lost is recorded by a person and ends the referral.
import { hostDateAt } from '../availability/timezone'
import { audit, commit, guard, human, id, insist, need, now, one, optional, rows, stmt, text, type Actor, type Data } from '../domain/model'
import { lookupNpi, type Registered } from './nppes'

export const referralSources = [['physician', 'Physician'], ['other_provider', 'Other provider'], ['self', 'Self (direct access)'], ['insurer', 'Insurer'], ['employer', 'Employer'], ['attorney', 'Attorney'], ['website', 'Website'], ['other', 'Other']] as const
export const stageOrder = ['received', 'scheduled', 'evaluated', 'discharged'] as const
export type Stage = typeof stageOrder[number] | 'lost'

export const source = (value: unknown) => {
  const key = value ? text(value, 'referral_source', 30) : 'physician'
  insist(referralSources.some(([k]) => k === key), 'invalid_referral_source')
  return key
}

/** Each referral's stage, the clinic-local date it reached each stage, and the practitioner of its first live visit. */
export async function referralStages(db: D1Database, referrals: Data[], zone: string) {
  const episodes = referrals.map(r => r.episode_id).filter(Boolean) as string[], list = JSON.stringify(episodes)
  const [visits, evaluations, closed] = episodes.length ? await Promise.all([
    rows(db, `SELECT r.episode_id,a.practitioner_id,a.created_at FROM bm_episode_records r JOIN bm_appointments a ON a.id=r.record_id
      WHERE r.record_kind='visit' AND a.status IN ('booked','attended') AND r.episode_id IN (SELECT value FROM json_each(?)) ORDER BY a.created_at,a.id`, list),
    rows(db, `SELECT r.episode_id,MIN(n.signed_at) AS at FROM bm_notes n JOIN bm_episode_records r ON r.record_kind='visit' AND r.record_id=n.appointment_id
      WHERE n.signed_at IS NOT NULL AND n.template LIKE '%.evaluation' AND r.episode_id IN (SELECT value FROM json_each(?)) GROUP BY r.episode_id`, list),
    rows(db, 'SELECT id,closed_at FROM bm_episodes WHERE closed_at IS NOT NULL AND id IN (SELECT value FROM json_each(?))', list),
  ]) : [[], [], []]
  const local = (at: unknown) => at ? hostDateAt(new Date(String(at)), zone) : null
  return new Map(referrals.map(r => {
    const first = visits.find(v => v.episode_id === r.episode_id), evaluated = evaluations.find(e => e.episode_id === r.episode_id), done = closed.find(e => e.id === r.episode_id)
    const dates = { receivedOn: r.received_on as string, scheduledOn: local(first?.created_at), evaluatedOn: local(evaluated?.at), dischargedOn: local(done?.closed_at), lostOn: local(r.lost_at) }
    const stage: Stage = r.lost_at ? 'lost' : done ? 'discharged' : evaluated ? 'evaluated' : first ? 'scheduled' : 'received'
    return [r.id as string, { stage, ...dates, practitionerId: (first?.practitioner_id as string) ?? null }]
  }))
}

/** The registry record for a typed NPI, kept as retrieved for every later referral from that provider. */
export function providerStatement(db: D1Database, found: Registered) {
  return stmt(db, `INSERT INTO bm_referring_providers(npi,name,credential,kind,taxonomy,address,phone,fax,retrieved_at) VALUES(?,?,?,?,?,?,?,?,?)
    ON CONFLICT(npi) DO UPDATE SET name=excluded.name,credential=excluded.credential,kind=excluded.kind,taxonomy=excluded.taxonomy,address=excluded.address,phone=excluded.phone,fax=excluded.fax,retrieved_at=excluded.retrieved_at`,
  found.npi, found.name, found.credential, found.kind, found.taxonomy, found.address, found.phone, found.fax, found.retrievedAt)
}

/** Whether the owner turned the NPPES lookup on (OWN-001: a declared integration, off until then). */
export const nppesOn = async (db: D1Database) => (await one(db, 'SELECT nppes_lookup FROM bm_settings WHERE id=1'))?.nppes_lookup === 1

export async function saveNppesSetting(db: D1Database, who: Actor, input: Data) {
  human(who); need(who, 'owner')
  const on = input.enabled === true || input.enabled === 'on' || input.enabled === 'true'
  await commit(db, who, [stmt(db, 'UPDATE bm_settings SET nppes_lookup=? WHERE id=1', on ? 1 : 0), audit(db, who, on ? 'settings.nppes_lookup_on' : 'settings.nppes_lookup_off', null)])
  return { nppesLookup: on }
}

/** Look up a referring provider by NPI in NPPES. Staff only; the request carries the NPI alone. */
export async function npiLookup(db: D1Database, who: Actor, input: Data) {
  human(who); need(who, 'owner', 'reception', 'practitioner')
  insist(await nppesOn(db), 'npi_lookup_not_enabled', 409)
  const found = await lookupNpi(text(input.npi, 'referring_npi', 10))
  await commit(db, who, [providerStatement(db, found)])
  return found
}

/** How a new episode starts: a received referral of this patient, or a direct-access entry recorded now. */
export async function episodeStart(db: D1Database, who: Actor, client: Data, episodeId: string, input: Data, zone: string) {
  const chosen = input.referralId || (input.start && input.start !== 'direct_access' ? input.start : null)
  if (chosen) {
    const referral = await one(db, 'SELECT * FROM bm_referrals WHERE id=? AND client_id=?', text(chosen, 'referral', 100), client.id)
    insist(referral, 'referral_not_found', 404)
    insist(!referral.episode_id, 'referral_already_started_an_episode', 409)
    insist(!referral.lost_at, 'referral_lost', 409)
    return [stmt(db, 'UPDATE bm_referrals SET episode_id=?,version=version+1 WHERE id=? AND episode_id IS NULL AND lost_at IS NULL', episodeId, referral.id), guard(db, 'changes()=1'),
      audit(db, who, 'referral.episode_started', client.id as string, referral.id as string)]
  }
  insist(input.directAccess === true || input.directAccess === 'on' || input.start === 'direct_access', 'choose_a_referral_or_direct_access')
  const key = id()
  return [stmt(db, `INSERT INTO bm_referrals(id,client_id,received_on,referring_first,referring_last,diagnosis,reason,created_by,created_at,kind,source,episode_id)
      VALUES(?,?,?,'','',?,?,?,?,'direct_access','self',?)`, key, client.id, hostDateAt(new Date(), zone), optional(input.diagnosis, 'diagnosis', 200) ?? '', optional(input.reason, 'referral_reason', 2000) ?? '', who.email, now(), episodeId),
    audit(db, who, 'referral.direct_access', client.id as string, key)]
}

/** A person records that a referral will not come in. Booked visits are canceled first; an attended one means it was not lost. */
export async function markLost(db: D1Database, who: Actor, input: Data) {
  human(who); need(who, 'owner', 'reception')
  const referral = await one(db, 'SELECT * FROM bm_referrals WHERE id=?', text(input.id, 'referral', 100))
  insist(referral, 'referral_not_found', 404)
  insist(!referral.lost_at, 'referral_lost', 409)
  const live = `EXISTS(SELECT 1 FROM bm_episode_records r JOIN bm_appointments a ON a.id=r.record_id WHERE r.record_kind='visit' AND r.episode_id=? AND a.status IN ('booked','attended'))`
  insist(!referral.episode_id || !await one(db, `SELECT 1 WHERE ${live}`, referral.episode_id), 'referral_has_visits', 409)
  await commit(db, who, [
    ...(referral.episode_id ? [guard(db, `NOT ${live}`, referral.episode_id)] : []),
    stmt(db, 'UPDATE bm_referrals SET lost_at=?,lost_by=?,lost_reason=?,version=version+1 WHERE id=? AND lost_at IS NULL', now(), who.email, optional(input.reason, 'lost_reason', 300) ?? '', referral.id), guard(db, 'changes()=1'),
    audit(db, who, 'referral.lost', referral.client_id as string, referral.id as string),
  ])
  return { id: referral.id, stage: 'lost' }
}

/** The patient's referrals with their stages, for the file's episodes panel. */
export async function referralsFor(db: D1Database, clientId: string, zone: string) {
  const list = await rows(db, `SELECT r.id,r.policy_id,r.kind,r.source,r.received_on,r.referring_first,r.referring_last,r.referring_npi,r.npi_source,r.diagnosis,r.reason,r.episode_id,r.lost_at,r.lost_reason,
    p.name AS provider_name,p.credential AS provider_credential,p.retrieved_at AS provider_retrieved_at FROM bm_referrals r LEFT JOIN bm_referring_providers p ON p.npi=r.referring_npi AND r.npi_source='nppes'
    WHERE r.client_id=? ORDER BY r.received_on DESC,r.created_at DESC`, clientId)
  const stages = await referralStages(db, list, zone)
  return list.map(r => ({ ...r, ...stages.get(r.id as string)! }))
}

export async function referralCommand(db: D1Database, who: Actor, name: string, input: Data) {
  if (name === 'referral.npi_lookup') return npiLookup(db, who, input)
  if (name === 'referral.lost') return markLost(db, who, input)
  if (name === 'referral.nppes_setting') return saveNppesSetting(db, who, input)
  insist(false, 'unknown_command', 404)
}

