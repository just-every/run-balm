import { test } from 'node:test'
import assert from 'node:assert/strict'
import { run } from './harness.mjs'
import { clinic, pastVisit, visitDate } from './clinic.mjs'

const brisbane = t => new Date(t + 10 * 3600_000).toISOString() // Australia/Brisbane has no daylight saving.
const weekday = date => new Date(date + 'T00:00:00Z').getUTCDay()

test('a recurring series shows its overlapping date before saving, books in one step, and moves or cancels one visit or the rest', () => run(async h => {
  await h.finishSetup()
  const { service, practitioners: [priya, sam, jordan] } = await clinic(h, ['Priya', 'Sam', 'Jordan'])
  const room = await h.cmd('room.save', { name: 'Gym' })
  const client = await h.cmd('client.save', { firstName: 'Ava', lastName: 'Ng', dateOfBirth: '1992-06-15', email: 'ava@client.example' })
  const other = await h.cmd('client.save', { firstName: 'Noah', lastName: 'Kim', dateOfBirth: '1979-11-30' })
  const first = '2099-03-02', second = '2099-03-05'
  await h.cmd('appointment.book', { clientId: other.id, practitionerId: priya.id, serviceId: service.id, date: second, time: '09:30' })
  const pattern = { clientId: client.id, practitionerId: priya.id, serviceId: service.id, roomId: room.id, firstDate: first, weekdays: [weekday(first), weekday(second)], weeks: 6, time: '09:00' }
  // Twice a week for six weeks: twelve dates, and the one that overlaps Noah's visit is shown, not dropped.
  const preview = await h.cmd('series.preview', pattern)
  assert.equal(preview.occurrences.length, 12)
  assert.deepEqual(preview.occurrences.filter(o => o.problem).map(o => [o.date, o.problem]), [[second, 'practitioner_already_booked']])
  assert.equal(preview.conflicts, 1)
  const reviewed = preview.occurrences.map(({ date, time }) => ({ date, time }))
  const refused = await h.send('/api/balm/command', { name: 'series.book', input: { ...pattern, occurrences: reviewed } }, h.owner)
  assert.equal(refused.status, 409)
  assert.equal(refused.value.detail.occurrences.find(o => o.date === second).problem, 'practitioner_already_booked')
  assert.equal((await h.state()).appointments.filter(a => a.client_id === client.id).length, 0, 'nothing is saved while a date conflicts')
  // Moving the conflicting date to a free time books all twelve in one step.
  const booked = await h.cmd('series.book', { ...pattern, occurrences: reviewed.map(o => o.date === second ? { ...o, time: '11:00' } : o) })
  assert.equal(booked.booked, 12)
  const visits = () => h.state().then(s => s.appointments.filter(a => a.client_id === client.id && a.series_id === booked.seriesId).sort((a, b) => a.start_at.localeCompare(b.start_at)))
  let series = await visits()
  assert.equal(series.length, 12)
  assert.ok(series.every(a => a.room_id === room.id && a.status === 'booked'))
  const week = await h.send(`/app?view=week&date=${second}&id=${priya.id}`, undefined, h.owner)
  assert.equal(week.status, 200)
  assert.equal((week.text.match(/class="appt st-booked tone-\w+ size/g) ?? []).length, 3, 'the week grid shows both series visits and Noah’s')
  assert.equal((week.text.match(/class="appt st-booked tone-\w+ ag/g) ?? []).length, 3, 'the phone agenda shows the same three')
  // The room holds one visit at a time, even for another practitioner's booking.
  await h.cmd('appointment.book', { clientId: other.id, practitionerId: sam.id, serviceId: service.id, roomId: room.id, date: first, time: '09:15' }, h.owner, 409)
  // Without assigned rooms, simultaneous visits from different practitioners
  // share the No room column. Each keeps its own lane and visit link.
  const noRoom = await h.cmd('appointment.book', { clientId: other.id, practitionerId: sam.id, serviceId: service.id, date: first, time: '09:00' })
  const alsoNoRoom = await h.cmd('appointment.book', { clientId: client.id, practitionerId: jordan.id, serviceId: service.id, date: first, time: '09:00' })
  const rooms = await h.send(`/app?view=day&by=room&date=${first}&id=none`, undefined, h.owner)
  assert.equal(rooms.status, 200)
  assert.equal((rooms.text.match(/class="overlap-lane"/g) ?? []).length, 2)
  for (const visit of [noRoom, alsoNoRoom]) assert.match(rooms.text, new RegExp(`appt=${visit.appointmentId}[^\"]*#visit`))
  assert.equal((rooms.text.match(/class="appt st-booked tone-\w+ ag/g) ?? []).length, 2, 'both remain accessible in the phone agenda')
  // One visit moves, to any 5-minute start inside hours; a move onto another visit is refused as at booking.
  await h.cmd('appointment.move', { id: series[0].id, date: second, time: '09:30' }, h.owner, 409)
  await h.cmd('appointment.move', { id: series[0].id, date: first, time: '14:10' })
  // The rest of the series moves together, or not at all.
  await h.cmd('series.move_rest', { appointmentId: series[1].id, time: '09:30' }, h.owner, 409)
  assert.equal((await h.cmd('series.move_rest', { appointmentId: series[2].id, time: '15:00' })).moved, 10)
  series = await visits()
  assert.deepEqual(series.map(a => brisbane(Date.parse(a.start_at)).slice(11, 16)), ['14:10', '11:00', ...Array(10).fill('15:00')])
  // Cancel one visit, then this and the rest.
  await h.cmd('appointment.cancel', { id: series[3].id })
  assert.equal((await h.cmd('series.cancel_rest', { appointmentId: series[6].id })).cancelled.length, 6)
  assert.deepEqual((await visits()).map(a => a.status), [...Array(3).fill('booked'), 'cancelled', 'booked', 'booked', ...Array(6).fill('cancelled')])
}))

test('a canceled visit is offered to the waitlist by email; the first to accept is booked and the others are told it is taken', () => run(async h => {
  await h.finishSetup()
  const { service, practitioners: [priya, sam] } = await clinic(h, ['Priya', 'Sam'])
  const add = (firstName, email) => h.cmd('client.save', { firstName, lastName: 'Example', dateOfBirth: '1990-01-01', email })
  const [ava, ben, cara, dev] = [await add('Ava', 'ava@client.example'), await add('Ben', 'ben@client.example'), await add('Cara', 'cara@client.example'), await add('Dev', 'dev@client.example')]
  const local = brisbane(Math.floor((Date.now() + 3 * 86400_000) / 3600_000) * 3600_000), date = local.slice(0, 10)
  const visit = await h.cmd('appointment.book', { clientId: ava.id, practitionerId: priya.id, serviceId: service.id, date, time: '10:00' })
  const until = brisbane(Date.now() + 10 * 86400_000).slice(0, 10)
  await h.cmd('waitlist.add', { clientId: ben.id, practitionerId: priya.id, serviceId: service.id, latestDate: until })
  await h.cmd('waitlist.add', { clientId: cara.id, serviceId: service.id, latestDate: until, note: 'Any practitioner' })
  await h.cmd('waitlist.add', { clientId: dev.id, practitionerId: sam.id, serviceId: service.id, latestDate: until })
  await h.cmd('waitlist.add', { clientId: ben.id, practitionerId: priya.id, serviceId: service.id, latestDate: until }, h.owner, 409)
  const cancelled = await h.form(`/app/action?name=appointment.cancel&returnTo=${encodeURIComponent('/app?view=day&date=' + date)}`, { id: visit.appointmentId }, h.owner)
  assert.equal(cancelled.status, 303)
  assert.match(cancelled.location, /offered=2$/)
  assert.ok(h.mail.some(m => m.to.includes('ava@client.example') && m.subject.endsWith('is canceled')), 'the patient is told by email')
  const offers = h.mail.filter(m => m.subject.startsWith('A time opened up'))
  assert.deepEqual(offers.map(m => m.to[0]).sort(), ['ben@client.example', 'cara@client.example'], 'only entries whose practitioner fits')
  const link = email => new URL(offers.find(m => m.to.includes(email)).text.match(/https?:\/\/\S+\/offer\/[\w-]+/)[0]).pathname
  const page = await h.send(link('ben@client.example'))
  assert.equal(page.status, 200); assert.match(page.text, /A time opened up/)
  // Both accept at once: exactly one is booked.
  const answers = await Promise.all(['ben@client.example', 'cara@client.example'].map(email => h.form(link(email), {})))
  assert.deepEqual(answers.map(a => a.status).sort(), [303, 409])
  const winner = answers[0].status === 303 ? 'ben@client.example' : 'cara@client.example', loser = winner.startsWith('ben') ? 'cara@client.example' : 'ben@client.example'
  assert.match(answers.find(a => a.status === 303).location, /^\/intake\/[\w-]+\?booked=1/)
  assert.match(answers.find(a => a.status === 409).text, /This time has been taken/)
  const mail = h.mail
  assert.ok(mail.some(m => m.to.includes(winner) && /accepted a time from the waitlist/.test(m.text)), 'the winner gets a confirmation with the intake link')
  assert.ok(mail.some(m => m.to.includes(loser) && m.subject.includes('has been taken')), 'the other is told it is taken')
  assert.ok(!mail.some(m => m.to.includes('dev@client.example')))
  const s = await h.state()
  const rebooked = s.appointments.filter(a => a.status === 'booked' && a.start_at === s.appointments.find(x => x.id === visit.appointmentId).start_at)
  assert.equal(rebooked.length, 1)
  assert.equal(s.clients.find(c => c.id === rebooked[0].client_id).first_name, winner.startsWith('ben') ? 'Ben' : 'Cara')
  assert.deepEqual(s.waitlist.entries.map(e => [e.client, e.status]).sort(), [['Ben Example', winner.startsWith('ben') ? 'booked' : 'waiting'], ['Cara Example', winner.startsWith('cara') ? 'booked' : 'waiting'], ['Dev Example', 'waiting']])
  // The link stays honest afterwards, and the waitlist page shows the offer's outcome.
  assert.match((await h.send(link(winner))).text, /You're booked/)
  assert.match((await h.send(link(loser))).text, /has been taken/)
  const listing = await h.send('/app/waitlist', undefined, h.owner)
  assert.equal(listing.status, 200); assert.match(listing.text, /Accepted/); assert.match(listing.text, /told it was taken/)
  // An existing open intake link is reused, then a completed intake stays on
  // file for later waitlist visits. Neither acceptance creates another form.
  const winnerId = rebooked[0].client_id
  const acceptAgain = async time => {
    const source = await h.cmd('appointment.book', { clientId: ava.id, practitionerId: priya.id, serviceId: service.id, date, time })
    await h.cmd('waitlist.add', { clientId: winnerId, practitionerId: priya.id, serviceId: service.id, latestDate: until })
    await h.cmd('appointment.cancel', { id: source.appointmentId })
    const email = h.mail.findLast(m => m.to.includes(winner) && m.subject.startsWith('A time opened up'))
    const offered = new URL(email.text.match(/https?:\/\/\S+\/offer\/[\w-]+/)[0]).pathname
    const before = h.mail.length, accepted = await h.form(offered, {})
    assert.equal(accepted.status, 303, accepted.text)
    assert.equal(accepted.location, offered, 'returning clients land on their booked confirmation')
    assert.ok(!h.mail.slice(before).some(m => m.to.includes(winner) && /\/intake\//.test(m.text)), 'no second intake link is emailed')
    return h.send(offered)
  }
  assert.match((await acceptAgain('11:00')).text, /already have an open intake link/)
  const intakePath = answers.find(a => a.status === 303).location.split('?')[0]
  const intakePage = await h.send(intakePath)
  const name = winner.startsWith('ben') ? 'Ben Example' : 'Cara Example'
  const submitted = await h.form(intakePath, { formId: 'intake-v1', q_reason: 'Follow-up', q_emergency: 'Alex Example +1 202 555 0110', q_consent: 'yes', consentVersion: intakePage.text.match(/name="consentVersion" value="([^"]+)"/)[1], consentAccepted: 'on', signerName: name, signerRelationship: 'patient', signatureTyped: name })
  assert.equal(submitted.status, 303, submitted.text)
  assert.match((await acceptAgain('12:00')).text, /intake form is already on file/)
  const file = await h.send('/api/balm/clients/' + winnerId, undefined, h.owner)
  assert.equal(file.value.intake.length, 1, 'all three waitlist visits continue the same intake record')
}))


test('SCHED-009: a private practitioner subscription follows bookings, moves and cancellations, and revokes immediately', () => run(async h => {
  await h.finishSetup()
  const { service, practitioners: [priya, sam] } = await clinic(h, ['Priya', 'Sam'])
  const reception = await h.staff('Taylor', 'reception')
  const client = await h.cmd('client.save', { firstName: 'Marisol', lastName: 'Diaz', dateOfBirth: '1980-03-07', email: 'marisol@client.example' })
  for (const cookie of [h.owner, reception.cookie]) await h.cmd('calendar.feed.create', {}, cookie, 403)
  const feed = await h.cmd('calendar.feed.create', { practitionerId: sam.id }, priya.cookie)
  const empty = await h.send(feed.calendarFeedPath)
  assert.equal(empty.status, 200)
  assert.match(empty.headers.get('content-type'), /text\/calendar/)
  assert.equal(empty.headers.get('cache-control'), 'no-store')
  assert.doesNotMatch(empty.text, /BEGIN:VEVENT/)
  const visit = await h.cmd('appointment.book', { clientId: client.id, practitionerId: priya.id, serviceId: service.id, date: '2099-03-02', time: '09:00' })
  await h.cmd('appointment.book', { clientId: client.id, practitionerId: sam.id, serviceId: service.id, date: '2099-03-02', time: '11:00' })
  const booked = await h.send(feed.calendarFeedPath)
  assert.equal((booked.text.match(/BEGIN:VEVENT/g) ?? []).length, 1)
  assert.match(booked.text, /SUMMARY:M\.D\.\r\n/)
  assert.match(booked.text, /DTSTART:20990301T230000Z/)
  assert.match(booked.text, /DTEND:20990301T234500Z/)
  assert.match(booked.text, new RegExp(`UID:${visit.appointmentId}@balm`))
  assert.doesNotMatch(booked.text, /Marisol|Diaz|client.example|Priya|Sam|consultation|DESCRIPTION|LOCATION/)
  await h.cmd('appointment.move', { id: visit.appointmentId, date: '2099-03-02', time: '10:00' })
  const moved = await h.send(feed.calendarFeedPath)
  assert.match(moved.text, /DTSTART:20990302T000000Z/)
  assert.match(moved.text, /SEQUENCE:2/)
  await h.cmd('appointment.cancel', { id: visit.appointmentId })
  const cancelled = await h.send(feed.calendarFeedPath)
  assert.match(cancelled.text, /STATUS:CANCELLED/)
  assert.match(cancelled.text, /SEQUENCE:3/)
  assert.match(cancelled.text, new RegExp(`UID:${visit.appointmentId}@balm`))
  const stored = await h.db.prepare('SELECT * FROM bm_calendar_feeds').all()
  assert.equal(stored.results.length, 1)
  assert.equal(stored.results[0].practitioner_id, priya.id)
  assert.ok(!JSON.stringify(stored.results).includes(feed.calendarFeedPath.split('/')[2].split('.')[0]), 'raw subscription credential never stored')
  await h.cmd('calendar.feed.revoke', {}, sam.cookie)
  assert.equal((await h.send(feed.calendarFeedPath)).status, 200, 'another practitioner cannot revoke this feed')
  const replacement = await h.cmd('calendar.feed.create', {}, priya.cookie)
  assert.equal((await h.send(feed.calendarFeedPath)).status, 404)
  assert.equal((await h.send(replacement.calendarFeedPath)).status, 200)
  await h.cmd('calendar.feed.revoke', {}, priya.cookie)
  assert.equal((await h.send(replacement.calendarFeedPath)).status, 404)
  const active = await h.cmd('calendar.feed.create', {}, priya.cookie)
  await h.cmd('staff.save', { id: priya.id, name: 'Priya', email: 'priya@clinic.example', role: 'practitioner', active: false })
  assert.equal((await h.send(active.calendarFeedPath)).status, 404, 'deactivation removes bearer access')
  assert.equal((await h.send('/api/balm/command', { name: 'calendar.feed.create', input: {} })).status, 401)
}))


test('SCHED-008: check in, attend, no-show and cancel retain actor/time history; attendance atomically opens clinical and billing drafts', () => run(async h => {
  await h.finishSetup()
  const { service, practitioners: [priya, sam] } = await clinic(h, ['Priya', 'Sam'])
  const reception = await h.staff('Taylor', 'reception')
  await h.cmd('service.save', { id: service.id, name: 'PT follow-up', durationMinutes: 45, priceCents: 9500, noteTemplate: 'pt.daily' })
  const client = await h.cmd('client.save', { firstName: 'Marisol', lastName: 'Diaz', dateOfBirth: '1980-03-07' })
  const visit = await pastVisit(h, client.id, priya, service.id, h.owner, 2)
  const absent = await pastVisit(h, client.id, priya, service.id, h.owner, 4)
  const cancelled = await pastVisit(h, client.id, priya, service.id, h.owner, 6)
  await h.cmd('appointment.attend', { id: visit }, sam.cookie, 404)
  await h.cmd('pay.checkin', { appointmentId: visit }, reception.cookie)
  // Two attempts cannot start duplicate work, even when they race.
  const attempts = await Promise.all([reception.cookie, priya.cookie].map(cookie => h.send('/api/balm/command', { name: 'appointment.attend', input: { id: visit } }, cookie)))
  assert.deepEqual(attempts.map(r => r.status).sort(), [200, 409])
  const file = async cookie => (await h.send('/api/balm/clients/' + client.id, undefined, cookie)).value
  const started = await file(priya.cookie), note = started.notes[0]
  assert.equal(started.notes.length, 1)
  assert.equal(note.appointmentId, visit)
  assert.equal(note.authorId, priya.id)
  assert.equal(note.status, 'draft')
  assert.equal(note.template, 'pt.daily')
  assert.equal(note.revisions[0].body, '')
  assert.ok(note.revisions[0].sections.every(s => s.text === ''))
  assert.equal((await file(reception.cookie)).notes, null)
  await h.cmd('note.amend', { id: note.id, revision: 0, sections: { subjective: 'Walking more comfortably.' } }, reception.cookie, 404)
  const desk = await file(h.owner), invoice = desk.invoices.find(i => i.appointment_id === visit)
  assert.equal(invoice.status, 'draft')
  assert.equal(invoice.number, null)
  assert.equal(invoice.amount_cents, 9500)
  assert.equal(desk.billing.ledger.chargesCents, 0, 'unapproved work does not bill the patient')
  await h.cmd('invoice.approve', { id: invoice.id }, priya.cookie, 403)
  const written = await h.cmd('note.write', { clientId: client.id, appointmentId: visit, sections: { subjective: 'Walking more comfortably.' } }, priya.cookie)
  assert.equal(written.id, note.id, 'first saved text continues the attendance starter')
  assert.equal(written.revision, 1)
  assert.equal((await file(priya.cookie)).notes.length, 1)
  await h.cmd('appointment.no_show', { id: absent }, reception.cookie)
  await h.cmd('appointment.cancel', { id: cancelled }, h.owner)
  for (const [id, actions] of [[visit, ['booked', 'checked_in', 'attended']], [absent, ['booked', 'no_show']], [cancelled, ['booked', 'cancelled']]]) {
    const page = await h.send(`/app?date=${await visitDate(h, id)}&appt=${id}`, undefined, reception.cookie)
    assert.equal(page.status, 200)
    assert.match(page.text, /Visit history/)
    for (const action of actions) assert.ok(page.text.includes(action.replaceAll('_', ' ')), action)
    assert.match(page.text, /owner@clinic.example/)
    if (id !== cancelled) assert.match(page.text, /taylor@clinic.example|priya@clinic.example/)
  }
  assert.equal((await file(h.owner)).invoices.length, 1, 'no charge is started for a no-show or cancellation')
  assert.equal((await file(h.owner)).notes.length, 1)
  // A failed status guard must roll back starters as well as attendance.
  const untouched = await pastVisit(h, client.id, sam, service.id, h.owner, 2)
  const before = await h.state()
  await h.cmd('appointment.no_show', { id: untouched }, h.owner)
  await h.cmd('appointment.attend', { id: untouched }, h.owner, 409)
  assert.equal((await h.state()).invoices.length, before.invoices.length)
}))
