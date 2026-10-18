import { one, rows } from '../domain/model'
import { hostDateAt } from '../availability/timezone'
import { billedLines, signedCharges } from './facts'

/** What an insured visit's invoice charges by default: the primary payer's fee
 * schedule for the signed CPT units, so the invoice and its claim agree. Null when
 * the visit has no covering policy, no signed charges, or a code without a fee. */
export async function insuredCharge(db: D1Database, appointmentId: string) {
  const visit = await one(db, 'SELECT a.client_id,a.start_at,s.time_zone FROM bm_appointments a JOIN bm_settings s ON s.id=1 WHERE a.id=?', appointmentId)
  if (!visit) return null
  const date = hostDateAt(new Date(visit.start_at as string), visit.time_zone as string)
  const policy = await one(db, "SELECT p.payer_id,y.name,y.unit_method FROM bm_policies p JOIN bm_payers y ON y.id=p.payer_id WHERE p.client_id=? AND p.starts_on<=? AND (p.ends_on IS NULL OR p.ends_on='' OR p.ends_on>=?) ORDER BY p.priority,p.starts_on DESC LIMIT 1", visit.client_id, date, date)
  if (!policy) return null
  const lines = billedLines((await signedCharges(db, appointmentId)).charges, policy.unit_method as string | null).filter(l => l.units > 0)
  const fees = new Map((await rows(db, 'SELECT code,cents FROM bm_payer_fees WHERE payer_id=?', policy.payer_id)).map(f => [f.code as string, f.cents as number]))
  if (!lines.length || lines.some(l => !fees.has(l.code))) return null
  return { cents: lines.reduce((sum, l) => sum + fees.get(l.code)! * l.units, 0), payer: policy.name as string }
}
