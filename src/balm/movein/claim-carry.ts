import { audit, guard, rows, sha256, stmt, type Actor } from '../domain/model'
import type { Bundle, BundleDiagnostic } from './formats'
import { chunks } from './batches'
import { targetId, type BundlePlan } from './bundle-plan'

/** Resolve only explicit source patient and configured payer identifiers. */
export async function planClaimCarry(db: D1Database, bundle: Bundle, patients: { sourceId: string; id: string }[], previousJob: string | undefined, diagnostics: BundleDiagnostic[]) {
  if (!bundle.carriedClaims.length) return []
  const [payers, existing, native, closed] = await Promise.all([
    rows(db, 'SELECT id,version FROM bm_payers'),
    rows(db, 'SELECT id,source,source_claim,payer_id,patient_control,payer_control FROM bm_migrated_claims'),
    rows(db, 'SELECT id FROM bm_claims'),
    rows(db, 'SELECT id FROM bm_runout_closures WHERE reopened_at IS NULL'),
  ])
  const own = new Set(previousJob ? (await rows(db, "SELECT target_id FROM bm_movein_records WHERE job_id=? AND target_table='bm_migrated_claims'", previousJob)).map(r => r.target_id) : [])
  const payerById = new Map(payers.map(p => [p.id, p])), clientBySource = new Map(patients.map(p => [p.sourceId, p.id]))
  const nativeIds = new Set(native.map(n => n.id))
  const sourceIds = new Set<string>(), controls = new Set<string>()
  for (const c of existing.filter(c => !own.has(c.id))) {
    sourceIds.add(JSON.stringify([c.source, c.source_claim]))
    controls.add(JSON.stringify([c.payer_id, 'patient', c.patient_control]))
    if (c.payer_control) controls.add(JSON.stringify([c.payer_id, 'payer', c.payer_control]))
  }
  const seen = new Set<string>()
  return Promise.all(bundle.carriedClaims.map(async c => {
    const fail = (code: string, message: string) => diagnostics.push({ severity: 'error', code, message, file: c.file, row: c.row })
    const payer = payerById.get(c.payerId), clientId = clientBySource.get(c.patientId) ?? ''
    if (!payer) fail('claim_payer_not_found', 'Choose an existing Balm payer identifier; a payer name is not an identity mapping.')
    if (closed.length && !previousJob) fail('claim_runout_closed', 'Reopen the receivables run-out before carrying additional claims.')
    const keys = [JSON.stringify([c.payerId, 'patient', c.patientControl]), ...(c.payerControl ? [JSON.stringify([c.payerId, 'payer', c.payerControl])] : [])]
    if (keys.some(k => seen.has(k))) fail('claim_control_ambiguous', 'Two carried claims share a patient or payer control for this payer; resolve the originals before cutover.')
    keys.forEach(k => seen.add(k))
    if (nativeIds.has(c.patientControl)) fail('claim_control_is_native', 'This patient control already identifies a Balm claim.')
    if (sourceIds.has(JSON.stringify([bundle.provider, c.sourceId])) || keys.some(k => controls.has(k))) fail('claim_already_carried', 'This source claim or payer control is already carried. Review its original import; it cannot be carried twice.')
    const record = { sourceClaim: c.sourceId, clientId, payerId: c.payerId, patientControl: c.patientControl, payerControl: c.payerControl, serviceDate: c.serviceDate, billedCents: c.billedCents, balanceCents: c.balanceCents, status: c.status }
    return { ...c, id: await targetId(bundle.provider, 'claim', c.sourceId), clientId, payerVersion: payer?.version ?? -1, sourceHash: await sha256(JSON.stringify(record)) }
  }))
}

/** Joined to the move-in's owner-guarded transaction; no intermediate patient-only apply. */
export function carryClaimStatements(db: D1Database, who: Actor, plan: BundlePlan, jobId: string, at: string) {
  if (!plan.carriedClaims.length) return []
  const body = [guard(db, 'NOT EXISTS(SELECT 1 FROM bm_runout_closures WHERE reopened_at IS NULL)')]
  for (const group of chunks(plan.carriedClaims)) {
    const data = JSON.stringify(group)
    body.push(
      guard(db, `NOT EXISTS(SELECT 1 FROM json_each(?) r LEFT JOIN bm_payers p ON p.id=json_extract(r.value,'$.payerId') AND p.version=json_extract(r.value,'$.payerVersion') WHERE p.id IS NULL)`, data),
      guard(db, `NOT EXISTS(SELECT 1 FROM json_each(?) r JOIN bm_claims c ON c.id=json_extract(r.value,'$.patientControl'))`, data),
      guard(db, `NOT EXISTS(SELECT 1 FROM json_each(?) r JOIN bm_migrated_claims c ON (c.source=? AND c.source_claim=json_extract(r.value,'$.sourceId')) OR (c.payer_id=json_extract(r.value,'$.payerId') AND (c.patient_control=json_extract(r.value,'$.patientControl') OR (json_extract(r.value,'$.payerControl')<>'' AND c.payer_control=json_extract(r.value,'$.payerControl')))))`, data, plan.provider),
      stmt(db, `INSERT INTO bm_migrated_claims(id,source,source_claim,client_id,payer_id,source_hash,patient_control,payer_control,service_date,billed_cents,initial_cents,balance_cents,status,imported_by,imported_at)
        SELECT json_extract(value,'$.id'),?,json_extract(value,'$.sourceId'),json_extract(value,'$.clientId'),json_extract(value,'$.payerId'),json_extract(value,'$.sourceHash'),json_extract(value,'$.patientControl'),json_extract(value,'$.payerControl'),json_extract(value,'$.serviceDate'),json_extract(value,'$.billedCents'),json_extract(value,'$.balanceCents'),json_extract(value,'$.balanceCents'),json_extract(value,'$.status'),?,? FROM json_each(?)`, plan.provider, who.email, at, data),
      stmt(db, `INSERT INTO bm_movein_records(job_id,provider,kind,source_id,target_table,target_id,snapshot) SELECT ?,?,'claim',json_extract(value,'$.sourceId'),'bm_migrated_claims',json_extract(value,'$.id'),value FROM json_each(?)`, jobId, plan.provider, data),
    )
  }
  body.push(audit(db, who, 'movein.claims_carried', null, jobId, String(plan.carriedClaims.length)))
  return body
}
