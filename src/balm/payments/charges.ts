import { recordBookingSucceeded, syncBookingCheckout } from './booking-prepayment'
import { syncTerminalPayment } from './terminal'
// Money in through the clinic's Stripe account: the card on file charged off
// session (a copay at check-in, an invoice's balance) or the patient paying a
// balance from their link in Stripe Checkout. Every outcome is read back from
// Stripe (immediately, on return, by webhook) and recorded by recordSucceeded,
// which posts a payment once however many times Stripe reports it.
import type { Bindings } from '../../auth.server'
import { audit, commit, guard, id, insist, now, one, stmt, type Actor, type Data } from '../domain/model'
import { liveCard, customerFor } from './cards'
import { stripeReady } from './connect'
import { openInvoices, postStatements } from './ledger'
import { sendReceipt } from './notify'
import { StripeRefusal, stripeCall } from './stripe-api'

const stripeActor = { email: 'Stripe', role: 'payments' }
const DONE = ['succeeded', 'failed', 'expired']
const payment = (db: D1Database, paymentId: string) => one(db, 'SELECT * FROM bm_card_payments WHERE id=?', paymentId)

export type Charge = { clientId: string; amountCents: number; kind: 'copay' | 'charge'; appointmentId?: string; invoiceId?: string; description: string; paymentId?: string; reservation?: D1PreparedStatement[] }

/** Charge the patient's card on file now; returns the payment row with its outcome. */
export async function chargeCardOnFile(env: Bindings, db: D1Database, who: Actor | null, c: Charge) {
  // A scheduler supplies a durable ID. An existing reservation is never sent
  // again, including after a lost Stripe response or a process crash.
  if (c.paymentId) { const known = await payment(db, c.paymentId); if (known) return known }
  const { settings, key } = await stripeReady(env, db)
  const card = await liveCard(db, c.clientId)
  insist(card, 'no_card_on_file', 409)
  insist(card.account_id === settings.account_id, 'the_card_was_saved_in_another_stripe_account_ask_the_patient_to_save_it_again', 409)
  insist(c.amountCents >= 50, 'stripe_charges_at_least_50_cents', 409)
  const customer = await customerFor(db, key, settings.account_id as string, c.clientId)
  const paymentId = c.paymentId ?? id(), source = who ?? { email: 'payment scheduler', role: 'payments' }
  try { await commit(db, who, [
    ...(c.reservation ?? []),
    ...(c.kind === 'copay' ? [guard(db, "NOT EXISTS(SELECT 1 FROM bm_card_payments WHERE appointment_id=? AND kind='copay' AND status IN ('open','processing','requires_action','succeeded'))", c.appointmentId)] : []),
    stmt(db, `INSERT INTO bm_card_payments(id,client_id,kind,appointment_id,invoice_id,amount_cents,status,card_brand,card_last4,created_by,created_at,updated_at,stripe_account_id,stripe_customer_id) VALUES(?,?,?,?,?,?,'open',?,?,?,?,?,?,?)`,
      paymentId, c.clientId, c.kind, c.appointmentId ?? null, c.invoiceId ?? null, c.amountCents, card.brand, card.last4, source.email, now(), now(), settings.account_id, customer),
    audit(db, source, `payment.${c.kind}_started`, c.clientId, paymentId, `${c.amountCents} cents`),
  ]) } catch (error) {
    if (c.paymentId) { const known = await payment(db, c.paymentId); if (known) return known }
    throw error
  }
  let intent: Data
  try {
    intent = await stripeCall(key, 'POST', '/payment_intents', {
      amount: c.amountCents, currency: 'usd', allowed_payment_method_types: ['card'], customer, payment_method: card.id,
      off_session: true, confirm: true, description: c.description, metadata: { balm_payment: paymentId, balm_client: c.clientId, balm_kind: c.kind },
    }, `balm-payment-${paymentId}`)
  } catch (error) {
    if (!(error instanceof StripeRefusal)) {
      await db.prepare("UPDATE bm_card_payments SET status='processing',failure=?,updated_at=? WHERE id=? AND status='open'").bind('Outcome unknown. Check Stripe before taking another payment. ' + (error as Error).message.slice(0, 220), now(), paymentId).run()
      throw error
    }
    const refused = error.stripe, needsPatient = refused.code === 'authentication_required'
    await db.prepare('UPDATE bm_card_payments SET status=?,payment_intent=?,failure=?,updated_at=? WHERE id=? AND status=?').bind(needsPatient ? 'requires_action' : 'failed', refused.payment_intent?.id ?? null,
      needsPatient ? 'The bank asks the patient to confirm this charge; send them a pay link.' : String(refused.message ?? refused.decline_code ?? 'The card was declined').slice(0, 300), now(), paymentId, 'open').run()
    await commit(db, who, [audit(db, source, `payment.${c.kind}_refused`, c.clientId, paymentId, String(refused.decline_code ?? refused.code ?? 'refused'))])
    return (await payment(db, paymentId))!
  }
  await db.prepare('UPDATE bm_card_payments SET payment_intent=?,updated_at=? WHERE id=?').bind(intent.id, now(), paymentId).run()
  return applyIntent(env, db, (await payment(db, paymentId))!, intent)
}

