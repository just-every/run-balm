import type { Bindings } from '../../auth.server'
import { audit, commit, day, human, id, insist, need, now, one, rows, stmt, text, type Actor, type Data } from './model'

export const processors = [
  ['mail', 'Mail', 'A signed BAA covering the configured mail service and its HIPAA-eligible plan.'],
  ['sms', 'SMS', 'Twilio Security or Enterprise edition with a signed BAA covering the configured account.'],
  ['fax', 'Fax', 'A HIPAA-eligible fax plan with a signed BAA; fax is not connected in Balm.'],
  ['clearinghouse', 'Clearinghouse', 'A signed BAA covering the gateway and clearinghouse enrollment used by this practice.'],
  ['video', 'Video', 'A HIPAA-eligible video plan with a signed BAA; video is not connected in Balm.'],
  ['scribe', 'Scribe model', 'The configured model provider and endpoint must be on its BAA-covered enterprise or healthcare plan.'],
  ['backups', 'Backups', 'A signed storage BAA covering the bucket and eligible services, including encrypted off-site backups.'],
  ['hosting', 'Hosting account', 'HIPAA-005 owns eligible hosting, its BAA, real-patient mode and live backup proof.'],
] as const
export type Processor = typeof processors[number][0]

/** Re-read on each attempt: recording or removing a BAA never itself sends data. */
export async function baaBlock(db: D1Database, processor: Processor) {
  return await one(db, 'SELECT 1 FROM bm_baa_records WHERE processor=? AND revoked_at IS NULL LIMIT 1', processor)
    ? null : `Record the signed ${processor} BAA in Clinic readiness before enabling or using this integration.`
}
export async function requireBaa(db: D1Database, processor: Processor) {
  insist(!await baaBlock(db, processor), `record_${processor}_baa_first`, 409)
}

export async function readinessState(env: Bindings, who: Actor) {
  need(who, 'owner'); human(who)
  const record = await one(env.DB, 'SELECT * FROM bm_readiness WHERE id=1')
  const baas = await rows(env.DB, 'SELECT * FROM bm_baa_records ORDER BY recorded_at,id')
  const scribe = await one(env.DB, 'SELECT provider FROM bm_scribe WHERE id=1')
  const backups = await one(env.DB, 'SELECT endpoint,bucket FROM bm_backup_settings WHERE id=1')
  const host = (value: unknown) => { try { return new URL(String(value)).hostname } catch { return 'Not configured' } }
  const providers: Record<string,string> = {mail:String(env.MAIL_PROVIDER ?? 'Not configured'),sms:String((env as Bindings & { SMS_PROVIDER?: string }).SMS_PROVIDER ?? 'Not configured'),clearinghouse:env.BALM_INSURANCE_ADAPTER_URL?host(env.BALM_INSURANCE_ADAPTER_URL):'Not configured',scribe:String(scribe?.provider ?? 'Not configured'),backups:backups?host(backups.endpoint)+' · '+String(backups.bucket):'Not configured',hosting:'Not assessed; see HIPAA-005'}
  const configured: Record<string, boolean> = {
    mail: !!env.MAIL_PROVIDER && !['none','development'].includes(env.MAIL_PROVIDER),
    sms: !!(env as Bindings & { SMS_PROVIDER?: string }).SMS_PROVIDER,
    clearinghouse: !!env.BALM_INSURANCE_ADAPTER_URL,
    scribe: !!scribe,
    backups: !!backups,
  }
  const subprocessors = processors.map(([key, name, requirement]) => ({ key, name, requirement, provider:providers[key] ?? 'Not connected', configured: !!configured[key], baaOnFile: baas.some(b => b.processor === key && !b.revoked_at) }))
  const missing = ['privacy_officer','security_officer','risk_analysis','risk_reviewed_on','encryption_at_rest','encryption_in_transit'].filter(key => !record?.[key])
  for (const p of subprocessors) if (p.configured && !p.baaOnFile) missing.push(p.key + '_baa')
  return { record, baas, subprocessors, missing, ready: missing.length === 0,
    boundary: 'This checks owner-recorded integration readiness only. It does not verify legal documents, hosting eligibility or HIPAA compliance. HIPAA-005 and the practice privacy review still gate real patient use.' }
}

export async function readinessCommand(db: D1Database, who: Actor, name: string, input: Data) {
  need(who, 'owner'); human(who)
  if (name === 'readiness.save') {
    insist(input.attest === true || input.attest === 'on', 'confirm_readiness_facts')
    const values = [text(input.privacyOfficer,'privacy_officer',160), text(input.securityOfficer,'security_officer',160), text(input.riskAnalysis,'risk_analysis',4000), day(input.riskReviewedOn,'risk_reviewed_on'), text(input.encryptionAtRest,'encryption_at_rest',1000), text(input.encryptionInTransit,'encryption_in_transit',1000), now(), who.email]
    await commit(db, who, [stmt(db, `INSERT INTO bm_readiness VALUES(1,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET privacy_officer=excluded.privacy_officer,security_officer=excluded.security_officer,risk_analysis=excluded.risk_analysis,risk_reviewed_on=excluded.risk_reviewed_on,encryption_at_rest=excluded.encryption_at_rest,encryption_in_transit=excluded.encryption_in_transit,updated_at=excluded.updated_at,updated_by=excluded.updated_by`, ...values), audit(db,who,'readiness.recorded',null)])
    return { saved: true }
  }
  if (name === 'readiness.baa.record') {
    const processor = text(input.processor,'processor',30)
    insist(processors.some(p => p[0] === processor),'unknown_processor')
    insist(input.attest === true || input.attest === 'on','confirm_signed_baa_covers_service_and_plan')
    const plan = text(input.plan,'baa_plan',300)
    if (processor === 'sms') insist(/\b(?:security|enterprise)\b/i.test(plan),'record_twilio_security_or_enterprise_plan')
    const key = id()
    await commit(db,who,[stmt(db,'INSERT INTO bm_baa_records(id,processor,provider,plan,reference,signed_on,recorded_at,recorded_by) VALUES(?,?,?,?,?,?,?,?)',key,processor,text(input.provider,'provider',200),plan,text(input.reference,'baa_reference',1000),day(input.signedOn,'signed_on'),now(),who.email),audit(db,who,'readiness.baa_recorded',null,key,processor)])
    return { id: key }
  }
  insist(name === 'readiness.baa.revoke','unknown_command',404)
  const row = await one(db,'SELECT * FROM bm_baa_records WHERE id=? AND revoked_at IS NULL',text(input.id,'id',100))
  insist(row,'baa_not_found',404)
  await commit(db,who,[stmt(db,'UPDATE bm_baa_records SET revoked_at=? WHERE id=? AND revoked_at IS NULL',now(),row.id),audit(db,who,'readiness.baa_revoked',null,row.id as string)])
  return { revoked: true }
}
