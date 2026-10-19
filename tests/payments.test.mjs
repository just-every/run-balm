import { test } from 'node:test'
import assert from 'node:assert/strict'
import { harness } from './harness.mjs'
import { clinic, pastVisit, visitDate } from './clinic.mjs'
import { fakeProviders } from './fakes/stripe.mjs'

const sms = { SMS_PROVIDER: 'twilio', TWILIO_ACCOUNT_SID: 'ACXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX', TWILIO_AUTH_TOKEN: 'test-token', TWILIO_FROM: '+15005550006' }
const tokenOf = url => new URL(url).pathname.split('/')[2]
const sessionOf = location => location.split('/').pop()
const pdfText = response => response.text

async function connected(options = {}) {
  const stripe = fakeProviders(), h = await harness({ outbound: stripe.handler, ...options })
  try {
    await h.finishSetup()
    const { service, practitioners: [priya] } = await clinic(h)
    const reception = await h.staff('Rosa', 'reception')
    const view = await h.cmd('pay.stripe.connect', { secretKey: 'sk_test_' + 'a'.repeat(24) })
    assert.equal(view.connected.accountId, 'acct_test_clinic')
    const client = await h.cmd('client.save', { firstName: 'Ava', lastName: 'Ng', dateOfBirth: '1992-06-15', email: 'ava@client.example', phone: '(555) 010-0199' }, reception.cookie)
    return { h, stripe, service, priya, reception, client, view }
  } catch (error) { await h.close(); throw error }
}

