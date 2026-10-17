// Stripe and Twilio faked at their HTTP edge (the Worker's outbound fetch), with
// the request and response shapes of Stripe's documented API. Test mode only:
// card pm_card_declined is refused like Stripe's 4000 0000 0000 0341 test card.
import { createHmac } from 'node:crypto'
import { readFile } from 'node:fs/promises'

const twilioMessage = JSON.parse(await readFile(new URL('../fixtures/twilio-message.json', import.meta.url), 'utf8'))

export function fakeProviders() {
  let n = 0
  const next = prefix => `${prefix}_test${String(++n).padStart(6, '0')}`
  const sessions = new Map(), intents = new Map(), calls = [], texts = []
  let webhookSecret = null
  const json = (value, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json' } })
  const card = { brand: 'visa', last4: '4242', exp_month: 12, exp_year: 2034 }
  const charge = method => ({ id: next('ch'), payment_method_details: { type: 'card', card: { brand: method.card.brand, last4: method.card.last4 } } })
  const methods = new Map()

  async function handler(request) {
    const url = new URL(request.url), body = request.method === 'POST' ? Object.fromEntries(new URLSearchParams(await request.text())) : Object.fromEntries(url.searchParams)
    if (url.hostname === 'api.twilio.com') {
      texts.push({ path: url.pathname, body, auth: request.headers.get('authorization') })
      return json({ ...twilioMessage, to: body.To, from: body.From, body: body.Body }, 201)
    }
    if (url.hostname !== 'api.stripe.com') return new Response('unexpected host ' + url.hostname, { status: 599 })
    const path = url.pathname.replace(/^\/v1/, '')
    calls.push({ method: request.method, path, body, idempotencyKey: request.headers.get('idempotency-key') })
    if (path === '/account') return json({ id: 'acct_test_clinic', country: 'US', default_currency: 'usd', settings: { dashboard: { display_name: 'Riverside Physio (test)' } } })
    if (path === '/customers') return json({ id: next('cus') })
    if (path === '/webhook_endpoints') { webhookSecret = 'whsec_' + next('secret'); return json({ id: next('we'), secret: webhookSecret, url: body.url }) }
    if (path.startsWith('/webhook_endpoints/')) return json({ id: path.split('/')[2], deleted: true })
    if (path === '/checkout/sessions') {
      const id = next('cs')
      sessions.set(id, { id, object: 'checkout.session', mode: body.mode, status: 'open', customer: body.customer ?? null, metadata: { balm_payment: body['metadata[balm_payment]'], balm_client: body['metadata[balm_client]'] },
        amount: Number(body['line_items[0][price_data][unit_amount]'] ?? 0), url: `https://checkout.stripe.com/c/pay/${id}`, success_url: body.success_url, setup_intent: null, payment_intent: null })
      return json(sessions.get(id))
    }
    const session = path.match(/^\/checkout\/sessions\/(cs_\w+)$/)
    if (session) {
      const s = sessions.get(session[1])
      if (!s) return json({ error: { message: 'No such checkout session' } }, 404)
      return json({ ...s, payment_intent: s.payment_intent ? intents.get(s.payment_intent) : null })
    }
    if (path === '/payment_intents') {
      const method = methods.get(body.payment_method)
      const id = next('pi')
      if (!method || method.declined) {
        intents.set(id, { id, object: 'payment_intent', status: 'requires_payment_method', amount: Number(body.amount), amount_received: 0, metadata: { balm_payment: body['metadata[balm_payment]'] } })
        return json({ error: { type: 'card_error', code: 'card_declined', decline_code: 'insufficient_funds', message: 'Your card has insufficient funds.', payment_intent: { id, status: 'requires_payment_method' } } }, 402)
      }
      intents.set(id, { id, object: 'payment_intent', status: 'succeeded', amount: Number(body.amount), amount_received: Number(body.amount), currency: body.currency, customer: body.customer, metadata: { balm_payment: body['metadata[balm_payment]'] }, latest_charge: charge(method) })
      return json(intents.get(id))
    }
    const intent = path.match(/^\/payment_intents\/(pi_\w+)$/)
    if (intent) return intents.has(intent[1]) ? json(intents.get(intent[1])) : json({ error: { message: 'No such payment_intent' } }, 404)
    const detach = path.match(/^\/payment_methods\/(pm_\w+)\/detach$/)
    if (detach) { methods.delete(detach[1]); return json({ id: detach[1], customer: null }) }
    return json({ error: { message: `fake has no ${request.method} ${path}` } }, 400)
  }

  return {
    handler, calls, texts, sessions, intents,
    /** The patient finishes Stripe Checkout: a saved card (setup) or a paid balance. */
    complete(sessionId, { declined = false } = {}) {
      const s = sessions.get(sessionId)
      s.status = 'complete'
      if (s.mode === 'setup') {
        const pm = { id: declined ? 'pm_card_declined' : next('pm'), object: 'payment_method', type: 'card', card }
        methods.set(pm.id, { ...pm, declined })
        s.setup_intent = { id: next('seti'), object: 'setup_intent', status: 'succeeded', payment_method: pm }
      } else {
        const id = next('pi')
        intents.set(id, { id, object: 'payment_intent', status: 'succeeded', amount: s.amount, amount_received: s.amount, currency: 'usd', metadata: s.metadata, latest_charge: charge({ card }) })
        s.payment_intent = id
      }
      return s
    },
    /** A webhook delivery as Stripe signs it (Stripe-Signature t=…,v1=HMAC-SHA256). */
    event(type, object, id = next('evt')) {
      const body = JSON.stringify({ id, object: 'event', type, data: { object } }), t = Math.floor(Date.now() / 1000)
      return { id, body, signature: `t=${t},v1=${createHmac('sha256', webhookSecret).update(`${t}.${body}`).digest('hex')}` }
    },
  }
}
