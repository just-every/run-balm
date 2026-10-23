import { one } from '../domain/model'

// Approved patient responsibility, less saved-card credit and all outstanding
// reservations. This same expression fences each reservation inside its batch.
export const availableBalanceSql = `MAX(0,
 (SELECT COALESCE(SUM(MAX(0,i.amount_cents
   -COALESCE((SELECT SUM(p.amount_cents) FROM bm_invoice_payments p WHERE p.invoice_id=i.id),0)
   -COALESCE((SELECT SUM(x.amount_cents) FROM bm_invoice_adjustments x WHERE x.invoice_id=i.id),0))),0)
 FROM bm_invoices i WHERE i.client_id=? AND i.status='approved'
 AND NOT EXISTS(SELECT 1 FROM bm_invoice_insurance_hold h WHERE h.invoice_id=i.id))
 -(SELECT COALESCE(SUM(amount_cents-applied_cents),0) FROM bm_card_payments WHERE client_id=? AND status='succeeded')
 -(SELECT COALESCE(SUM(remaining_cents),0) FROM bm_credit_balances WHERE client_id=?)
 -(SELECT COALESCE(SUM(amount_cents),0) FROM bm_card_payments WHERE client_id=? AND status IN ('open','processing','requires_action')))`

export async function availablePlanBalance(db: D1Database, clientId: string) {
  return Number((await one(db, `SELECT ${availableBalanceSql} AS cents`, clientId, clientId, clientId, clientId))!.cents)
}

export function monthDue(first: string, offset: number) {
  const [year, month, date] = first.split('-').map(Number)
  const end = new Date(Date.UTC(year, month + offset, 0))
  return new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth(), Math.min(date, end.getUTCDate()))).toISOString().slice(0, 10)
}

export function clinicDay(at: string, zone: string) {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date(at))
  return ['year', 'month', 'day'].map(key => parts.find(p => p.type === key)!.value).join('-')
}
