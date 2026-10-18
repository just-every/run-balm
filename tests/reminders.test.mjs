import { test } from 'node:test'
import assert from 'node:assert/strict'
import { harness } from './harness.mjs'
import { clinic, pastVisit } from './clinic.mjs'
import { fakeProviders } from './fakes/stripe.mjs'

test('booked visit is reminded on schedule, confirmed in one reply, moved and canceled safely; private messages stay in Balm', { timeout: 120_000 }, async () => {
  const providers = fakeProviders(), h = await harness({ outbound: providers.handler, auth: {
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
    const due = Date.parse(booked.startAt) - 1440 * 60_000
    const tick = async time => (await h.mf.getWorker()).scheduled({ scheduledTime: time, cron: '* * * * *' })
    const reminders = () => h.mail.filter(m => m.subject.startsWith('Appointment reminder'))
    await tick(due - 60_000)
    assert.equal(reminders().length, 0, 'the reminder is not sent early')
    await tick(due)
    assert.equal(reminders().length, 1, 'Balm sends without a person approving')
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
    await h.cmd('appointment.move', { id: booked.appointmentId, date: '2099-03-03', time: '11:00' })
    assert.equal((await h.send(visit)).status, 404, 'old reply link cannot confirm a moved visit')
    assert.equal((await h.state()).appointments.find(a => a.id === booked.appointmentId).patient_response, 'awaiting')
    await tick(due + 86400_000 + 3600_000)
    assert.equal(reminders().length, 2, 'the moved visit has its own reminder')
    const movedLink = new URL(reminders()[1].text.match(/https?:\/\/[^\s]+\/visit\/[\w-]+/)[0]).pathname
    await h.cmd('appointment.cancel', { id: booked.appointmentId })
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
    const due = Date.parse(booked.startAt) - 1440 * 60_000
    const worker = await local.mf.getWorker()
    await worker.scheduled({ scheduledTime: due, cron: '* * * * *' })
    await worker.scheduled({ scheduledTime: due + 60_000, cron: '* * * * *' })
    let file = (await local.send('/api/balm/clients/' + client.id, undefined, local.owner)).value
    assert.equal(file.reminderHistory.length, 1)
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
})
