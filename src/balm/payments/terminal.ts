// Server-driven Terminal. The durable payment is reserved before sending, and
// replay only reads Stripe. An uncertain send never creates or processes again.
import type { Bindings } from '../../auth.server'
import { visibleAppointment } from '../domain/booking'
import { audit, commit, guard, human, insist, need, now, one, rows, sha256, stmt, text, type Actor, type Data } from '../domain/model'
import { customerFor } from './cards'
import { recordSucceeded } from './charges'
import { stripeReady } from './connect'
import { parseDollars } from './ledger'
import { stripeCall } from './stripe-api'

const readerPath = (reader: unknown) => `/terminal/readers/${encodeURIComponent(String(reader))}`
const intentPath = (intent: unknown) => `/payment_intents/${encodeURIComponent(String(intent))}`
const finished = (row: Data) => ['succeeded', 'canceled'].includes(row.state)
const terminalRow = (db: D1Database, paymentId: string) => one(db, `SELECT p.*,t.account_id,t.reader_id,t.livemode,t.state,t.reader_status,t.action_status,t.failure AS terminal_failure,t.checked_at
 FROM bm_card_payments p JOIN bm_terminal_payments t ON t.payment_id=p.id WHERE p.id=?`, paymentId)
function paymentDesk(who: Actor) {
  human(who); need(who, 'owner', 'reception')
  insist(who.role === 'owner' || !who.staffKind || ['reception', 'biller'].includes(who.staffKind), 'role_cannot_do_this', 403)
}
const providerId = (value: unknown, prefix: string) => {
  const result = text(value, prefix, 100)
  insist(new RegExp(`^${prefix}_[A-Za-z0-9]+$`).test(result), `invalid_${prefix}`)
  return result
}
function checkReader(reader: Data, livemode: boolean) {
  insist(!!reader.livemode === livemode && !reader.deleted, 'terminal_reader_mode_mismatch', 409)
  insist(!livemode || !String(reader.device_type).startsWith('simulated'), 'simulated_readers_are_test_mode_only', 409)
}

/** Owner selects an existing reader or registers hardware at an existing Stripe location. */
async function configure(env: Bindings, db: D1Database, who: Actor, input: Data) {
  human(who); need(who, 'owner')
  const { settings, key } = await stripeReady(env, db), live = !!settings.livemode
  await commit(db, who, [guard(db, "NOT EXISTS(SELECT 1 FROM bm_terminal_payments WHERE state NOT IN ('succeeded','canceled'))")])
  let reader: Data
  if (input.readerId) reader = await stripeCall(key, 'GET', readerPath(providerId(input.readerId, 'tmr')))
  else {
    const location = providerId(input.locationId, 'tml'), simulated = input.simulated === 'on' || input.simulated === true
    const code = simulated ? 'simulated-wpe' : text(input.registrationCode, 'reader_registration_code', 100)
    insist(!live || !/simulated/i.test(code), 'simulated_readers_are_test_mode_only', 409)
    reader = await stripeCall(key, 'POST', '/terminal/readers', { registration_code: code, location, label: 'Balm clinic reader' },
      `balm-reader-${await sha256(`${settings.account_id}:${location}:${code}`)}`)
  }
  checkReader(reader, live)
  const locationId = typeof reader.location === 'object' ? reader.location?.id : reader.location
  insist(locationId, 'terminal_reader_needs_a_stripe_location', 409)
  await commit(db, who, [
    guard(db, 'EXISTS(SELECT 1 FROM bm_stripe WHERE account_id=? AND livemode=?)', settings.account_id, live ? 1 : 0),
    guard(db, "NOT EXISTS(SELECT 1 FROM bm_terminal_payments WHERE state NOT IN ('succeeded','canceled'))"),
    stmt(db, `INSERT INTO bm_terminal_reader(id,account_id,reader_id,location_id,device_type,livemode,reader_status,checked_at,configured_by,configured_at)
      VALUES(1,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET account_id=excluded.account_id,reader_id=excluded.reader_id,location_id=excluded.location_id,
      device_type=excluded.device_type,livemode=excluded.livemode,reader_status=excluded.reader_status,checked_at=excluded.checked_at,configured_by=excluded.configured_by,configured_at=excluded.configured_at`,
      settings.account_id, reader.id, locationId, reader.device_type, live ? 1 : 0, reader.status, now(), who.email, now()),
    audit(db, who, 'terminal.reader_configured', null, reader.id, live ? 'live mode' : 'test mode'),
  ])
  return terminalState(db, who)
}

