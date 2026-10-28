import type { Bindings } from '../../auth.server'
import { audit, commit, guard, human, id, insist, need, now, one, rows, stmt, text, type Actor, type Data } from './model'

/** Operator-supplied deployment inventory, never inferred from an agreement or archive. */
export function hostingDeployment(env?: Bindings) {
  try {
    const v = JSON.parse(env?.BALM_HOSTING_PROFILE ?? '')
    if (v.provider !== 'cloudflare' || ![v.account,v.deployment].every(x => typeof x === 'string' && x.trim() && x.length <= 300)) return null
    const services = serviceList(v.services)
    if (!['workers','d1','r2'].every(s => services.includes(s))) return null
    return { provider: v.provider as string, account: v.account.trim(), deployment: v.deployment.trim(), services }
  } catch { return null }
}
function serviceList(value: unknown): string[] {
  const list = Array.isArray(value) ? value : typeof value === 'string' ? value.split(/[\n,]/) : []
  insist(list.length > 0 && list.length <= 30 && list.every(s => typeof s === 'string' && /^[a-z][a-z0-9_-]{0,59}$/.test(s.trim())), 'list_hosting_services')
  return [...new Set(list.map(s => s.trim()))].sort()
}

/** Every prerequisite is evaluated again inside the transaction that creates data. */
function qualification(env?: Bindings) {
  const deployment = hostingDeployment(env)
  const configured = [env?.MAIL_PROVIDER && !['none','development'].includes(env.MAIL_PROVIDER) ? 'mail' : '',
    (env as any)?.SMS_PROVIDER ? 'sms' : '', env?.BALM_INSURANCE_ADAPTER_URL ? 'clearinghouse' : ''].filter(Boolean)
  return {
    sql: `EXISTS(SELECT 1 FROM bm_hosting_records h JOIN bm_hosting_qualifications q ON q.record_id=h.id
      JOIN oa_operators o ON o.id=q.owner_id AND o.version=q.owner_version AND o.status='active' AND o.role='owner'
      JOIN bm_baa_records b ON b.id=h.baa_id AND b.processor='hosting' AND b.revoked_at IS NULL
      JOIN bm_baa_records bb ON bb.id=h.backup_baa_id AND bb.processor='backups' AND bb.revoked_at IS NULL
      WHERE h.id=? AND ?=1 AND h.origin=? AND h.provider=? AND h.account=? AND h.deployment=? AND h.services=?
      AND NOT EXISTS(SELECT 1 FROM bm_hosting_revocations r WHERE r.record_id=h.id)
      AND NOT EXISTS(SELECT 1 FROM json_each(h.services) s WHERE NOT EXISTS(SELECT 1 FROM json_each(h.covered_services) c WHERE c.value=s.value)
        OR NOT EXISTS(SELECT 1 FROM json_each(h.service_evidence) e WHERE e.key=s.value AND e.type='text' AND length(trim(e.value))>0))
      AND EXISTS(SELECT 1 FROM bm_readiness WHERE id=1 AND length(trim(privacy_officer))>0 AND length(trim(security_officer))>0
        AND length(trim(risk_analysis))>0 AND length(trim(risk_reviewed_on))>0 AND length(trim(encryption_at_rest))>0 AND length(trim(encryption_in_transit))>0)
      AND NOT EXISTS(SELECT 1 FROM json_each(?) p WHERE NOT EXISTS(SELECT 1 FROM bm_baa_records WHERE processor=p.value AND revoked_at IS NULL))
      AND (NOT EXISTS(SELECT 1 FROM bm_scribe) OR EXISTS(SELECT 1 FROM bm_baa_records WHERE processor='scribe' AND revoked_at IS NULL))
      AND (NOT EXISTS(SELECT 1 FROM bm_backup_settings) OR EXISTS(SELECT 1 FROM bm_baa_records WHERE processor='backups' AND revoked_at IS NULL)))`,
    params: [deployment ? 1 : 0, env?.AUTH_ORIGIN ?? '', deployment?.provider ?? '', deployment?.account ?? '', deployment?.deployment ?? '', JSON.stringify(deployment?.services ?? []), JSON.stringify(configured)],
  }
}
export function patientCreationSql(env?: Bindings) {
  const q = qualification(env)
  return {
    sql: `(?=1 OR EXISTS(SELECT 1 FROM bm_patient_mode m WHERE m.id=1 AND m.origin=? AND (
      m.mode='demo' OR (m.mode='real' AND EXISTS(SELECT 1 FROM oa_operators o WHERE o.id=m.owner_id AND o.version=m.owner_version AND o.status='active' AND o.role='owner')
      AND ${q.sql.replace('h.id=?', 'h.id=m.record_id')}))))`,
    params: [env?.RER_DEMO === '1' ? 1 : 0, env?.AUTH_ORIGIN ?? '', ...q.params],
  }
}
export async function patientCreationFence(db: D1Database, env?: Bindings) {
  const p = patientCreationSql(env)
  insist(await one(db, 'SELECT 1 WHERE ' + p.sql, ...p.params), 'hosting_readiness_required', 409)
  return guard(db, p.sql, ...p.params)
}
export async function hostingState(env: Bindings) {
  const mode = await one(env.DB, 'SELECT * FROM bm_patient_mode WHERE id=1')
  const p = patientCreationSql(env), permitted = !!await one(env.DB, 'SELECT 1 WHERE ' + p.sql, ...p.params)
  return { mode: env.RER_DEMO === '1' ? 'demo' : mode?.mode ?? 'blocked', permitted,
    deployment: hostingDeployment(env), records: await rows(env.DB, `SELECT h.*,r.revoked_at,
      EXISTS(SELECT 1 FROM bm_hosting_qualifications q WHERE q.record_id=h.id) AS qualification_present
      FROM bm_hosting_records h LEFT JOIN bm_hosting_revocations r ON r.record_id=h.id ORDER BY h.recorded_at,h.id`),
    boundary: 'Owner-recorded evidence is not provider or legal verification. Demo mode permits synthetic data only. Real-patient mode requires matching deployment inventory, complete service and BAA coverage, readiness and locked-backup evidence. AWS deployment and live qualification remain unproved.' }
}
export async function hostingCommand(env: Bindings, who: Actor, name: string, input: Data) {
  need(who, 'owner'); human(who)
  const db = env.DB
  if (name === 'hosting.record') {
    insist(input.attest === true || input.attest === 'on', 'confirm_hosting_evidence')
    const provider = text(input.provider, 'hosting_provider', 30)
    insist(['aws','cloudflare'].includes(provider), 'unknown_hosting_provider')
    const services = serviceList(input.services), coverage = serviceList(input.coveredServices)
    let evidence: Data
    try { evidence = typeof input.serviceEvidence === 'string' ? JSON.parse(input.serviceEvidence) : input.serviceEvidence } catch { evidence = {} }
    insist(evidence && typeof evidence === 'object' && !Array.isArray(evidence), 'record_service_eligibility_evidence')
    const eligibility = Object.fromEntries(Object.entries(evidence).map(([key,value]) => [text(key,'service',60),text(value,'service_evidence',1000)]))
    const key = id(), baa = text(input.baaId,'hosting_baa',100), backupBaa = text(input.backupBaaId,'backup_baa',100)
    await commit(db, who, [
      guard(db,"EXISTS(SELECT 1 FROM bm_baa_records WHERE id=? AND processor='hosting' AND revoked_at IS NULL)",baa),
      guard(db,"EXISTS(SELECT 1 FROM bm_baa_records WHERE id=? AND processor='backups' AND revoked_at IS NULL)",backupBaa),
      stmt(db, 'INSERT INTO bm_hosting_records VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)', key,env.AUTH_ORIGIN,provider,text(input.account,'hosting_account',300),text(input.deployment,'hosting_deployment',300),JSON.stringify(services),JSON.stringify(coverage),JSON.stringify(eligibility),baa,backupBaa,text(input.qualificationReference,'qualification_reference',1000),text(input.backupReceipt,'locked_backup_receipt',1000),text(input.drillReceipt,'restore_drill_receipt',1000),now(),who.email),
      stmt(db, 'INSERT INTO bm_hosting_qualifications VALUES(?,?,?)',key,who.id,who.operatorVersion),
      audit(db, who, 'hosting.evidence_recorded', null, key),
    ])
    return { id: key }
  }
  if (name === 'hosting.revoke') {
    const key = text(input.id,'hosting_record',100)
    await commit(db,who,[guard(db,'EXISTS(SELECT 1 FROM bm_hosting_records WHERE id=?)',key),stmt(db,'INSERT OR IGNORE INTO bm_hosting_revocations VALUES(?,?,?)',key,now(),who.email),audit(db,who,'hosting.revoked',null,key)])
    return { revoked: true }
  }
  insist(name === 'hosting.mode', 'unknown_command', 404)
  insist(['blocked','demo','real'].includes(input.mode), 'unknown_patient_mode')
  insist(input.attest === true || input.attest === 'on', 'confirm_patient_mode')
  const reason = text(input.reason,'patient_mode_reason',1000)
  const key = input.mode === 'real' ? text(input.id,'hosting_record',100) : null
  const q = qualification(env)
  if (key) insist(await one(db,'SELECT 1 WHERE '+q.sql,key,...q.params),'hosting_readiness_required',409)
  insist(env.RER_DEMO !== '1' || input.mode !== 'real','demo_cannot_enable_real_patients',409)
  await commit(db,who,[...(key ? [guard(db,q.sql,key,...q.params)] : []),
    stmt(db, 'UPDATE bm_patient_mode SET mode=?,origin=?,record_id=?,owner_id=?,owner_version=? WHERE id=1', input.mode,env.AUTH_ORIGIN,key,who.id,who.operatorVersion),
    audit(db,who,'hosting.mode_changed',null,key,input.mode+': '+reason)])
  return { mode: input.mode }
}
