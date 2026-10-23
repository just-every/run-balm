import { test } from 'node:test'
import assert from 'node:assert/strict'
import { run, harness } from './harness.mjs'
import { fakeProviders } from './fakes/stripe.mjs'
import { bookOnline, clinic, pastVisit, visitDate, slots } from './clinic.mjs'
import { portalLogin } from './portal-billing.mjs'
import { readFile } from 'node:fs/promises'

const brisbane = t => new Date(t + 10 * 3600_000).toISOString() // Australia/Brisbane has no daylight saving.
const weekday = date => new Date(date + 'T00:00:00Z').getUTCDay()

test('SCHED-003: plan cadence, named holiday and visit conflicts, atomic series booking, one/rest/all moves and cancellation', () => run(async h => {
  await h.finishSetup()
  const { service, practitioners: [priya, sam, jordan] } = await clinic(h, ['Priya', 'Sam', 'Jordan'])
  const room = await h.cmd('room.save', { name: 'Gym' })
  const client = await h.cmd('client.save', { firstName: 'Ava', lastName: 'Ng', dateOfBirth: '1992-06-15', email: 'ava@client.example' })
  const other = await h.cmd('client.save', { firstName: 'Noah', lastName: 'Kim', dateOfBirth: '1979-11-30' })
  const first = '2099-03-02', second = '2099-03-05'
  await h.cmd('appointment.book', { clientId: other.id, practitionerId: priya.id, serviceId: service.id, date: second, time: '09:30' })
  await h.cmd('appointment.book', { clientId: client.id, practitionerId: priya.id, serviceId: service.id, date: '2099-02-20', time: '09:00' })
  const plan = await h.cmd('plan.send', { clientId: client.id, diagnoses: 'M25.561', shortTermGoals: 'Climb stairs', longTermGoals: 'Walk independently', frequencyPerWeek: 2, durationWeeks: 6, startDate: first, interventions: 'Therapeutic exercise', physicianName: 'Dr Anika Patel', physicianEmail: 'anika@referrer.example', signature: 'Priya', credentials: 'PT, DPT', attest: true }, priya.cookie)
  await h.cmd('holiday.save', { date: '2099-03-09', name: 'Clinic spring holiday' }, priya.cookie, 403)
  await h.cmd('holiday.save', { date: '2099-03-09', name: 'Clinic spring holiday' })
  const pattern = { planId: plan.id, clientId: client.id, practitionerId: priya.id, serviceId: service.id, roomId: room.id, firstDate: first, weekdays: [weekday(first), weekday(second)], weeks: 1, time: '09:00' }
  await h.cmd('series.preview', { ...pattern, weekdays: [weekday(first)] }, priya.cookie, 400)
  const planPage = (await h.send('/app/clients/' + client.id, undefined, priya.cookie)).text
  assert.ok(planPage.includes('Plan of care cadence') && planPage.includes(plan.id))
  // Twice a week for six weeks: twelve dates, and the one that overlaps Noah's visit is shown, not dropped.
  const preview = await h.cmd('series.preview', pattern, priya.cookie)
  assert.equal(preview.occurrences.length, 12)
  assert.deepEqual(preview.occurrences.filter(o => o.problem).map(o => [o.date, o.problem]), [[second, 'practitioner_already_booked'], ['2099-03-09', 'clinic_holiday']])
  assert.equal(preview.conflicts, 2)
  assert.equal(preview.occurrences.find(o => o.problem === 'clinic_holiday').clash.name, 'Clinic spring holiday')
  assert.equal(preview.pattern.weeks, 6, 'cadence comes from the signed plan, not posted weeks')
  const reviewed = preview.occurrences.map(({ date, time }) => ({ date, time }))
  const refused = await h.send('/api/balm/command', { name: 'series.book', input: { ...pattern, occurrences: reviewed } }, h.owner)
  assert.equal(refused.status, 409)
  assert.equal(refused.value.detail.occurrences.find(o => o.date === second).problem, 'practitioner_already_booked')
  assert.equal((await h.state()).appointments.filter(a => a.client_id === client.id).length, 1, 'nothing is saved while a date conflicts')
  // Moving the conflicting date to a free time books all twelve in one step.
  const booked = await h.cmd('series.book', { ...pattern, occurrences: reviewed.map(o => o.date === second ? { ...o, time: '11:00' } : o.date === '2099-03-09' ? { ...o, date: '2099-03-10' } : o) }, priya.cookie)
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
  await h.cmd('appointment.move', { id: series[0].id, date: '2099-03-09', time: '14:10' }, h.owner, 409)
  await h.cmd('appointment.book', { clientId: client.id, practitionerId: sam.id, serviceId: service.id, date: '2099-03-09', time: '10:00' }, h.owner, 409)
  // Cancel one visit, then this and following from visit eight; the first seven stay exactly as they were.

  await h.cmd('appointment.cancel', { id: series[3].id, reason: 'Patient requested cancellation' })
  assert.equal((await h.cmd('series.cancel_rest', { appointmentId: series[7].id, reason: 'Patient ended the recurring visits' })).cancelled.length, 5)
  const earlier = series.slice(0, 7).map(a => ({ id: a.id, start_at: a.start_at }))
  assert.deepEqual((await visits()).slice(0, 7).map(a => ({ id: a.id, start_at: a.start_at })), earlier)
  assert.deepEqual((await visits()).map(a => a.status), [...Array(3).fill('booked'), 'cancelled', 'booked', 'booked', 'booked', ...Array(5).fill('cancelled')])
  // Whole-series actions include the earlier booked visits even when launched from a later visit.
  const whole = { ...pattern, planId: '', firstDate: '2099-05-04', weeks: 2 }
  const wholePreview = await h.cmd('series.preview', whole)
  const skipped = wholePreview.occurrences.map((o,i) => ({ date: o.date, time: o.time, skip: i === 1 }))
  const wholeBooked = await h.cmd('series.book', { ...whole, occurrences: skipped })
  assert.equal(wholeBooked.skipped.length, 1)
  const wholeVisits = () => h.state().then(s => s.appointments.filter(a => a.series_id === wholeBooked.seriesId).sort((a,b) => a.start_at.localeCompare(b.start_at)))
  const bookedBeforeClosure = await wholeVisits(), closedVisit = bookedBeforeClosure[0]
  const closedDate = brisbane(Date.parse(closedVisit.start_at)).slice(0,10)
  await h.cmd('holiday.save', { date: closedDate, name: 'Newly recorded closure' })
  assert.deepEqual((await wholeVisits()).map(a => [a.id,a.status]), bookedBeforeClosure.map(a => [a.id,a.status]), 'SCHED-003 recording a holiday retains already-booked visits for staff to resolve')
  const closedPreview = await h.cmd('series.preview', { ...whole, occurrences: [{ date:closedDate,time:'09:00' }] })
  assert.equal(closedPreview.occurrences[0].problem, 'clinic_holiday')
  await h.cmd('holiday.save', { date: closedDate, remove: true })
  const tail = (await wholeVisits()).at(-1)
  assert.equal((await h.cmd('series.move_rest', { appointmentId: tail.id, scope: 'all', time: '13:00' }, priya.cookie)).moved, 3)
  assert.ok((await wholeVisits()).every(a => brisbane(Date.parse(a.start_at)).slice(11,16) === '13:00'))
  const detail = (await h.send(`/app?date=${brisbane(Date.parse(tail.start_at)).slice(0,10)}&appt=${tail.id}`, undefined, priya.cookie)).text
  assert.ok(detail.includes('Move the whole series') && detail.includes('Cancel the whole series'))
  assert.ok(detail.includes('Skipped when booked'), 'SCHED-003 skipped dates remain readable on the saved series')
  assert.equal((await h.cmd('series.cancel_rest', { appointmentId: tail.id, scope: 'all', reason: 'Patient ended the recurring visits' }, priya.cookie)).cancelled.length, 3)
  assert.ok((await wholeVisits()).every(a => a.status === 'cancelled'))
  const clinicPage = (await h.send('/app/clinic', undefined, h.owner)).text
  assert.ok(clinicPage.includes('Clinic spring holiday'))
  await h.cmd('holiday.save', { date: '2099-03-09', remove: true })
  await h.cmd('appointment.book', { clientId: client.id, practitionerId: sam.id, serviceId: service.id, date: '2099-03-09', time: '10:00' })

  // Completed visits belong to the series history; whole-series operations act only on its booked visits.
  const source = await pastVisit(h, client.id, priya, service.id)
  const past = (await h.state()).appointments.find(a => a.id === source)
  await h.cmd('appointment.cancel', { id: source, reason: 'Patient requested cancellation' })
  const localPast = brisbane(Date.parse(past.start_at)), futureDate = brisbane(Date.parse(past.start_at) + 7 * 86400_000).slice(0,10)
  const historicalPattern = { clientId:client.id,practitionerId:priya.id,serviceId:service.id,firstDate:localPast.slice(0,10),weeks:2,weekdays:[weekday(localPast.slice(0,10))],time:localPast.slice(11,16),occurrences:[{date:localPast.slice(0,10),time:localPast.slice(11,16)},{date:futureDate,time:localPast.slice(11,16)}] }
  const history = await h.cmd('series.book', historicalPattern)
  await h.cmd('appointment.attend', { id:history.appointmentIds[0] })
  const completedBefore = (await h.state()).appointments.find(a => a.id === history.appointmentIds[0])
  assert.equal((await h.cmd('series.move_rest', { appointmentId:history.appointmentIds[1],scope:'all',time:'16:00' })).moved,1)
  assert.equal((await h.cmd('series.cancel_rest', { appointmentId:history.appointmentIds[1],scope:'all', reason: 'Patient ended the recurring visits' })).cancelled.length,1)
  const completedAfter = (await h.state()).appointments.find(a => a.id === completedBefore.id)
  assert.deepEqual([completedAfter.status,completedAfter.start_at,completedAfter.end_at], [completedBefore.status,completedBefore.start_at,completedBefore.end_at], 'SCHED-003 whole-series moves and cancellations retain completed visits unchanged')

  // A closure follows the clinic's local date across a zone change, including a 25-hour DST day.
  await h.cmd('holiday.save', { date:'2099-11-01',name:'Fall closure' })
  const beforeZone = JSON.parse((await h.state()).settings.holidays).find(x => x.date === '2099-11-01')
  assert.equal(Date.parse(beforeZone.endAt)-Date.parse(beforeZone.startAt),24*3600_000)
  await h.cmd('settings.save', { clinicName:'Riverside Physical Therapy',timeZone:'America/New_York',confirmTimeZone:true })
  const afterZone = JSON.parse((await h.state()).settings.holidays).find(x => x.date === '2099-11-01')
  assert.equal(Date.parse(afterZone.endAt)-Date.parse(afterZone.startAt),25*3600_000, 'SCHED-003 holidays use full clinic-local dates, recalculated when the clinic zone changes')
  assert.notEqual(afterZone.startAt,beforeZone.startAt)
  await h.cmd('appointment.book', { clientId:client.id,practitionerId:sam.id,serviceId:service.id,date:'2099-11-01',time:'10:00' }, h.owner,409)
  await h.cmd('appointment.book', { clientId:client.id,practitionerId:sam.id,serviceId:service.id,date:'2099-11-02',time:'10:00' })

}))