/** Local state only: page loading never sends a reader action. */
export async function terminalState(db: D1Database, who: Actor) {
  if (who.role !== 'owner' && (who.staffRole !== 'reception' || who.staffKind && !['reception', 'biller'].includes(who.staffKind))) return null
  const reader = await one(db, `SELECT r.* FROM bm_terminal_reader r JOIN bm_stripe s ON s.account_id=r.account_id AND s.livemode=r.livemode WHERE r.id=1`)
  const payments = await rows(db, `SELECT p.id,p.appointment_id,p.amount_cents,p.status,p.receipt_number,p.payment_intent,t.state,t.reader_id,t.livemode,t.failure,t.reader_status,t.action_status,t.checked_at
    FROM bm_terminal_payments t JOIN bm_card_payments p ON p.id=t.payment_id
    ORDER BY CASE WHEN t.state IN ('succeeded','canceled') THEN 1 ELSE 0 END,t.created_at DESC LIMIT 100`)
  return { reader, payments }
}

async function collect(env: Bindings, db: D1Database, who: Actor, input: Data) {
  paymentDesk(who)
  const visit = await visibleAppointment(db, who, input.appointmentId), paymentId = text(input.paymentId, 'payment_id', 80)
  insist(/^[a-f0-9-]{36}$/.test(paymentId), 'invalid_payment_id')
  const known = await terminalRow(db, paymentId)
  if (known) {
    insist(known.appointment_id === visit.id, 'payment_does_not_match_visit', 409)
    return syncTerminalPayment(env, db, paymentId, who)
  }
  insist(visit.status === 'booked' || visit.status === 'attended' && visit.checked_in_at, 'only_a_booked_or_checked_in_visit_can_collect', 409)
  insist(Math.abs(Date.parse(visit.start_at) - Date.now()) < 12 * 3600_000, 'check_in_on_the_day_of_the_visit', 409)
  const client = await one(db, 'SELECT copay_cents FROM bm_clients WHERE id=? AND erased_at IS NULL', visit.client_id)
  const amount = parseDollars(input.amount, 'copay')
  insist(client && amount === Number(client.copay_cents) && amount >= 50, 'confirm_the_current_patient_copay_at_least_50_cents', 409)
  const { settings, key } = await stripeReady(env, db)
  const config = await one(db, 'SELECT * FROM bm_terminal_reader WHERE id=1 AND account_id=? AND livemode=?', settings.account_id, settings.livemode)
  insist(config, 'configure_a_terminal_reader_in_clinic_first', 409)
  const reader = await stripeCall(key, 'GET', readerPath(config.reader_id))
  checkReader(reader, !!settings.livemode)
  insist(reader.status === 'online' && reader.action?.status !== 'in_progress', 'terminal_reader_is_offline_or_busy', 409)
  // The customer contains only Balm's opaque ID; no patient name, contact or visit data.
  await commit(db, who, [audit(db, who, 'terminal.collect_requested', visit.client_id, paymentId)])
  const customer = await customerFor(db, key, settings.account_id, visit.client_id)
  try {
    await commit(db, who, [
      guard(db, 'EXISTS(SELECT 1 FROM bm_stripe WHERE account_id=? AND livemode=?)', settings.account_id, settings.livemode),
      guard(db, 'EXISTS(SELECT 1 FROM bm_terminal_reader WHERE id=1 AND account_id=? AND reader_id=? AND livemode=?)', settings.account_id, config.reader_id, settings.livemode),
      guard(db, "EXISTS(SELECT 1 FROM bm_appointments a JOIN bm_clients c ON c.id=a.client_id WHERE a.id=? AND a.client_id=? AND a.version=? AND a.status IN ('booked','attended') AND c.copay_cents=? AND c.erased_at IS NULL)", visit.id, visit.client_id, visit.version, amount),
      guard(db, "NOT EXISTS(SELECT 1 FROM bm_card_payments WHERE appointment_id=? AND kind='copay' AND status IN ('open','processing','requires_action','succeeded'))", visit.id),
      stmt(db, `INSERT INTO bm_card_payments(id,client_id,kind,appointment_id,amount_cents,status,stripe_account_id,stripe_customer_id,created_by,created_at,updated_at)
        VALUES(?,?,'copay',?,?,'processing',?,?,?,?,?)`, paymentId, visit.client_id, visit.id, amount, settings.account_id, customer, who.email, now(), now()),
      stmt(db, `INSERT INTO bm_terminal_payments(payment_id,account_id,reader_id,livemode,state,reader_status,created_at,checked_at) VALUES(?,?,?,?,'reserved',?,?,?)`,
        paymentId, settings.account_id, config.reader_id, settings.livemode, reader.status, now(), now()),
      ...(!visit.checked_in_at ? [stmt(db, "UPDATE bm_appointments SET checked_in_at=?,checked_in_by=?,version=version+1 WHERE id=? AND checked_in_at IS NULL AND status='booked'", now(), who.email, visit.id),
        guard(db, 'changes()=1'), audit(db, who, 'appointment.checked_in', visit.client_id, visit.id)] : []),
      audit(db, who, 'payment.terminal_started', visit.client_id, paymentId, `${amount} cents`),
    ])
  } catch (error) {
    if (await terminalRow(db, paymentId)) return syncTerminalPayment(env, db, paymentId, who)
    throw error
  }
  try {
    const intent = await stripeCall(key, 'POST', '/payment_intents', { amount, currency: 'usd', customer,
      allowed_payment_method_types: ['card_present'], capture_method: 'automatic', description: 'Clinic payment',
      metadata: { balm_payment: paymentId, balm_client: visit.client_id, balm_kind: 'copay' } }, `balm-terminal-${paymentId}`)
    await commit(db, who, [guard(db, "EXISTS(SELECT 1 FROM bm_terminal_payments WHERE payment_id=? AND state='reserved')", paymentId),
      stmt(db, 'UPDATE bm_card_payments SET payment_intent=?,updated_at=? WHERE id=? AND payment_intent IS NULL', intent.id, now(), paymentId),
      stmt(db, "UPDATE bm_terminal_payments SET state='intent_created',checked_at=? WHERE payment_id=?", now(), paymentId)])
    // Only this original execution can reach the process request.
    await commit(db, who, [guard(db, "EXISTS(SELECT 1 FROM bm_terminal_payments WHERE payment_id=? AND state='intent_created')", paymentId),
      guard(db, 'EXISTS(SELECT 1 FROM bm_stripe WHERE account_id=? AND livemode=?)', settings.account_id, settings.livemode),
      stmt(db, "UPDATE bm_terminal_payments SET state='sent',checked_at=? WHERE payment_id=?", now(), paymentId)])
    await stripeCall(key, 'POST', readerPath(config.reader_id) + '/process_payment_intent',
      { payment_intent: intent.id, process_config: { enable_customer_cancellation: true, skip_tipping: true } }, `balm-terminal-process-${paymentId}`)
  } catch {
    await commit(db, null, [stmt(db, "UPDATE bm_terminal_payments SET state='unknown',failure=?,checked_at=? WHERE payment_id=? AND state NOT IN ('succeeded','canceled')",
      'Outcome uncertain. Check Stripe status; do not take another payment until this intent succeeds or is canceled.', now(), paymentId)])
  }
  return syncTerminalPayment(env, db, paymentId, who)
}

