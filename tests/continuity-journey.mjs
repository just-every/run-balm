import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { clinic } from './clinic.mjs'

export async function continuityFixture(h, options = {}) {
  await h.finishSetup()
  const { service, practitioners: [priya] } = await clinic(h, ['ContinuityClinician'])
  await h.cmd('staff.save', { id: priya.id, name: 'Priya Shah', email: priya.email, role: 'practitioner', credentials: 'PT', active: true })
  const patient = await h.cmd('client.save', { firstName: 'Synthetic', lastName: 'Continuity', dateOfBirth: '1980-01-01', email: ['synthetic-balm-204','patient.example'].join('@') })
  const startsOn = '2099-03-01', endsOn = '2099-05-01'
  const initial = await h.cmd('appointment.book', { clientId: patient.id, practitionerId: priya.id, serviceId: service.id, date: '2099-02-28', time: '09:00' })
  const payer = await h.cmd('insurance.payer.save', { name: 'Synthetic continuity payer', payerId: 'SYNTH', unitMethod: 'cms', fees: [] })
  const policy = await h.cmd('insurance.policy.save', { clientId: patient.id, payerId: payer.id, memberId: 'synthetic-balm-201', relationship: '18', patientSex: 'F', address: '1 Synthetic St', city: 'Austin', state: 'TX', postalCode: '78701', startsOn, endsOn })
  const authInput = { policyId: policy.id, number: 'synthetic-balm-202', startsOn, endsOn, visits: 5, bookingAction: 'warn' }
  const authorization = await h.cmd('insurance.authorization.save', authInput)
  const planInput = { clientId: patient.id, diagnoses: 'Synthetic knee rehabilitation', shortTermGoals: 'Comfortable stairs', longTermGoals: 'Return to activity', frequencyPerWeek: 2, durationWeeks: 6, interventions: 'Therapeutic exercise', startDate: startsOn, physicianName: 'Synthetic Physician', physicianEmail: ['synthetic-balm-203', 'physician.example'].join('@'), signature: 'Priya Shah', credentials: 'PT', attest: true }
  const plan = await h.cmd('plan.send', planInput, priya.cookie)
  const seriesInput = { clientId: patient.id, practitionerId: priya.id, serviceId: service.id, planId: plan.id, weekdays: [0, 2], time: '10:00' }
  const preview = await h.cmd('series.preview', seriesInput, priya.cookie)
  const booked = await h.cmd('series.book', { ...seriesInput, occurrences: preview.occurrences.map((o, i) => ({ date: o.date, time: o.time, skip: i >= 3 })) }, priya.cookie)
  await h.cmd('appointment.cancel', { id: booked.appointmentIds[0], reason: 'Synthetic cancellation one' }, priya.cookie)
  if (options.oneCancellation !== true) await h.cmd('appointment.cancel', { id: booked.appointmentIds[1], reason: 'Synthetic cancellation two' }, priya.cookie)
  return { priya, service, patient, initial, planInput, plan, seriesInput, preview, booked, authorization, authInput, policy }
}

