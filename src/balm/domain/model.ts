// Guarded batches adapted from Satchel's atomic()/audit() (src/satchel/model.ts,
// just-every/run-satchel @ 2d460e4) and Strap's st_assert fence: every write
// re-checks the actor's live authority inside the same D1 batch.
export type StaffKind = 'practitioner' | 'reception' | 'biller' | 'assistant' | 'student' | 'fellow' | 'supervisor' | 'location_manager'
export type Role = 'owner' | 'practitioner' | 'reception' | 'agent'
export interface Actor {
  /** Native operator id (the owner's id for an agent key). */
  id: string; email: string; role: Role
  /** The linked staff row, when this person is on the clinic's staff list. */
  staffId?: string; staffRole?: 'practitioner' | 'reception'
  operatorVersion: number; staffVersion?: number; balanceVisibility?: boolean
  keyId?: string; keyScopes?: string[]; keyScope?: string
  sessionId?: string; staffKind?: StaffKind; supervisorId?: string; locationId?: string
}
export type Data = Record<string, any>

export class DomainError extends Error {
  /** `detail` travels with a refusal the caller must act on, such as a series' conflicting dates. */
  constructor(public code: string, public status = 400, public detail?: unknown) { super(code); this.name = 'DomainError' }
}
export function insist(condition: unknown, code: string, status = 400): asserts condition {
  if (!condition) throw new DomainError(code, status)
}
export const id = () => crypto.randomUUID()
/** A first and last name, as claims and signatures need; a local install's default owner name "Owner" is not one. */
export const fullName = (name: unknown) => typeof name === 'string' && name.trim().split(/\s+/).length >= 2 && name.trim().toLowerCase() !== 'owner'
export const now = () => new Date().toISOString()
export function text(value: unknown, field: string, max = 200): string {
  insist(typeof value === 'string' && value.trim().length > 0 && value.trim().length <= max && !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value), `invalid_${field}`)
  return value.trim()
}
export function optional(value: unknown, field: string, max = 200): string | null {
  if (value === undefined || value === null || (typeof value === 'string' && !value.trim())) return null
  return text(value, field, max)
}
export function integer(value: unknown, field: string, min = 0, max = 10_000_000): number {
  const number = typeof value === 'string' && /^-?\d+$/.test(value.trim()) ? Number(value) : value
  insist(typeof number === 'number' && Number.isSafeInteger(number) && number >= min && number <= max, `invalid_${field}`)
  return number
}
export function day(value: unknown, field: string): string {
  const v = text(value, field, 10)
  insist(/^\d{4}-\d\d-\d\d$/.test(v) && new Date(v + 'T00:00:00Z').toISOString().slice(0, 10) === v, `invalid_${field}`)
  return v
}
export function email(value: unknown, field = 'email'): string {
  const v = text(value, field, 254).toLowerCase()
  insist(/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v), `invalid_${field}`)
  return v
}
export async function sha256(value: string) {
  return [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value)))].map(b => b.toString(16).padStart(2, '0')).join('')
}
export const stmt = (db: D1Database, sql: string, ...values: unknown[]) => db.prepare(sql).bind(...values)
export async function rows<T = Data>(db: D1Database, sql: string, ...values: unknown[]) { return (await stmt(db, sql, ...values).all<T>()).results }
export async function one<T = Data>(db: D1Database, sql: string, ...values: unknown[]) { return await stmt(db, sql, ...values).first<T>() }

/** A failed predicate aborts the whole batch through bm_assert's CHECK. */
export function guard(db: D1Database, condition: string, ...values: unknown[]) {
  return stmt(db, `INSERT INTO bm_assert(value) SELECT CASE WHEN (${condition}) THEN 1 ELSE 0 END`, ...values)
}

export const human = (who: Actor) => insist(who.role !== 'agent', 'a_person_must_approve', 403)
export function need(who: Actor, ...roles: Role[]) {
  insist(roles.includes(who.role) || (who.staffRole && roles.includes(who.staffRole)), 'role_cannot_do_this', 403)
}
/** Practitioner powers come from a linked practitioner staff row, including the owner's own. */
export const practitionerId = (who: Actor) => who.staffRole === 'practitioner' ? who.staffId : undefined

function authority(db: D1Database, who: Actor) {
  if (who.role === 'owner' || who.role === 'agent') return guard(db, "EXISTS(SELECT 1 FROM oa_operators WHERE id=? AND lower(email)=lower(?) AND status='active' AND role='owner' AND version=?)", who.id, who.email, who.operatorVersion)
  return guard(db, `EXISTS(SELECT 1 FROM oa_operators o JOIN bm_staff s ON lower(s.email)=lower(o.email)
    WHERE o.id=? AND o.status='active' AND o.version=? AND s.id=? AND s.active=1 AND s.erased_at IS NULL AND s.role=? AND s.version=?)`,
  who.id, who.operatorVersion, who.staffId, who.staffRole, who.staffVersion)
}