function verifyIntent(row: Data, intent: Data) {
  const customer = typeof intent.customer === 'object' ? intent.customer?.id : intent.customer
  insist(intent.metadata?.balm_payment === row.id && intent.metadata?.balm_client === row.client_id && customer === row.stripe_customer_id
    && Number(intent.amount) === Number(row.amount_cents) && intent.currency === 'usd' && !!intent.livemode === !!row.livemode
    && intent.payment_method_types?.includes('card_present'), 'terminal_intent_does_not_match_reservation', 409)
  if (intent.status === 'succeeded') insist(Number(intent.amount_received) === Number(row.amount_cents), 'terminal_received_amount_mismatch', 409)
}

/** Reconcile by GET only. Search can recover a lost create response, but absence
 * never releases a reservation because Stripe search is eventually consistent. */
export async function syncTerminalPayment(env: Bindings, db: D1Database, paymentId: string, who: Actor | null = null, suppliedIntentId?: string) {
  const row = await terminalRow(db, paymentId)
  insist(row, 'terminal_payment_not_found', 404)
  const { settings, key } = await stripeReady(env, db)
  insist(settings.account_id === row.account_id && !!settings.livemode === !!row.livemode, 'reconnect_the_original_stripe_account_and_mode_to_reconcile', 409)
  let intentId = row.payment_intent || suppliedIntentId
  if (!intentId) {
    const found = await stripeCall(key, 'GET', '/payment_intents/search', { query: `metadata['balm_payment']:'${row.id}'`, limit: 2 })
    insist(!found.has_more && found.data.length <= 1, 'multiple_terminal_intents_need_owner_review', 409)
    intentId = found.data[0]?.id
  }
  const reader = await stripeCall(key, 'GET', readerPath(row.reader_id))
  checkReader(reader, !!row.livemode)
  const intent = intentId ? await stripeCall(key, 'GET', intentPath(intentId), { expand: ['latest_charge'] }) : null
  if (intent) verifyIntent(row, intent)
  const action = reader.action?.process_payment_intent?.payment_intent === intentId ? reader.action : null
  const failure = !intent ? 'Stripe has not located this intent yet. Keep this payment reserved and review Stripe before collecting again.'
    : intent.last_payment_error ? 'Card payment needs review. Cancel this intent in Stripe before collecting another payment.'
    : action?.status === 'failed' ? 'Reader action failed. Check the intent or cancel it before collecting another payment.'
    : row.state === 'unknown' ? 'The send was uncertain. Review or cancel this same intent; it will not be sent again automatically.' : null
  await commit(db, who, [
    ...(intent && !row.payment_intent ? [stmt(db, 'UPDATE bm_card_payments SET payment_intent=?,updated_at=? WHERE id=? AND payment_intent IS NULL', intent.id, now(), row.id)] : []),
    stmt(db, 'UPDATE bm_terminal_payments SET reader_status=?,action_status=?,failure=?,checked_at=? WHERE payment_id=?', reader.status, action?.status ?? null, failure, now(), row.id),
    stmt(db, 'UPDATE bm_terminal_reader SET reader_status=?,checked_at=? WHERE id=1 AND account_id=? AND reader_id=?', reader.status, now(), row.account_id, row.reader_id),
    ...(who ? [audit(db, who, 'payment.terminal_checked', row.client_id, row.id)] : []),
  ])
  if (intent?.status === 'succeeded') {
    await recordSucceeded(env, db, { ...row, payment_intent: intent.id }, intent)
    await commit(db, null, [stmt(db, "UPDATE bm_terminal_payments SET state='succeeded',failure=NULL,checked_at=? WHERE payment_id=?", now(), row.id)])
  } else if (intent?.status === 'canceled') {
    await commit(db, who, [stmt(db, "UPDATE bm_card_payments SET status='failed',failure='Terminal payment canceled in Stripe',updated_at=? WHERE id=? AND status<>'succeeded'", now(), row.id),
      guard(db, 'changes()=1'), stmt(db, "UPDATE bm_terminal_payments SET state='canceled',failure=NULL,checked_at=? WHERE payment_id=?", now(), row.id)])
  }
  return terminalRow(db, paymentId)
}

