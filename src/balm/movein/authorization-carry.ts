import { hostDateAt } from '../availability/timezone'
import { audit, guard, rows, stmt, type Actor, type Data } from '../domain/model'
import { policyRecord, policyStatement } from '../insurance/policy'
import type { Bundle, BundleDiagnostic } from './formats'
import { targetId, type BundlePlan } from './bundle-plan'

/** Source policy identities are explicit; no payer or subscriber is inferred. */
export async function planAuthorizationCarry(db: D1Database, bundle: Bundle, patients: { sourceId: string; id: string; firstName: string; lastName: string; dateOfBirth: string | null }[], diagnostics: BundleDiagnostic[], timeZone: string) {
  const payers = await rows(db, 'SELECT id,version FROM bm_payers'), staff = await rows(db, "SELECT id,version FROM bm_staff WHERE role='practitioner' AND active=1 AND erased_at IS NULL")
  const policies = new Map<string, Data>(), mappings: unknown[] = [], authorizations = []
  for (const record of bundle.carriedAuthorizations) {
    const fail = (message: string) => diagnostics.push({ severity: 'error', code: 'authorization_carry_invalid', message, file: record.file, row: record.row })
    if (record.cutoverOn > hostDateAt(new Date(), timeZone)) fail('The source cutover date cannot be in the future.')
    const patient = patients.find(p => p.sourceId === record.patientId)
    if (!patient) continue
    const payer = payers.find(p => p.id === record.policyInput.payerId), practitioner = staff.find(p => p.id === record.practitionerId)
    if (!payer) fail('Choose an existing Balm payer identifier for the authorization policy.')
    if (record.practitionerId && !practitioner) fail('The authorization practitioner must be an active Balm practitioner.')
    mappings.push([record.sourceId, payer?.id, payer?.version, practitioner?.id, practitioner?.version])
    try {
      const policy = policyRecord({ id: patient.id, first_name: patient.firstName, last_name: patient.lastName, date_of_birth: patient.dateOfBirth }, record.policyInput, await targetId(bundle.provider, 'policy', record.policySourceId))
      if (record.startsOn < policy.starts_on || (!policy.ends_on || record.endsOn > policy.ends_on)) fail('The authorization dates must be within the source policy coverage dates.')
      const previous = policies.get(record.policySourceId)
      if (previous && JSON.stringify(previous) !== JSON.stringify(policy)) fail('The same source policy identifier has conflicting patient or coverage facts.')
      policies.set(record.policySourceId, policy)
      authorizations.push({ ...record, id: await targetId(bundle.provider, 'authorization', record.sourceId), policyId: policy.id, clientId: patient.id, payerVersion: payer?.version ?? -1, practitionerVersion: practitioner?.version ?? null })
    } catch { fail('The authorization needs complete, valid policy and subscriber facts. Review dates, birth date, sex, relationship and address.') }
  }
  return { policies: [...policies.values()], authorizations, mappings }
}

/** Same owner-guarded transaction as patients, original source and reconciliation. */
export function authorizationCarryStatements(db: D1Database, who: Actor, plan: BundlePlan, jobId: string) {
  const body: D1PreparedStatement[] = []
  for (const policy of plan.authorizationCarry.policies) body.push(
    guard(db, 'NOT EXISTS(SELECT 1 FROM bm_policies WHERE id=?)', policy.id), policyStatement(db, policy),
    stmt(db, "INSERT INTO bm_movein_records(job_id,provider,kind,source_id,target_table,target_id,snapshot) VALUES(?,?,'policy',?,'bm_policies',?,?)", jobId, plan.provider, policy.id, policy.id, JSON.stringify(policy)),
    audit(db, who, 'insurance.policy_saved', policy.client_id, policy.id),
  )
  for (const a of plan.authorizationCarry.authorizations) body.push(
    guard(db, 'EXISTS(SELECT 1 FROM bm_payers WHERE id=? AND version=?)', a.policyInput.payerId, a.payerVersion),
    ...(a.practitionerId ? [guard(db, "EXISTS(SELECT 1 FROM bm_staff WHERE id=? AND version=? AND role='practitioner' AND active=1 AND erased_at IS NULL)", a.practitionerId, a.practitionerVersion)] : []),
    stmt(db, `INSERT INTO bm_authorizations(id,policy_id,number,starts_on,ends_on,visits,practitioner_id,booking_action,allowance_kind,units,units_per_visit,cpt_scope,low_remainder,imported_used,imported_cutover_on) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,2,?,?)`, a.id, a.policyId, a.number, a.startsOn, a.endsOn, a.allowanceKind === 'visits' ? a.allowance : 1, a.practitionerId || null, a.bookingAction, a.allowanceKind, a.allowanceKind === 'units' ? a.allowance : null, a.allowanceKind === 'units' ? a.unitsPerVisit : null, JSON.stringify(a.cptScope), a.used, a.cutoverOn),
    stmt(db, "INSERT INTO bm_movein_records(job_id,provider,kind,source_id,target_table,target_id,snapshot) VALUES(?,?,'authorization',?,'bm_authorizations',?,?)", jobId, plan.provider, a.sourceId, a.id, JSON.stringify(a)),
    audit(db, who, 'insurance.authorization_saved', a.clientId, a.id),
  )
  return body
}