export async function continuityJourney(h, proof = async () => {}) {
  const f = await continuityFixture(h, { oneCancellation: true })
  const { patient, priya, service, booked } = f
  const input = { seriesId: booked.seriesId }, read = () => h.cmd('continuity.read', { clientId: patient.id }, priya.cookie)
  await h.cmd('continuity.prepare', input, priya.cookie, 409)
  await h.cmd('appointment.cancel', { id: booked.appointmentIds[1], reason: 'Synthetic cancellation two' }, priya.cookie)
  await proof({ stage: 'prepare', f })
  const before = await h.state(), egress = h.outboundRequests.length
  const prepared = await h.cmd('continuity.prepare', input, priya.cookie)
  assert.equal(prepared.digest, createHash('sha256').update(JSON.stringify(prepared.payload)).digest('hex'))
  assert.deepEqual(prepared.payload.occurrences.map(o => o.date), ['2099-03-10', '2099-03-15'])
  assert.deepEqual(prepared.payload.authorization.map(a => [a.total, a.used, a.reserved, a.remaining, a.proposed, a.afterBooking]), [[5, 0, 1, 4, 2, 2]])
  assert.equal(prepared.payload.cancellations.length, 2)
  assert.equal((await h.cmd('continuity.prepare', input, priya.cookie)).id, prepared.id)
  assert.equal((await read()).proposals.length, 1)
  await proof({ stage: 'review', f, prepared })
  const approve = { id: prepared.id, digest: prepared.digest, confirm: true }
  await h.cmd('continuity.approve', { ...approve, digest: 'changed' }, priya.cookie, 409)
  const desk = await h.staff('ContinuityDesk', 'reception')
  const other = await h.staff('ContinuityOther', 'practitioner')
  const biller = await h.staff('ContinuityBiller', 'biller')
  for (const person of [desk, biller, other]) {
    for (const [name, fields] of [['continuity.prepare', input], ['continuity.approve', approve], ['continuity.read', { clientId: patient.id }]]) {
      const r = await h.send('/api/balm/command', { name, input: fields }, person.cookie)
      assert.ok([403, 404].includes(r.status), r.text)
      assert.ok(!r.text.includes(prepared.digest), 'no clinical review bytes in a refusal')
    }
    const page = await h.send('/api/balm/clients/' + patient.id, undefined, person.cookie)
    assert.ok(!page.text.includes(prepared.digest))
  }
  const key = await h.cmd('agent.create', { label: 'Synthetic scheduling key', scopes: ['appointments.read'] })
  const agent = await h.send('/api/balm/agent/command', { name: 'continuity.prepare', input }, '', { authorization: 'Bearer ' + key.token })
  assert.equal(agent.status, 403)
  assert.ok(!agent.text.includes(prepared.digest))
  // Current coverage changes invalidate the exact review, even when ordinary
  // booking would only warn about exhaustion.
  await h.cmd('insurance.authorization.save', { ...f.authInput, id: f.authorization.id, visits: 1 })
  await h.cmd('continuity.approve', approve, priya.cookie, 409)
  await h.cmd('continuity.prepare', input, priya.cookie, 409)
  await h.cmd('insurance.authorization.save', { ...f.authInput, id: f.authorization.id })
  const refreshed = await h.cmd('continuity.prepare', input, priya.cookie)
  const refreshedApproval = { id: refreshed.id, digest: refreshed.digest, confirm: true }
  // A competing patient consumes capacity, so approval must not silently choose
  // new dates under the old review.
  const rival = await h.cmd('client.save', { firstName: 'Synthetic', lastName: 'Capacity' })
  const competing = await h.cmd('appointment.book', { clientId: rival.id, practitionerId: priya.id, serviceId: service.id, date: refreshed.payload.occurrences[0].date, time: '10:00' })
  await h.cmd('continuity.approve', refreshedApproval, priya.cookie, 409)
  await h.cmd('appointment.cancel', { id: competing.appointmentId, reason: 'Synthetic capacity released' })
  // Patient waitlist preferences are facts, never inferred consent. A new
  // preference refuses the reviewed sequence and the new preparation follows it.
  const wait = await h.cmd('waitlist.add', { clientId: patient.id, practitionerId: priya.id, serviceId: service.id, earliestDate: '2099-03-01', latestDate: '2099-04-20', weekdays: [2], timeFrom: '10:00', timeUntil: '10:45' })
  await h.cmd('continuity.approve', refreshedApproval, priya.cookie, 409)
  const waiting = await h.cmd('continuity.prepare', input, priya.cookie)
  assert.deepEqual(waiting.payload.occurrences.map(o => o.date), ['2099-03-10', '2099-03-17'])
  assert.equal(waiting.payload.waitlist[0].id, wait.id)
  const finalApprove = { id: waiting.id, digest: waiting.digest, confirm: true }
  const result = await h.cmd('continuity.approve', finalApprove, priya.cookie)
  assert.deepEqual([result.approved, result.booked, result.reserved, result.outbound], [true, false, false, false])
  await h.cmd('continuity.approve', finalApprove, priya.cookie, 409)
  await proof({ stage: 'approved', f, prepared: waiting })
  const history = (await read()).proposals.find(p => p.id === waiting.id)
  assert.equal(history.approved_by, priya.email)
  assert.deepEqual(history.payload, waiting.payload)
  const after = await h.state()
  assert.equal(after.appointments.filter(a => a.client_id === patient.id).length, before.appointments.filter(a => a.client_id === patient.id).length, 'approval adds no visit')
  assert.equal((await h.send('/api/balm/clients/' + patient.id, undefined, priya.cookie)).value.insurance.authorizations[0].reserved_allowance, 1)
  assert.equal((await h.db.prepare('SELECT COUNT(*) AS n FROM bm_booking_payments').first()).n, 0)
  assert.equal((await h.db.prepare('SELECT COUNT(*) AS n FROM bm_offers').first()).n, 0)
  assert.ok(h.outboundRequests.slice(egress).every(r => r.pathname === '/emails'), 'no booking or text provider effect')
  assert.equal(h.mail.filter(m => !m.subject.includes('invited') && m.to.includes(['synthetic-balm-203','physician.example'].join('@'))).length, 1, 'only the earlier plan send reached the physician')
  await h.cmd('client.erase', { id: patient.id }, h.owner, 409)
  const unitInput = {...f.authInput,id:f.authorization.id,allowanceKind:'units',units:10,unitsPerVisit:3}
  await h.cmd('insurance.authorization.save',unitInput)
  const countBeforeRace=(await read()).proposals.length
  await h.cmd('continuity.prepare',input,priya.cookie,409,{'x-synthetic-session-revoke':priya.email})
  priya.cookie=await h.signIn(priya.email)
  assert.equal((await read()).proposals.length,countBeforeRace,'revocation in the preparation batch stores nothing')
  const units=await h.cmd('continuity.prepare',input,priya.cookie)
  assert.deepEqual(units.payload.authorization.map(a=>[a.total,a.used,a.reserved,a.remaining,a.proposed,a.afterBooking]),[[10,0,3,7,6,1]],'unit allowance counts the existing visit and both proposed reservations independently')
  const unitApproval={id:units.id,digest:units.digest,confirm:true}
  await h.cmd('continuity.approve',unitApproval,priya.cookie,409,{'x-synthetic-revoke':priya.email})
  priya.cookie=await h.signIn(priya.email)
  assert.equal((await read()).proposals.find(p=>p.id===units.id).approved_at,null,'revocation in approval batch records no approval')
  await h.cmd('continuity.approve',unitApproval,priya.cookie)
  const refusedRead=await h.send('/api/balm/command',{name:'continuity.read',input:{clientId:patient.id}},priya.cookie,{'x-synthetic-session-revoke':priya.email})
  assert.equal(refusedRead.status,409)
  assert.ok(!refusedRead.text.includes(units.digest),'revoked reads expose no proposal')
  priya.cookie=await h.signIn(priya.email)
  await h.cmd('hours.save',{practitionerId:other.id,hours:[0,1,2,3,4,5,6].map(weekday=>({weekday,start:'00:00',end:'24:00'}))})
  await h.cmd('appointment.book',{clientId:patient.id,practitionerId:other.id,serviceId:service.id,date:'2099-02-27',time:'09:00',acknowledgeInsurance:'on'})
  await h.cmd('plan.send',{...f.planInput,signature:'ContinuityOther',credentials:'PT'},other.cookie)
  await h.cmd('continuity.prepare',input,priya.cookie,409)
  const otherFile=await h.send('/api/balm/clients/'+patient.id,undefined,other.cookie)
  assert.equal(otherFile.status,200)
  assert.ok(!otherFile.text.includes(waiting.digest),'a second treating clinician still cannot see another clinician’s preparation')
  await h.cmd('plan.send', { ...f.planInput, frequencyPerWeek: 1 }, priya.cookie)
  await h.cmd('continuity.prepare', input, priya.cookie, 409)
  await h.cmd('continuity.approve', refreshedApproval, priya.cookie, 409)
  const expired = await h.cmd('plan.send', { ...f.planInput, startDate: '2000-01-01' }, priya.cookie)
  const expiredSeries = await h.cmd('series.preview', { ...f.seriesInput, planId: expired.id }, priya.cookie)
  assert.ok(expiredSeries.conflicts > 0)
  // Expiry is tested on a historically recorded series, with unchanged clinical
  // bytes; ordinary users cannot edit a signed plan to evade this refusal.
  const oldSeriesId = 'synthetic-balm-expired-series'
  await h.db.prepare('INSERT INTO bm_series SELECT ?,client_id,practitioner_id,service_id,room_id,?,skipped,created_at,created_by FROM bm_series WHERE id=?').bind(oldSeriesId, JSON.stringify({ firstDate: '2000-01-01', weekdays: [0, 2], weeks: 6, time: '10:00', planId: expired.id, planSha256: (await h.db.prepare('SELECT content_sha256 FROM bm_plans_of_care WHERE id=?').bind(expired.id).first()).content_sha256 }), booked.seriesId).run()
  const expiryRefusal = await h.cmd('continuity.prepare', { seriesId: oldSeriesId }, priya.cookie, 409)
  assert.equal(expiryRefusal.code, 'continuity_plan_expired')
  await h.send('/auth/signout', {}, priya.cookie)
  await h.cmd('continuity.prepare', input, priya.cookie, 401)
  await h.cmd('continuity.approve', refreshedApproval, priya.cookie, 401)
  return { ...f, prepared: waiting }
}

