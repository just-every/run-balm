import type { Bindings } from '../../auth.server'
import { artifact, snapshot } from '../domain/invoices'
import { audit, guard, human, insist, need, now, one, practitionerId, rows, sha256, stmt, text, type Actor, type Data } from '../domain/model'
import { chargeCardOnFile } from '../payments/charges'
import { liveCard } from '../payments/cards'

export async function visitFees(db: D1Database, who: Actor) {
  return rows(db, `SELECT f.*,p.status AS payment_status,p.failure,p.card_brand,p.card_last4 FROM bm_visit_fees f JOIN bm_appointments a ON a.id=f.appointment_id LEFT JOIN bm_card_payments p ON p.id=f.payment_id WHERE (? OR a.practitioner_id=?) ORDER BY f.proposed_at DESC`, who.role === 'owner' || who.staffRole === 'reception' ? 1 : 0, practitionerId(who) ?? '')
}
/** The proposal is a frozen amount. A native person approves that amount and the saved card charge together. */
export async function confirmVisitFee(env: Bindings, db: D1Database, who: Actor, input: Data) {
  need(who, 'owner', 'reception'); human(who)
  insist(input.confirm === true || input.confirm === 'on', 'confirm_the_fee_and_card_charge')
  const fee = await one(db, 'SELECT * FROM bm_visit_fees WHERE id=?', text(input.id, 'fee', 100))
  insist(fee, 'fee_not_found', 404)
  const paymentId = `visit-fee-${fee.id}`, invoiceId = `visit-fee-invoice-${fee.id}`
  if (fee.payment_id) return { id: fee.id, payment: await one(db, 'SELECT * FROM bm_card_payments WHERE id=?', fee.payment_id) }
  insist(input.authorization === true || input.authorization === 'on', 'patient_authorization_for_visit_fee_required')
  const authorization = text(input.authorizationRecord, 'patient_authorization_record', 1000)
  const card = await liveCard(db, fee.client_id)
  insist(card, 'no_card_on_file', 409)
  const label = fee.kind === 'no_show' ? 'No-show fee' : 'Late cancellation fee'
  const { row, value } = await snapshot(db, fee.appointment_id, fee.amount_cents)
  const approvedAt = now(), number = Number((await one(db, 'SELECT COALESCE(MAX(number),0)+1 AS n FROM bm_invoices'))!.n)
  const bill = { ...value, service: { name: label, durationMinutes: 0 } }, bytes = artifact(number, bill, approvedAt, row.time_zone)
  const payment = await chargeCardOnFile(env, db, who, {
    paymentId, clientId: fee.client_id, appointmentId: fee.appointment_id, invoiceId, amountCents: fee.amount_cents, kind: 'charge', description: `${label} at ${value.clinic.name}`,
    reservation: [
      guard(db, 'EXISTS(SELECT 1 FROM bm_visit_fees WHERE id=? AND payment_id IS NULL AND amount_cents=?)', fee.id, fee.amount_cents),
      guard(db, 'EXISTS(SELECT 1 FROM bm_cards WHERE id=? AND removed_at IS NULL)', card.id),
      stmt(db, 'UPDATE bm_visit_fees SET confirmed_at=?,confirmed_by=?,authorization_record=?,payment_id=?,invoice_id=? WHERE id=? AND payment_id IS NULL', approvedAt, who.email, authorization, paymentId, invoiceId, fee.id), guard(db, 'changes()=1'),
      stmt(db, `INSERT INTO bm_invoices(id,appointment_id,client_id,status,amount_cents,snapshot,prepared_by,prepared_role,prepared_at,number,artifact,artifact_sha256,approved_by,approved_at) VALUES(?,?,?,'approved',?,?,?,?,?,?,?,?,?,?)`, invoiceId, fee.appointment_id, fee.client_id, fee.amount_cents, JSON.stringify(bill), who.email, who.role, approvedAt, number, bytes, await sha256(bytes), who.email, approvedAt),
      audit(db, who, 'appointment.fee_confirmed', fee.client_id, fee.appointment_id, `${fee.amount_cents} cents`),
    ],
  })
  return { id: fee.id, payment }
}
