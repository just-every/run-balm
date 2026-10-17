import { audit, commit, guard, human, id, insist, need, now, one, rows, stmt, text, type Actor, type Data } from '../domain/model'

export const policyKinds = [
  ['treatment', 'Consent to treat'], ['hipaa', 'HIPAA Notice of Privacy Practices acknowledgment'],
  ['financial', 'Financial policy'], ['cancellation', 'Cancellation policy'],
  ['telehealth', 'Telehealth consent'], ['sms', 'SMS consent'],
] as const
export const optionalPolicy = (kind: string) => kind === 'sms' || kind === 'telehealth'
export const policyField = (kind: string, field: 'Version' | 'Accepted') => `consent${field}${kind === 'treatment' ? '' : '_' + kind}`

export async function currentPolicies(db: D1Database) {
  return rows(db, `SELECT p.* FROM bm_consent_policies p WHERE version=(SELECT MAX(version) FROM bm_consent_policies WHERE kind=p.kind) ORDER BY p.kind`)
}
export async function pendingPolicies(db: D1Database, clientId: string) {
  const policies = await currentPolicies(db)
  const completed = await rows(db, `SELECT policy_version AS id FROM bm_intake_consents WHERE client_id=? UNION SELECT policy_id AS id FROM bm_consent_declines WHERE client_id=?`, clientId, clientId)
  return policies.filter(p => !completed.some(c => c.id === p.id))
}
export function policiesFence(db: D1Database, policies: Data[]) {
  return guard(db, `(SELECT group_concat(id,',') FROM (SELECT p.id FROM bm_consent_policies p WHERE version=(SELECT MAX(version) FROM bm_consent_policies WHERE kind=p.kind) ORDER BY p.kind))=?`, policies.map(p => p.id).join(','))
}
export async function publishPolicy(db: D1Database, who: Actor, input: Data) {
  human(who); need(who, 'owner')
  const kind = text(input.kind, 'policy_kind', 30)
  insist(policyKinds.some(([key]) => key === kind), 'invalid_policy_kind')
  const title = text(input.title, 'policy_title', 160), body = text(input.body, 'policy_text', 30000)
  const previous = await one(db, 'SELECT MAX(version) AS version FROM bm_consent_policies WHERE kind=?', kind)
  const version = Number(previous?.version ?? 0) + 1, key = id()
  insist(Number(input.version ?? 0) === version - 1, 'policy_changed_reload', 409)
  await commit(db, who, [guard(db, 'COALESCE((SELECT MAX(version) FROM bm_consent_policies WHERE kind=?),0)=?', kind, version - 1),
    stmt(db, 'INSERT INTO bm_consent_policies(id,kind,title,body,version,published_at,published_by) VALUES(?,?,?,?,?,?,?)', key, kind, title, body, version, now(), who.email),
    audit(db, who, 'consent.policy_published', null, key, `${kind} v${version}`)])
  return { id: key, kind, version }
}
