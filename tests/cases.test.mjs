import { test } from 'node:test'
import assert from 'node:assert/strict'
import { run } from './harness.mjs'
import { clinic, pastVisit } from './clinic.mjs'

const year = new Date().getUTCFullYear(), coverage = { startsOn: `${year - 1}-01-01`, endsOn: `${year + 1}-12-31` }

/** A referral whose authorization runs low, with a signed treatment note in the case. */
async function lowAuthorizationCase(h) {
  await h.finishSetup()
  const { service, practitioners: [priya] } = await clinic(h)
  await h.cmd('staff.save', { id: priya.id, name: 'Priya Shah', email: priya.email, role: 'practitioner', credentials: 'PT', active: true })
  await h.cmd('insurance.settings.save', { billingNpi: '1234567893', taxId: '123456789', address: '100 Main St', city: 'Austin', state: 'TX', postalCode: '78701', senderId: 'BALMTEST', contactName: 'Jordan Clinic', contactPhone: '5125550100' })
  const payer = await h.cmd('insurance.payer.save', { name: 'Aetna', payerId: '60054', receiverId: 'AETNA', unitMethod: 'cms', fees: [{ code: '97110', cents: 3500 }] })
  const patient = await h.cmd('client.save', { firstName: 'Marcus', lastName: 'Thompson', dateOfBirth: '1990-02-11', email: 'marcus@client.example' })
  const policy = await h.cmd('insurance.policy.save', { clientId: patient.id, payerId: payer.id, memberId: 'MEMBER123', relationship: '18', patientSex: 'M', address: '200 Oak St', city: 'Austin', state: 'TX', postalCode: '78701', ...coverage })
  const visitId = await pastVisit(h, patient.id, priya, service.id)
  await h.cmd('appointment.attend', { id: visitId })
  const note = await h.cmd('note.write', { clientId: patient.id, appointmentId: visitId, body: 'Synthetic progress: knee flexion 120 degrees, stairs reciprocal. Goal: return to running.', charges: [{ code: '97110', minutes: 38 }] }, priya.cookie)
  await h.cmd('note.sign', { id: note.id, revision: 1, signature: 'Priya Shah', attest: true }, priya.cookie)
  const auth = await h.cmd('insurance.authorization.save', { policyId: policy.id, number: 'AUTH3', ...coverage, visits: 3 })
  const tomorrow = new Date(Date.now() + 86400000).toISOString().slice(0, 10)
  await h.cmd('appointment.book', { clientId: patient.id, practitionerId: priya.id, serviceId: service.id, date: tomorrow, time: '12:00', acknowledgeInsurance: 'on' })
  const referral = { clientId: patient.id, policyId: policy.id, receivedOn: coverage.startsOn, referringFirst: 'Anil', referringLast: 'Patel', referringNpi: '1234567893', diagnosis: 'M23.611 right knee ACL', authorizationEmail: 'auth-desk@payer.example' }
  return { priya, patient, visitId, note, auth, referral, opened: await h.cmd('case.open', referral) }
}