export async function continuityCoverageJourney(h) {
  const f = await continuityFixture(h)
  const input = { seriesId: f.booked.seriesId }, dates = ['2099-03-10', '2099-03-15']
  const prepare = async () => {
    const p = await h.cmd('continuity.prepare', input, f.priya.cookie)
    assert.deepEqual(p.payload.occurrences.map(o => o.date), dates)
    assert.deepEqual(p.payload.authorization.map(a => [a.total, a.used, a.reserved, a.proposed, a.afterBooking]), [[5, 0, 1, 2, 2]])
    assert.equal(p.payload.policy.id, f.policy.id)
    return p
  }
  await prepare()

  // Native service defaults are CPT strings, including when scope is restricted.
  await h.cmd('service.save', { id: f.service.id, cptDefaults: ['97110'] })
  const scoped = { ...f.authInput, id: f.authorization.id, cptScope: ['97110'] }
  await h.cmd('insurance.authorization.save', scoped)
  const matching = await prepare()
  assert.deepEqual(matching.payload.authorization[0].scope, '["97110"]')
  await h.cmd('insurance.authorization.save', { ...scoped, cptScope: ['97530'] })
  await h.cmd('continuity.prepare', input, f.priya.cookie, 409)
  await h.cmd('continuity.approve', { id: matching.id, digest: matching.digest, confirm: true }, f.priya.cookie, 409)
  await h.cmd('insurance.authorization.save', scoped)

  // A retained expired primary policy does not compete with dated coverage.
  const payer = await h.cmd('insurance.payer.save', { name: 'Synthetic historical payer', payerId: 'SYNOLD', unitMethod: 'cms', fees: [] })
  await h.cmd('insurance.policy.save', { clientId: f.patient.id, payerId: payer.id, memberId: 'synthetic-balm-205', relationship: '18', patientSex: 'F', address: '1 Synthetic St', city: 'Austin', state: 'TX', postalCode: '78701', startsOn: '2000-01-01', endsOn: '2000-12-31' })
  await prepare()

  // A nonoverlapping OT visit belongs to a different episode, so it cannot
  // consume this plan's twice-weekly PT cadence or its authorization.
  const episode = await h.cmd('episode.open', { clientId: f.patient.id, title: 'Synthetic OT episode', start: 'direct_access' })
  const ot = await h.staff('SyntheticOT', 'practitioner', { discipline: 'ot' })
  await h.cmd('hours.save', { practitionerId: ot.id, hours: [0, 1, 2, 3, 4, 5, 6].map(weekday => ({ weekday, start: '00:00', end: '24:00' })) })
  const service = await h.cmd('service.save', { name: 'Synthetic OT service', durationMinutes: 45, priceCents: 9500, intakeDiscipline: 'ot' })
  const visit = await h.cmd('appointment.book', { clientId: f.patient.id, practitionerId: ot.id, serviceId: service.id, episodeId: episode.id, date: '2099-03-09', time: '09:00', acknowledgeInsurance: 'on' })
  await h.cmd('waitlist.add', { clientId: f.patient.id, practitionerId: f.priya.id, serviceId: f.service.id, earliestDate: dates[0], latestDate: dates[1] })
  const before = (await h.state()).appointments.length
  const p = await prepare()
  await h.cmd('continuity.approve', { id: p.id, digest: p.digest, confirm: true }, f.priya.cookie)
  assert.equal((await h.state()).appointments.length, before, 'review creates no replacement booking')
  // Separate episode cadence never exempts a real patient-time overlap.
  await h.cmd('appointment.move', { id: visit.appointmentId, date: dates[0], time: '10:00', practitionerId: ot.id, acknowledgeInsurance: 'on' })
  await h.cmd('continuity.prepare', input, f.priya.cookie, 409)
}
