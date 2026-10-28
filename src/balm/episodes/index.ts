// REF-003 episodes of care (ct 19 Oct 17:20Z): immutable per-patient episodes, a
// labelled "not assigned" bucket for records filed before episodes (never guessed by
// date), explicit human assignment, refusal when a staff action would have to pick
// between open episodes, and an explicit close that leaves signed records unchanged.
// Episodes add no read rights: each record keeps the access rules it already had.
import { clientVisible } from '../domain/clients'
import { episodeStart } from '../referrals'
import { audit, commit, guard, human, id, insist, now, one, optional, practitionerId, rows, stmt, text, type Actor, type Data } from '../domain/model'

/** The bucket for records no episode holds; its id is the empty string. */
export const NOT_ASSIGNED = { id: '', title: 'Not assigned to an episode' }
export const episodeKinds = ['visit', 'note', 'plan', 'authorization', 'document', 'message', 'historical_note'] as const
export type EpisodeKind = typeof episodeKinds[number]

const recordOwner: Record<EpisodeKind, string> = {
  visit: 'SELECT client_id,practitioner_id AS owner FROM bm_appointments WHERE id=?',
  note: 'SELECT client_id,author_id AS owner FROM bm_notes WHERE id=? AND appointment_id IS NULL',
  plan: 'SELECT client_id,author_id AS owner FROM bm_plans_of_care WHERE id=?',
  authorization: 'SELECT p.client_id,NULL AS owner FROM bm_authorizations z JOIN bm_policies p ON p.id=z.policy_id WHERE z.id=?',
  document: 'SELECT client_id,NULL AS owner FROM bm_chart_documents WHERE id=?',
  message: 'SELECT client_id,NULL AS owner FROM bm_messages WHERE id=?',
  historical_note: 'SELECT client_id,NULL AS owner FROM bm_movein_notes WHERE id=?',
}

const link = (db: D1Database, kind: EpisodeKind, recordId: string, clientId: string, episodeId: string, by: string) =>
  stmt(db, `INSERT INTO bm_episode_records(record_kind,record_id,client_id,episode_id,assigned_at,assigned_by) VALUES(?,?,?,?,?,?)
    ON CONFLICT(record_kind,record_id) DO UPDATE SET episode_id=excluded.episode_id,assigned_at=excluded.assigned_at,assigned_by=excluded.assigned_by`, kind, recordId, clientId, episodeId, now(), by)

/** Statements that file a new record a person is creating. A chosen episode must be open;
 * with no choice the record follows `inherited` (its visit's open episode) or the only open
 * episode (the producer trigger files it), and with several open episodes the action is refused. */
export async function episodeChoice(db: D1Database, who: Actor, clientId: string, kind: EpisodeKind, recordId: string, chosen?: unknown, inherited?: string | null) {
  const open = (await rows(db, 'SELECT id FROM bm_episodes WHERE client_id=? AND closed_at IS NULL', clientId)).map(e => e.id as string)
  const key = chosen ? text(chosen, 'episode', 100) : inherited && open.includes(inherited) ? inherited : null
  if (key) {
    insist(open.includes(key), 'episode_not_open', 409)
    return [link(db, kind, recordId, clientId, key, who.email)]
  }
  insist(open.length <= 1, 'choose_an_episode', 409)
  return []
}

/** The episode a new staff booking would land in, for authorization warnings: '' when none. */
export async function bookingEpisode(db: D1Database, clientId: string, chosen?: unknown) {
  if (chosen) return text(chosen, 'episode', 100)
  const open = await rows(db, 'SELECT id FROM bm_episodes WHERE client_id=? AND closed_at IS NULL LIMIT 2', clientId)
  return open.length === 1 ? open[0].id as string : ''
}

/** Episodes and record filings of one patient; `of` answers '' for a record no episode holds. */
export async function episodeIndex(db: D1Database, clientId: string) {
  const [episodes, links] = await Promise.all([
    rows(db, 'SELECT id,title,opened_at,opened_by,closed_at,closed_by,close_reason FROM bm_episodes WHERE client_id=? ORDER BY opened_at,id', clientId),
    rows(db, 'SELECT record_kind,record_id,episode_id FROM bm_episode_records WHERE client_id=?', clientId),
  ])
  const filed = new Map(links.map(l => [l.record_kind + ':' + l.record_id, l.episode_id as string]))
  return { episodes, of: (kind: EpisodeKind, recordId: string) => filed.get(kind + ':' + recordId) ?? '' }
}

/** Open, close and assign: the owner and reception, or a practitioner treating this patient. */
async function manager(db: D1Database, who: Actor, clientKey: unknown) {
  human(who)
  insist(who.role === 'owner' || who.staffRole === 'reception' || practitionerId(who), 'role_cannot_do_this', 403)
  return clientVisible(db, who, clientKey)
}