/** The patient pays from their link: a Stripe Checkout address for `amount`. */
export async function startLinkPayment(env: Bindings, db: D1Database, link: Data, linkUrl: string, amountCents: number) {
  const { settings, key } = await stripeReady(env, db)
  const customer = await customerFor(db, key, settings.account_id as string, link.client_id)
  const clinic = (await one(db, 'SELECT clinic_name FROM bm_settings WHERE id=1'))!.clinic_name as string, paymentId = id()
  const session = await stripeCall(key, 'POST', '/checkout/sessions', {
    mode: 'payment', customer, allowed_payment_method_types: ['card'], client_reference_id: paymentId,
    line_items: [{ quantity: 1, price_data: { currency: 'usd', unit_amount: amountCents, product_data: { name: `Payment to ${clinic}` } } }],
    metadata: { balm_payment: paymentId, balm_client: link.client_id }, payment_intent_data: { description: `Payment to ${clinic}`, metadata: { balm_payment: paymentId, balm_client: link.client_id, balm_kind: 'link' } },
    success_url: `${linkUrl}?paid={CHECKOUT_SESSION_ID}`, cancel_url: linkUrl,
  })
  await commit(db, null, [
    stmt(db, `INSERT INTO bm_card_payments(id,client_id,kind,link_id,amount_cents,status,checkout_session,created_by,created_at,updated_at,stripe_account_id,stripe_customer_id) VALUES(?,?,'link',?,?,'open',?,'patient link',?,?,?,?)`,
      paymentId, link.client_id, link.id, amountCents, session.id, now(), now(), settings.account_id, customer),
    audit(db, { email: 'patient link', role: 'patient' }, 'payment.link_started', link.client_id, paymentId, `${amountCents} cents`),
  ])
  return String(session.url)
}

/** Read a Checkout Session back from Stripe and record what it says; safe to repeat. */
export async function syncCheckout(env: Bindings, db: D1Database, sessionId: string) {
  const row = await one(db, 'SELECT * FROM bm_card_payments WHERE checkout_session=?', sessionId)
  if (row && await one(db,'SELECT 1 FROM bm_booking_payments WHERE payment_id=?',row.id))return syncBookingCheckout(env,db,row.id)
  if (!row || DONE.includes(row.status as string)) return row
  const { key } = await stripeReady(env, db)
  const session = await stripeCall(key, 'GET', `/checkout/sessions/${encodeURIComponent(sessionId)}`, { expand: ['payment_intent.latest_charge'] })
  if (session.status === 'expired') {
    await db.prepare("UPDATE bm_card_payments SET status='expired',updated_at=? WHERE id=? AND status='open'").bind(now(), row.id).run()
    return payment(db, row.id as string)
  }
  const intent = typeof session.payment_intent === 'object' ? session.payment_intent : null
  if (!intent) return row
  if (!row.payment_intent) await db.prepare('UPDATE bm_card_payments SET payment_intent=? WHERE id=? AND payment_intent IS NULL').bind(intent.id, row.id).run()
  return applyIntent(env, db, { ...row, payment_intent: intent.id }, intent)
}

