import { chartFixture } from './chart-template-journey.mjs'
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createHmac, generateKeyPairSync, randomBytes, sign } from 'node:crypto'
import { harness } from './harness.mjs'
import { clinic, pastVisit } from './clinic.mjs'
import { fakeProviders } from './fakes/stripe.mjs'

const resendKey = 'whsec_' + randomBytes(32).toString('base64')
async function resendEvent(h, eventId, event, extra = {}) {
  const raw = typeof event === 'string' ? event : JSON.stringify(event), timestamp = String(Math.floor(Date.now() / 1000))
  const signature = createHmac('sha256', Buffer.from(resendKey.slice(6), 'base64')).update(`${eventId}.${timestamp}.${raw}`).digest('base64')
  return h.mf.dispatchFetch(h.origin + '/api/balm/mail/events/resend', { method: 'POST', body: raw, headers: { 'content-type': 'application/json', 'svix-id': eventId, 'svix-timestamp': timestamp, 'svix-signature': `v1,${signature}`, ...extra } })
}
const resendBody = (messageId, type = 'email.delivered', to = ['ava@client.example'], occurredAt = Date.now() - 10_000) => ({ type, created_at: new Date(occurredAt).toISOString(), data: { email_id: messageId, to } })
const privateVisit = message => new URL(message.text.match(/https?:\/\/[^\s]+\/visit\/[\w-]+/)[0]).pathname

