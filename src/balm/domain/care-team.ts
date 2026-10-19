// CHART-013 care-team access (ct 19 Oct 12:12Z). Only the owner grants or revokes
// a practitioner's read-only access to one patient's notes. Any active practitioner
// may break glass on one patient by giving a reason: for 12 hours they read that
// patient's notes and CHART-009 documents, every read is audited with the reason,
// and the owner sees a notice in Balm until acknowledged. Nothing here lets anyone
// write, sign or amend another clinician's note, and no clinical text is copied.
import { audit, commit, guard, human, id, insist, need, now, one, practitionerId, rows, stmt, text, type Actor, type Data } from './model'

export const BREAK_GLASS_HOURS = 12

export type NoteAccess = { all: boolean; breakGlass: { id: string; reason: string } | null }

const activePractitioner = (db: D1Database, staffId: string) =>
  one(db, "SELECT id,name FROM bm_staff WHERE id=? AND role='practitioner' AND active=1 AND erased_at IS NULL", staffId)

/** Whether this actor reads every note of the patient, and the open break glass it reads under. */
export async function noteAccess(db: D1Database, who: Actor, clientId: string): Promise<NoteAccess> {
  if (who.role === 'owner') return { all: true, breakGlass: null }
  const own = practitionerId(who)
  if (!own) return { all: false, breakGlass: null }
  const grant = await one(db, 'SELECT 1 FROM bm_care_grants WHERE client_id=? AND practitioner_id=? AND revoked_at IS NULL', clientId, own)
  if (grant) return { all: true, breakGlass: null }
  const glass = await openBreakGlass(db, clientId, own)
  return glass ? { all: true, breakGlass: { id: glass.id as string, reason: glass.reason as string } } : { all: false, breakGlass: null }
}

export function openBreakGlass(db: D1Database, clientId: string, staffId: string) {
  return one(db, 'SELECT id,reason,expires_at FROM bm_break_glass WHERE client_id=? AND practitioner_id=? AND ended_at IS NULL AND expires_at>? ORDER BY opened_at DESC LIMIT 1', clientId, staffId, now())
}

/** A practitioner without a visit reaches the file only through a grant or open break glass. */
export async function careTeamOnly(db: D1Database, who: Actor, clientId: string) {
  const own = practitionerId(who)
  if (!own || await one(db, 'SELECT 1 FROM bm_appointments WHERE client_id=? AND practitioner_id=?', clientId, own)) return false
  return (await noteAccess(db, who, clientId)).all
}

/** SQL fragment for "this practitioner has open break glass on this client": binds client id, practitioner id, now. */
export const breakGlassOpen = 'EXISTS(SELECT 1 FROM bm_break_glass g WHERE g.client_id=? AND g.practitioner_id=? AND g.ended_at IS NULL AND g.expires_at>?)'

const liveClient = (db: D1Database, clientId: string) => guard(db, 'EXISTS(SELECT 1 FROM bm_clients WHERE id=? AND erased_at IS NULL)', clientId)

export async function grantCareTeam(db: D1Database, who: Actor, input: Data) {
  human(who); need(who, 'owner'); insist(who.role === 'owner', 'role_cannot_do_this', 403)
  const clientId = text(input.clientId, 'client', 100), staffId = text(input.practitionerId, 'practitioner', 100)
  insist(await one(db, 'SELECT 1 FROM bm_clients WHERE id=? AND erased_at IS NULL', clientId), 'client_not_found', 404)
  insist(await activePractitioner(db, staffId), 'practitioner_not_found', 404)
  insist(!await one(db, 'SELECT 1 FROM bm_care_grants WHERE client_id=? AND practitioner_id=? AND revoked_at IS NULL', clientId, staffId), 'care_team_access_already_granted', 409)
  const grantId = id()
  await commit(db, who, [liveClient(db, clientId),
    stmt(db, 'INSERT INTO bm_care_grants(id,client_id,practitioner_id,granted_by,granted_at) VALUES(?,?,?,?,?)', grantId, clientId, staffId, who.email, now()),
    audit(db, who, 'care_team.granted', clientId, grantId, staffId)])
  return { id: grantId, clientId, practitionerId: staffId }
}

export async function revokeCareTeam(db: D1Database, who: Actor, input: Data) {
  human(who); need(who, 'owner'); insist(who.role === 'owner', 'role_cannot_do_this', 403)
  const grant = await one(db, 'SELECT * FROM bm_care_grants WHERE id=? AND revoked_at IS NULL', text(input.id, 'grant', 100))
  insist(grant, 'care_team_grant_not_found', 404)
  await commit(db, who, [
    stmt(db, 'UPDATE bm_care_grants SET revoked_by=?,revoked_at=? WHERE id=? AND revoked_at IS NULL', who.email, now(), grant.id), guard(db, 'changes()=1'),
    audit(db, who, 'care_team.revoked', grant.client_id, grant.id, grant.practitioner_id)])
  return { id: grant.id, revoked: true }
}

