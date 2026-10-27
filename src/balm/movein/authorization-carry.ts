import { hostDateAt } from '../availability/timezone'
import { guard, now, rows, stmt, type Actor, type Data } from '../domain/model'
import { policyRecord, policyColumns } from '../insurance/policy'
import type { Bundle, BundleDiagnostic } from './formats'
import { chunks } from './batches'
import { targetId, type BundlePlan } from './bundle-plan'

/** Source policy identities are explicit; no payer or subscriber is inferred. */
export async function planAuthorizationCarry(db: D1Database, bundle: Bundle, patients: { sourceId: string; id: string; firstName: string; lastName: string; dateOfBirth: string | null }[], diagnostics: BundleDiagnostic[], timeZone: string) {
  const payers = await rows(db, 'SELECT id,version FROM bm_payers'), staff = await rows(db, "SELECT id,version FROM bm_staff WHERE role='practitioner' AND active=1 AND erased_at IS NULL")
  const patientById = new Map(patients.map(p => [p.sourceId, p])), payerById = new Map(payers.map(p => [p.id, p])), staffById = new Map(staff.map(p => [p.id, p]))
  const policies = new Map<string, Data>(), mappings: unknown[] = [], authorizations = []
  for (const record of bundle.carriedAuthorizations) {
    const fail = (message: string) => diagnostics.push({ severity: 'error', code: 'authorization_carry_invalid', message, file: record.file, row: record.row })
    if (record.cutoverOn > hostDateAt(new Date(), timeZone)) fail('The source cutover date cannot be in the future.')
    const patient = patientById.get(record.patientId)
    if (!patient) continue
    const payer = payerById.get(String(record.policyInput.payerId)), practitioner = staffById.get(record.practitionerId)
    if (!payer) fail('Choose an existing Balm payer identifier for the authorization policy.')
    if (record.practitionerId && !practitioner) fail('The authorization practitioner must be an active Balm practitioner.')
    mappings.push([record.sourceId, payer?.id, payer?.version, practitioner?.id, practitioner?.version])
    try {
      const policy = policyRecord({ id: patient.id, first_name: patient.firstName, last_name: patient.lastName, date_of_birth: patient.dateOfBirth }, record.policyInput, await targetId(bundle.provider, 'policy', record.policySourceId))
      if (record.startsOn < policy.starts_on || (policy.ends_on && record.endsOn > policy.ends_on)) fail('The authorization dates must be within the source policy coverage dates.')
      const previous = policies.get(record.policySourceId)
      if (previous && JSON.stringify(previous) !== JSON.stringify({ ...policy, sourceId: record.policySourceId })) fail('The same source policy identifier has conflicting patient or coverage facts.')
      policies.set(record.policySourceId, { ...policy, sourceId: record.policySourceId })
      authorizations.push({ ...record, id: await targetId(bundle.provider, 'authorization', record.sourceId), policyId: policy.id, clientId: patient.id, payerVersion: payer?.version ?? -1, practitionerVersion: practitioner?.version ?? null })
    } catch { fail('The authorization needs complete, valid policy and subscriber facts. Review dates, birth date, sex, relationship and address.') }
  }
  return { policies: [...policies.values()], authorizations, mappings }
}

/** Same owner-guarded transaction as patients, original source and reconciliation. */
export function authorizationCarryStatements(db: D1Database, who: Actor, plan: BundlePlan, jobId: string) {
  const body: D1PreparedStatement[] = [], at = now()
  const extract = (key: string) => `json_extract(value,'$.${key}')`
  const provenance = (kind: string, table: string, clientKey: string, data: string) => [
    stmt(db, `INSERT INTO bm_movein_records(job_id,provider,kind,source_id,target_table,target_id,snapshot) SELECT ?,?,?,${extract('sourceId')},?,${extract('id')},value FROM json_each(?)`, jobId, plan.provider, kind, table, data),
    stmt(db, `INSERT INTO bm_audit(at,actor_email,actor_role,action,client_id,subject_id,detail) SELECT ?,?,?,?,${extract(clientKey)},${extract('id')},'' FROM json_each(?)`, at, who.email, who.role, 'insurance.' + kind + '_saved', data),
  ]
  for (const group of chunks(plan.authorizationCarry.policies)) {
    const data = JSON.stringify(group)
    body.push(
      guard(db, "NOT EXISTS(SELECT 1 FROM json_each(?) r JOIN bm_policies p ON p.id=json_extract(r.value,'$.id'))", data),
      stmt(db, `INSERT INTO bm_policies(${policyColumns.join(',')}) SELECT ${policyColumns.map(extract).join(',')} FROM json_each(?)`, data),
      ...provenance('policy', 'bm_policies', 'client_id', data),
    )
  }
  const authorizations = plan.authorizationCarry.authorizations.map(a => ({ ...a, visits: a.allowanceKind === 'visits' ? a.allowance : 1, units: a.allowanceKind === 'units' ? a.allowance : null, unitsPerVisit: a.allowanceKind === 'units' ? a.unitsPerVisit : null, practitionerId: a.practitionerId || null, cptScope: JSON.stringify(a.cptScope) }))
  for (const group of chunks(authorizations)) {
    const data = JSON.stringify(group)
    body.push(
      guard(db, "NOT EXISTS(SELECT 1 FROM json_each(?) r LEFT JOIN bm_payers p ON p.id=json_extract(r.value,'$.policyInput.payerId') AND p.version=json_extract(r.value,'$.payerVersion') WHERE p.id IS NULL)", data),
      guard(db, "NOT EXISTS(SELECT 1 FROM json_each(?) r LEFT JOIN bm_staff s ON s.id=json_extract(r.value,'$.practitionerId') AND s.version=json_extract(r.value,'$.practitionerVersion') AND s.role='practitioner' AND s.active=1 AND s.erased_at IS NULL WHERE json_extract(r.value,'$.practitionerId') IS NOT NULL AND s.id IS NULL)", data),
      stmt(db, `INSERT INTO bm_authorizations(id,policy_id,number,starts_on,ends_on,visits,practitioner_id,booking_action,allowance_kind,units,units_per_visit,cpt_scope,low_remainder,imported_used,imported_cutover_on) SELECT ${['id','policyId','number','startsOn','endsOn','visits','practitionerId','bookingAction','allowanceKind','units','unitsPerVisit','cptScope'].map(extract).join(',')},2,${extract('used')},${extract('cutoverOn')} FROM json_each(?)`, data),
      ...provenance('authorization', 'bm_authorizations', 'clientId', data),
    )
  }
  return body
}
