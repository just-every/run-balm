// Stripe and Twilio faked at their HTTP edge (the Worker's outbound fetch), with
// the request and response shapes of Stripe's documented API. Test mode only:
// card pm_card_declined is refused like Stripe's 4000 0000 0000 0341 test card.
import { createHmac } from 'node:crypto'
import { readFile } from 'node:fs/promises'

const twilioMessage = JSON.parse(await readFile(new URL('../fixtures/twilio-message.json', import.meta.url), 'utf8'))

export function fakeProviders() {
  let n = 0
  const next = prefix => `${prefix}_test${String(++n).padStart(6, '0')}`
  const sessions = new Map(), intents = new Map(), refunds = new Map(), readers = new Map(), calls = [], texts = []
  const checkoutKeys=new Map()
  let webhookSecret = null
  const json = (value, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json' } })
  const card = { brand: 'visa', last4: '4242', exp_month: 12, exp_year: 2034 }
  const charge = (method, intent, customer, amount) => ({ id: next('ch'), payment_intent: intent, customer, amount, amount_refunded: 0, paid: true, captured: true, currency: 'usd', disputed: false, payment_method_details: { type: 'card', card: { brand: method.card.brand, last4: method.card.last4 } } })
  const methods = new Map()

  async function handler(request) {
    const url = new URL(request.url), body = request.method === 'POST' ? Object.fromEntries(new URLSearchParams(await request.text())) : Object.fromEntries(url.searchParams)
    if (url.hostname === 'api.twilio.com') {
      texts.push({ path: url.pathname, body, auth: request.headers.get('authorization') })
      return json({ ...twilioMessage, to: body.To, from: body.From, body: body.Body }, 201)
    }
    if (url.hostname !== 'api.stripe.com') return new Response('unexpected host ' + url.hostname, { status: 599 })
    const path = url.pathname.replace(/^\/v1/, '')
    // Balm names its API version; on the current version Checkout no longer takes payment_method_types.
    if (!request.headers.get('stripe-version')) return json({ error: { message: 'fake: every Balm call names a Stripe-Version' } }, 400)
    if (Object.keys(body).some(k => k.startsWith('payment_method_types'))) return json({ error: { message: 'The `payment_method_types` parameter is no longer supported when creating a Checkout Session.' } }, 400)
    calls.push({ method: request.method, path, body, idempotencyKey: request.headers.get('idempotency-key') })
    if (path === '/account') return json({ id: 'acct_test_clinic', country: 'US', default_currency: 'usd', settings: { dashboard: { display_name: 'Riverside Physio (test)' } } })
    if (path === '/customers') return json({ id: next('cus') })
    if (path === '/webhook_endpoints') { webhookSecret = 'synthetic-balm-' + (++n); return json({ id: next('we'), secret: webhookSecret, url: body.url }) }
    if (path.startsWith('/webhook_endpoints/')) return json({ id: path.split('/')[2], deleted: true })
    if (path === '/checkout/sessions') {
      const key=request.headers.get('idempotency-key')
      if(key&&checkoutKeys.has(key))return json(sessions.get(checkoutKeys.get(key)))
      const id = next('cs')
      sessions.set(id, { id, object: 'checkout.session', mode: body.mode, status: 'open', customer: body.customer ?? null, metadata: { balm_payment: body['metadata[balm_payment]'], balm_client: body['metadata[balm_client]'] },
        amount: Number(body['line_items[0][price_data][unit_amount]'] ?? 0), url: `https://checkout.stripe.com/c/pay/${id}`, success_url: body.success_url, setup_intent: null, payment_intent: null })
      if(key)checkoutKeys.set(key,id)
      return json(sessions.get(id))
    }
    const session = path.match(/^\/checkout\/sessions\/(cs_\w+)$/)
    if (session) {
      const s = sessions.get(session[1])
      if (!s) return json({ error: { message: 'No such checkout session' } }, 404)
      return json({ ...s, payment_intent: s.payment_intent ? intents.get(s.payment_intent) : null })
    }
    if(path==='/payment_intents/search')return json({data:[...intents.values()].filter(i=>body.query===`metadata['balm_payment']:'${i.metadata?.balm_payment}'`),has_more:false})
    if(path.match(/^\/payment_intents\/pi_\w+\/cancel$/)){const i=intents.get(path.split('/')[2]);i.status='canceled';return json(i)}
    if (path === '/payment_intents') {
      if(body['allowed_payment_method_types[0]']==='card_present'){
        const id=next('pi'),intent={id,status:'requires_payment_method',amount:Number(body.amount),amount_received:0,currency:'usd',customer:body.customer,livemode:false,payment_method_types:['card_present'],metadata:{balm_payment:body['metadata[balm_payment]'],balm_client:body['metadata[balm_client]']},latest_charge:null};intents.set(id,intent);return json(intent)
      }
      const method = methods.get(body.payment_method)
      const id = next('pi')
      if (!method || method.declined) {
        intents.set(id, { id, object: 'payment_intent', status: 'requires_payment_method', amount: Number(body.amount), amount_received: 0, metadata: { balm_payment: body['metadata[balm_payment]'], balm_client: body['metadata[balm_client]'] } })
        return json({ error: { type: 'card_error', code: 'card_declined', decline_code: 'insufficient_funds', message: 'Your card has insufficient funds.', payment_intent: { id, status: 'requires_payment_method' } } }, 402)
      }
      intents.set(id, { id, object: 'payment_intent', status: 'succeeded', amount: Number(body.amount), amount_received: Number(body.amount), currency: body.currency, customer: body.customer, metadata: { balm_payment: body['metadata[balm_payment]'], balm_client: body['metadata[balm_client]'] }, latest_charge: charge(method, id, body.customer, Number(body.amount)) })
      return json(intents.get(id))
    }
    if (path === '/refunds') {
      if (request.method === 'GET') return json({data:[...refunds.values()].filter(r=>r.payment_intent===body.payment_intent),has_more:false})
      const intent = [...intents.values()].find(v=>v.latest_charge?.id===body.charge)
      if(!intent)return json({error:{message:'No such original charge'}},404)
      const r = {id:next('re'),status:'succeeded',payment_intent:intent.id,charge:intent.latest_charge.id,amount:Number(body.amount),currency:'usd',metadata:{balm_refund:body['metadata[balm_refund]'],balm_payment:body['metadata[balm_payment]']}}
      intent.latest_charge.amount_refunded += r.amount;refunds.set(r.id,r);return json(r)
    }
    if (path.startsWith('/refunds/')) return json(refunds.get(path.split('/').at(-1)))
    if (path === '/terminal/readers') {
      const reader={id:next('tmr'),location:body.location,device_type:'simulated_wisepos_e',livemode:false,status:'online',action:null};readers.set(reader.id,reader);return json(reader)
    }
    const readerMatch=path.match(/^\/terminal\/readers\/(tmr_\w+)(?:\/(process_payment_intent|cancel_action))?$/)
    if(readerMatch){
      const reader=readers.get(readerMatch[1]);if(!reader)return json({error:{message:'Unknown reader'}},404)
      if(readerMatch[2]==='process_payment_intent')reader.action={status:'in_progress',type:'process_payment_intent',process_payment_intent:{payment_intent:body.payment_intent}}
      if(readerMatch[2]==='cancel_action')reader.action=null
      return json(reader)
    }
    const present=path.match(/^\/test_helpers\/terminal\/readers\/(tmr_\w+)\/present_payment_method$/)
    if(present){const reader=readers.get(present[1]),intent=intents.get(reader.action.process_payment_intent.payment_intent);intent.status='succeeded';intent.amount_received=intent.amount;intent.latest_charge=charge({card},intent.id,intent.customer,intent.amount);intent.latest_charge.payment_method_details={type:'card_present',card_present:card};reader.action.status='succeeded';return json(reader)}
    const intent = path.match(/^\/payment_intents\/(pi_\w+)$/)
    if (intent) return intents.has(intent[1]) ? json(intents.get(intent[1])) : json({ error: { message: 'No such payment_intent' } }, 404)
    const detach = path.match(/^\/payment_methods\/(pm_\w+)\/detach$/)
    if (detach) { methods.delete(detach[1]); return json({ id: detach[1], customer: null }) }
    return json({ error: { message: `fake has no ${request.method} ${path}` } }, 400)
  }

  return {
    handler, calls, texts, sessions, intents, refunds, readers,
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
        intents.set(id, { id, object: 'payment_intent', status: 'succeeded', amount: s.amount, amount_received: s.amount, currency: 'usd', customer:s.customer, metadata: s.metadata, latest_charge: charge({ card }, id, s.customer, s.amount) })
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