/** The patient opens their card link, accepts the authorization and saves a card in Stripe Checkout. */
async function saveCard(h, stripe, reception, clientId) {
  // From the client file's card panel: the page shows the link once.
  const shown = await h.form(`/app/action?name=pay.link.create&returnTo=/app/clients/${clientId}`, { clientId, purpose: 'card', delivery: 'shown' }, reception.cookie)
  assert.equal(shown.status, 200, shown.text)
  const token = shown.text.match(/href="https?:\/\/[^"]+\/pay\/([\w-]+)"/)[1], page = await h.send(`/pay/${token}`)
  assert.equal(page.status, 200)
  assert.match(page.text, /I authorize Riverside Physio to save this card/)
  assert.equal((await h.form(`/pay/${token}?do=card`, {})).status, 400)
  const started = await h.form(`/pay/${token}?do=card`, { consent: 'on' })
  assert.equal(started.status, 303); assert.match(started.location, /^https:\/\/checkout\.stripe\.com\//)
  stripe.complete(sessionOf(started.location))
  return { token, session: sessionOf(started.location) }
}

test('copay at check-in from the day view, then the balance by pay link: paid once, matched to the invoice, on the statement and superbill', { timeout: 120_000 }, async () => {
  const { h, stripe, service, priya, reception, client } = await connected({ auth: sms })
  try {
    await h.cmd('pay.npi.save', { staffId: priya.id, npi: '1234567890' }, h.owner, 400)
    await h.cmd('pay.npi.save', { staffId: priya.id, npi: '1234567893' })
    await h.cmd('pay.copay.save', { clientId: client.id, copay: '30.00' }, reception.cookie)
    const { token, session } = await saveCard(h, stripe, reception, client.id)
    const back = await h.send(`/pay/${token}?setup=${session}`)
    assert.match(back.text, /Your card is saved/); assert.match(back.text, /Visa ending 4242/)

    // The front desk checks the patient in and charges the copay in one action from the schedule.
    const visit = await pastVisit(h, client.id, priya, service.id, reception.cookie, 0)
    const schedule = '/app?date=' + await visitDate(h, visit, reception.cookie)
    const day = await h.send(schedule, undefined, reception.cookie)
    assert.match(day.text, /Check in and charge \$30\.00 copay to Visa ending 4242/)
    const checkIn = await h.form('/app/action?name=pay.checkin&returnTo=/app', { appointmentId: visit, charge: 'on' }, reception.cookie)
    assert.equal(checkIn.status, 303, checkIn.text)
    const charged = stripe.calls.filter(c => c.path === '/payment_intents')
    assert.equal(charged.length, 1)
    assert.deepEqual([charged[0].body.amount, charged[0].body.off_session, charged[0].body.confirm, charged[0].body.currency], ['3000', 'true', 'true', 'usd'])
    assert.ok(charged[0].idempotencyKey)
    const after = await h.send(schedule, undefined, reception.cookie)
    assert.match(after.text, /Copay \$30\.00 paid/); assert.match(after.text, /Receipt R-000001/)
    assert.equal((await h.form('/app/action?name=pay.checkin&returnTo=/app', { appointmentId: visit, charge: 'on' }, reception.cookie)).status, 409)
    assert.equal(stripe.calls.filter(c => c.path === '/payment_intents').length, 1)
    const receiptId = (await h.db.prepare("SELECT id,receipt_delivery FROM bm_card_payments WHERE kind='copay'").first())
    assert.equal(receiptId.receipt_delivery, 'sent')
    const receipt = await h.send(`/api/balm/receipts/${receiptId.id}.pdf`, undefined, reception.cookie)
    assert.equal(receipt.headers.get('content-type'), 'application/pdf'); assert.match(pdfText(receipt), /^%PDF-1\.4/); assert.match(pdfText(receipt), /Copay at check-in/)

    // The invoice approved after the visit takes the copay; the rest is open.
    await h.cmd('appointment.attend', { id: visit }, priya.cookie)
    const invoice = await h.cmd('invoice.prepare', { appointmentId: visit }, reception.cookie)
    await h.cmd('invoice.approve', { id: invoice.id }, reception.cookie)
    let file = (await h.send('/api/balm/clients/' + client.id, undefined, reception.cookie)).value
    assert.equal(file.invoices[0].paid_cents, 3000)
    assert.equal(file.billing.ledger.balanceCents, 6500)

    // Superbill: refused until the visit has its codes, then a PDF with CPT, ICD-10, NPI and tax ID.
    assert.equal((await h.send(`/api/balm/superbills/${invoice.id}.pdf`, undefined, reception.cookie)).status, 409)
    await h.cmd('pay.codes.save', { appointmentId: visit, cpt: '97161 GP, 97110 GP x2', icd10: 'M25.561, m5450' }, priya.cookie)
    await h.cmd('pay.codes.save', { appointmentId: visit, cpt: '9711', icd10: '' }, priya.cookie, 400)
    const superbill = await h.send(`/api/balm/superbills/${invoice.id}.pdf`, undefined, reception.cookie)
    assert.equal(superbill.status, 200)
    for (const text of ['Superbill', '1234567893', '12-3456789', 'M25.561', 'M54.50', '97161', '97110', 'GP', 'Ava Ng', '$95.00']) assert.ok(pdfText(superbill).includes(text), text)

    // The balance goes by text (adapter, recorded Twilio response), and the patient pays it from their link.
    const texted = await h.cmd('pay.link.create', { clientId: client.id, purpose: 'balance', delivery: 'text' }, reception.cookie)
    assert.equal(texted.delivered, 'sent')
    assert.equal(stripe.texts.length, 1)
    assert.equal(stripe.texts[0].body.To, '+15550100199'); assert.match(stripe.texts[0].body.Body, /\$65\.00: https?:\/\/[^\s]+\/pay\/[\w-]+$/)
    assert.ok(!/Initial consultation|M25/.test(stripe.texts[0].body.Body))
    const emailed = await h.cmd('pay.link.create', { clientId: client.id, purpose: 'balance', delivery: 'email' }, reception.cookie)
    assert.equal(emailed.delivered, 'sent'); assert.equal(emailed.url, undefined)
    assert.match(h.mail.findLast(m => m.subject.startsWith('Your statement')).text, /pay your balance/)
    // The statement still works before online payments are connected, with clinic payment instructions.
    await h.cmd('pay.stripe.disconnect', {})
    await h.cmd('pay.link.create', { clientId: client.id, purpose: 'balance', delivery: 'email' }, reception.cookie)
    const offlineMail = h.mail.findLast(m => m.subject.startsWith('Your statement'))
    assert.doesNotMatch(offlineMail.text + offlineMail.html, /Stripe|pay your balance/)
    assert.match(offlineMail.text, /pay at the clinic/)
    const offlineLink = new URL(offlineMail.text.match(/https?:\/\/[^\s]+\/pay\/[\w-]+/)[0]).pathname
    const offlinePage = await h.send(offlineLink)
    assert.equal(offlinePage.status, 200)
    assert.match(offlinePage.text, /Please pay at the clinic/)
    assert.doesNotMatch(offlinePage.text, /action="[^\"]+\?do=pay"/)
    await h.cmd('pay.stripe.connect', { secretKey: 'sk_test_' + 'a'.repeat(24) })
    const pay = tokenOf(stripe.texts[0].body.Body.match(/https?:\/\/\S+/)[0])
    assert.match((await h.send(`/pay/${pay}`)).text, /Balance due \$65\.00/)
    assert.equal((await h.form(`/pay/${pay}?do=pay`, { amount: '65.01' })).status, 400)
    const checkout = await h.form(`/pay/${pay}?do=pay`, { amount: '65.00' })
    assert.equal(checkout.status, 303)
    stripe.complete(sessionOf(checkout.location))
    const paid = await h.send(`/pay/${pay}?paid=${sessionOf(checkout.location)}`)
    assert.match(paid.text, /Your payment of \$65\.00 was received/); assert.match(paid.text, /Balance due \$0\.00/)

    // The statement across visits: the charge, the copay and the online payment, balance zero.
    file = (await h.send('/api/balm/clients/' + client.id, undefined, reception.cookie)).value
    assert.equal(file.invoices[0].paid_cents, 9500)
    assert.deepEqual(file.billing.ledger.lines.map(l => [l.kind, l.chargeCents || -l.paymentCents]), [['card', -3000], ['charge', 9500], ['card', -6500]])
    assert.equal(file.billing.ledger.balanceCents, 0)
    const statement = await h.send(`/pay/${pay}/statement.pdf`)
    assert.match(pdfText(statement), /^%PDF/); for (const text of ['Statement', 'Copay at check-in', 'Paid online', '$95.00', 'Balance due']) assert.ok(pdfText(statement).includes(text), text)
    assert.equal((await h.send(`/pay/${pay}/superbills/${invoice.id}.pdf`)).status, 200)
    const audit = file.audit ?? (await h.send('/api/balm/clients/' + client.id, undefined, h.owner)).value.audit
    for (const action of ['card.saved', 'appointment.checked_in', 'payment.copay_succeeded', 'payment.link_succeeded', 'statement.downloaded', 'superbill.downloaded']) assert.ok(audit.some(a => a.action === action), action)
    assert.ok(!JSON.stringify(audit).includes('M25.561'))
  } finally { await h.close() }
})

test('a Stripe webhook replayed, or reported by several events and the return, matches the payment to the invoice once', { timeout: 120_000 }, async () => {
  const { h, stripe, service, priya, reception, client, view } = await connected({ https: true })
  try {
    assert.equal(view.connected.webhook, true)
    const hook = async e => h.send('/api/balm/stripe/webhook', JSON.parse(e.body), '', { 'stripe-signature': e.signature, origin: '' })
    const { session } = await saveCard(h, stripe, reception, client.id)
    const saved = stripe.event('checkout.session.completed', stripe.sessions.get(session))
    assert.equal((await hook(saved)).status, 200)
    assert.equal((await hook(saved)).value.duplicate, true)
    assert.equal((await h.db.prepare('SELECT COUNT(*) AS n FROM bm_cards WHERE client_id=?').bind(client.id).first()).n, 1)

    const visit = await pastVisit(h, client.id, priya, service.id, reception.cookie)
    await h.cmd('appointment.attend', { id: visit }, priya.cookie)
    const invoice = await h.cmd('invoice.prepare', { appointmentId: visit }, reception.cookie)
    await h.cmd('invoice.approve', { id: invoice.id }, reception.cookie)
    const link = await h.cmd('pay.link.create', { clientId: client.id, purpose: 'balance', delivery: 'shown' }, reception.cookie)
    const checkout = await h.form(`/pay/${tokenOf(link.url)}?do=pay`, { amount: '95.00' })
    const s = stripe.complete(sessionOf(checkout.location)), intent = stripe.intents.get(s.payment_intent)

    const forged = stripe.event('checkout.session.completed', s)
    assert.equal((await h.send('/api/balm/stripe/webhook', JSON.parse(forged.body), '', { 'stripe-signature': forged.signature.replace(/v1=(.)/, (_, c) => 'v1=' + (c === '0' ? '1' : '0')), origin: '' })).status, 400)
    const completed = stripe.event('checkout.session.completed', s), succeeded = stripe.event('payment_intent.succeeded', intent)
    const results = await Promise.all([hook(completed), hook(completed), hook(succeeded)])
    assert.deepEqual(results.map(r => r.status), [200, 200, 200])
    assert.equal((await hook(completed)).value.duplicate, true)
    assert.equal((await h.send(`/pay/${tokenOf(link.url)}?paid=${s.id}`)).status, 200)

    const payments = (await h.db.prepare('SELECT amount_cents,reference FROM bm_payments WHERE invoice_id=?').bind(invoice.id).all()).results
    assert.deepEqual(payments.map(p => p.amount_cents), [9500])
    assert.equal(payments[0].reference, `stripe:${intent.id}:${invoice.id}`)
    const card = (await h.db.prepare("SELECT status,applied_cents,receipt_number FROM bm_card_payments WHERE kind='link'").all()).results
    assert.deepEqual(card, [{ status: 'succeeded', applied_cents: 9500, receipt_number: 1 }])
    const file = (await h.send('/api/balm/clients/' + client.id, undefined, reception.cookie)).value
    assert.equal(file.billing.ledger.balanceCents, 0)
    assert.equal(file.billing.ledger.lines.filter(l => l.kind === 'card').length, 1)
  } finally { await h.close() }
})
