// What Balm sends patients about money: a receipt after each card payment and a
// private link to their statement. Messages name the clinic and the amount only,
// never a service, diagnosis or other clinical detail.
import type { Bindings } from '../../auth.server'
import { send } from '../mail-out'
import { dollars } from '../domain/invoices'
import { one, type Data } from '../domain/model'
import { smsSender, usMobile, type SmsEnv } from '../sms'
import { receiptPdf } from './documents'
import { cardLabel, receiptNumber } from './ledger'
import { paymentBlock } from './connect'

export async function sendReceipt(env: Bindings, db: D1Database, payment: Data) {
  const row = await one(db, 'SELECT c.email,c.first_name,s.clinic_name FROM bm_clients c, bm_settings s WHERE c.id=?', payment.client_id)
  const number = receiptNumber(payment.receipt_number)
  const result = await send(env, row?.email as string | null, `Receipt ${number} from ${row?.clinic_name}`,
    `Hello ${row?.first_name},\n\nThank you. ${row?.clinic_name} received ${dollars(payment.amount_cents)} from your ${cardLabel(payment.card_brand, payment.card_last4)}${payment.kind === 'copay' ? ' for your copay at check-in' : ''}.\n\nReceipt ${number} is attached.\n`,
    [{ filename: `receipt-${number}.pdf`, contentType: 'application/pdf', content: (await receiptPdf(db, payment.id)).bytes }])
  await db.prepare('UPDATE bm_card_payments SET receipt_delivery=? WHERE id=?').bind(result, payment.id).run()
  return result
}

/** Deliver a patient's private link by email or text; returns the delivery result. */
export async function deliverLink(env: SmsEnv, db: D1Database, clientId: string, url: string, purpose: 'balance' | 'card', channel: 'email' | 'text', balanceCents: number) {
  const row = await one(db, 'SELECT c.email,c.phone,c.first_name,s.clinic_name FROM bm_clients c, bm_settings s WHERE c.id=?', clientId)
  const online = !await paymentBlock(env, db)
  const ask = purpose === 'card' ? `save a card for your copays with ${row!.clinic_name}` : `view your statement from ${row!.clinic_name}${online && balanceCents > 0 ? ` and pay your balance of ${dollars(balanceCents)}` : ''}`
  const instructions = purpose === 'balance' && !online ? `${balanceCents > 0 ? `Your balance is ${dollars(balanceCents)}. ` : ''}Please pay at the clinic or contact the clinic for payment instructions.` : "Card details go to Stripe, the clinic's payment processor, and never to the clinic."
  if (channel === 'text') {
    const to = usMobile(row?.phone), sender = (await smsSender(env))
    if (!to) return 'no_mobile_number'
    if (!sender) return 'texts_unavailable'
    await sender.send({ to, body: `${row!.clinic_name}: ${ask.replace(/^./, c => c.toUpperCase())}: ${url}${purpose === 'balance' && !online ? `\n${instructions}` : ''}` })
    return 'sent'
  }
  return send(env, row?.email as string | null, purpose === 'card' ? `Save a card with ${row!.clinic_name}` : `Your statement from ${row!.clinic_name}`,
    `Hello ${row!.first_name},\n\nUse this private link to ${ask}:\n${url}\n\nThe link is yours alone and works for 30 days. ${instructions}\n`)
}
