// External receipts are cash facts; allocations are not another cash receipt.
import { guard, id, now, rows, stmt, type Data } from '../domain/model'

export function allocateExternalCredit(db: D1Database, credit: Data, invoices: Data[], amount: number) {
  const statements: D1PreparedStatement[] = []
  let left = amount
  for (const invoice of invoices) {
    if (left <= 0) break
    const take = Math.min(left, Number(invoice.open_cents)); left -= take
    statements.push(stmt(db, `INSERT INTO bm_payments(id,invoice_id,amount_cents,reference,recorded_by,recorded_at,account_entry_id)
      VALUES(?,?,?,?,?,?,?)`, id(), invoice.id, take, `external:${credit.id}:${invoice.id}`, 'Approved external credit', now(), credit.id),
    guard(db, `EXISTS(SELECT 1 FROM bm_invoices i WHERE i.id=? AND i.client_id=? AND i.status='approved'
      AND i.amount_cents>=(SELECT COALESCE(SUM(amount_cents),0) FROM bm_payments WHERE invoice_id=i.id)
       +(SELECT COALESCE(SUM(amount_cents),0) FROM bm_invoice_adjustments WHERE invoice_id=i.id))`, invoice.id, credit.client_id))
  }
  statements.push(guard(db, 'EXISTS(SELECT 1 FROM bm_credit_balances WHERE id=? AND remaining_cents>=0)', credit.id))
  return { statements, allocatedCents: amount - left }
}

/** Called in the invoice approval batch, after saved-card credits. */
export async function externalCreditsForInvoice(db: D1Database, invoice: Data, available: number) {
  const credits = await rows(db, 'SELECT * FROM bm_credit_balances WHERE client_id=? AND remaining_cents>0 ORDER BY posted_at,id', invoice.client_id)
  const statements: D1PreparedStatement[] = []
  let left = available
  for (const credit of credits) {
    if (left <= 0) break
    const take = Math.min(left, Number(credit.remaining_cents)); left -= take
    statements.push(...allocateExternalCredit(db, credit, [{ id: invoice.id, open_cents: take }], take).statements)
  }
  return statements
}
