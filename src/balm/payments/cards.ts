// A card on file: the patient opens their private link, reads and accepts the
// clinic's authorization, and saves a card in Stripe Checkout (setup mode, so a
// SetupIntent for later off-session charges). Balm keeps the brand, last four,
// expiry and the exact consent; the card number stays with Stripe.
import type { Bindings } from '../../auth.server'
import { audit, commit, guard, human, insist, need, now, one, sha256, stmt, text, type Actor, type Data } from '../domain/model'
import { stripeReady } from './connect'
import { stripeCall } from './stripe-api'

const patient = { email: 'patient link', role: 'patient' }

export const consentText = (clinic: string) => `I authorize ${clinic} to save this card with Stripe and to charge it for my copays at check-in and for balances on visits I have attended, as shown on my statement. I can ask ${clinic} to remove the card at any time.`

export const liveCard = (db: D1Database, clientId: string) => one(db, 'SELECT * FROM bm_cards WHERE client_id=? AND removed_at IS NULL', clientId)

/** The patient's Stripe customer in the connected account, created once. No name or contact details go to Stripe. */
export async function customerFor(db: D1Database, key: string, accountId: string, clientId: string) {
  const known = await one(db, 'SELECT customer_id FROM bm_stripe_customers WHERE client_id=? AND account_id=?', clientId, accountId)
  if (known) return known.customer_id as string
  const customer = await stripeCall(key, 'POST', '/customers', { description: 'Balm patient', metadata: { balm_client: clientId } }, `balm-customer-${accountId}-${clientId}`)
  await db.prepare('INSERT INTO bm_stripe_customers(client_id,account_id,customer_id,created_at) VALUES(?,?,?,?) ON CONFLICT DO NOTHING').bind(clientId, accountId, customer.id, now()).run()
  return (await one(db, 'SELECT customer_id FROM bm_stripe_customers WHERE client_id=? AND account_id=?', clientId, accountId))!.customer_id as string
}

/** From the patient's link, after they checked the consent: the Stripe Checkout address to save a card. */
export async function startCardSetup(env: Bindings, db: D1Database, link: Data, linkUrl: string, input: Data) {
  insist(input.consent === 'on' || input.consent === true, 'tick_the_authorization_to_save_a_card')
  const { settings, key } = await stripeReady(env, db)
  const clinic = (await one(db, 'SELECT clinic_name FROM bm_settings WHERE id=1'))!.clinic_name as string, consent = consentText(clinic)
  const customer = await customerFor(db, key, settings.account_id as string, link.client_id)
  const session = await stripeCall(key, 'POST', '/checkout/sessions', {
    mode: 'setup', customer, payment_method_types: ['card'], currency: 'usd',
    success_url: `${linkUrl}?setup={CHECKOUT_SESSION_ID}`, cancel_url: linkUrl,
    metadata: { balm_client: link.client_id, balm_link: link.id }, setup_intent_data: { description: `Card on file at ${clinic}`, metadata: { balm_client: link.client_id } },
    custom_text: { submit: { message: consent.slice(0, 1200) } },
  })
  await commit(db, null, [
    stmt(db, "INSERT INTO bm_card_setups(id,link_id,client_id,consent_text,consented_at,status,created_at) VALUES(?,?,?,?,?,'open',?)", session.id, link.id, link.client_id, consent, now(), now()),
    audit(db, patient, 'card.setup_started', link.client_id, session.id),
  ])
  return String(session.url)
}

/** Read a setup session back from Stripe and keep the card it saved; safe to repeat (return, webhook). */
export async function syncCardSetup(env: Bindings, db: D1Database, sessionId: string) {
  const row = await one(db, 'SELECT * FROM bm_card_setups WHERE id=?', sessionId)
  if (!row || row.status !== 'open') return row
  const { settings, key } = await stripeReady(env, db)
  const session = await stripeCall(key, 'GET', `/checkout/sessions/${encodeURIComponent(sessionId)}`, { expand: ['setup_intent.payment_method'] })
  if (session.status === 'expired') {
    await db.prepare("UPDATE bm_card_setups SET status='expired' WHERE id=? AND status='open'").bind(sessionId).run()
    return one(db, 'SELECT * FROM bm_card_setups WHERE id=?', sessionId)
  }
  const intent = typeof session.setup_intent === 'object' ? session.setup_intent : null, method = intent && typeof intent.payment_method === 'object' ? intent.payment_method : null
  if (session.status !== 'complete' || intent?.status !== 'succeeded' || !method?.card) return row
  const previous = await liveCard(db, row.client_id as string)
  try {
    await commit(db, null, [
      stmt(db, "UPDATE bm_card_setups SET status='saved',card_id=? WHERE id=? AND status='open'", method.id, sessionId), guard(db, 'changes()=1'),
      stmt(db, "UPDATE bm_cards SET removed_at=?,removed_by='replaced by a newer card' WHERE client_id=? AND removed_at IS NULL", now(), row.client_id),
      stmt(db, `INSERT INTO bm_cards(id,client_id,account_id,customer_id,setup_intent,brand,last4,exp_month,exp_year,consent_text,consent_sha256,consented_at,saved_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        method.id, row.client_id, settings.account_id, typeof session.customer === 'string' ? session.customer : session.customer?.id, intent.id,
        method.card.brand, method.card.last4, method.card.exp_month, method.card.exp_year, row.consent_text, await sha256(row.consent_text as string), row.consented_at, now()),
      audit(db, patient, 'card.saved', row.client_id as string, method.id, `${method.card.brand} ${method.card.last4}`),
    ])
  } catch (error) {
    // The return and the webhook can both arrive; the first one keeps the card.
    if ((await one(db, 'SELECT status FROM bm_card_setups WHERE id=?', sessionId))?.status === 'saved') return one(db, 'SELECT * FROM bm_card_setups WHERE id=?', sessionId)
    throw error
  }
  // The replaced card stays usable in Stripe until detached; Balm no longer charges it.
  if (previous) await stripeCall(key, 'POST', `/payment_methods/${previous.id}/detach`).catch(() => null)
  return one(db, 'SELECT * FROM bm_card_setups WHERE id=?', sessionId)
}

export async function removeCard(env: Bindings, db: D1Database, who: Actor, input: Data) {
  need(who, 'owner', 'reception'); human(who)
  const card = await liveCard(db, text(input.clientId, 'client', 100))
  insist(card, 'no_card_on_file', 404)
  const { key } = await stripeReady(env, db)
  await stripeCall(key, 'POST', `/payment_methods/${card.id}/detach`)
  await commit(db, who, [
    stmt(db, 'UPDATE bm_cards SET removed_at=?,removed_by=? WHERE id=? AND removed_at IS NULL', now(), who.email, card.id), guard(db, 'changes()=1'),
    audit(db, who, 'card.removed', card.client_id as string, card.id as string),
  ])
  return { removed: true }
}
