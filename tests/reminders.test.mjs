import { test } from 'node:test'
import assert from 'node:assert/strict'
import { harness } from './harness.mjs'
import { clinic } from './clinic.mjs'
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
    assert.deepEqual(file.messages.messages.map(m => m.body), [clinical, reply])
    assert.equal((await h.send('/api/balm/clients/' + client.id, undefined, reception.cookie)).value.messages, null)
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
})
