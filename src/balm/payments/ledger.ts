// A patient's ledger across visits. Charges are approved invoices; payments are
// those recorded at the desk plus every card payment taken through Stripe. A card
// payment is posted to invoices as bm_payments rows (reference stripe:<intent>:<invoice>,
// unique, so a payment can never be matched to an invoice twice); what is not yet
// posted is the patient's credit, applied when their next invoice is approved.
import { guard, id, insist, now, rows, stmt, type Data } from '../domain/model'
import { invoiceNumber } from '../domain/invoices'

/** Dollars as typed ("65", "65.00", "$1,065.50") in cents. */
export function parseDollars(value: unknown, field = 'amount') {
  const v = String(value ?? '').replace(/[$,\s]/g, '')
  insist(/^\d{1,7}(\.\d{1,2})?$/.test(v), `enter_the_${field}_in_dollars_like_30.00`)
  return Math.round(Number(v) * 100)
}

export const receiptNumber = (n: number) => 'R-' + String(n).padStart(6, '0')
export const cardLabel = (brand: unknown, last4: unknown) => `${String(brand ?? 'card').replace(/^./, c => c.toUpperCase())} ending ${last4}`

export type Line = { at: string; kind: 'charge' | 'payment' | 'card'; description: string; chargeCents: number; paymentCents: number; balanceCents: number; ref: string }

/** Open approved invoices of a client, oldest first, with what is still owed. */
export async function openInvoices(db: D1Database, clientId: string) {
  return (await rows(db, `SELECT i.id,i.number,i.amount_cents,i.appointment_id,i.approved_at,(SELECT COALESCE(SUM(amount_cents),0) FROM bm_payments p WHERE p.invoice_id=i.id) AS paid_cents
    FROM bm_invoices i WHERE i.client_id=? AND i.status='approved' ORDER BY i.number`, clientId))
    .map(i => ({ ...i, open_cents: (i.amount_cents as number) - (i.paid_cents as number) }) as Data & { open_cents: number }).filter(i => i.open_cents > 0)
}

export async function ledger(db: D1Database, clientId: string) {
  const invoices = await rows(db, "SELECT id,number,amount_cents,approved_at,snapshot FROM bm_invoices WHERE client_id=? AND status='approved' ORDER BY number", clientId)
  const manual = await rows(db, `SELECT p.amount_cents,p.reference,p.recorded_at,i.number FROM bm_payments p JOIN bm_invoices i ON i.id=p.invoice_id
    WHERE i.client_id=? AND p.card_payment_id IS NULL ORDER BY p.recorded_at`, clientId)
  const cards = await rows(db, "SELECT * FROM bm_card_payments WHERE client_id=? AND status='succeeded' ORDER BY succeeded_at", clientId)
  const entries: Omit<Line, 'balanceCents'>[] = [
    ...invoices.map(i => { const v = JSON.parse(i.snapshot as string); return { at: i.approved_at as string, kind: 'charge' as const, description: `${v.serviceDate.split(',').slice(0, 3).join(',')} · ${v.service.name} · ${invoiceNumber(i.number as number)}`, chargeCents: i.amount_cents as number, paymentCents: 0, ref: i.id as string } }),
    ...manual.map(p => ({ at: p.recorded_at as string, kind: 'payment' as const, description: `Payment received · ${invoiceNumber(p.number as number)} · ${p.reference}`, chargeCents: 0, paymentCents: p.amount_cents as number, ref: String(p.reference) })),
    ...cards.map(c => ({ at: c.succeeded_at as string, kind: 'card' as const, description: `${c.kind === 'copay' ? 'Copay at check-in' : c.kind === 'link' ? 'Paid online' : 'Card payment'} · ${cardLabel(c.card_brand, c.card_last4)} · receipt ${receiptNumber(c.receipt_number as number)}`, chargeCents: 0, paymentCents: c.amount_cents as number, ref: c.id as string })),
  ].sort((a, b) => a.at.localeCompare(b.at))
  let balance = 0
  const lines: Line[] = entries.map(e => ({ ...e, balanceCents: balance += e.chargeCents - e.paymentCents }))
  const charges = lines.reduce((t, l) => t + l.chargeCents, 0), payments = lines.reduce((t, l) => t + l.paymentCents, 0)
  const credit = cards.reduce((t, c) => t + (c.amount_cents as number) - (c.applied_cents as number), 0)
  return { lines, chargesCents: charges, paymentsCents: payments, balanceCents: charges - payments, creditCents: credit }
}

/** Post `amount` of a card payment to open invoices (the named one first); the rest stays credit. */
export function postStatements(db: D1Database, payment: Data, open: Data[], amount: number) {
  const statements: D1PreparedStatement[] = []
  let left = amount
  for (const invoice of open) {
    if (left <= 0) break
    const take = Math.min(left, invoice.open_cents)
    left -= take
    statements.push(
      stmt(db, 'INSERT INTO bm_payments(id,invoice_id,amount_cents,reference,recorded_by,recorded_at,card_payment_id) VALUES(?,?,?,?,?,?,?)',
        id(), invoice.id, take, `stripe:${payment.payment_intent}:${invoice.id}`, 'Stripe', now(), payment.id),
      guard(db, "(SELECT COALESCE(SUM(amount_cents),0) FROM bm_payments WHERE invoice_id=?)<=(SELECT amount_cents FROM bm_invoices WHERE id=? AND status='approved')", invoice.id, invoice.id))
  }
  return { statements, applied: amount - left }
}

/** On an invoice's approval: apply the patient's unposted card payments, this visit's copay first. */
export async function creditStatements(db: D1Database, invoice: Data) {
  // A copay waits for its own visit's invoice; other credit applies to whichever invoice comes next.
  const credits = await rows(db, `SELECT * FROM bm_card_payments WHERE client_id=? AND status='succeeded' AND applied_cents<amount_cents AND (kind<>'copay' OR appointment_id=?)
    ORDER BY CASE WHEN appointment_id=? THEN 0 ELSE 1 END, succeeded_at`, invoice.client_id, invoice.appointment_id, invoice.appointment_id)
  const statements: D1PreparedStatement[] = []
  let open = invoice.amount_cents as number
  for (const c of credits) {
    if (open <= 0) break
    const take = Math.min(open, (c.amount_cents as number) - (c.applied_cents as number))
    open -= take
    const posted = postStatements(db, c, [{ id: invoice.id, open_cents: take }], take)
    statements.push(...posted.statements,
      stmt(db, 'UPDATE bm_card_payments SET applied_cents=applied_cents+?,updated_at=? WHERE id=? AND applied_cents=?', take, now(), c.id, c.applied_cents),
      guard(db, 'changes()=1'))
  }
  return statements
}
