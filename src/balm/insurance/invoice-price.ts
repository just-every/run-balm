import { one, rows } from '../domain/model'
import { hostDateAt } from '../availability/timezone'
import { billedLines, signedCharges } from './facts'

/** The covering primary payer and its signed procedure units at snapshot time.
 * Cash visits use CMS; an unconfigured payer remains explicitly unconfigured. */
export async function visitBilling(db: D1Database, appointmentId: string) {
  const visit = await one(db, 'SELECT a.client_id,a.start_at,s.time_zone FROM bm_appointments a JOIN bm_settings s ON s.id=1 WHERE a.id=?', appointmentId)
  if (!visit) return null
  const date = hostDateAt(new Date(visit.start_at as string), visit.time_zone as string)
  const policy = await one(db, "SELECT p.payer_id,y.name,y.unit_method,y.version AS payer_version FROM bm_policies p JOIN bm_payers y ON y.id=p.payer_id WHERE p.client_id=? AND p.starts_on<=? AND (p.ends_on IS NULL OR p.ends_on='' OR p.ends_on>=?) ORDER BY p.priority,p.starts_on DESC LIMIT 1", visit.client_id, date, date)
  const charges = (await signedCharges(db, appointmentId)).charges
  const lines = billedLines(charges, (policy?.unit_method ?? null) as string | null)
  return { lines, method: policy?.unit_method ?? (policy ? null : 'cms'), payerId: policy?.payer_id ?? null, payer: policy?.name ?? null, payerVersion: policy?.payer_version ?? null }
}

/** The primary payer's priced signed units, shared with the invoice snapshot. */
export async function insuredCharge(db: D1Database, appointmentId: string) {
  const billing = await visitBilling(db, appointmentId)
  if (!billing?.payerId) return null
  const lines = billing.lines.filter(l => l.units > 0)
  const fees = new Map((await rows(db, 'SELECT code,cents FROM bm_payer_fees WHERE payer_id=?', billing.payerId)).map(f => [f.code as string, f.cents as number]))
  if (!lines.length || lines.some(l => !fees.has(l.code))) return null
  return { cents: lines.reduce((sum, l) => sum + fees.get(l.code)! * l.units, 0), payer: billing.payer as string }
}