export function audit(db: D1Database, who: Actor | { email: string; role: string }, action: string, clientId: string | null, subjectId: string | null = null, detail = '') {
  return stmt(db, 'INSERT INTO bm_audit(at,actor_email,actor_role,action,client_id,subject_id,detail) VALUES(?,?,?,?,?,?,?)', now(), who.email, (['owner','agent'].includes(who.role) ? who.role : ('staffKind' in who ? who.staffKind : null) ?? who.role), action, clientId, subjectId, detail)
}

/** One D1 batch: live authority, the caller's guards and writes, then cleanup. */
export async function commit(db: D1Database, who: Actor | null, statements: D1PreparedStatement[]) {
  try {
    await db.batch([...(who ? [authority(db, who),...(who.role==='agent'?[guard(db,`EXISTS(SELECT 1 FROM bm_agent_keys k WHERE k.id=? AND k.owner_id=? AND k.revoked_at IS NULL AND k.expires_at>? AND k.owner_version=? AND (k.scopes IS NULL OR EXISTS(SELECT 1 FROM json_each(k.scopes) WHERE value=?)))`,who.keyId??'',who.id,Date.now(),who.operatorVersion,who.keyScope??'')]:[]),...(who.sessionId?[guard(db,"EXISTS(SELECT 1 FROM oa_sessions s JOIN bm_staff_session_proofs p ON p.session_id=s.id JOIN bm_staff_security_policy c ON c.id=1 WHERE s.id=? AND s.revoked_at IS NULL AND s.expires_at>? AND p.last_seen_at+c.idle_minutes*60000>?)",who.sessionId,Date.now(),Date.now())]:[])] : []), ...statements, stmt(db, 'DELETE FROM bm_assert')])
  } catch (error) {
    if (/note_locked|plan_locked/.test(String(error))) throw new DomainError('signed_records_cannot_change', 409)
    if (/bm_assert|CHECK constraint|UNIQUE constraint|ik_d1_assertions/.test(String(error))) throw new DomainError('changed_refresh_and_retry', 409)
    throw error
  }
}

type OperatorRow = { id: string; email: string; role: string; status: string; version: number }
type StaffRow = { id: string; role: 'practitioner' | 'reception'; version: number; balance_visibility: number; kind: StaffKind; supervisor_id: string | null; location_id: string | null }
/** Resolves the current person from the native operator and the staff list. */
export async function actor(db: D1Database, operatorId: string, agent = false): Promise<Actor> {
  const operator = await one<OperatorRow>(db, 'SELECT id,email,role,status,version FROM oa_operators WHERE id=?', operatorId)
  insist(operator?.status === 'active', 'sign_in_required', 401)
  const staff = await one<StaffRow>(db, 'SELECT s.id,s.role,s.version,s.balance_visibility,COALESCE(a.kind,s.role) AS kind,a.supervisor_id,a.location_id FROM bm_staff s LEFT JOIN bm_staff_access a ON a.staff_id=s.id WHERE lower(s.email)=lower(?) AND s.active=1 AND s.erased_at IS NULL', operator.email)
  const base = { id: operator.id, email: operator.email, operatorVersion: operator.version }
  const scope = staff ? { staffKind: staff.kind, supervisorId: staff.supervisor_id ?? undefined, locationId: staff.location_id ?? undefined } : {}
  if (operator.role === 'owner') {
    if (agent) return { ...base, role: 'agent' }
    return { ...base, role: 'owner', ...(staff ? { staffId: staff.id, staffRole: staff.role, ...scope, staffVersion: staff.version, balanceVisibility: staff.role === 'practitioner' && !!staff.balance_visibility } : {}) }
  }
  if (!agent && !staff) {
    const previous = await one(db,'SELECT COALESCE(a.kind,s.role) AS kind FROM bm_staff s LEFT JOIN bm_staff_access a ON a.staff_id=s.id WHERE lower(s.email)=lower(?)',operator.email)
    await commit(db,null,[audit(db,{email:operator.email,role:String(previous?.kind ?? 'inactive staff')},'access.refused',null,null,'inactive staff access refused')])
  }
  insist(!agent && staff, 'active_staff_required', 403)
  return { ...base, role: staff.role, staffId: staff.id, staffRole: staff.role, ...scope, staffVersion: staff.version, balanceVisibility: staff.role === 'practitioner' && !!staff.balance_visibility }
}

/** BALM-001: a balance grant adds no client scope, copay/card access or payment powers. */
export const seesBalances = (who: Actor) => who.role === 'owner' || who.staffRole === 'reception' || (who.role === 'practitioner' && who.balanceVisibility === true)
