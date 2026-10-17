import { test } from 'node:test'
import assert from 'node:assert/strict'
import { run } from './harness.mjs'
import { clinic } from './clinic.mjs'

const brisbane = t => new Date(t + 10 * 3600_000).toISOString() // Australia/Brisbane has no daylight saving.
const weekday = date => new Date(date + 'T00:00:00Z').getUTCDay()

test('a recurring series shows its overlapping date before saving, books in one step, and moves or cancels one visit or the rest', () => run(async h => {
  await h.finishSetup()
  const { service, practitioners: [priya] } = await clinic(h)
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
  await h.cmd('appointment.book', { clientId: other.id, practitionerId: (await h.staff('Sam')).id, serviceId: service.id, roomId: room.id, date: first, time: '09:15' }, h.owner, 409)
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
}))
