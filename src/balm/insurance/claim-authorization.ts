import { rows, type Data } from '../domain/model'
import { authorizationsFor } from './authorization'

export type AuthorizationCorrection = { deniedNumber: string | null; afterSequence: number }

/** The append-only save sequence distinguishes a new payer decision from an
 * authorization already on file when the payer denied the claim. */
export async function claimAuthorizations(db: D1Database, clientId: string): Promise<(Data & { saved_sequence: number; used_visits: number; reserved_visits: number })[]> {
  const [auths, saves] = await Promise.all([
    authorizationsFor(db, clientId),
    rows(db, `SELECT subject_id,MAX(sequence) AS sequence FROM bm_audit
      WHERE client_id=? AND action='insurance.authorization_saved' GROUP BY subject_id`, clientId),
  ])
  const sequences = new Map(saves.map(s => [s.subject_id, s.sequence]))
  return auths.map(a => ({ ...a, saved_sequence: Number(sequences.get(a.id) ?? 0) }))
}

/** A correction must use a different authorization recorded after CO-197;
 * ordinary claims use the latest starting authorization for this provider. */
export function claimAuthorization(auths: Data[], policyId: string, date: string, practitionerId: string, correction?: AuthorizationCorrection | null) {
  return auths.filter(a => a.policy_id === policyId && a.starts_on <= date && a.ends_on >= date
    && (!a.practitioner_id || a.practitioner_id === practitionerId)
    && (!correction || a.number !== correction.deniedNumber && a.saved_sequence > correction.afterSequence))
    .sort((a, b) => correction
      ? b.saved_sequence - a.saved_sequence || b.starts_on.localeCompare(a.starts_on) || b.id.localeCompare(a.id)
      : b.starts_on.localeCompare(a.starts_on) || b.saved_sequence - a.saved_sequence || b.id.localeCompare(a.id))[0]
}

/** The original denial remains the boundary when a corrected attempt is later
 * rejected for another reason. The snapshot keeps that reviewed requirement. */
export function authorizationCorrection(claim: Data): AuthorizationCorrection | null {
  if (claim.errors.some((e: Data) => e.code === 'carc_197')) return {
    deniedNumber: claim.snapshot.authorization,
    afterSequence: Number(claim.remittance_sequence ?? 0),
  }
  return claim.snapshot.basis?.authorizationCorrection ?? null
}