test('a referral whose authorization runs low gets a cited request lined up, sent only once a person approves, and kept with who approved it', async () => {
  await run(async h => {
    const { priya, patient, visitId, note, auth, opened } = await lowAuthorizationCase(h)

    // The agent keeps the case's state and lines up the request, citing the records it used. Nothing is sent yet.
    const listed = (await h.send('/api/balm/cases', undefined, h.owner)).value
    const c = listed.cases.find(x => x.referral.id === opened.id)
    assert.equal(c.stages.find(s => s.id === 'authorization').state, 'waiting')
    assert.equal(c.stages.find(s => s.id === 'notes').state, 'done')
    const step = c.steps.find(s => s.kind === 'authorization.request')
    assert.match(step.why, /Only 1 authorized visit of 3 is left \(1 used, 1 booked\)/)
    assert.ok(step.citations.some(x => x.href === `/app/clients/${patient.id}#authorization-${auth.id}`))
    assert.ok(step.citations.some(x => x.href === `/app/clients/${patient.id}#note-${note.id}` && /signed .* by Priya Shah, PT/.test(x.label)))
    assert.ok(step.citations.some(x => x.href === `/app/clients/${patient.id}#visit-${visitId}`))
    assert.equal(step.sends.to, 'auth-desk@payer.example')
    assert.equal(listed.wording.ready, false); assert.match(listed.wording.line, /needs an AI key/)
    assert.equal(h.mail.filter(m => m.to.includes('auth-desk@payer.example')).length, 0)

    // Only a person at the desk approves, and only the step as it was reviewed.
    await h.cmd('case.approve', { caseId: opened.id, key: step.key, digest: step.digest, wording: 'x' }, priya.cookie, 403)
    await h.cmd('case.approve', { caseId: opened.id, key: step.key, digest: 'stale', wording: 'x' }, h.owner, 409)
    const page = await h.send('/app/cases', undefined, h.owner)
    assert.equal(page.status, 200); assert.match(page.text, /Send to payer/); assert.match(page.text, /Records used/)

    const wording = 'We request 3 further visits to continue care toward return to running.'
    const approved = await h.form('/app/action?name=case.approve&returnTo=/app/cases', { caseId: opened.id, key: step.key, digest: step.digest, wording, reviewed: 'on' }, h.owner)
    assert.equal(approved.status, 303, approved.text)
    const sent = h.mail.filter(m => m.to.includes('auth-desk@payer.example'))
    assert.equal(sent.length, 1)
    assert.equal(sent[0].subject, 'Authorization request: Aetna member MEMBER123')
    assert.match(sent[0].text, /Current authorization: AUTH3, 3 visits/); assert.match(sent[0].text, new RegExp(wording)); assert.match(sent[0].text, /Attached: Treatment note, signed/)
    assert.equal(sent[0].attachments.length, 1); assert.match(sent[0].attachments[0].filename, /\.pdf$/)

    const after = (await h.send('/api/balm/cases', undefined, h.owner)).value.cases.find(x => x.referral.id === opened.id)
    assert.ok(!after.steps.some(s => s.key === step.key))
    assert.equal(after.history[0].approved_by, 'owner@clinic.example'); assert.equal(after.history[0].status, 'done'); assert.equal(after.history[0].result.delivery, 'sent'); assert.equal(after.history[0].wording, wording)
    await h.cmd('case.approve', { caseId: opened.id, key: step.key, digest: step.digest, wording }, h.owner, 409)
    assert.equal(h.mail.filter(m => m.to.includes('auth-desk@payer.example')).length, 1)
  })
})

test('a request that attaches a signed note goes out only on the owner’s approval', async () => {
  await run(async h => {
    const { referral, opened } = await lowAuthorizationCase(h)
    const desk = await h.staff('Rhea', 'reception')
    // The desk keeps a case's details current, including where the payer takes requests.
    await h.cmd('case.open', { ...referral, id: opened.id, authorizationEmail: 'requests@elsewhere.example' }, desk.cookie)
    const step = (await h.send('/api/balm/cases', undefined, desk.cookie)).value.cases.find(x => x.referral.id === opened.id).steps.find(s => s.kind === 'authorization.request')
    assert.equal(step.sends.to, 'requests@elsewhere.example')
    assert.ok(step.sends.attachment, 'the request attaches the signed note')
    await h.cmd('case.approve', { caseId: opened.id, key: step.key, digest: step.digest, wording: step.wording }, desk.cookie, 403)
    await h.cmd('case.draft', { caseId: opened.id, key: step.key }, desk.cookie, 403)
    assert.equal(h.mail.filter(m => m.to.includes('requests@elsewhere.example')).length, 0, 'nothing leaves on the desk’s approval')
    await h.cmd('case.approve', { caseId: opened.id, key: step.key, digest: step.digest, wording: step.wording }, h.owner)
    assert.equal(h.mail.filter(m => m.to.includes('requests@elsewhere.example')).length, 1, 'the owner approves the exact step they reviewed')
  })
})

test('month reconciliation cites missing ERA and duplicate settlement originals and only approves preparations', {timeout:120000}, async()=>{const {financeReviewJourney}=await import('./finance-review-journey.mjs');await run(financeReviewJourney)})

test('AGENT-006: episode questionnaires follow up once within shared limits and a cited score and adherence brief becomes a clinician-edited progress report', {timeout:120000}, async()=>{const {outcomeFollowthroughJourney}=await import('./outcome-followthrough-journey.mjs');await run(outcomeFollowthroughJourney)})

test('denial appeal preserves cited adjudications, fences current evidence and billing authority, and resolves only on posted payment', {timeout:120000},async()=>{const {denialJourney}=await import('./denial-resolver-journey.mjs');await run(denialJourney)})

test('care continuity prepares cited feasible dates and only the current treating clinician approves the exact preparation', {timeout:120000}, async()=>{const {continuityJourney}=await import('./continuity-journey.mjs');await run(continuityJourney,{entry:'tests/communication-worker.ts'})})