/** A payment_intent.* event: read the intent back from Stripe and record it. */
export async function syncIntent(env: Bindings, db: D1Database, intentId: string, paymentId?: string) {
  const row = await one(db, 'SELECT * FROM bm_card_payments WHERE payment_intent=? OR id=?', intentId, paymentId ?? '')
  if (!row) return row
  if(await one(db,'SELECT 1 FROM bm_booking_payments WHERE payment_id=?',row.id))return syncBookingCheckout(env,db,row.id,intentId)
  if (await one(db, 'SELECT 1 FROM bm_terminal_payments WHERE payment_id=?', row.id)) return syncTerminalPayment(env, db, row.id, null, intentId)
  if (DONE.includes(row.status as string)) return row
  const { settings, key } = await stripeReady(env, db)
  insist(!row.stripe_account_id || row.stripe_account_id === settings.account_id, 'original_stripe_account_must_be_connected', 409)
  const intent = await stripeCall(key, 'GET', `/payment_intents/${encodeURIComponent(intentId)}`, { expand: ['latest_charge'] })
  if (!row.payment_intent) await db.prepare('UPDATE bm_card_payments SET payment_intent=? WHERE id=? AND payment_intent IS NULL').bind(intent.id, row.id).run()
  return applyIntent(env, db, { ...row, payment_intent: intent.id }, intent)
}

async function applyIntent(env: Bindings, db: D1Database, row: Data, intent: Data) {
  if (intent.status === 'succeeded') return recordSucceeded(env, db, row, intent)
  const status = intent.status === 'processing' ? 'processing' : intent.status === 'requires_action' ? 'requires_action'
    : intent.status === 'canceled' || (intent.status === 'requires_payment_method' && intent.last_payment_error) ? 'failed' : null
  if (status) await db.prepare('UPDATE bm_card_payments SET status=?,failure=?,updated_at=? WHERE id=? AND status NOT IN (\'succeeded\',\'failed\',\'expired\')')
    .bind(status, intent.last_payment_error?.message?.slice(0, 300) ?? row.failure ?? null, now(), row.id).run()
  return payment(db, row.id)
}

/** Post a succeeded intent once: the payment, its receipt number and its matching to invoices in one batch. */
export async function recordSucceeded(env: Bindings, db: D1Database, row: Data, intent: Data) {
  if(await one(db,'SELECT 1 FROM bm_booking_payments WHERE payment_id=?',row.id))return recordBookingSucceeded(env,db,row,intent)
  const card = intent.latest_charge && typeof intent.latest_charge === 'object' ? (intent.latest_charge.payment_method_details?.card ?? intent.latest_charge.payment_method_details?.card_present) : null
  const amount = Number(intent.amount_received)
  insist(amount === Number(row.amount_cents) && intent.currency === 'usd', 'stripe_payment_amount_changed', 409)
  if (row.stripe_customer_id) insist(row.stripe_customer_id === (typeof intent.customer === 'string' ? intent.customer : intent.customer?.id), 'stripe_payment_customer_changed', 409)
  for (let attempt = 0; ; attempt++) {
    const current = (await payment(db, row.id))!
    if (current.status === 'succeeded') return current
    // A copay belongs to its visit: it waits as credit until that visit's invoice is approved.
    // Other payments go to the invoice charged first, then the oldest open invoices.
    const owed = await openInvoices(db, row.client_id)
    const open = row.kind === 'copay' ? owed.filter(i => i.appointment_id === row.appointment_id) : owed.sort((a, b) => Number(b.id === row.invoice_id) - Number(a.id === row.invoice_id))
    const posted = postStatements(db, { ...current, payment_intent: intent.id }, open, amount)
    try {
      await commit(db, null, [
        stmt(db, `UPDATE bm_card_payments SET status='succeeded',amount_cents=?,applied_cents=?,payment_intent=?,card_brand=COALESCE(?,card_brand),card_last4=COALESCE(?,card_last4),failure=NULL,
          receipt_number=(SELECT COALESCE(MAX(receipt_number),0)+1 FROM bm_card_payments),succeeded_at=?,updated_at=? WHERE id=? AND status<>'succeeded'`,
          amount, posted.applied, intent.id, card?.brand ?? null, card?.last4 ?? null, now(), now(), row.id),
        guard(db, 'changes()=1'),
        ...posted.statements,
        audit(db, stripeActor, `payment.${row.kind}_succeeded`, row.client_id, row.id, `${amount} cents; ${posted.applied} cents matched to invoices`),
      ])
      break
    } catch (error) {
      // Another report of the same payment (return, webhook, replay) may have posted it first,
      // or a desk payment changed what is open: re-read and post against what is true now.
      if ((await payment(db, row.id))?.status === 'succeeded') return payment(db, row.id)
      if (attempt >= 2) throw error
    }
  }
  const done = (await payment(db, row.id))!
  await sendReceipt(env, db, done)
  return payment(db, row.id)
}