test('INTAKE-001: a canceled visit is offered to the waitlist by email; the first to accept is booked and the others are told it is taken', () => run(async h => {
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
  const cancelled = await h.form(`/app/action?name=appointment.cancel&returnTo=${encodeURIComponent('/app?view=day&date=' + date)}`, { id: visit.appointmentId, reason: 'Patient requested cancellation' }, h.owner)
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
    await h.cmd('appointment.cancel', { id: source.appointmentId, reason: 'Patient requested cancellation' })
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
  const draft=await h.cmd('intake.prepare',{title:'Waitlist renewal',questions:[{id:'update',label:'What has changed?',type:'short',required:true}]})
  const published=await h.cmd('intake.publish',{id:draft.id})
  const source=await h.cmd('appointment.book',{clientId:ava.id,practitionerId:priya.id,serviceId:service.id,date,time:'13:00'})
  await h.cmd('waitlist.add',{clientId:winnerId,practitionerId:priya.id,serviceId:service.id,latestDate:until})
  await h.cmd('appointment.cancel',{id:source.appointmentId,reason:'Patient requested cancellation'})
  const offered=new URL(h.mail.findLast(m=>m.to.includes(winner)&&m.subject.startsWith('A time opened up')).text.match(/https?:\/\/\S+\/offer\/[\w-]+/)[0]).pathname
  const renewal=await h.form(offered,{})
  assert.equal(renewal.status,303);assert.match(renewal.location,/^\/intake\//)
  assert.match((await h.send(renewal.location)).text,/What has changed/)
  assert.equal((await h.form(renewal.location.split('?')[0],{formId:published.id,q_update:'Improved'})).status,303)
  const versions=(await h.send('/api/balm/clients/'+winnerId,undefined,h.owner)).value.intake
  assert.equal(versions.length,2);assert.equal(versions.find(i=>i.formNumber===1).answers.reason,'Follow-up')

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
  await h.cmd('appointment.cancel', { id: visit.appointmentId, reason: 'Patient requested cancellation' })
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
  await h.cmd('appointment.cancel', { id: cancelled, reason: 'Patient requested cancellation' }, h.owner)
  for (const [id, actions] of [[visit, ['booked', 'checked_in', 'attended']], [absent, ['booked', 'no_show']], [cancelled, ['booked', 'cancelled']]]) {
    const page = await h.send(`/app?date=${await visitDate(h, id)}&appt=${id}`, undefined, reception.cookie)
    assert.equal(page.status, 200)
    assert.match(page.text, /Visit history/)
    const history = page.text.match(/<summary>Visit history<\/summary>([\s\S]*?)<\/details>/)[1]
    const entries = [...history.matchAll(/<li>([\s\S]*?)<\/li>/g)].map(m => m[1])
    assert.equal(entries.length, actions.length)
    entries.forEach((entry, index) => {
      assert.ok(entry.startsWith(actions[index].replaceAll('_', ' ') + ' · '))
      assert.match(entry, /(?:owner|taylor|priya)@clinic.example/)
      const at = entry.match(/datetime="([^"]+)"/)[1]
      assert.ok(Number.isFinite(Date.parse(at)) && Math.abs(Date.now() - Date.parse(at)) < 120000, 'the actual change time is exposed')
    })
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

test('SCHED-004: staff and patient moves keep one visit, intake and authorization; reasoned late cancellation proposes a human-confirmed charge once; no-show reaches attendance reports', () => {
  const schedStripe = fakeProviders()
  return run(async h => {
  await h.finishSetup()
  const { service, practitioners: [priya] } = await clinic(h)
  const reception = await h.staff('Rosa', 'reception')
  await h.cmd('pay.stripe.connect', { secretKey: 'sk_test_' + 'a'.repeat(24) })
  await h.cmd('visit_policy.save', { noticeHours: 24, lateCancelFeeCents: 2500, noShowFeeCents: 3000 })
  await h.cmd('visit_policy.save', { noticeHours: 24, lateCancelFeeCents: 2500, noShowFeeCents: 3000 }, reception.cookie, 403)
  const client = await h.cmd('client.save', { firstName: 'Ava', lastName: 'Ng', dateOfBirth: '1992-06-15', email: 'ava@client.example' })
  const date = brisbane(Date.now() + 3 * 86400_000).slice(0, 10)
  const booked = await h.cmd('appointment.book', { clientId: client.id, practitionerId: priya.id, serviceId: service.id, date, time: '10:00' })
  const intakePath = '/intake/' + booked.token, intakePage = await h.send(intakePath)
  assert.equal((await h.form(intakePath, { formId: 'intake-v1', q_reason: 'Follow-up', q_emergency: 'Alex Example +1 202 555 0110', q_consent: 'yes', consentVersion: intakePage.text.match(/name="consentVersion" value="([^"]+)"/)[1], consentAccepted: 'on', signerName: 'Ava Ng', signerRelationship: 'patient', signatureTyped: 'Ava Ng' })).status, 303)
  const payer = await h.cmd('insurance.payer.save', { name: 'Therapy coverage', payerId: 'THERAPY', medicare: false })
  const coverage = { startsOn: brisbane(Date.now() - 30 * 86400_000).slice(0, 10), endsOn: brisbane(Date.now() + 30 * 86400_000).slice(0, 10) }
  const policy = await h.cmd('insurance.policy.save', { clientId: client.id, payerId: payer.id, memberId: 'AVA123', relationship: '18', patientSex: 'F', address: '200 Oak St', city: 'Austin', state: 'TX', postalCode: '78701', ...coverage })
  const authorization = await h.cmd('insurance.authorization.save', { policyId: policy.id, number: 'MOVE10', ...coverage, visits: 10, bookingAction: 'block' })
  const file = async () => (await h.send('/api/balm/clients/' + client.id, undefined, h.owner)).value
  const before = await file()
  await h.cmd('appointment.move', { id: booked.appointmentId, date, time: '11:00' }, reception.cookie)
  const message = h.mail.findLast(m => m.to.includes('ava@client.example') && /\/visit\//.test(m.text))
  assert.ok(message, 'the moved appointment delivers its current private visit link')
  const visitPath = new URL(message.text.match(/https?:\/\/[^\s]+\/visit\/[\w-]+/)[0]).pathname
  const patientPage = await h.send(visitPath)
  assert.equal(patientPage.status, 200)
  const moved = (await h.state()).appointments.find(a => a.id === booked.appointmentId)
  const invalid = new Date(Date.parse(moved.start_at) + 7 * 60_000).toISOString()
  assert.equal((await h.form(visitPath, { action: 'move', start: invalid })).status, 409, 'patient moves refuse off-grid slots')
  const start = new Date(Date.parse(moved.start_at) + 3600_000).toISOString()
  const patientMove = await h.form(visitPath, { action: 'move', start })
  assert.equal(patientMove.status, 303, patientMove.text)
  assert.equal((await h.send(visitPath)).status, 404, 'a moved visit invalidates its old bearer as COMM-001 requires')
  const after = await file(), appointments = (await h.state()).appointments.filter(a => a.client_id === client.id)
  assert.equal(appointments.length, 1)
  assert.equal(appointments[0].id, booked.appointmentId)
  assert.equal(appointments[0].start_at, start)
  const intakeRecord = ({ startAt, ...record }) => record
  assert.deepEqual(after.intake.map(intakeRecord), before.intake.map(intakeRecord), 'SCHED-004 the identical intake identity, version, answers and submission stay linked')
  assert.equal(after.intake[0].startAt, start, 'SCHED-004 the visit-time projection follows the rescheduled appointment')
  const retained = after.insurance.authorizations.find(a => a.id === authorization.id)
  assert.equal(retained.reserved_visits, 1)
  assert.equal(retained.number, 'MOVE10')
  const history = (await h.send(`/app?date=${date}&appt=${booked.appointmentId}`, undefined, h.owner)).text
  assert.match(history, /Patient via private visit link/)
  assert.match(history, /rosa@clinic.example/)
  await h.cmd('appointment.cancel', { id: booked.appointmentId }, reception.cookie, 400)
  await h.cmd('visit_policy.save', { noticeHours: 8760, lateCancelFeeCents: 2500, noShowFeeCents: 3000 })
  const latestVisitMail = h.mail.findLast(m => m.to.includes('ava@client.example') && /\/visit\//.test(m.text))
  const currentVisitPath = new URL(latestVisitMail.text.match(/https?:\/\/[^\s]+\/visit\/[\w-]+/)[0]).pathname
  assert.equal((await h.form(currentVisitPath, { action: 'move', start: new Date(Date.parse(start) + 3600_000).toISOString() })).status, 409, 'the patient must contact the clinic inside the notice window')
  await h.cmd('appointment.cancel', { id: booked.appointmentId, reason: 'Patient requested cancellation due to a schedule conflict' }, reception.cookie)
  const proposal = (await h.state()).visitFees.find(f => f.appointment_id === booked.appointmentId)
  assert.equal(proposal.amount_cents, 2500)
  assert.equal(proposal.payment_id, null)
  assert.equal(schedStripe.calls.filter(c => c.path === '/payment_intents').length, 0)
  const cancelledPage = (await h.send(`/app?date=${date}&appt=${booked.appointmentId}`, undefined, reception.cookie)).text
  assert.match(cancelledPage, /Patient requested cancellation due to a schedule conflict/)
  assert.match(cancelledPage, /rosa@clinic.example/)
  assert.match(cancelledPage, /Nothing has been charged/)
  const approve = { id: proposal.id, confirm: true, authorization: true, authorizationRecord: 'Patient authorized this specific $25 fee by signed consent today' }
  await h.cmd('appointment.fee.confirm', { ...approve, confirm: false }, reception.cookie, 400)
  await h.cmd('appointment.fee.confirm', { ...approve, authorization: false }, reception.cookie, 400)
  await h.cmd('appointment.fee.confirm', approve, priya.cookie, 403)
  const agent = await h.cmd('agent.create', { label: 'Schedule assistant' })
  assert.equal((await h.send('/api/balm/agent/command', { name: 'appointment.fee.confirm', input: approve }, '', { authorization: 'Bearer ' + agent.token })).status, 403)
  const cardLink = await h.cmd('pay.link.create', { clientId: client.id, purpose: 'card', delivery: 'shown' })
  const cardPath = new URL(cardLink.url).pathname
  const setup = await h.form(cardPath + '?do=card', { consent: 'on' })
  assert.equal(setup.status, 303)
  const session = schedStripe.complete(setup.location.split('/').at(-1))
  assert.equal((await h.send(cardPath + '?setup=' + session.id)).status, 200)
  const confirmations = await Promise.all([h.cmd('appointment.fee.confirm', approve, reception.cookie), h.cmd('appointment.fee.confirm', approve, h.owner)])
  assert.ok(confirmations[0].payment.id)
  assert.equal(new Set(confirmations.map(r => r.payment.id)).size, 1)
  await h.cmd('appointment.fee.confirm', approve)
  const charges = schedStripe.calls.filter(c => c.path === '/payment_intents')
  assert.equal(charges.length, 1, 'racing approval and replay charge this proposal exactly once')
  assert.equal(charges[0].body.amount, '2500')
  assert.equal((await file()).billing.ledger.balanceCents, 0, 'the paid fee is matched to its own approved invoice')
  const absent = await pastVisit(h, client.id, priya, service.id)
  await h.cmd('appointment.no_show', { id: absent }, reception.cookie)
  const absenceFee = (await h.state()).visitFees.find(f => f.appointment_id === absent)
  assert.equal(absenceFee.amount_cents, 3000)
  assert.equal(absenceFee.payment_id, null)
  const report = (await h.send(`/api/balm/reports?from=${brisbane(Date.now() - 7 * 86400_000).slice(0, 10)}&to=${date}`, undefined, h.owner)).value
  assert.equal(report.visits.total.noShows, 1)
  assert.equal(schedStripe.calls.filter(c => c.path === '/payment_intents').length, 1, 'no-show marking only proposes its fee')
}, { outbound: request => schedStripe.handler(request) })
})

test('SCHED-006: returning patients book, move and cancel under live clinic rules through portal, reminder and public booking doors', {timeout:120_000}, async()=>{
  const h=await harness()
  try { await (await import('./self-service-journey.mjs')).selfServiceJourney(h) }
  finally { await h.close() }
})

test('SCHED-010: a PT with capacity 2 takes two patients side by side and refuses a third, a race gets one booking, online offers only free times, Medicare overlap is warned and recorded, and imports land overlaps named by capacity', {timeout:120_000}, async()=>{
  await run(async h=>{
    await h.finishSetup()
    const { service: evaluation, practitioners: [priya] } = await clinic(h)
    const reception = await h.staff('Rosa','reception')
    const followUp = await h.cmd('service.save',{name:'PT follow-up',durationMinutes:45,priceCents:9000})
    await h.cmd('capacity.save',{practitionerId:priya.id,capacity:2},reception.cookie,403)
    await h.cmd('capacity.save',{practitionerId:priya.id,capacity:2})
    await h.cmd('capacity.save',{serviceId:followUp.id,capacity:2})
    const day=brisbane(Date.now()+3*86400_000).slice(0,10), at=time=>new Date(`${day}T${time}:00+10:00`).toISOString()
    const patients=[]
    for(const first of ['Ana','Ben','Cy','Dee','Eli','Fay']) patients.push(await h.cmd('client.save',{firstName:first,lastName:'Cap',dateOfBirth:'1980-01-01',email:first.toLowerCase()+'@patient.example'}))
    const book=(client,time,extra={},cookie=reception.cookie)=>h.send('/api/balm/command',{name:'appointment.book',input:{clientId:client.id,practitionerId:priya.id,serviceId:followUp.id,date:day,time,...extra}},cookie)
    // Two at 9:00 succeed and sit side by side; a third, or a capacity-1 evaluation, is refused.
    const first=await book(patients[0],'09:00'), second=await book(patients[1],'09:00')
    assert.deepEqual([first.status,second.status],[200,200],second.text)
    assert.equal((await book(patients[2],'09:00')).value.code,'practitioner_already_booked')
    assert.equal((await book(patients[2],'09:15',{serviceId:evaluation.id})).value.code,'practitioner_already_booked','the evaluation service keeps capacity 1')
    const calendar=(await h.send(`/app?view=day&date=${day}&id=${priya.id}`,undefined,reception.cookie)).text
    const lanes=calendar.match(/<div class="overlap [^"]*">([\s\S]*?)<\/div><\/div>/)
    assert.ok(lanes&&(lanes[0].match(/class="overlap-lane"/g)||[]).length===2,'two lanes in the practitioner’s column')
    for(const v of [first,second]) assert.ok(calendar.includes(v.value.result.appointmentId),'both visits are in the column')
    // Moving into the full 9:00 is refused as booking is.
    const later=(await book(patients[2],'11:00')).value.result
    assert.equal((await h.send('/api/balm/command',{name:'appointment.move',input:{id:later.appointmentId,date:day,time:'09:00'}},reception.cookie)).value.code,'practitioner_already_booked')
    // Race two staff bookings for the last 11:00 place: exactly one succeeds.
    const raced=await Promise.all([book(patients[3],'11:00'),book(patients[4],'11:00',{},h.owner)])
    assert.deepEqual(raced.map(r=>r.status).sort(),[200,409])
    // /book and the portal offer only times with no live visit: 9:00 is not offered, nor 13:00 with one patient booked.
    await book(patients[5],'13:00')
    let offered=await slots(h,followUp.id,priya.id)
    assert.ok(offered.length&&!offered.includes(at('09:00'))&&!offered.includes(at('13:00'))&&offered.includes(at('14:00')))
    await pastVisit(h,patients[0].id,priya,evaluation.id)
    const portal=await portalLogin(h,'ana@patient.example')
    const portalPage=(await h.send(`/portal/schedule?serviceId=${followUp.id}&practitionerId=${priya.id}&from=${day}`,undefined,portal)).text
    assert.ok(portalPage.includes(`value="${at('14:00')}"`)&&!portalPage.includes(`value="${at('09:00')}"`)&&!portalPage.includes(`value="${at('13:00')}"`),'portal offers the same free times')
    // Online double-booking on: times with a place left are offered; full ones still are not.
    await h.cmd('capacity.save',{serviceId:followUp.id,capacity:2,onlineDoubleBooking:'on'})
    offered=await slots(h,followUp.id,priya.id)
    assert.ok(offered.includes(at('13:00'))&&!offered.includes(at('09:00'))&&!offered.includes(at('11:00')))
    await h.cmd('capacity.save',{serviceId:followUp.id,capacity:2})
    // Two Medicare patients at 10:00: warned before saving, booked anyway, recorded on both visits.
    const payer=await h.cmd('insurance.payer.save',{name:'Medicare Part B',payerId:'MEDICARE',receiverId:'CMS',unitMethod:'cms',medicare:true})
    const medicare=[]
    for(const first of ['Mo','Ned']){
      const c=await h.cmd('client.save',{firstName:first,lastName:'Medicare',dateOfBirth:'1950-01-01'})
      await h.cmd('insurance.policy.save',{clientId:c.id,payerId:payer.id,memberId:first+'1EG4TE5MK72',relationship:'18',patientSex:'M',address:'1 Main St',city:'Austin',state:'TX',postalCode:'78701',startsOn:'2026-01-01',endsOn:'2027-12-31'})
      medicare.push(c)
    }
    const m1=await book(medicare[0],'10:00',{acknowledgeInsurance:'on'})
    assert.equal(m1.status,200,m1.text)
    const warned=await book(medicare[1],'10:00',{acknowledgeInsurance:'on'})
    assert.equal(warned.value.code,'medicare_overlap_warning')
    const m2=await book(medicare[1],'10:00',{acknowledgeInsurance:'on',acknowledgeMedicareOverlap:'on'})
    assert.equal(m2.status,200,m2.text)
    for(const [c,own,other] of [[medicare[0],m1,m2],[medicare[1],m2,m1]]){
      const visit=(await h.send('/api/balm/clients/'+c.id,undefined,h.owner)).value.appointments.find(a=>a.id===own.value.result.appointmentId)
      assert.deepEqual(visit.medicareOverlaps.map(o=>[o.other,o.by]),[[other.value.result.appointmentId,reception.email]])
    }
    assert.match((await h.send('/app/clients/'+medicare[0].id,undefined,reception.cookie)).text,/booked anyway by rosa@clinic\.example/)
  })
  // Migrated WebPT scheduler visits land as booked; overlap beyond capacity is named, never refused.
  await run(async h=>{
    await h.finishSetup()
    const { service, practitioners: [therapist] } = await clinic(h)
    await h.cmd('settings.save', { clinicName: 'Lakeview Therapy', timeZone: 'America/Chicago', taxId: '36-4829175', address: '100 Example Street, Chicago IL' })
    const input = { provider: 'webpt', practitionerId: therapist.id, serviceId: service.id, files: [
      { kind: 'appointments', name: 'Scheduled Visits.csv', csv: await readFile('tests/fixtures/movein/webpt-scheduled-visits-native.csv', 'utf8') },
      { kind: 'patients', name: 'Patient Lists.csv', csv: await readFile('tests/fixtures/movein/webpt-patient-lists-native.csv', 'utf8') } ] }
    await h.cmd('capacity.save',{practitionerId:therapist.id,capacity:2}); await h.cmd('capacity.save',{serviceId:service.id,capacity:2})
    assert.ok(!(await h.cmd('movein.preview', input)).diagnostics.some(d=>d.code==='imported_overlap'),'within capacity 2 the 9:00 pair is not named')
    await h.cmd('capacity.save',{practitionerId:therapist.id,capacity:1})
    const preview=await h.cmd('movein.preview', input)
    const named=preview.diagnostics.filter(d=>d.code==='imported_overlap')
    assert.equal(named.length,1); assert.match(named[0].message,/row 3.*row 4.*capacity of 1/)
    await h.cmd('movein.apply', { ...input, fingerprint: preview.fingerprint, acceptanceReason: 'Both 9:00 visits were booked this way in WebPT; the aide supervises the second.' })
    const charts=await Promise.all(preview.patients.map(p=>h.send('/api/balm/clients/'+p.id,undefined,h.owner)))
    assert.equal(charts.flatMap(c=>c.value.appointments).filter(a=>a.status==='booked').length,2,'both overlapping visits landed')
  })
})

test('BALM-001 / SCHED-002: rooms and equipment refuse a second booking, drag moves keep history under diary authority, the week shows each visit’s intake, authorization and balance flags, capacity visits sit side by side, and the day sheet prints and exports', {timeout:120_000}, () => run(async h => {
  await h.finishSetup()
  const { service, practitioners: [priya, sam, lee] } = await clinic(h, ['Priya', 'Sam', 'Lee'])
  const reception = await h.staff('Rosa', 'reception')
  const room = await h.cmd('room.save', { name: 'Treatment room 1' }), alterG = await h.cmd('equipment.save', { name: 'AlterG' })
  await h.cmd('equipment.save', { name: 'Pool' }, reception.cookie, 403)
  const [ava, ben, cara, dan, eve] = await Promise.all(['Ava', 'Ben', 'Cara', 'Dan', 'Eve'].map(first => h.cmd('client.save', { firstName: first, lastName: 'Sched', dateOfBirth: '1985-05-05' })))
  const day = brisbane(Date.now() + 3 * 86400_000).slice(0, 10)
  const book = (client, p, time, extra = {}) => h.send('/api/balm/command', { name: 'appointment.book', input: { clientId: client.id, practitionerId: p.id, serviceId: service.id, date: day, time, ...extra } }, reception.cookie)
  // One room, one visit at a time: Sam cannot take the room Priya holds at 9:00.
  const avaVisit = (await book(ava, priya, '09:00', { roomId: room.id })).value.result.appointmentId
  assert.equal((await book(ben, sam, '09:00', { roomId: room.id })).value.code, 'room_in_use')
  // Equipment too: the AlterG is Ben's from 9:00 to 9:45, so Cara's 9:30 is refused and her 10:00 is not.
  const benVisit = (await book(ben, sam, '09:00', { equipmentId: alterG.id })).value.result.appointmentId
  assert.equal((await book(cara, lee, '09:30', { equipmentId: alterG.id })).value.code, 'equipment_in_use')
  const caraVisit = (await book(cara, lee, '10:00', { equipmentId: alterG.id })).value.result.appointmentId
  // The equipment column shows both AlterG visits; the move form the drag script submits names the equipment.
  const machine = (await h.send(`/app?view=day&by=equipment&date=${day}&id=${alterG.id}`, undefined, reception.cookie)).text
  assert.ok(machine.includes(`data-id="${benVisit}"`) && machine.includes(`data-id="${caraVisit}"`) && !machine.includes(`data-id="${avaVisit}"`))
  assert.match(machine, /<form id="move-form"[^>]*>.*<input name="equipmentId">/)
  // A drag onto a taken AlterG time is refused; onto 11:00 it moves, and the visit's history shows who moved it from when.
  const drag = (cookie, fields) => h.form(`/app/action?name=appointment.move&returnTo=${encodeURIComponent(`/app?view=day&by=equipment&date=${day}`)}`, fields, cookie)
  const version = async id => (await h.send(`/app?view=day&date=${day}`, undefined, reception.cookie)).text.match(new RegExp(`data-id="${id}" data-version="(\\d+)"`))[1]
  assert.notEqual((await drag(reception.cookie, { id: caraVisit, version: await version(caraVisit), date: day, time: '09:15', equipmentId: alterG.id })).status, 303)
  assert.equal((await drag(reception.cookie, { id: caraVisit, version: await version(caraVisit), date: day, time: '11:00', equipmentId: alterG.id })).status, 303)
  const moved = (await h.send(`/app?view=day&date=${day}&appt=${caraVisit}`, undefined, reception.cookie)).text
  assert.match(moved, /Visit history[\s\S]*moved · rosa@clinic\.example \(reception\)[\s\S]*T00:00:00\.000Z -&gt; \S*T01:00:00\.000Z/)
  // Drag authority: Lee drags only Lee's own visits, cannot see Priya's, and cannot drop a visit into Priya's diary.
  const leePage = (await h.send(`/app?view=day&date=${day}`, undefined, lee.cookie)).text
  assert.ok(leePage.includes(`draggable="true" data-id="${caraVisit}"`) && !leePage.includes(avaVisit))
  await h.cmd('appointment.move', { id: avaVisit, date: day, time: '12:00' }, lee.cookie, 404)
  await h.cmd('appointment.move', { id: caraVisit, date: day, time: '12:00', practitionerId: priya.id }, lee.cookie, 403)
  // Flags: Ava's authorization counts her attended and booked visits; Ben owes an approved invoice; Dan's intake is in.
  await h.cmd('insurance.settings.save', { billingNpi: '1234567893', taxId: '123456789', address: '100 Main St', city: 'Austin', state: 'TX', postalCode: '78701', senderId: 'BALMTEST', contactName: 'Jordan Clinic', contactPhone: '5125550100' })
  const payer = await h.cmd('insurance.payer.save', { name: 'Aetna', payerId: '60054', receiverId: 'AETNA' })
  const year = new Date().getUTCFullYear(), coverage = { startsOn: `${year - 1}-01-01`, endsOn: `${year + 1}-12-31` }
  const policy = await h.cmd('insurance.policy.save', { clientId: ava.id, payerId: payer.id, memberId: 'AVA123', relationship: '18', patientSex: 'F', address: '200 Oak St', city: 'Austin', state: 'TX', postalCode: '78701', ...coverage })
  await h.cmd('insurance.authorization.save', { policyId: policy.id, number: 'AUTH12', ...coverage, visits: 12 })
  await h.cmd('appointment.attend', { id: await pastVisit(h, ava.id, priya, service.id) })
  const owed = await pastVisit(h, ben.id, sam, service.id)
  await h.cmd('appointment.attend', { id: owed })
  await h.cmd('invoice.approve', { id: (await h.cmd('invoice.prepare', { appointmentId: owed })).id })
  const online = await bookOnline(h, service.id, lee.id, (await slots(h, service.id, lee.id))[0], { firstName: 'Dan', lastName: 'Sched', dateOfBirth: '1985-05-05', email: 'dan@client.example' })
  const intake = await h.send(online.location)
  assert.equal((await h.form(online.location, { formId: 'intake-v1', q_reason: 'Hip pain', q_emergency: 'Kim 0400', q_consent: 'yes', consentVersion: intake.text.match(/name="consentVersion" value="([^"]+)"/)[1], consentAccepted: 'on', signerName: 'Dan Sched', signerRelationship: 'patient', signatureTyped: 'Dan Sched' })).status, 303)
  const danVisit = (await h.state(reception.cookie)).appointments.find(a => a.booked_via === 'online').id
  const danDay = brisbane(Date.parse((await h.state(reception.cookie)).appointments.find(a => a.id === danVisit).start_at)).slice(0, 10)
  const card = (page, id) => page.match(new RegExp(`<a class="appt[^"]*"[^>]*appt=${id}[\\s\\S]*?</a>`))?.[0] ?? ''
  // The week view for each of the three practitioners carries every visit's flags.
  const week = async (p, date = day) => (await h.send(`/app?view=week&date=${date}&id=${p.id}`, undefined, reception.cookie)).text
  const [priyaWeek, samWeek, leeWeek] = [await week(priya), await week(sam), await week(lee, danDay)]
  assert.match(card(priyaWeek, avaVisit), /10 of 12 visits left/)
  assert.match(card(priyaWeek, avaVisit), /Intake due/)
  assert.match(card(samWeek, benVisit), /\$95\.00 owed/)
  assert.match(card(samWeek, benVisit), /AlterG/)
  assert.match(card(leeWeek, danVisit), /Intake in/)
  assert.doesNotMatch((await h.send(`/app?view=week&date=${day}`, undefined, sam.cookie)).text, /\d owed/, 'balances stay with the desk')
  // BALM-001: only the owner grants/revokes a named practitioner's scoped balance access.
  await h.cmd('pay.copay.save', { clientId: ben.id, copay: '30.00' })
  await h.cmd('insurance.eligibility.record', { policyId: policy.id, serviceDate: day, status: 'active', copayCents: 3000, source: 'Payer provider portal reference 24' })
  const clinicalInsurance = (await h.send('/api/balm/clients/' + ava.id, undefined, priya.cookie)).value.insurance
  assert.ok(!('copay_cents' in clinicalInsurance.policies[0]))
  assert.equal(clinicalInsurance.eligibility[0].benefits.manual.copayCents, null)
  const financialFile = async cookie => (await h.send('/api/balm/clients/' + ben.id, undefined, cookie)).value
  assert.equal((await financialFile(h.owner)).client.copay_cents, 3000)
  assert.equal((await financialFile(reception.cookie)).billing.copayCents, 3000)
  assert.ok(!('copay_cents' in (await financialFile(sam.cookie)).client))
  for (const cookie of [sam.cookie, reception.cookie]) await h.cmd('staff.balance_access', { id: sam.id, enabled: true }, cookie, 403)
  const grant = () => h.form('/app/action?name=staff.balance_access&returnTo=%2Fapp%2Fclinic', { id: sam.id, enabled: 'true' }, h.owner)
  assert.equal((await grant()).status, 303)
  assert.match((await h.send(`/app?view=week&date=${day}`, undefined, sam.cookie)).text, /\$95\.00 owed/)
  const grantedFile = await financialFile(sam.cookie)
  assert.equal(grantedFile.billing.balanceCents, 9500)
  assert.ok(!('copay_cents' in grantedFile.client) && !('copayCents' in grantedFile.billing) && !('card' in grantedFile.billing))
  await h.cmd('pay.invoice.charge', { invoiceId: 'no-invoice' }, sam.cookie, 403)
  const samSheet = await h.send(`/api/balm/day-sheet.csv?date=${day}`, undefined, sam.cookie)
  assert.ok(samSheet.text.includes('Ben Sched') && samSheet.text.includes('Balance owed') && samSheet.text.includes('$95.00') && !samSheet.text.includes('Ava Sched'))
  assert.match((await h.send(`/api/balm/day-sheet.html?date=${day}`, undefined, sam.cookie)).text, /Balance owed[\s\S]*\$95\.00/)
  assert.doesNotMatch((await h.send(`/api/balm/day-sheet.csv?date=${day}`, undefined, lee.cookie)).text, /Balance owed/)
  await h.cmd('staff.balance_access', { id: sam.id, enabled: false })
  assert.doesNotMatch((await h.send(`/app?view=week&date=${day}`, undefined, sam.cookie)).text, /\d owed/)
  assert.doesNotMatch((await h.send(`/api/balm/day-sheet.csv?date=${day}`, undefined, sam.cookie)).text, /Balance owed/)
  assert.ok(!('balanceCents' in (await financialFile(sam.cookie)).billing))
  const accessAudit = await h.db.prepare("SELECT action,actor_email,subject_id FROM bm_audit WHERE action LIKE 'staff.balance_visibility_%' ORDER BY sequence").all()
  assert.deepEqual(accessAudit.results.map(a => [a.action, a.actor_email, a.subject_id]), [['staff.balance_visibility_granted', 'owner@clinic.example', sam.id], ['staff.balance_visibility_revoked', 'owner@clinic.example', sam.id]])
  // Capacity 2: two patients at 13:00 sit side by side in Priya's column.
  await h.cmd('capacity.save', { practitionerId: priya.id, capacity: 2 }); await h.cmd('capacity.save', { serviceId: service.id, capacity: 2 })
  const pair = [(await book(dan, priya, '13:00')).value.result.appointmentId, (await book(eve, priya, '13:00')).value.result.appointmentId]
  const column = (await h.send(`/app?view=day&date=${day}&id=${priya.id}`, undefined, reception.cookie)).text.match(/<div class="overlap [^"]*">([\s\S]*?)<\/div><\/div>/)?.[0] ?? ''
  assert.equal((column.match(/class="overlap-lane"/g) ?? []).length, 2)
  for (const id of pair) assert.ok(column.includes(`appt=${id}`))
  // The day sheet prints and exports the same day; a practitioner's lists only their own visits; an agent key is refused.
  const printed = await h.send(`/api/balm/day-sheet.html?date=${day}`, undefined, reception.cookie)
  assert.equal(printed.status, 200); assert.match(printed.headers.get('content-type'), /text\/html/)
  assert.ok(['Ava Sched', 'Ben Sched', 'Cara Sched', 'AlterG', 'Treatment room 1', '10 of 12 visits left (AUTH12'].every(text => printed.text.includes(text)))
  const csv = await h.send(`/api/balm/day-sheet.csv?date=${day}&by=equipment&id=${alterG.id}`, undefined, reception.cookie)
  assert.match(csv.headers.get('content-disposition'), new RegExp(`balm-day-sheet-${day}\\.csv`))
  const lines = csv.text.trim().split('\r\n')
  assert.equal(lines[0], '"Time","Patient","Practitioner","Service","Room","Equipment","Status","Intake","Authorization","Payer","Balance owed"')
  assert.deepEqual(lines.slice(1).map(l => l.split(',')[1]), ['"Ben Sched"', '"Cara Sched"'])
  assert.match(lines[1], /"\$95\.00"$/)
  const own = await h.send(`/api/balm/day-sheet.csv?date=${day}`, undefined, lee.cookie)
  assert.ok(own.text.includes('Cara Sched') && !own.text.includes('Ava Sched') && !own.text.includes('Balance owed'))
  const key = await h.cmd('agent.create', { label: 'Desk agent' })
  await h.cmd('staff.balance_access', { id: sam.id, enabled: true }, '', 401, { authorization: 'Bearer ' + key.token })
  assert.equal((await h.send(`/api/balm/day-sheet.csv?date=${day}`, undefined, '', { authorization: 'Bearer ' + key.token })).status, 401, 'an agent key is not a staff sign-in')
}))

test('SCHED-007: service and location rules govern public, portal, staff and series availability with padded race refusal',()=>run(async h=>{
 const {serviceAvailabilityJourney}=await import('./service-availability-journey.mjs')
 await serviceAvailabilityJourney(h)
}))