/** Any active practitioner, giving a 10-500 character reason; reception and agents never. */
export async function breakGlass(db: D1Database, who: Actor, input: Data) {
  human(who)
  const own = practitionerId(who)
  insist(own && await activePractitioner(db, own), 'only_practitioners_break_glass', 403)
  const clientId = text(input.clientId, 'client', 100), reason = text(input.reason, 'break_glass_reason', 500)
  insist(reason.length >= 10, 'break_glass_reason_too_short')
  insist(await one(db, 'SELECT 1 FROM bm_clients WHERE id=? AND erased_at IS NULL', clientId), 'client_not_found', 404)
  const opened = new Date(), expires = new Date(opened.getTime() + BREAK_GLASS_HOURS * 3600_000).toISOString(), glassId = id()
  await commit(db, who, [liveClient(db, clientId),
    stmt(db, 'INSERT INTO bm_break_glass(id,client_id,practitioner_id,opened_by,reason,opened_at,expires_at) VALUES(?,?,?,?,?,?,?)', glassId, clientId, own, who.email, reason, opened.toISOString(), expires),
    audit(db, who, 'chart.break_glass', clientId, glassId, `${reason} (until ${expires})`)])
  return { id: glassId, clientId, expiresAt: expires }
}

async function ownerGlass(db: D1Database, who: Actor, input: Data) {
  human(who); need(who, 'owner'); insist(who.role === 'owner', 'role_cannot_do_this', 403)
  const glass = await one(db, 'SELECT * FROM bm_break_glass WHERE id=?', text(input.id, 'break_glass', 100))
  insist(glass, 'break_glass_not_found', 404)
  return glass
}

export async function endBreakGlass(db: D1Database, who: Actor, input: Data) {
  const glass = await ownerGlass(db, who, input)
  insist(!glass.ended_at && String(glass.expires_at) > now(), 'break_glass_already_closed', 409)
  await commit(db, who, [
    stmt(db, 'UPDATE bm_break_glass SET ended_by=?,ended_at=? WHERE id=? AND ended_at IS NULL', who.email, now(), glass.id), guard(db, 'changes()=1'),
    audit(db, who, 'chart.break_glass_ended', glass.client_id, glass.id)])
  return { id: glass.id, ended: true }
}

export async function acknowledgeBreakGlass(db: D1Database, who: Actor, input: Data) {
  const glass = await ownerGlass(db, who, input)
  insist(!glass.acknowledged_at, 'break_glass_already_acknowledged', 409)
  await commit(db, who, [
    stmt(db, 'UPDATE bm_break_glass SET acknowledged_by=?,acknowledged_at=? WHERE id=? AND acknowledged_at IS NULL', who.email, now(), glass.id), guard(db, 'changes()=1'),
    audit(db, who, 'chart.break_glass_acknowledged', glass.client_id, glass.id)])
  return { id: glass.id, acknowledged: true }
}

/** The owner's notices: every break glass not yet acknowledged. Names and reasons only, never clinical text. */
export async function breakGlassNotices(db: D1Database, who: Actor) {
  if (who.role !== 'owner') return null
  return rows(db, `SELECT g.id,g.client_id,g.reason,g.opened_at,g.expires_at,g.ended_at,s.name AS practitioner,c.first_name||' '||c.last_name AS client
    FROM bm_break_glass g JOIN bm_staff s ON s.id=g.practitioner_id JOIN bm_clients c ON c.id=g.client_id WHERE g.acknowledged_at IS NULL ORDER BY g.opened_at DESC,g.id`)
}

/** The owner's view of one file's care team: live grants and recent break-glass openings. */
export async function careTeamFor(db: D1Database, who: Actor, clientId: string) {
  if (who.role !== 'owner') return null
  const grants = await rows(db, `SELECT g.id,g.practitioner_id,g.granted_by,g.granted_at,s.name AS practitioner FROM bm_care_grants g JOIN bm_staff s ON s.id=g.practitioner_id
    WHERE g.client_id=? AND g.revoked_at IS NULL ORDER BY s.name,g.id`, clientId)
  const openings = await rows(db, `SELECT g.id,g.reason,g.opened_at,g.expires_at,g.ended_at,g.acknowledged_at,s.name AS practitioner FROM bm_break_glass g JOIN bm_staff s ON s.id=g.practitioner_id
    WHERE g.client_id=? ORDER BY g.opened_at DESC,g.id LIMIT 20`, clientId)
  return { grants, openings, now: now() }
}