/** REF-001: every episode starts from a received referral of this patient or a direct-access entry. */
export async function openEpisode(db: D1Database, who: Actor, input: Data) {
  const client = await manager(db, who, input.clientId)
  const title = text(input.title, 'episode_title', 120), episodeId = id()
  const zone = (await one(db, 'SELECT time_zone FROM bm_settings WHERE id=1'))!.time_zone as string
  const start = await episodeStart(db, who, client, episodeId, input, zone)
  await commit(db, who, [
    stmt(db, 'INSERT INTO bm_episodes(id,client_id,title,opened_at,opened_by) VALUES(?,?,?,?,?)', episodeId, client.id, title, now(), who.email),
    audit(db, who, 'episode.opened', client.id as string, episodeId),
    ...start,
  ])
  return { id: episodeId, clientId: client.id, title }
}

/** Closing (discharge) freezes the episode's filings; signed notes and plans are not touched. */
export async function closeEpisode(db: D1Database, who: Actor, input: Data) {
  const episode = await one(db, 'SELECT * FROM bm_episodes WHERE id=?', text(input.id, 'episode', 100))
  insist(episode, 'episode_not_found', 404)
  await manager(db, who, episode.client_id)
  insist(!episode.closed_at, 'episode_closed', 409)
  const booked = `EXISTS(SELECT 1 FROM bm_episode_records r JOIN bm_appointments a ON a.id=r.record_id WHERE r.record_kind='visit' AND r.episode_id=? AND a.status='booked')`
  insist(!await one(db, `SELECT 1 WHERE ${booked}`, episode.id), 'episode_has_booked_visits', 409)
  await commit(db, who, [
    guard(db, `NOT ${booked}`, episode.id),
    stmt(db, 'UPDATE bm_episodes SET closed_at=?,closed_by=?,close_reason=? WHERE id=? AND closed_at IS NULL', now(), who.email, optional(input.reason, 'close_reason', 300) ?? '', episode.id),
    guard(db, 'changes()=1'),
    audit(db, who, 'episode.closed', episode.client_id as string, episode.id as string),
  ])
  return { id: episode.id, closed: true }
}

/** File one existing record to an open episode of its own patient. Reception files visits and
 * authorizations only; a practitioner files their own visits, notes and plans and the patient's
 * documents, messages and historical notes; the owner files anything. */
export async function assignEpisode(db: D1Database, who: Actor, input: Data) {
  const kind = text(input.kind, 'record_kind', 30) as EpisodeKind
  insist(episodeKinds.includes(kind), 'invalid_record_kind')
  const recordId = text(input.recordId, 'record', 100)
  const record = await one(db, recordOwner[kind], recordId)
  insist(record, 'record_not_found', 404)
  const client = await manager(db, who, record.client_id)
  if(kind==='plan'||kind==='document')insist(!await one(db,`SELECT 1 FROM bm_plan_certifications WHERE ${kind==='plan'?'plan_id':'document_id'}=?`,recordId),'certified_plan_episode_is_fixed',409)
  if(kind==='plan')insist(!await one(db,'SELECT 1 FROM bm_plan_replacements WHERE predecessor_id=? OR successor_id=?',recordId,recordId),'replacement_plan_episode_is_fixed',409)
  if(kind==='document')insist(!await one(db,'SELECT 1 FROM bm_letter_deliveries WHERE document_id=?',recordId),'delivered_letter_episode_is_fixed',409)
  if (who.role !== 'owner') {
    if (who.staffRole === 'reception') insist(kind === 'visit' || kind === 'authorization', 'clinical_access_required', 403)
    else insist(kind !== 'authorization' && (record.owner === null || record.owner === practitionerId(who)), 'record_not_found', 404)
  }
  const episodeId = text(input.episodeId, 'episode', 100)
  const target = await one(db, 'SELECT id,closed_at FROM bm_episodes WHERE id=? AND client_id=?', episodeId, client.id)
  insist(target, 'episode_not_found', 404)
  insist(!target.closed_at, 'episode_not_open', 409)
  const previous = await one(db, 'SELECT episode_id FROM bm_episode_records WHERE record_kind=? AND record_id=?', kind, recordId)
  await commit(db, who, [link(db, kind, recordId, client.id as string, episodeId, who.email),
    audit(db, who, 'episode.assigned', client.id as string, recordId, `${kind}: ${previous?.episode_id ?? 'not assigned'} -> ${episodeId}`)])
  return { kind, recordId, episodeId }
}

export async function episodeCommand(db: D1Database, who: Actor, name: string, input: Data) {
  if (name === 'episode.open') return openEpisode(db, who, input)
  if (name === 'episode.close') return closeEpisode(db, who, input)
  if (name === 'episode.assign') return assignEpisode(db, who, input)
  insist(false, 'unknown_command', 404)
}
