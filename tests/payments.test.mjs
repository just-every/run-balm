import { cardPaymentsJourney } from './card-payments-journey.mjs'
import { test, mock } from 'node:test'
import assert from 'node:assert/strict'
import { harness, run } from './harness.mjs'
import { clinic, pastVisit, visitDate } from './clinic.mjs'
import { fakeProviders } from './fakes/stripe.mjs'
import { portalBilling, portalLogin } from './portal-billing.mjs'
import { installmentTick, paymentPlanEdge, recordedAuthorization } from './payment-plan-fixtures.mjs'

const sms = { SMS_PROVIDER: 'twilio', TWILIO_ACCOUNT_SID: 'synthetic-balm-sms-account', TWILIO_AUTH_TOKEN: 'synthetic-balm-sms-token', TWILIO_FROM: '+15005550006' }
const tokenOf = url => new URL(url).pathname.split('/')[2]
const sessionOf = location => location.split('/').pop()
const pdfText = response => response.text

async function connected(options = {}) {
  const stripe = options.stripe ?? fakeProviders(), h = await harness({ origin: 'https://synthetic-balm.example', outbound: stripe.handler, ...options })
  try {
    await h.finishSetup()
    const { service, practitioners: [priya] } = await clinic(h)
  await h.cmd('settings.save', { clinicName: 'Riverside Physio', timeZone: 'Australia/Brisbane', taxId: '12-3456789', practiceNpi: '1234567893', address: '1 River St' })
    const reception = await h.staff('Rosa', 'reception')
    const view = await h.cmd('pay.stripe.connect', { secretKey: 'synthetic-balm-1' })
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
    await h.cmd('pay.stripe.connect', { secretKey: 'synthetic-balm-1' })
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


test('PAY-005: a period superbill includes each signed visit and ledger payment, refuses incomplete visits and keeps patient scope', async () => {
  const h = await harness()
  try {
    await h.finishSetup()
    const { service, practitioners: [priya] } = await clinic(h)
    await h.cmd('settings.save', { clinicName: 'Lakeside Therapy', timeZone: 'Australia/Brisbane', taxId: '12-3456789', practiceNpi: '1234567893', address: '100 Lake Street, Chicago IL' })
    await h.cmd('pay.npi.save', { staffId: priya.id, npi: '1245319599' })
    const client = await h.cmd('client.save', { firstName: 'Marisol', lastName: 'Diaz', dateOfBirth: '1980-03-07', email: 'marisol@patient.example' })
    const invoiceIds = []
    for (const hours of [2,5]) {
      const visit = await pastVisit(h, client.id, priya, service.id, h.owner, hours)
      const note = await h.cmd('note.write', { clientId: client.id, appointmentId: visit, body: 'Therapeutic exercise and manual therapy completed; stairs improving.', charges: [{ code: '97110', minutes: 23 }, { code: '97140', minutes: 10 }] }, priya.cookie)
      await h.cmd('note.sign', { id: note.id, revision: 1, signature: 'Priya', credentials: 'PT, DPT', attest: true }, priya.cookie)
      await h.cmd('pay.codes.save', { appointmentId: visit, cpt: '97110 GP x1, 97140 GP x1', icd10: 'M25.561' }, priya.cookie)
      await h.cmd('appointment.attend', { id: visit }, priya.cookie)
      const invoice = await h.cmd('invoice.prepare', { appointmentId: visit })
      await h.cmd('invoice.approve', { id: invoice.id })
      invoiceIds.push(invoice.id)
    }
    await h.cmd('payment.record', { invoiceId: invoiceIds[0], amountCents: 3000, reference: 'patient-check-1042' })
    const dates = (await h.state()).appointments.map(a => new Date(Date.parse(a.start_at) + 10*3600000).toISOString().slice(0,10)).sort()
    const from = dates[0].slice(0,7)+'-01', d = new Date(dates.at(-1)+'T00:00:00Z'), to = new Date(Date.UTC(d.getUTCFullYear(),d.getUTCMonth()+1,0)).toISOString().slice(0,10)
    const path = `/api/balm/period-superbills/${client.id}.pdf?from=${from}&to=${to}`
    const period = await h.send(path, undefined, h.owner)
    assert.equal(period.status, 200)
    for (const text of ['Period superbill','Marisol Diaz','Lakeside Therapy','Practice NPI','Rendering NPI','1234567893','1245319599','12-3456789','97110','97140','GP','M25.561','$190.00','$30.00','$160.00']) assert.ok(pdfText(period).includes(text), text)
    for (const id of invoiceIds) assert.equal((await h.send(`/api/balm/superbills/${id}.pdf`, undefined, h.owner)).status,200)
    assert.equal((await h.send(path, undefined, priya.cookie)).status,403)
    assert.equal((await h.send(path)).status,401)
    assert.equal((await h.send(path.replace(`from=${from}`,`from=${to}`) + 'x', undefined, h.owner)).status,400)
    const link = await h.cmd('pay.link.create', { clientId: client.id, purpose: 'balance', delivery: 'shown' })
    const patientPath = new URL(link.url).pathname
    assert.equal((await h.send(`${patientPath}/superbill.pdf?from=${from}&to=${to}`)).status,200)
    assert.ok((await h.send('/app/clients/'+client.id,undefined,h.owner)).text.includes('Download period superbill'))
    await h.form('/portal', { email: 'marisol@patient.example' })
    const mail = h.mail.findLast(m => m.text.includes('/portal/confirm?token='))
    const token = new URL(mail.text.match(/https?:\/\/[^\s]+\/portal\/confirm\?token=[^\s]+/)[0]).searchParams.get('token')
    const signedIn = await h.send('/portal/confirm', { token })
    assert.equal(signedIn.status,303)
    assert.equal((await h.send(`/portal/superbill.pdf?from=${from}&to=${to}`,undefined,signedIn.cookie)).status,200)
    const incompleteVisit = await pastVisit(h, client.id, priya, service.id, h.owner, 8)
    await h.cmd('appointment.attend', { id: incompleteVisit })
    const incompleteInvoice = await h.cmd('invoice.prepare', { appointmentId: incompleteVisit })
    await h.cmd('invoice.approve', { id: incompleteInvoice.id })
    assert.equal((await h.send(path, undefined, h.owner)).status,409, 'one incomplete visit refuses the whole document')
    const other = await h.cmd('client.save', { firstName:'Ava', lastName:'Ng', dateOfBirth:'1992-06-15' })
    const otherLink = await h.cmd('pay.link.create', { clientId: other.id, purpose:'card',delivery:'shown' })
    assert.equal((await h.send(new URL(otherLink.url).pathname+`/superbill.pdf?from=${from}&to=${to}`)).status,409, 'a patient without visits cannot obtain another patient’s superbill')
  } finally { await h.close() }
})


test('PORTAL-004: paid and unpaid visits, every current document, portal payment to zero and patient isolation', { timeout: 120_000 }, async () => {
  const { h, stripe, patient, invoices, cookie } = await portalBilling()
  try {
    let page = await h.send('/portal/home', undefined, cookie)
    assert.equal(page.status, 200)
    assert.match(page.text, /\$95\.00 <span>balance/)
    const receiptLinks = [...page.text.matchAll(/href="(\/portal\/receipts\/[^" ]+\.pdf)"/g)].map(m => m[1])
    const superbillLinks = [...page.text.matchAll(/href="(\/portal\/superbills\/[^" ]+\.pdf)"/g)].map(m => m[1])
    assert.equal(receiptLinks.length, 1)
    assert.deepEqual(superbillLinks.map(p => p.split('/').at(-1).replace('.pdf', '')).sort(), [...invoices].sort())
    const receipt = await h.send(receiptLinks[0], undefined, cookie)
    assert.equal(receipt.status, 200)
    assert.match(receipt.text, /^%PDF/)
    for (const text of ['Marisol Diaz', '$95.00', 'Visa', '4242']) assert.ok(receipt.text.includes(text), text)
    for (const path of superbillLinks) {
      const doc = await h.send(path, undefined, cookie)
      assert.equal(doc.status, 200)
      for (const text of ['Marisol Diaz', '97110', 'GP', 'M25.561', '1234567893', '1245319599', '$95.00']) assert.ok(doc.text.includes(text), text)
    }
    const statement = await h.send('/portal/statement.pdf', undefined, cookie)
    assert.equal(statement.status, 200)
    for (const text of ['Marisol Diaz', '$190.00', '$95.00', 'Paid online', 'Balance due']) assert.ok(statement.text.includes(text), text)

    // Session identity selects the ledger even if a different client id is posted.
    const foreign = await h.cmd('client.save', { firstName: 'Una', lastName: 'Other', email: 'una@patient.example' })
    const otherCookie = await portalLogin(h, 'una@patient.example')
    for (const path of [...receiptLinks, ...superbillLinks]) {
      assert.equal((await h.send(path, undefined, otherCookie)).status, 404)
      assert.equal((await h.send(path)).status, 303)
    }
    const opened = await h.form('/portal/action', { name: 'payment.open', clientId: foreign.id }, cookie)
    assert.equal(opened.status, 303)
    const pay = await h.send(opened.location)
    assert.match(pay.text, /Balance due \$95\.00/)
    const checkout = await h.form(opened.location + '?do=pay', { amount: '95.00' })
    assert.equal(checkout.status, 303)
    const session = stripe.complete(checkout.location.split('/').at(-1))
    assert.equal(session.amount, 9500)
    assert.equal((await h.send(opened.location + '?paid=' + session.id)).status, 200)
    assert.equal((await h.send(opened.location + '?paid=' + session.id)).status, 200)
    page = await h.send('/portal/home', undefined, cookie)
    assert.match(page.text, /\$0\.00 <span>balance/)
    assert.equal([...page.text.matchAll(/href="\/portal\/receipts\//g)].length, 2)
    const file = (await h.send('/api/balm/clients/' + patient.id, undefined, h.owner)).value
    assert.equal(file.billing.ledger.balanceCents, 0)
    assert.equal(file.billing.ledger.lines.filter(l => l.kind === 'card').length, 2)
    assert.deepEqual(file.invoices.filter(i => invoices.includes(i.id)).map(i => i.paid_cents), [9500, 9500])
    const finalStatement = await h.send('/portal/statement.pdf', undefined, cookie)
    assert.match(finalStatement.text, /Balance due[^]*\$0\.00/)
    for (const action of ['statement.downloaded', 'receipt.downloaded', 'superbill.downloaded', 'paylink.portal_opened']) assert.ok(file.audit.some(a => a.action === action), action)
    await h.cmd('pay.stripe.disconnect', {})
    const disconnected = await h.send('/portal/home', undefined, cookie)
    assert.doesNotMatch(disconnected.text, />Pay balance</)
    assert.equal((await h.form('/portal/action', { name: 'payment.open' }, cookie)).status, 409)
    assert.equal((await h.send('/portal/statement.pdf', undefined, cookie)).status, 200)
  } finally { await h.close() }
})

test('PAY-006: three authorized monthly card charges, consented reminder sequence, human aged review, stops, racing ticks and uncertain charges, with each payment in the patient portal', { timeout: 120_000 }, async () => {
  const edge = paymentPlanEdge()
  const { h, stripe, service, priya, reception, client } = await connected({ stripe: edge.stripe, outbound: edge.handler, https: true })
  try {
    const authorize = recordedAuthorization()
    const approve = async (patientId, hours) => {
      const visit = await pastVisit(h, patientId, priya, service.id, reception.cookie, hours)
      await h.cmd('appointment.attend', { id: visit }, priya.cookie)
      const invoice = await h.cmd('invoice.prepare', { appointmentId: visit }, reception.cookie)
      await h.cmd('invoice.approve', { id: invoice.id }, reception.cookie)
      return invoice.id
    }
    const card = await saveCard(h, stripe, reception, client.id)
    await h.send(`/pay/${card.token}?setup=${card.session}`)
    const invoices = []
    for (const hours of [2, 5, 8]) invoices.push(await approve(client.id, hours))
    const input = { clientId: client.id, amountCents: 9500, months: 3, firstDue: '2030-01-31', ...authorize }
    await h.cmd('pay.plan.create', { ...input, authorized: false }, reception.cookie, 400)
    await h.cmd('pay.plan.create', input, priya.cookie, 403)
    const key = await h.cmd('agent.create', { label: 'Payment assistant' })
    assert.equal((await h.send('/api/balm/agent/command', { name: 'pay.plan.create', input }, '', { authorization: 'Bearer ' + key.token })).status, 403)
    const created = await h.cmd('pay.plan.create', input, reception.cookie)
    await h.cmd('pay.plan.create', input, reception.cookie, 409)
    const reminder = await h.cmd('pay.reminders.save', { clientId: client.id, everyDays: 7, firstDue: '2030-01-31', ...authorize }, reception.cookie)
    await h.cmd('pay.review.save', { afterDays: 2 }, reception.cookie, 403)
    await h.cmd('pay.review.save', { afterDays: 2 })
    let file = (await h.send('/api/balm/clients/' + client.id, undefined, reception.cookie)).value
    assert.deepEqual(file.billing.plans[0].installments.map(i => i.due_on), ['2030-01-31', '2030-02-28', '2030-03-31'])
    assert.equal(file.billing.plans[0].authorized_by, 'Ava Ng')
    assert.equal(file.billing.plans[0].authorization_evidence, authorize.evidence)
    const page = await h.send('/app/clients/' + client.id, undefined, reception.cookie)
    assert.match(page.text, /Payment plans/)
    assert.match(page.text, /Stop payment plan/)

    // Racing delivery ticks reserve one installment and one reminder slot.
    await Promise.all([installmentTick(h, '2030-01-31'), installmentTick(h, '2030-01-31')])
    let charges = stripe.calls.filter(c => c.path === '/payment_intents')
    assert.equal(charges.length, 1)
    assert.equal(charges[0].body.amount, '9500')
    assert.deepEqual([charges[0].body.off_session, charges[0].body.confirm], ['true', 'true'])
    assert.match(charges[0].idempotencyKey, /^balm-payment-plan-/)
    assert.equal(h.mail.filter(m => m.subject.startsWith('Balance reminder')).length, 1)
    const cookie = await portalLogin(h, 'ava@client.example')
    let portal = await h.send('/portal/home', undefined, cookie)
    assert.match(portal.text, /\$190\.00 <span>balance/)
    assert.match(portal.text, /Your payment plans/)
    assert.ok(portal.text.includes(file.billing.plans[0].authorization_text))
    await installmentTick(h, '2030-02-07')
    assert.equal(h.mail.filter(m => m.subject.startsWith('Balance reminder')).length, 2)
    for (const mail of h.mail.filter(m => m.subject.startsWith('Balance reminder'))) {
      assert.ok(mail.text.includes('/portal'))
      assert.doesNotMatch(mail.text + mail.html, /Ava|Initial consultation|M25|\$190/)
    }
    assert.ok((await h.state(reception.cookie)).payments.review.accounts.some(a => a.client_id === client.id), 'the scheduled aged account enters a human review list')
    const reviewPage = await h.send('/app/invoices', undefined, reception.cookie)
    assert.equal(reviewPage.status, 200)
    assert.ok(reviewPage.text.includes(`/app/clients/${client.id}`), 'PAY-006 reception can open the human review list and its patient file')
    assert.equal((await h.state(priya.cookie)).payments.review, undefined)

    await installmentTick(h, '2030-02-28')
    portal = await h.send('/portal/home', undefined, cookie)
    assert.match(portal.text, /\$95\.00 <span>balance/)
    // The existing portal payment door reduces the third installment's cap.
    const open = await h.form('/portal/action', { name: 'payment.open' }, cookie)
    assert.equal(open.status, 303)
    const checkout = await h.form(open.location + '?do=pay', { amount: '40.00' })
    assert.equal(checkout.status, 303)
    const paid = stripe.complete(sessionOf(checkout.location))
    assert.equal((await h.send(open.location + '?paid=' + paid.id)).status, 200)
    await Promise.all([installmentTick(h, '2030-03-31'), installmentTick(h, '2030-03-31')])
    charges = stripe.calls.filter(c => c.path === '/payment_intents')
    assert.deepEqual(charges.map(c => Number(c.body.amount)), [9500, 9500, 5500])
    assert.equal(new Set(charges.map(c => c.idempotencyKey)).size, 3)
    file = (await h.send('/api/balm/clients/' + client.id, undefined, reception.cookie)).value
    assert.equal(file.billing.plans.find(p => p.id === created.id).status, 'completed')
    assert.deepEqual(file.billing.plans[0].installments.map(i => i.status), ['paid', 'paid', 'paid'])
    assert.equal(file.billing.reminders.find(r => r.id === reminder.id).status, 'paid')
    assert.equal(file.billing.ledger.balanceCents, 0)
    assert.deepEqual(file.invoices.filter(i => invoices.includes(i.id)).map(i => i.paid_cents), [9500, 9500, 9500])
    const sentWhenPaid = h.mail.filter(m => m.subject.startsWith('Balance reminder')).length
    await installmentTick(h, '2030-04-30')
    assert.equal(h.mail.filter(m => m.subject.startsWith('Balance reminder')).length, sentWhenPaid)
    assert.equal(stripe.calls.filter(c => c.path === '/payment_intents').length, 3)
    assert.ok(!(await h.state(reception.cookie)).payments.review.accounts.some(a => a.client_id === client.id))
    portal = await h.send('/portal/home', undefined, cookie)
    assert.match(portal.text, /\$0\.00 <span>balance/)
    const receipts = [...new Set([...portal.text.matchAll(/href="(\/portal\/receipts\/[^" ]+\.pdf)"/g)].map(m => m[1]))]
    assert.equal(receipts.length, 4)
    const foreign = await h.cmd('client.save', { firstName: 'Una', lastName: 'Other', email: 'una@patient.example' })
    const foreignCookie = await portalLogin(h, 'una@patient.example')
    assert.doesNotMatch((await h.send('/portal/home', undefined, foreignCookie)).text, /Your payment plans/)
    for (const payment of file.billing.payments) {
      assert.ok(receipts.includes(`/portal/receipts/${payment.id}.pdf`))
      const receipt = await h.send(`/portal/receipts/${payment.id}.pdf`, undefined, cookie)
      assert.equal(receipt.status, 200)
      for (const text of ['Ava Ng', 'Visa', '4242', '$' + (payment.amount_cents / 100).toFixed(2)]) assert.ok(receipt.text.includes(text), text)
      assert.equal((await h.send(`/portal/receipts/${payment.id}.pdf`, undefined, foreignCookie)).status, 404)
    }
    const statement = await h.send('/portal/statement.pdf', undefined, cookie)
    assert.equal(statement.status, 200)
    assert.match(statement.text, /Balance due[^]*\$0\.00/)
    assert.equal(file.billing.ledger.lines.filter(l => l.kind === 'card').length, 4)

    // An unpaid account keeps its reminders and human review entry until a
    // person stops the sequence; stopping a plan prevents every future charge.
    const foreignCard = await saveCard(h, stripe, reception, foreign.id)
    await h.send(`/pay/${foreignCard.token}?setup=${foreignCard.session}`)
    await approve(foreign.id, 11)
    const foreignAuth = recordedAuthorization('Una Other')
    const stoppedPlan = await h.cmd('pay.plan.create', { ...input, clientId: foreign.id, ...foreignAuth }, reception.cookie)
    const stoppedReminder = await h.cmd('pay.reminders.save', { clientId: foreign.id, everyDays: 7, firstDue: '2030-05-01', ...foreignAuth }, reception.cookie)
    await h.cmd('pay.plan.stop', { clientId: foreign.id, id: stoppedPlan.id, reason: 'Patient asked to stop card charges' }, reception.cookie)
    await installmentTick(h, '2030-05-01')
    await installmentTick(h, '2030-05-08')
    const beforeStop = h.mail.filter(m => m.subject.startsWith('Balance reminder')).length
    assert.equal(beforeStop, sentWhenPaid + 2)
    assert.ok((await h.state(reception.cookie)).payments.review.accounts.some(a => a.client_id === foreign.id))
    await h.cmd('pay.reminders.stop', { clientId: foreign.id, id: stoppedReminder.id, reason: 'Patient requested no more reminders' }, reception.cookie)
    await installmentTick(h, '2030-06-01')
    assert.equal(h.mail.filter(m => m.subject.startsWith('Balance reminder')).length, beforeStop)
    assert.equal(stripe.calls.filter(c => c.path === '/payment_intents').length, 3)

    // A real Stripe success with a lost response is never charged again, even
    // on later months. Its webhook can still recover the existing receipt.
    const uncertainPlan = await h.cmd('pay.plan.create', { ...input, clientId: foreign.id, firstDue: '2030-07-01', ...foreignAuth }, reception.cookie)
    edge.loseNextPaymentResponse()
    await installmentTick(h, '2030-07-01')
    await installmentTick(h, '2030-07-01')
    await installmentTick(h, '2030-08-01')
    assert.equal(stripe.calls.filter(c => c.path === '/payment_intents').length, 4)
    let uncertainFile = (await h.send('/api/balm/clients/' + foreign.id, undefined, reception.cookie)).value
    const installment = uncertainFile.billing.plans.find(p => p.id === uncertainPlan.id).installments[0]
    assert.equal(installment.status, 'review')
    assert.equal(uncertainFile.billing.payments[0].status, 'processing')
    assert.ok((await h.state(reception.cookie)).payments.review.attention.some(i => i.id === installment.id))
    const intent = [...stripe.intents.values()].find(i => i.metadata.balm_payment === installment.payment_id)
    const event = stripe.event('payment_intent.succeeded', intent)
    assert.equal((await h.send('/api/balm/stripe/webhook', JSON.parse(event.body), '', { 'stripe-signature': event.signature, origin: '' })).status, 200)
    await installmentTick(h, '2030-08-01')
    uncertainFile = (await h.send('/api/balm/clients/' + foreign.id, undefined, reception.cookie)).value
    assert.equal(uncertainFile.billing.ledger.balanceCents, 0)
    assert.equal(stripe.calls.filter(c => c.path === '/payment_intents').length, 4)
    assert.equal((await h.send(`/portal/receipts/${installment.payment_id}.pdf`, undefined, foreignCookie)).status, 200)
    const auditedFile = (await h.send('/api/balm/clients/' + foreign.id, undefined, h.owner)).value
    assert.ok(auditedFile.audit.some(a => a.action === 'payment_plan.authorized'))
    assert.ok(auditedFile.audit.some(a => a.action === 'balance_reminders.stopped'))
  } finally { await h.close() }
})

// PAY-004 includes its public API, staff form data, patient-session documents and scheduler.
test('PAY-004: reviewed write-offs, external credit/refund, periodic statements and financial reports preserve original money facts', { timeout: 120000 }, async () => {
  const { accountLedgerJourney } = await import('./account-ledger-journey.mjs')
  await accountLedgerJourney()
})


test('PAY-007: scheduled and requested estimates meet business-day deadlines, preserve originals and portal isolation, and flag the $400 boundary',async()=>{const {goodFaithJourney}=await import('./good-faith-journey.mjs');await run(goodFaithJourney)})

test('ROLE-002: the biller completes card, payment-plan, statement, adjustment, credit, refund and A/R work without clinical or owner powers',async()=>{
 const {h,stripe,service,priya,client}=await connected()
 try{
  const biller=await h.staff('PaymentsBiller','biller')
  await h.cmd('settings.save',{clinicName:'Riverside Physio',timeZone:'Australia/Brisbane',taxId:'12-3456789',practiceNpi:'1234567893',address:'100 Main St, Austin TX'})
  await h.cmd('pay.npi.save',{staffId:priya.id,npi:'1234567893'})
  const saved=await saveCard(h,stripe,biller,client.id)
  assert.equal((await h.send('/pay/'+saved.token+'?setup='+saved.session)).status,200)
  await h.cmd('pay.copay.save',{clientId:client.id,copay:'30.00'},biller.cookie)
  const visit=await pastVisit(h,client.id,priya,service.id)
  await h.cmd('pay.codes.save',{appointmentId:visit,cpt:'97110 GP x3',icd10:'M25.561'},priya.cookie)
  await h.cmd('appointment.attend',{id:visit})
  const invoice=await h.cmd('invoice.prepare',{appointmentId:visit},biller.cookie)
  await h.cmd('invoice.approve',{id:invoice.id},biller.cookie)
  await h.cmd('payment.record',{invoiceId:invoice.id,amountCents:1000,reference:'synthetic-balm-biller-payment'},biller.cookie)
  const today=new Date(Date.now()+10*3600000).toISOString().slice(0,10)
  for(const kind of ['adjustment','write_off']){
   const proposal=await h.cmd('pay.entry.prepare',{clientId:client.id,invoiceId:invoice.id,kind,amountCents:500,reason:'Approved courtesy correction',reference:'synthetic-balm-'+kind,occurredOn:today},biller.cookie)
   await h.cmd('pay.entry.approve',{id:proposal.id,sha256:proposal.sha256,attest:true},biller.cookie)
  }
  const consent={...recordedAuthorization('Ava Ng'),authorizedOn:today}
  const plan=await h.cmd('pay.plan.create',{clientId:client.id,amountCents:5000,months:2,firstDue:'2030-01-01',...consent},biller.cookie)
  await h.cmd('pay.plan.stop',{clientId:client.id,id:plan.id,reason:'Patient requested a different schedule'},biller.cookie)
  for(const name of ['pay.reminders.save','pay.statements.save']){
   const reminder=await h.cmd(name,{clientId:client.id,everyDays:30,firstDue:today,...consent},biller.cookie)
   await h.cmd('pay.reminders.stop',{clientId:client.id,id:reminder.id,reason:'Patient stopped this cadence'},biller.cookie)
  }
  const link=await h.cmd('pay.link.create',{clientId:client.id,purpose:'balance',delivery:'shown'},biller.cookie)
  assert.equal((await h.send(new URL(link.url).pathname)).status,200)
  await h.cmd('pay.invoice.charge',{invoiceId:invoice.id},biller.cookie)
  const credit=await h.cmd('pay.entry.prepare',{clientId:client.id,kind:'credit',amountCents:1000,reason:'External money actually received',reference:'synthetic-balm-biller-credit',occurredOn:today},biller.cookie)
  await h.cmd('pay.entry.approve',{id:credit.id,sha256:credit.sha256,attest:true},biller.cookie)
  const refund=await h.cmd('pay.entry.prepare',{clientId:client.id,creditId:credit.id,kind:'refund',amountCents:500,reason:'External money actually returned',reference:'synthetic-balm-biller-refund',occurredOn:today},biller.cookie)
  await h.cmd('pay.entry.approve',{id:refund.id,sha256:refund.sha256,attest:true},biller.cookie)
  for(const path of ['/api/balm/invoices/'+invoice.id+'.html','/api/balm/statements/'+client.id+'.pdf','/api/balm/superbills/'+invoice.id+'.pdf','/api/balm/receipts/'+credit.id+'.pdf','/api/balm/receipts/'+refund.id+'.pdf','/api/balm/reports/financial','/app/reports'])assert.equal((await h.send(path,undefined,biller.cookie)).status,200,path)
  await h.cmd('pay.card.remove',{clientId:client.id},biller.cookie)
  const file=(await h.send('/api/balm/clients/'+client.id,undefined,biller.cookie)).value
  assert.equal(file.notes,null);assert.equal(file.intake,null);assert.equal(file.billing.card,null)
 }finally{await h.close()}
})

test('PAY-010: contributing provider quotes stay in the aggregate original without diluting the practice dispute flag', {timeout:120000}, async()=>{const {coProviderEstimateJourney}=await import('./estimate-contributors-journey.mjs');await run(coProviderEstimateJourney)})

test('PAY-010: an owner matches, reviews and publishes the payer original with consent and patient isolation', {timeout:120000}, async()=>{const {payerEstimateJourney}=await import('./payer-estimate-journey.mjs');await run(payerEstimateJourney)})

test('statement cycles preserve mail batches, actual delivery outcomes and every portal original without changing the ledger', {timeout:120000}, async()=>{
  const {statementCyclesJourney,statementCycleHarnessOptions}=await import('./statement-cycles-journey.mjs')
  await run(statementCyclesJourney,statementCycleHarnessOptions)
})

test('cash packages draw down at attendance and taxed gift sales reconcile with patient originals and deposits', {timeout:120000}, async()=>{const {retailJourney}=await import('./retail-journey.mjs');await run(retailJourney)})

test('PAY-002: intake and portal authorize hosted card setup, approved original refunds reconcile once, and Terminal posts a copay once', {timeout:120_000}, async()=>{
 const fixture=await connected()
 try { await cardPaymentsJourney(fixture) } finally { await fixture.h.close() }
})

test('PAY-002: a lost refund response stays reserved until the original Stripe refund is reconciled without another send', {timeout:120_000}, async()=>{
 const stripe=fakeProviders();let lose=true
 const fixture=await connected({stripe,outbound:async request=>{
  const refund=request.method==='POST'&&new URL(request.url).pathname==='/v1/refunds'
  const response=await stripe.handler(request)
  if(refund&&lose){lose=false;return Response.json({error:{message:'Response lost after acceptance'}},{status:503})}
  return response
 }})
 const {h,reception,client,service,priya}=fixture
 try{
  const saved=await saveCard(h,stripe,reception,client.id);await h.send('/pay/'+saved.token+'?setup='+saved.session)
  await h.cmd('pay.copay.save',{clientId:client.id,copay:'30.00'},reception.cookie)
  const visit=await pastVisit(h,client.id,priya,service.id,reception.cookie,0)
  await h.cmd('pay.checkin',{appointmentId:visit,charge:true},reception.cookie)
  const payment=await h.db.prepare("SELECT * FROM bm_card_payments WHERE appointment_id=? AND status='succeeded'").bind(visit).first()
  // A historical payment predates retained original account and customer bindings.
  await h.db.prepare('UPDATE bm_card_payments SET stripe_account_id=NULL,stripe_customer_id=NULL WHERE id=?').bind(payment.id).run()
  const providerOriginal=stripe.intents.get(payment.payment_intent)
  providerOriginal.metadata.balm_client='synthetic-balm-unrelated'
  await h.cmd('pay.refund.prepare',{paymentId:payment.id,amount:'10.00',reason:'Synthetic overcollection'},reception.cookie,409)
  providerOriginal.metadata.balm_client=client.id
  let prepared=await h.cmd('pay.refund.prepare',{paymentId:payment.id,amount:'10.00',reason:'Synthetic overcollection'},reception.cookie)
  assert.equal((await h.db.prepare('SELECT stripe_account_id FROM bm_card_payments WHERE id=?').bind(payment.id).first()).stripe_account_id,null)
  await h.cmd('pay.copay.save',{clientId:client.id,copay:'30.00'},reception.cookie)
  await h.cmd('pay.refund.approve',{id:prepared.id,sha256:prepared.sha256,attest:true},h.owner,409)
  prepared=await h.cmd('pay.refund.prepare',{paymentId:payment.id,amount:'10.00',reason:'Synthetic overcollection'},reception.cookie)
  const biller=await h.staff('Morgan','biller')
  const action={id:prepared.id,sha256:prepared.sha256,attest:true}
  await h.cmd('pay.refund.approve',action,biller.cookie)
  const held=await h.db.prepare('SELECT * FROM bm_card_refunds WHERE id=?').bind(prepared.id).first()
  assert.equal(held.status,'uncertain');assert.equal(held.approved_by,'morgan@clinic.example')
  assert.equal(stripe.calls.findLast(c=>c.method==='POST'&&c.path==='/refunds').body.charge,prepared.charge_id)
  const original=await h.db.prepare('SELECT stripe_account_id,stripe_customer_id FROM bm_card_payments WHERE id=?').bind(payment.id).first()
  assert.equal(original.stripe_account_id,'acct_test_clinic');assert.ok(original.stripe_customer_id)
  await Promise.all([h.cmd('pay.refund.approve',action,biller.cookie),h.cmd('pay.refund.approve',action,h.owner)])
  assert.equal(stripe.calls.filter(c=>c.method==='POST'&&c.path==='/refunds').length,1)
  const reconciled=await h.cmd('pay.refund.reconcile',{id:prepared.id},biller.cookie)
  assert.equal(reconciled.status,'confirmed');assert.ok(reconciled.provider_refund_id)
  await h.cmd('pay.refund.reconcile',{id:prepared.id},biller.cookie)
  const f=(await h.send('/api/balm/clients/'+client.id,undefined,biller.cookie)).value
  assert.equal(f.billing.ledger.creditCents,2000);assert.equal(f.billing.ledger.patientBalanceCents,-2000)
  assert.equal(f.billing.ledger.lines.filter(x=>x.kind==='refund').length,1)
  assert.equal(stripe.calls.filter(c=>c.method==='POST'&&c.path==='/refunds').length,1)
 }finally{await h.close()}
})

test('PAY-002: an uncertain Terminal send is reconciled on its original intent without another collection', {timeout:120_000}, async()=>{
 const stripe=fakeProviders();let lose=true,loseCard=true,revokeDuringRead=false
 const fixture=await connected({stripe,outbound:async request=>{
  const body=request.method==='POST'?await request.clone().text():''
  const saved=request.method==='POST'&&new URL(request.url).pathname==='/v1/payment_intents'&&body.includes('off_session=true')
  const processing=request.method==='POST'&&new URL(request.url).pathname.endsWith('/process_payment_intent')
  const response=await stripe.handler(request)
  if(revokeDuringRead&&request.method==='GET'&&new URL(request.url).pathname.startsWith('/v1/terminal/readers/')){revokeDuringRead=false;await fixture.h.cmd('staff.save',{id:fixture.reception.id,name:'Rosa',email:'rosa@clinic.example',role:'reception',active:false})}
  if(processing&&lose){lose=false;return Response.json({error:{message:'Reader response lost after accepting action'}},{status:503})}
  if(saved&&loseCard){loseCard=false;return Response.json({error:{message:'Card response lost after acceptance'}},{status:503})}
  return response
 }})
 const {h,reception,client,service,priya}=fixture
 try{
  await h.cmd('pay.copay.save',{clientId:client.id,copay:'30.00'},reception.cookie)
  const visit=await pastVisit(h,client.id,priya,service.id,reception.cookie,0)
  await h.cmd('pay.terminal.configure',{locationId:'tml_syntheticbalm1',simulated:true})
  const oldVisit=await pastVisit(h,client.id,priya,service.id,h.owner,4)
  await h.cmd('appointment.attend',{id:oldVisit})
  const invoice=await h.cmd('invoice.prepare',{appointmentId:oldVisit});await h.cmd('invoice.approve',{id:invoice.id})
  const paymentId=crypto.randomUUID(),input={appointmentId:visit,paymentId,amount:'30.00',invoiceId:invoice.id,purpose:'balance',confirm:true}
  const uncertain=await h.cmd('pay.terminal.collect',input,reception.cookie)
  assert.equal(uncertain.state,'unknown');assert.equal(uncertain.status,'processing')
  const repeated=await h.cmd('pay.terminal.collect',input,reception.cookie)
  assert.equal(repeated.payment_intent,uncertain.payment_intent)
  assert.equal(stripe.calls.filter(c=>c.method==='POST'&&c.path==='/payment_intents').length,1)
  assert.equal(stripe.calls.filter(c=>c.path.endsWith('/process_payment_intent')).length,1)
  const paid=await h.cmd('pay.terminal.simulate',{paymentId},reception.cookie)
  assert.equal(paid.status,'succeeded');assert.equal(paid.state,'succeeded')
  await h.cmd('pay.terminal.simulate',{paymentId},reception.cookie)
  const f=(await h.send('/api/balm/clients/'+client.id,undefined,h.owner)).value
  assert.equal(f.billing.ledger.creditCents,0);assert.equal(f.billing.ledger.patientBalanceCents,6500);assert.equal(f.billing.ledger.lines.filter(x=>x.kind==='card').length,1)
  assert.equal(stripe.calls.filter(c=>c.path.endsWith('/present_payment_method')).length,1)
  const saved=await saveCard(h,stripe,reception,client.id);await h.send('/pay/'+saved.token+'?setup='+saved.session)
  const cardInput={...input,paymentId:crypto.randomUUID(),amount:'65.00'}
  await h.cmd('pay.checkin.collect',cardInput,reception.cookie,409)
  const reserved=await h.db.prepare('SELECT * FROM bm_card_payments WHERE id=?').bind(cardInput.paymentId).first()
  assert.equal(reserved.status,'processing');assert.equal(reserved.payment_intent,null)
  await h.cmd('pay.terminal.collect',{...cardInput,paymentId:crypto.randomUUID()},reception.cookie,409)
  const postCount=stripe.calls.filter(c=>c.method==='POST'&&c.path==='/payment_intents').length
  const recovered=await h.cmd('pay.checkin.collect',cardInput,reception.cookie)
  assert.equal(recovered.status,'succeeded');assert.equal(recovered.id,cardInput.paymentId);assert.equal(recovered.amount_cents,6500)
  await h.cmd('pay.checkin.collect',cardInput,reception.cookie)
  assert.equal(stripe.calls.filter(c=>c.method==='POST'&&c.path==='/payment_intents').length,postCount)
  assert.equal((await h.send('/api/balm/clients/'+client.id,undefined,h.owner)).value.billing.ledger.patientBalanceCents,0)
  const nextVisit=await pastVisit(h,client.id,priya,service.id,h.owner,6)
  await h.cmd('appointment.attend',{id:nextVisit})
  const nextInvoice=await h.cmd('invoice.prepare',{appointmentId:nextVisit});await h.cmd('invoice.approve',{id:nextInvoice.id})
  const revokedInput={...input,paymentId:crypto.randomUUID(),invoiceId:nextInvoice.id,amount:'10.00'}
  revokeDuringRead=true
  await h.cmd('pay.terminal.collect',revokedInput,reception.cookie,409)
  assert.equal(await h.db.prepare('SELECT id FROM bm_card_payments WHERE id=?').bind(revokedInput.paymentId).first(),null)
  assert.equal(stripe.calls.filter(c=>c.method==='POST'&&c.path==='/payment_intents').length,postCount)
 }finally{await h.close()}
})


test('reviewed QuickBooks journals reconcile a mixed payment day and resume lost responses without duplicates', { timeout: 120_000 }, async () => {
  const { accountingDayFixture, accountingDay, accountingNow } = await import('./accounting-day.mjs')
  const { quickbooksEdge, accountingMappings } = await import('./fakes/quickbooks.mjs')
  mock.timers.enable({ apis: ['Date'], now: accountingNow })
  const stripe = fakeProviders(), qbo = quickbooksEdge()
  let h
  try {
    h = await harness({ entry: 'tests/accounting-worker.ts', outbound: r => new URL(r.url).hostname === 'api.stripe.com' ? stripe.handler(r) : qbo.outbound(r) })
    const day = await accountingDayFixture(h, stripe)
    const connect = { realmId: '123', clientId: 'synthetic-balm-8', clientSecret: 'synthetic-balm-9', refreshToken: 'synthetic-balm-10', environment: 'sandbox', confirm: true }
    await h.cmd('accounting.connect', connect, day.priya.cookie, 403)
    await h.cmd('accounting.connect', { ...connect, confirm: false }, h.owner, 400)
    await h.cmd('accounting.connect', connect)
    assert.equal(qbo.writes.length, 0, 'connecting never posts money')
    await h.cmd('accounting.prepare', { day: accountingDay }, h.owner, 409)
    await h.cmd('accounting.mapping', { mappings: accountingMappings, confirm: true })
    const before = await h.cmd('accounting.prepare', { day: accountingDay })
    const input = { id: before.id, sha256: before.sha256, confirm: true }
    assert.equal(qbo.writes.length, 0, 'review leaves the books unchanged')
    await h.cmd('accounting.sync', { ...input, sha256: 'synthetic-balm-13' }, h.owner, 409)
    await h.cmd('accounting.sync', { ...input, confirm: false }, h.owner, 400)
    qbo.loseNextResponse()
    await h.cmd('accounting.sync', input, h.owner, 409)
    assert.equal(qbo.journals.size, 1, 'the provider committed before the response was lost')
    const confirmed = await h.cmd('accounting.sync', input)
    assert.equal(confirmed.status, 'confirmed')
    await h.cmd('accounting.sync', input)
    const again = await h.cmd('accounting.prepare', { day: accountingDay })
    assert.equal(again.status, 'up_to_date')
    assert.equal(qbo.journals.size, 1)
    const lines = qbo.writes[0].Line, debits = Object.fromEntries(lines.filter(l => l.JournalEntryLineDetail.PostingType === 'Debit').map(l => [l.Description, Math.round(l.Amount * 100)]))
    assert.deepEqual(debits, { 'payment · card': 1500, 'fee · card': 30, 'charge · invoice': 19000, 'payout · card': 970, 'payment · cash': 2000, 'payment · era': 6000, 'adjustment · adjustment': 2000, 'refund · card': 500 })
    assert.equal(lines.filter(l => l.JournalEntryLineDetail.PostingType === 'Debit').reduce((n,l) => n + Math.round(l.Amount * 100), 0), lines.filter(l => l.JournalEntryLineDetail.PostingType === 'Credit').reduce((n,l) => n + Math.round(l.Amount * 100), 0))
    assert.ok(!/Maya|Noah|97110|M25|synthetic-balm/.test(JSON.stringify(qbo.writes)), 'financial handoff has no patient identity, clinical content or original references')
    const view = (await h.state()).accounting
    assert.ok(!JSON.stringify(view).includes('synthetic-balm-10'))
    assert.equal((await h.state(day.priya.cookie)).accounting, null)
    const original = qbo.journals.get(confirmed.providerId), saved = structuredClone(original)
    original.Line[0].Amount += 1
    await h.cmd('accounting.sync', input, h.owner, 409)
    assert.equal((await h.state()).accounting.batches[0].status, 'conflict')
    assert.equal(qbo.journals.size, 1)
    qbo.journals.set(confirmed.providerId, saved)
    assert.equal((await h.cmd('accounting.sync', input)).status, 'confirmed')
    await h.cmd('payment.record', { invoiceId: day.cashInvoice.id, amountCents: 1000, reference: 'synthetic-balm-14', paymentMethod: 'cash' })
    const later = await h.cmd('accounting.prepare', { day: accountingDay })
    assert.equal(later.sources, 1, 'late money becomes a separate journal with only its new source')
    await h.cmd('accounting.sync', { id: later.id, sha256: later.sha256, confirm: true })
    assert.equal(qbo.journals.size, 2)
    const final = await h.cmd('accounting.prepare', { day: accountingDay })
    assert.equal(final.status, 'up_to_date')
    await h.cmd('accounting.disconnect', {})
    await h.cmd('accounting.sync', input, h.owner, 409)
  } finally { if (h) await h.close(); mock.timers.reset() }
})

test('PAY-003: deposit and full booking payments reserve slots, confirm exact cents once and expose isolated fixed portal receipts', {timeout:120000},async()=>{
 const stripe=fakeProviders(),h=await harness({outbound:stripe.handler,browserHttps:!!process.env.BALM_UI_SCREENSHOTS})
 try{const {bookingPrepaymentJourney}=await import('./booking-prepayment-journey.mjs');const {viewportProof}=await import('./viewport-proof.mjs');await bookingPrepaymentJourney(h,stripe,{screen:async(name,path,selector,cookie)=>viewportProof(h,[{name,path,selector,cookie,openSelector:name==='booking-settings'?'details:has([name=prepayMode]) > summary:text-is("Edit service")':undefined,interact:async({page,width})=>{if(width===1440&&name==='booking-amount')assert.equal(await page.locator('[name=confirmedAmountCents]').inputValue(),'3000')}}])})}finally{await h.close()}
})
