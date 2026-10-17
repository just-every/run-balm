// The clinic connects its own Stripe account from Clinic: the owner pastes a
// secret key, Balm checks it with Stripe, seals it, and on a public https
// install creates the webhook that tells Balm about payments and saved cards.
import { runtimeBindings, type Bindings } from '../../auth.server'
import { audit, commit, human, insist, need, now, one, text, type Actor, type Data } from '../domain/model'
import { managedInstall, MANAGED_LINE, seal, stripeCall, unseal } from './stripe-api'

export const WEBHOOK_PATH = '/api/balm/stripe/webhook'
const EVENTS = ['checkout.session.completed', 'checkout.session.expired', 'checkout.session.async_payment_succeeded', 'checkout.session.async_payment_failed',
  'payment_intent.succeeded', 'payment_intent.payment_failed', 'payment_intent.processing']

export const stripeSettings = (db: D1Database) => one(db, 'SELECT * FROM bm_stripe WHERE id=1')

/** Why patients cannot pay online here, or null when they can. */
export async function paymentBlock(env: Bindings, db: D1Database) {
  if (managedInstall(env)) return MANAGED_LINE
  if (!await stripeSettings(db)) return 'This clinic has not connected Stripe yet, so cards cannot be saved or charged online.'
  return null
}

/** The connected account and its unsealed key, refusing when payment is unavailable. */
export async function stripeReady(env: Bindings, db: D1Database) {
  const block = await paymentBlock(env, db)
  insist(!block, block ?? '', 409)
  const settings = (await stripeSettings(db))!
  return { settings, key: await unseal(env, settings.key_sealed as string) }
}

export async function connectStripe(env: Bindings, db: D1Database, who: Actor, input: Data) {
  need(who, 'owner'); human(who)
  insist(!managedInstall(env), MANAGED_LINE, 409)
  const key = text(input.secretKey, 'stripe_key', 300)
  insist(/^(sk|rk)_(test|live)_[A-Za-z0-9]{16,}$/.test(key), 'Paste a Stripe secret key (sk_live_… or sk_test_…) or a restricted key (rk_…)')
  const account = await stripeCall(key, 'GET', '/account')
  const existing = await stripeSettings(db), origin = runtimeBindings(env).AUTH_ORIGIN
  // A reconnect often replaces a revoked key, so the old webhook may no longer be reachable to remove.
  if (existing?.webhook_id) await stripeCall(await unseal(env, existing.key_sealed as string), 'DELETE', `/webhook_endpoints/${existing.webhook_id}`).catch(() => null)
  // Stripe calls back only to a public https address; a computer-local install reads outcomes when the patient returns.
  const hook = origin.startsWith('https://') ? await stripeCall(key, 'POST', '/webhook_endpoints', { url: origin + WEBHOOK_PATH, description: 'Balm patient payments', enabled_events: EVENTS }) : null
  const name = account.settings?.dashboard?.display_name || account.business_profile?.name || account.email || account.id
  await commit(db, who, [
    db.prepare(`INSERT INTO bm_stripe(id,key_sealed,key_hint,livemode,account_id,account_name,country,webhook_id,webhook_secret_sealed,connected_by,connected_at) VALUES(1,?,?,?,?,?,?,?,?,?,?)
      ON CONFLICT(id) DO UPDATE SET key_sealed=excluded.key_sealed,key_hint=excluded.key_hint,livemode=excluded.livemode,account_id=excluded.account_id,account_name=excluded.account_name,
      country=excluded.country,webhook_id=excluded.webhook_id,webhook_secret_sealed=excluded.webhook_secret_sealed,connected_by=excluded.connected_by,connected_at=excluded.connected_at`)
      .bind(await seal(env, key), `${key.slice(0, 8)}…${key.slice(-4)}`, key.includes('_live_') ? 1 : 0, account.id, String(name), String(account.country ?? ''), hook?.id ?? null, hook ? await seal(env, hook.secret) : null, who.email, now()),
    audit(db, who, 'stripe.connected', null, String(account.id), `${key.includes('_live_') ? 'live' : 'test'} mode; webhook ${hook ? 'created' : 'not possible on a computer-local address'}`),
  ])
  return stripeView(env, db)
}

export async function disconnectStripe(env: Bindings, db: D1Database, who: Actor) {
  need(who, 'owner'); human(who)
  const s = await stripeSettings(db)
  insist(s, 'stripe_is_not_connected', 409)
  if (s.webhook_id && !managedInstall(env)) await stripeCall(await unseal(env, s.key_sealed as string), 'DELETE', `/webhook_endpoints/${s.webhook_id}`)
  await commit(db, who, [db.prepare('DELETE FROM bm_stripe WHERE id=1'), audit(db, who, 'stripe.disconnected', null, String(s.account_id))])
  return stripeView(env, db)
}

export async function stripeView(env: Bindings, db: D1Database) {
  const s = await stripeSettings(db)
  return {
    managed: managedInstall(env), block: await paymentBlock(env, db), publicOrigin: runtimeBindings(env).AUTH_ORIGIN.startsWith('https://'),
    connected: s ? { keyHint: s.key_hint, livemode: !!s.livemode, account: s.account_name, accountId: s.account_id, country: s.country, webhook: !!s.webhook_id, connectedBy: s.connected_by, connectedAt: s.connected_at } : null,
  }
}