/** Explicit operator commands; no browser SDK or card data accepted. */
export async function terminalCommand(env: Bindings, db: D1Database, who: Actor, name: string, input: Data) {
  paymentDesk(who)
  if (name === 'pay.terminal.configure') return configure(env, db, who, input)
  if (name === 'pay.terminal.collect') return collect(env, db, who, input)
  const paymentId = text(input.paymentId, 'payment_id', 80), row = await terminalRow(db, paymentId)
  insist(row, 'terminal_payment_not_found', 404)
  await visibleAppointment(db, who, row.appointment_id)
  if (name === 'pay.terminal.sync') return syncTerminalPayment(env, db, paymentId, who, input.intentId ? providerId(input.intentId, 'pi') : undefined)
  insist(['pay.terminal.cancel', 'pay.terminal.simulate'].includes(name), 'unknown_command', 404)
  if (name === 'pay.terminal.cancel') insist(input.confirm === true || input.confirm === 'on', 'confirm_terminal_payment_cancellation')
  const current = (await syncTerminalPayment(env, db, paymentId, who))!
  if (finished(current)) return current
  insist(current.payment_intent, 'locate_the_original_stripe_intent_before_canceling', 409)
  const { key, settings } = await stripeReady(env, db), reader = await stripeCall(key, 'GET', readerPath(row.reader_id))
  insist(settings.account_id === row.account_id && !!settings.livemode === !!row.livemode, 'reconnect_the_original_stripe_account_and_mode_to_reconcile', 409)
  checkReader(reader, !!settings.livemode)
  await commit(db, who, [guard(db, 'EXISTS(SELECT 1 FROM bm_stripe WHERE account_id=? AND livemode=?)', row.account_id, row.livemode),
    audit(db, who, name === 'pay.terminal.cancel' ? 'payment.terminal_cancel_requested' : 'payment.terminal_test_requested', row.client_id, row.id)])
  if (name === 'pay.terminal.simulate') {
    insist(!settings.livemode && reader.livemode === false && String(reader.device_type).startsWith('simulated'), 'simulated_readers_are_test_mode_only', 409)
    insist(reader.action?.status === 'in_progress' && reader.action?.process_payment_intent?.payment_intent === current.payment_intent, 'reader_is_not_waiting_for_this_payment', 409)
    await stripeCall(key, 'POST', `/test_helpers${readerPath(row.reader_id)}/present_payment_method`, { type: 'card_present' }, `balm-terminal-present-${paymentId}`)
  } else {
    if (reader.action?.process_payment_intent?.payment_intent === current.payment_intent && reader.action.status === 'in_progress')
      await stripeCall(key, 'POST', readerPath(row.reader_id) + '/cancel_action', {}, `balm-terminal-stop-${paymentId}`)
    await stripeCall(key, 'POST', intentPath(current.payment_intent) + '/cancel', {}, `balm-terminal-cancel-${paymentId}`)
  }
  return syncTerminalPayment(env, db, paymentId, who)
}