test('COMM-001: booked visit is reminded on schedule, confirmed in one reply, moved and canceled safely; private messages stay in Balm', { timeout: 120_000 }, async () => {
  const providers = fakeProviders(), h = await harness({ outbound: providers.handler, auth: {
    BALM_RESEND_WEBHOOK_KEY: resendKey, BALM_RESEND_EVENT_NAMESPACE: 'clinic-account',
    SMS_PROVIDER: 'twilio', TWILIO_ACCOUNT_SID: 'ACXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX', TWILIO_AUTH_TOKEN: 'test-token', TWILIO_FROM: '+15005550006',
  } })
  try {
    await h.finishSetup()
    const { service, practitioners: [priya, sam] } = await clinic(h, ['Priya', 'Sam'])
    const reception = await h.staff('Rosa', 'reception')
    const client = await h.cmd('client.save', { firstName: 'Ava', lastName: 'Ng', email: 'ava@client.example', phone: '(555) 010-0199' })
    await h.cmd('reminders.settings', { leadMinutes: '1440', sms: true })
    await h.cmd('reminders.consent', { clientId: client.id, consent: true })
    const booked = await h.cmd('appointment.book', { clientId: client.id, practitionerId: priya.id, serviceId: service.id, date: '2099-03-02', time: '10:00' })
    const bookingMail = h.mail.at(-1), bookingMessageId = `mail_test_${h.mail.length}`
    assert.match(bookingMail.text, /appointment is booked/, 'COMM-001 booking confirmation is in the intake email')
    assert.match(bookingMail.text, /\/intake\//, 'COMM-001 the booking includes its private intake link')
    const readFile = async () => (await h.send('/api/balm/clients/' + client.id, undefined, h.owner)).value
    assert.equal((await readFile()).mailHistory[0].state, 'accepted', 'COMM-001 provider acceptance does not assert delivery')
    const delivered = resendBody(bookingMessageId)
    assert.equal((await resendEvent(h, 'booking-delivered', delivered)).status, 200, 'COMM-001 signed callback needs no native session or browser Origin')
    assert.equal((await resendEvent(h, 'booking-delivered', delivered)).status, 200, 'COMM-001 exact duplicate is harmless')
    assert.equal((await readFile()).mailHistory[0].state, 'delivered')
    assert.equal((await resendEvent(h, 'booking-late-accepted', resendBody(bookingMessageId, 'email.sent', undefined, Date.now() - 1000))).status, 200)
    assert.equal((await readFile()).mailHistory[0].state, 'delivered', 'COMM-001 later acceptance cannot regress terminal delivery')
    assert.equal((await resendEvent(h, 'booking-delivered', { ...delivered, type: 'email.bounced' })).status, 409, 'COMM-001 event identity conflict is refused')
    assert.equal((await readFile()).mailHistory[0].state, 'delivered')
    assert.equal((await resendEvent(h, 'wrong-signature', delivered, { 'svix-signature': 'v1,' + randomBytes(32).toString('base64') })).status, 401)
    assert.equal((await resendEvent(h, 'unrelated-id', resendBody('unrelated-message'))).status, 503, 'COMM-001 unknown/racing message refuses retryably')
    const unrelated = await resendEvent(h, 'unrelated-recipient', resendBody(bookingMessageId, 'email.delivered', ['ava@client.example', 'other@example.com']))
    assert.equal(unrelated.status, 503, 'COMM-001 every recipient must belong to the exact attempt')
    assert.deepEqual(await unrelated.json(), { error: 'Delivery event was not accepted' }, 'COMM-001 callbacks reveal no patient details')
    assert.equal((await readFile()).mailHistory[0].state, 'delivered')
    assert.equal((await resendEvent(h, 'booking-older-failure', resendBody(bookingMessageId, 'email.bounced', undefined, Date.now() - 20_000))).status, 200)
    assert.equal((await readFile()).mailHistory[0].state, 'delivered', 'COMM-001 older terminal events cannot replace newer terminal facts')
    assert.equal((await resendEvent(h, 'booking-failed', resendBody(bookingMessageId, 'email.failed', undefined, Date.now() - 500))).status, 200)
    assert.equal((await readFile()).mailHistory[0].state, 'failed', 'COMM-001 provider-reported failure is visible on the patient file')
    assert.match((await h.send('/app/clients/' + client.id, undefined, h.owner)).text, /Delivery failed/)
    const beforeOversize = (await readFile()).mailHistory[0].state
    assert.equal((await h.mf.dispatchFetch(h.origin + '/api/balm/mail/events/resend', { method: 'POST', body: ' '.repeat(1024 * 1024 + 1) })).status, 413, 'COMM-001 raw body is bounded at one MiB')
    assert.equal((await readFile()).mailHistory[0].state, beforeOversize)
    const due = Date.parse(booked.startAt) - 1440 * 60_000
    const tick = async time => (await h.mf.getWorker()).scheduled({ scheduledTime: time, cron: '* * * * *' })
    const reminders = () => h.mail.filter(m => m.subject.startsWith('Appointment reminder'))
    await tick(due - 60_000)
    assert.equal(reminders().length, 0, 'the reminder is not sent early')
    await tick(due)
    assert.equal(reminders().length, 1, 'Balm sends without a person approving')
    const reminderMessageId = `mail_test_${h.mail.indexOf(reminders()[0]) + 1}`
    const reminderDelivered = JSON.stringify(resendBody(reminderMessageId)).padEnd(1024 * 1024, ' ')
    assert.equal((await resendEvent(h, 'reminder-delivered', reminderDelivered)).status, 200, 'COMM-001 an exact one-MiB signed body succeeds')
    assert.ok((await readFile()).mailHistory.some(m => m.kind === 'reminder' && m.state === 'delivered'), 'COMM-001 reminder delivery is recorded')
    assert.equal(providers.texts.length, 1, 'the registered SMS adapter sends the consented reminder')
    await tick(due + 60_000)
    assert.equal(reminders().length, 1, 'another scheduler tick does not duplicate delivery')
    const visit = new URL(reminders()[0].text.match(/https?:\/\/[^\s]+\/visit\/[\w-]+/)[0]).pathname
    assert.equal((await h.send(visit)).status, 200)
    assert.equal((await h.form(visit, { reply: 'confirmed' })).status, 303)
    assert.equal((await h.state()).appointments.find(a => a.id === booked.appointmentId).patient_response, 'confirmed')
    assert.match((await h.send(visit)).text, /visit is confirmed/)
    let file = (await h.send('/api/balm/clients/' + client.id, undefined, h.owner)).value
    assert.equal(file.reminderHistory.filter(r => r.state === 'sent').length, 2)
    assert.ok(file.audit.some(a => a.action === 'appointment.confirmed'))

    // Requesting a new time takes one reply and reaches the clinic without exposing patient details in mail.
    await h.form(visit, { reply: 'change_requested' })
    assert.equal((await h.state()).appointments.find(a => a.id === booked.appointmentId).patient_response, 'change_requested')
    assert.ok(h.mail.some(m => m.subject.includes('requested a new appointment time') && !m.text.includes('Ava')))
    const beforeMove = h.mail.length
    await h.cmd('appointment.move', { id: booked.appointmentId, date: '2099-03-03', time: '11:00' })
    assert.equal(h.mail.length, beforeMove + 1, 'COMM-001 a single move emails immediately')
    const changedLink = privateVisit(h.mail.at(-1))
    assert.match(h.mail.at(-1).subject, /is changed/)
    assert.match(h.mail.at(-1).text, /11:00/)
    assert.equal((await h.state()).appointments.find(a => a.id === booked.appointmentId).patient_response, 'awaiting', 'COMM-001 move resets the previous confirmation')
    assert.equal((await h.form(changedLink, { reply: 'confirmed' })).status, 303, 'COMM-001 moved-visit private link works')
    assert.equal((await h.state()).appointments.find(a => a.id === booked.appointmentId).patient_response, 'confirmed')
    assert.equal((await h.send(visit)).status, 404, 'old reply link cannot confirm a moved visit')
    assert.equal((await h.state()).appointments.find(a => a.id === booked.appointmentId).patient_response, 'confirmed')
    await tick(due + 86400_000 + 3600_000)
    assert.equal(reminders().length, 2, 'the moved visit has its own reminder')
    const movedLink = new URL(reminders()[1].text.match(/https?:\/\/[^\s]+\/visit\/[\w-]+/)[0]).pathname
    const beforeCancel = h.mail.length
    await h.cmd('appointment.cancel', { id: booked.appointmentId, reason: 'Patient requested cancellation' })
    assert.equal(h.mail.length, beforeCancel + 1, 'COMM-001 cancellation emails immediately')
    assert.match(h.mail.at(-1).subject, /is canceled/)
    assert.equal((await h.send(changedLink)).status, 404, 'COMM-001 cancellation invalidates the immediate move link')
    assert.equal((await h.send(movedLink)).status, 404)
    await tick(due + 86400_000 + 3660_000)
    assert.equal(reminders().length, 2, 'canceled visit gets no more reminders')

    // One reminder per lead time, never two at once: a visit booked inside both windows gets one now.
    await h.cmd('reminders.settings', { leadMinutes: '1440, 60', sms: false })
    const soon = await h.cmd('appointment.book', { clientId: client.id, practitionerId: priya.id, serviceId: service.id, date: '2099-03-10', time: '10:00' })
    const later = await h.cmd('appointment.book', { clientId: client.id, practitionerId: priya.id, serviceId: service.id, date: '2099-03-12', time: '10:00' })
    const sentFor = async id => (await h.send('/api/balm/clients/' + client.id, undefined, h.owner)).value.reminderHistory.filter(r => r.appointment_id === id && r.state === 'sent').map(r => r.lead_minutes)
    await tick(Date.parse(soon.startAt) - 55 * 60_000)
    await tick(Date.parse(soon.startAt) - 54 * 60_000)
    assert.deepEqual(await sentFor(soon.appointmentId), [60], 'booked 55 minutes ahead: one reminder, not one per passed lead time')
    assert.equal(reminders().length, 3)
    // Booked three hours ahead: the day-before reminder goes now, and the hour-before one still goes on time.
    await tick(Date.parse(later.startAt) - 180 * 60_000)
    assert.deepEqual(await sentFor(later.appointmentId), [1440])
    await tick(Date.parse(later.startAt) - 60 * 60_000)
    assert.deepEqual((await sentFor(later.appointmentId)).sort((a, b) => a - b), [60, 1440])
    assert.equal(reminders().length, 5)

    // A rest/all-series change sends a single message listing every changed date immediately.
    const series = await h.cmd('series.book', { clientId: client.id, practitionerId: priya.id, serviceId: service.id, firstDate: '2099-04-06', weeks: 2, weekdays: [1], time: '10:00',
      occurrences: [{ date: '2099-04-06', time: '10:00' }, { date: '2099-04-13', time: '10:00' }] })
    let beforeSeriesChange = h.mail.length
    await h.cmd('series.move_rest', { appointmentId: series.appointmentIds[1], time: '11:00', scope: 'all' })
    assert.equal(h.mail.length, beforeSeriesChange + 1, 'COMM-001 moving all series emails once immediately')
    const allLinks = [...h.mail.at(-1).text.matchAll(/https?:\/\/[^\s]+\/visit\/[\w-]+/g)].map(m => new URL(m[0]).pathname)
    assert.equal(allLinks.length, 2, 'COMM-001 changed-series email contains both new times and private links')
    for (const link of allLinks) assert.equal((await h.send(link)).status, 200)
    beforeSeriesChange = h.mail.length
    await h.cmd('series.move_rest', { appointmentId: series.appointmentIds[1], time: '12:00' })
    assert.equal(h.mail.length, beforeSeriesChange + 1, 'COMM-001 moving rest of series emails immediately')
    assert.equal([...h.mail.at(-1).text.matchAll(/\/visit\//g)].length, 1)
    assert.equal((await h.send(allLinks[1])).status, 404, 'COMM-001 moving again invalidates prior private link')
    beforeSeriesChange = h.mail.length
    await h.cmd('series.cancel_rest', { appointmentId: series.appointmentIds[1], scope: 'all', reason: 'Patient requested cancellation' })
    assert.equal(h.mail.length, beforeSeriesChange + 1, 'COMM-001 all-series cancellation emails once immediately')
    assert.match(h.mail.at(-1).subject, /is canceled/)
    assert.ok((await readFile()).mailHistory.some(m => m.kind === 'booking'), 'COMM-001 existing intake request produces a tracked confirmation')

    const clinical = 'Please continue the prescribed shoulder exercises, stopping if pain increases.'
    await h.cmd('message.send', { clientId: client.id, body: clinical }, reception.cookie, 403)
    await h.cmd('message.send', { clientId: client.id, body: clinical }, sam.cookie, 404)
    await h.cmd('message.send', { clientId: client.id, body: clinical }, priya.cookie)
    const notice = h.mail.findLast(m => m.subject === 'You have a secure message')
    assert.ok(notice)
    assert.ok(!notice.text.includes(clinical) && !notice.html.includes(clinical), 'email contains no clinical content')
    const thread = new URL(notice.text.match(/https?:\/\/[^\s]+\/messages\/[\w-]+/)[0]).pathname
    assert.match((await h.send(thread)).text, /prescribed shoulder exercises/)
    const reply = 'The exercises are comfortable. Can I keep the same plan this week?'
    assert.equal((await h.form(thread, { body: reply })).status, 303)
    assert.ok(h.mail.some(m => m.subject === 'A secure message needs your attention' && !m.text.includes(reply)))
    file = (await h.send('/api/balm/clients/' + client.id, undefined, priya.cookie)).value
    assert.deepEqual(file.messages.messages.filter(m => !m.automated).map(m => m.body), [clinical, reply])
    assert.deepEqual((await h.send('/api/balm/clients/' + client.id, undefined, reception.cookie)).value.messages.messages, [])
    const autoReply = file.messages.messages.find(m => m.automated)
    assert.ok(autoReply && autoReply.replyTo === file.messages.messages.find(m => m.body === reply).id)
    assert.match(autoReply.body, /911/)
    const other = await h.cmd('client.save', { firstName: 'Noah', lastName: 'Kim', email: 'noah@client.example' })
    await h.cmd('message.send', { clientId: other.id, body: 'A different private conversation', delivery: 'shown' })
    assert.ok(!(await h.send(thread)).text.includes('different private conversation'))
    await h.cmd('message.revoke', { clientId: client.id })
    assert.equal((await h.send(thread)).status, 404)
    assert.equal((await h.form(thread, { body: 'This should not be saved' })).status, 404)
    await h.cmd('client.erase', { id: other.id }, h.owner, 409, {})
    file = (await h.send('/api/balm/clients/' + client.id, undefined, h.owner)).value
    assert.ok(file.audit.some(a => a.action === 'message.sent'))
    assert.ok(file.audit.some(a => a.action === 'message.read'))
    assert.ok(file.audit.every(a => !a.detail.includes(clinical) && !a.detail.includes(reply)))
    assert.ok(h.mail.every(m => !JSON.stringify(m).includes(clinical) && !JSON.stringify(m).includes(reply)), 'COMM-001 no clinical detail appears in any appointment email')
    const ownHistoryIds = new Set((await readFile()).mailHistory.map(m => m.id))
    await h.cmd('appointment.book', { clientId: client.id, practitionerId: sam.id, serviceId: service.id, date: '2099-06-01', time: '10:00' }, sam.cookie)
    const samFile = (await h.send('/api/balm/clients/' + client.id, undefined, sam.cookie)).value
    assert.equal(samFile.mailHistory.length, 1, 'COMM-001 practitioner sees deliveries only for their own visible visits')
    assert.ok(!ownHistoryIds.has(samFile.mailHistory[0].id))
    assert.ok(!(await h.send('/api/balm/clients/' + client.id, undefined, priya.cookie)).value.mailHistory.some(m => m.id === samFile.mailHistory[0].id))
    assert.ok((await h.send('/api/balm/clients/' + client.id, undefined, reception.cookie)).value.mailHistory.length > 1, 'COMM-001 reception can read delivery states without clinical message content')
  } finally { await h.close() }

  // Local mail suppression must remain visible through the same scheduling and approval doors.
  const local = await harness({ auth: { AUTH_LOCAL: 'true' } })
  try {
    await local.finishSetup()
    await local.cmd('settings.save', { clinicName: 'Riverside Physio', timeZone: 'Australia/Brisbane' })
    const service = await local.cmd('service.save', { name: 'Therapy visit', durationMinutes: 45, priceCents: 9500 })
    const practitioner = await local.cmd('staff.save', { name: 'Priya', email: 'priya@clinic.example', role: 'practitioner', active: true, profession: 'Physiotherapist' })
    await local.cmd('hours.save', { practitionerId: practitioner.id, hours: [0, 1, 2, 3, 4, 5, 6].map(weekday => ({ weekday, start: '00:00', end: '24:00' })) })
    const client = await local.cmd('client.save', { firstName: 'Ava', lastName: 'Ng', email: 'ava@client.example' })
    await local.cmd('reminders.settings', { leadMinutes: '1440', sms: false })
    const booked = await local.cmd('appointment.book', { clientId: client.id, practitionerId: practitioner.id, serviceId: service.id, date: '2099-03-02', time: '10:00' })
    assert.equal(booked.mail, 'suppressed')
    assert.equal((await local.send('/api/balm/mail/events/resend', {})).status, 404, 'COMM-001 callback disabled without its signing configuration')
    const due = Date.parse(booked.startAt) - 1440 * 60_000
    const worker = await local.mf.getWorker()
    await worker.scheduled({ scheduledTime: due, cron: '* * * * *' })
    await worker.scheduled({ scheduledTime: due + 60_000, cron: '* * * * *' })
    let file = (await local.send('/api/balm/clients/' + client.id, undefined, local.owner)).value
    assert.equal(file.reminderHistory.length, 1)
    assert.ok(file.mailHistory.every(m => m.state === 'suppressed'), 'COMM-001 local booking and reminder attempts are suppressed, never delivered')
    assert.equal(file.reminderHistory[0].state, 'failed')
    assert.equal(file.reminderHistory[0].sent_at, null)
    assert.match(file.reminderHistory[0].outcome, /no email/)
    const page = await local.send('/app/clients/' + client.id, undefined, local.owner)
    assert.match(page.text, /Not sent/)
    assert.doesNotMatch(page.text, /Accepted by mail provider/)

    const visit = await pastVisit(local, client.id, practitioner, service.id)
    await local.cmd('appointment.attend', { id: visit })
    const invoice = await local.cmd('invoice.prepare', { appointmentId: visit })
    await local.cmd('invoice.approve', { id: invoice.id })
    const referral = await local.cmd('case.open', { clientId: client.id, receivedOn: '2020-01-01', referringFirst: 'Anil', referringLast: 'Patel' })
    const readCase = async () => (await local.send('/api/balm/cases', undefined, local.owner)).value.cases.find(c => c.referral.id === referral.id)
    const step = (await readCase()).steps.find(s => s.kind === 'statement.send')
    assert.ok(step)
    await local.cmd('case.approve', { caseId: referral.id, key: step.key, digest: step.digest }, local.owner, 409)
    const after = await readCase()
    assert.equal(after.history[0].status, 'failed')
    assert.equal(after.history[0].result.delivery, 'suppressed')
    assert.ok(after.steps.some(s => s.kind === 'statement.send'), 'suppressed mail leaves the statement proposed')
    const casesPage = await local.send('/app/cases', undefined, local.owner)
    assert.match(casesPage.text, /Not sent: email is suppressed/)
    assert.doesNotMatch(casesPage.text, /Statement link emailed/)
    file = (await local.send('/api/balm/clients/' + client.id, undefined, local.owner)).value
    assert.equal(file.billing.links[0].delivery_result, 'suppressed')
    assert.ok(file.audit.some(a => a.action === 'paylink.not_sent'))
    assert.equal(local.mail.length, 0, 'local work never reaches the mail provider')
  } finally { await local.close() }

  // A second real Worker exercises SendGrid's signed delivery-id correlation.
  const signing = generateKeyPairSync('ec', { namedCurve: 'prime256v1' }), sgMessages = []
  let submission = 'accepted', sg
  const postSendgrid = async events => {
    const body = JSON.stringify(events), timestamp = String(Math.floor(Date.now() / 1000))
    const signature = sign('sha256', Buffer.from(timestamp + body), signing.privateKey).toString('base64')
    return sg.mf.dispatchFetch(sg.origin + '/api/balm/mail/events/sendgrid', { method: 'POST', body, headers: { 'x-twilio-email-event-webhook-timestamp': timestamp, 'x-twilio-email-event-webhook-signature': signature } })
  }
  sg = await harness({ auth: { MAIL_PROVIDER: 'sendgrid', MAIL_API_KEY: 'test-sendgrid-key', BALM_SENDGRID_WEBHOOK_KEY: signing.publicKey.export({ type: 'spki', format: 'der' }).toString('base64'), BALM_SENDGRID_EVENT_NAMESPACE: 'clinic-sendgrid' }, outbound: async request => {
    assert.equal(request.url, 'https://api.sendgrid.com/v3/mail/send')
    assert.equal(request.method, 'POST')
    const message = await request.json()
    sgMessages.push(message)
    const file = (await sg.send('/api/balm/clients/' + sgClient.id, undefined, sg.owner)).value
    assert.ok(file.mailHistory.some(m => m.id === message.custom_args.rer_delivery_id && m.state === 'uncertain'), 'COMM-001 stable attempt association is persisted before provider submission')
    return submission === 'accepted' ? new Response(null, { status: 202, headers: { 'x-message-id': 'submitted-' + sgMessages.length } }) : new Response(null, { status: submission === 'rejected' ? 400 : 503 })
  } })
  let sgClient
  try {
    await sg.finishSetup()
    await sg.cmd('settings.save', { clinicName: 'Riverside Physio', timeZone: 'Australia/Brisbane' })
    const practitioner = await sg.cmd('staff.save', { name: 'Priya', email: 'priya@clinic.example', role: 'practitioner', active: true, profession: 'Physiotherapist' })
    const service = await sg.cmd('service.save', { name: 'Clinical detail must stay in Balm', durationMinutes: 45, priceCents: 9500 })
    await sg.cmd('hours.save', { practitionerId: practitioner.id, hours: [0, 1, 2, 3, 4, 5, 6].map(weekday => ({ weekday, start: '00:00', end: '24:00' })) })
    sgClient = await sg.cmd('client.save', { firstName: 'Ava', lastName: 'Ng', email: 'ava@client.example' })
    const book = date => sg.cmd('appointment.book', { clientId: sgClient.id, practitionerId: practitioner.id, serviceId: service.id, date, time: '10:00' })
    const file = async () => (await sg.send('/api/balm/clients/' + sgClient.id, undefined, sg.owner)).value
    const first = await book('2099-05-04'), deliveryId = sgMessages[0].custom_args.rer_delivery_id, timestamp = Math.floor(Date.now() / 1000) - 10
    const delivered = { sg_event_id: 'sg-delivered', sg_message_id: 'provider-final-message-1', event: 'delivered', timestamp, email: 'ava@client.example', rer_delivery_id: deliveryId }
    assert.equal((await postSendgrid([delivered, { ...delivered, sg_event_id: 'sg-unrelated-recipient', email: 'unrelated@example.com' }])).status, 503)
    assert.equal((await file()).mailHistory[0].state, 'accepted', 'COMM-001 unauthorized SendGrid batch leaves all delivery states unchanged')
    assert.equal((await postSendgrid([{ ...delivered, rer_delivery_id: 'unrelated-attempt' }])).status, 503)
    assert.equal((await postSendgrid([delivered])).status, 200, 'COMM-001 SendGrid authorizes its signed delivery ID even when provider message ID differs from submission')
    assert.equal((await postSendgrid([delivered])).status, 200)
    assert.equal((await file()).mailHistory[0].state, 'delivered')
    assert.equal((await postSendgrid([{ ...delivered, sg_event_id: 'sg-late-processing', event: 'processed', timestamp: timestamp + 1 }])).status, 200)
    assert.equal((await file()).mailHistory[0].state, 'delivered')
    assert.equal((await postSendgrid([{ ...delivered, sg_event_id: 'sg-bounce', event: 'bounce', timestamp: timestamp + 2 }])).status, 200)
    assert.equal((await file()).mailHistory[0].state, 'bounced', 'COMM-001 signed SendGrid failure appears on the patient file')
    assert.match((await sg.send('/app/clients/' + sgClient.id, undefined, sg.owner)).text, /Delivery bounced/)

    // Both configured leads send once, with a durable unknown response never resent.
    await sg.cmd('reminders.settings', { leadMinutes: '2880,1440', sms: false })
    const worker = await sg.mf.getWorker(), tick = async time => worker.scheduled({ scheduledTime: time, cron: '* * * * *' })
    const due = Date.parse(first.startAt) - 2880 * 60_000
    await tick(due); await tick(due + 60_000)
    assert.equal(sgMessages.length, 2, 'COMM-001 48-hour lead submits once')
    const firstReminderId = sgMessages[1].custom_args.rer_delivery_id
    assert.equal((await postSendgrid([{ ...delivered, sg_event_id: 'sg-48h-delivered', sg_message_id: 'provider-48h-reminder', rer_delivery_id: firstReminderId, timestamp: timestamp + 3 }])).status, 200)
    assert.ok((await file()).mailHistory.some(m => m.id === firstReminderId && m.state === 'delivered'), 'COMM-001 48-hour reminder delivery is recorded')
    submission = 'uncertain'
    await tick(due + 1440 * 60_000); await tick(due + 1441 * 60_000)
    assert.equal(sgMessages.length, 3, 'COMM-001 24-hour lead with unknown provider outcome is not resent')
    let history = (await file()).mailHistory
    assert.equal(history.filter(m => m.kind === 'reminder' && m.state === 'delivered').length, 1)
    assert.equal(history.filter(m => m.kind === 'reminder' && m.state === 'uncertain').length, 1)
    const uncertainId = sgMessages[2].custom_args.rer_delivery_id
    assert.equal((await postSendgrid([{ ...delivered, sg_event_id: 'sg-uncertain-delivered', sg_message_id: 'provider-final-uncertain', rer_delivery_id: uncertainId, timestamp: timestamp + 3 }])).status, 200)
    assert.ok((await file()).mailHistory.some(m => m.id === uncertainId && m.state === 'delivered'), 'COMM-001 an uncertain submission can be resolved by a signed delivery fact')
    assert.equal((await file()).mailHistory.filter(m => m.kind === 'reminder' && m.state === 'delivered').length, 2, 'COMM-001 both configured lead deliveries are recorded separately')
    assert.match((await sg.send('/app/clients/' + sgClient.id, undefined, sg.owner)).text, /Delivered to the receiving mail server/)
    submission = 'rejected'
    const rejected = await book('2099-05-05')
    assert.equal(rejected.mail, 'mail_unavailable')
    history = (await file()).mailHistory
    assert.ok(history.some(m => m.id === sgMessages.at(-1).custom_args.rer_delivery_id && m.state === 'failed'), 'COMM-001 definite provider rejection is recorded honestly')
    assert.ok(sgMessages.every(m => !JSON.stringify(m).includes('Clinical detail must stay in Balm')), 'COMM-001 service/clinical detail stays out of booking and reminder emails')
  } finally { await sg.close() }

})

test('COMM-004: configured consented sequences follow chart goals, share contact limits, stop on booking and keep honest file history', { timeout: 120_000 }, async () => {
  const h = await harness()
  try {
    await h.finishSetup()
    const { service, practitioners: [priya, sam] } = await clinic(h, ['Priya', 'Sam'])
    const reception = await h.staff('Rosa', 'reception')
    const client = await h.cmd('client.save', { firstName: 'Elena', lastName: 'Martinez', email: 'elena@patient.example' })
    const file = async (cookie = h.owner) => (await h.send('/api/balm/clients/' + client.id, undefined, cookie)).value
    const settings = kind => ({ kind, enabled: true, delayDays: 0, repeatDays: 2, maxSends: 3, contactLimit: 1, surveyUrl: 'https://clinic.example/survey', reviewUrl: 'https://clinic.example/review' })
    await h.cmd('followups.settings', settings('no_next'), reception.cookie, 403)
    for (const kind of ['welcome', 'missed', 'no_next', 'discharge', 'recall']) await h.cmd('followups.settings', settings(kind))
    assert.match((await h.send('/app/clinic', undefined, h.owner)).text, /name="contactLimit"/)
    const enroll = async (kind, patient = client, consent = true, cookie = reception.cookie, status = 200) => h.cmd('followups.enroll', { clientId: patient.id, kind, consent, consentRecord: 'Patient requested these emails during the visit on October 19.' }, cookie, status)
    await enroll('no_next', client, false, reception.cookie, 400)
    await enroll('no_next', client, true, priya.cookie, 403)
    const visit = await pastVisit(h, client.id, priya, service.id)
    await h.cmd('appointment.attend', { id: visit })
    const plan = await h.cmd('plan.send', { clientId: client.id, diagnoses: 'M25.561', shortTermGoals: 'Climb stairs', longTermGoals: 'Walk independently', frequencyPerWeek: 2, durationWeeks: 6,
      startDate: new Date().toISOString().slice(0, 10), interventions: 'Therapeutic exercise', physicianName: 'Dr Anika Patel', physicianEmail: 'anika@referrer.example', signature: 'Priya', credentials: 'PT, DPT', attest: true }, priya.cookie)
    assert.ok(plan.id)
    const noNext = await enroll('no_next'), recall = await enroll('recall')
    const tick = async time => (await h.mf.getWorker()).scheduled({ scheduledTime: time, cron: '* * * * *' })
    // `at` is re-anchored after each real-time enrollment or signature below: a sequence is never due before the moment the clinic recorded it.
    let at = Date.now() + 1000
    const messages = () => h.mail.filter(m => m.subject.startsWith('A follow-up'))
    await Promise.all([tick(at), tick(at)])
    assert.equal(messages().length, 1, 'COMM-004 racing ticks share one per-patient contact reservation across all sequence kinds')
    assert.ok((await file()).followups.attempts.some(a => a.state === 'accepted'))
    assert.ok(!messages()[0].text.includes('M25.561') && !messages()[0].text.includes('Elena'), 'COMM-004 no chart or identifying detail in email')
    assert.match(messages()[0].text, /\/portal/)
    await tick(at + 60_000)
    assert.equal(messages().length, 1, 'COMM-004 repeated ticks do not resend')
    await tick(at + 86400_000 + 1)
    assert.equal(messages().length, 2, 'COMM-004 the other eligible kind runs when the shared cap clears')
    const beforeNext = (await file()).followups.attempts.length
    const date = new Date(at + 4 * 86400_000 + 10 * 3600_000).toISOString().slice(0, 10)
    await h.cmd('appointment.book', { clientId: client.id, practitionerId: priya.id, serviceId: service.id, date, time: '15:00' })
    await tick(at + 2 * 86400_000 + 2)
    const stopped = (await file()).followups
    assert.equal(stopped.attempts.length, beforeNext)
    assert.ok(stopped.sequences.filter(s => [noNext.id, recall.id].includes(s.id)).every(s => s.state === 'goal_met'), 'COMM-004 a booking stops open-plan and recall sequences')
    const missedClient = await h.cmd('client.save', { firstName: 'Noah', lastName: 'Kim', email: 'noah@patient.example' })
    const missedVisit = await pastVisit(h, missedClient.id, priya, service.id, h.owner, 5)
    await h.cmd('appointment.no_show', { id: missedVisit })
    const missed = await enroll('missed', missedClient)
    at = Date.now() + 1000
    await tick(at)
    assert.equal(messages().length, 3, 'COMM-004 missed-visit outreach is triggered by a recorded no-show')
    await tick(at + 86400_000)
    assert.equal(messages().length, 3, 'COMM-004 configured repeat delay holds')
    await tick(at + 2 * 86400_000)
    assert.equal(messages().length, 4, 'COMM-004 missed-visit outreach repeats at its configured interval')
    await h.cmd('followups.stop', { clientId: missedClient.id, id: missed.id }, reception.cookie)
    await tick(at + 4 * 86400_000)
    assert.equal(messages().length, 4, 'COMM-004 withdrawn consent stops outreach')
    const noteClient = await h.cmd('client.save', { firstName: 'Maya', lastName: 'Lee', email: 'maya@patient.example' })
    const noteVisit = await pastVisit(h, noteClient.id, priya, service.id, h.owner, 8)
    const note = async kind => {
      const n = await h.cmd('note.write', { clientId: noteClient.id, appointmentId: noteVisit, template: 'pt.' + kind, ...chartFixture(kind), charges: kind === 'evaluation' ? chartFixture(kind).charges : [], sections: { ...chartFixture(kind).sections, diagnosis: 'M25.561', reason: 'Goals met', subjective: 'Private narrative', objective: 'Private findings', assessment: 'Private assessment', goals: 'Private goals', plan: 'Private plan' } }, priya.cookie)
      return h.cmd('note.sign', { id: n.id, revision: 1, signature: 'Priya', credentials: 'PT, DPT', attest: true }, priya.cookie)
    }
    await enroll('welcome', noteClient)
    await tick(at)
    assert.equal(messages().length, 4, 'COMM-004 welcome waits for a signed evaluation')
    await note('evaluation')
    at = Date.now() + 1000
    await tick(at + 1000)
    assert.equal(messages().length, 5)
    await tick(at + 2 * 86400_000)
    assert.equal(messages().length, 5, 'COMM-004 welcome goal completes after one attempt')
    await enroll('discharge', noteClient)
    await tick(at + 2 * 86400_000)
    assert.equal(messages().length, 5, 'COMM-004 discharge waits for signed discharge')
    await note('discharge')
    await tick(at + 2 * 86400_000 + 1000)
    assert.equal(messages().length, 6)
    assert.match(messages().at(-1).text, /https:\/\/clinic.example\/survey[\s\S]*https:\/\/clinic.example\/review/)
    await tick(at + 4 * 86400_000)
    assert.equal(messages().length, 6, 'COMM-004 discharge request completes once')
    assert.ok(messages().every(m => !JSON.stringify(m).includes('Private narrative')))
    assert.ok((await file()).audit.some(a => a.action === 'followup.attempted'))
    assert.match((await h.send('/app/clients/' + client.id, undefined, reception.cookie)).text, /Follow-ups and recalls[\s\S]*Accepted by mail provider/)
    assert.equal((await h.send('/api/balm/clients/' + client.id, undefined, sam.cookie)).status, 404, 'COMM-004 unrelated practitioner cannot see follow-up records')
    assert.ok((await file(priya.cookie)).followups.attempts.length)
  } finally { await h.close() }
  // Unknown provider submission is a real network-edge response, never application mock data.
  const unknown = await harness({ auth: { MAIL_PROVIDER: 'sendgrid' }, outbound: async () => new Response(null, { status: 503 }) })
  try {
    await unknown.finishSetup()
    await unknown.cmd('settings.save', { clinicName: 'Riverside Rehabilitation', timeZone: 'Australia/Brisbane' })
    const practitioner = await unknown.cmd('staff.save', { name: 'Jordan Parker', email: unknown.auth.OWNER_EMAIL, role: 'practitioner', active: true })
    const service = await unknown.cmd('service.save', { name: 'Therapy', durationMinutes: 45, priceCents: 9500 })
    await unknown.cmd('hours.save', { practitionerId: practitioner.id, hours: [0,1,2,3,4,5,6].map(weekday => ({ weekday, start: '00:00', end: '24:00' })) })
    const patient = await unknown.cmd('client.save', { firstName: 'Alex', lastName: 'Rivera', email: 'alex@patient.example' })
    const v = await pastVisit(unknown, patient.id, practitioner, service.id)
    await unknown.cmd('appointment.no_show', { id: v })
    await unknown.cmd('followups.enroll', { clientId: patient.id, kind: 'missed', consent: true, consentRecord: 'Requested by patient in person today' })
    const tick = async time => (await unknown.mf.getWorker()).scheduled({ scheduledTime: time, cron: '* * * * *' })
    const file = async () => (await unknown.send('/api/balm/clients/' + patient.id, undefined, unknown.owner)).value.followups
    await tick(Date.now() + 1000)
    assert.equal((await file()).attempts.length, 0, 'COMM-004 disabled sequences never contact patients')
    await unknown.cmd('followups.settings', { kind: 'missed', enabled: true, delayDays: 1, repeatDays: 2, maxSends: 3, contactLimit: 1 })
    await tick(Date.now() + 1000)
    assert.equal((await file()).attempts.length, 0, 'COMM-004 configured initial delay holds')
    const later = Date.now() + 86400_000
    await tick(later)
    assert.equal((await file()).attempts[0].state, 'uncertain')
    await tick(later + 3 * 86400_000)
    assert.equal((await file()).attempts.length, 1, 'COMM-004 unknown send is never automatically attempted again')
    assert.equal((await file()).sequences[0].state, 'stopped')
    assert.match((await unknown.send('/app/clients/' + patient.id, undefined, unknown.owner)).text, /Outcome unknown; never automatically resent/)
  } finally { await unknown.close() }
})
