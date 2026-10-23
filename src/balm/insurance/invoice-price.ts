import {scheduleFees} from './schedules'
import { one, rows } from '../domain/model'
import { primaryUnitMethod } from './unit-method'
import { billedLines, signedCharges } from './facts'

/** The covering primary payer and its signed procedure units at snapshot time.
 * Cash visits use CMS; an unconfigured payer remains explicitly unconfigured. */
export async function visitBilling(db: D1Database, appointmentId: string) {
  const visit = await one(db, 'SELECT client_id,start_at FROM bm_appointments WHERE id=?', appointmentId)
  if (!visit) return null
  const basis = await primaryUnitMethod(db, visit.client_id as string, visit.start_at as string)
  const charges = (await signedCharges(db, appointmentId)).charges
  const lines = billedLines(charges, basis.method, basis.fixedUnitMinutes)
  return { lines, ...basis }
}

/** The primary payer's priced signed units, shared with the invoice snapshot. */
export async function insuredCharge(db: D1Database, appointmentId: string) {
  const billing = await visitBilling(db, appointmentId)
  if (!billing?.payerId) return null
  const lines = billing.lines.filter(l => l.units > 0)
  const fees = new Map((await scheduleFees(db,String(billing.payerId),billing.schedule)).map(f => [f.code as string, f.cents as number]))
  if (!billing.lines.length || lines.some(l => !fees.has(l.code))) return null
  return { cents: lines.reduce((sum, l) => sum + fees.get(l.code)! * l.units, 0), payer: billing.payer as string }
}
