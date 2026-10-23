import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { run } from './harness.mjs'
import { clinic, pastVisit, visitDate } from './clinic.mjs'

const fixture = async (name, values = {}) => {
  let body = await readFile(new URL(`./fixtures/insurance/${name}`, import.meta.url), 'utf8')
  for (const [key, value] of Object.entries(values)) body = body.replaceAll(`{{${key}}}`, value)
  return body
}
// Keep the transaction count valid as payer loops vary across real ERA files.
const payerLoop = (body, segments) => body.replace(/N1\*PR\*[^~]*~/, segments.join('~') + '~')
  .replace(/SE\*\d+\*/, `SE*${body.split('~').filter(s => s.trim()).length + segments.length - 1}*`)
// Coverage runs from last year through next year, so today's visit and tomorrow's booking are covered on any date, New Year's Eve included.
const year = new Date().getUTCFullYear(), coverage = { startsOn: `${year - 1}-01-01`, endsOn: `${year + 1}-12-31` }
const patientFile = async (h, id, cookie = h.owner) => (await h.send('/api/balm/clients/' + id, undefined, cookie)).value
const setup = async h => {
  await h.finishSetup()
  const { service, practitioners: [priya] } = await clinic(h)
  await h.cmd('staff.save', { id: priya.id, name: 'Priya Shah', email: priya.email, role: 'practitioner', credentials: 'PT', active: true })
  await h.cmd('pay.npi.save', { staffId: priya.id, npi: '1234567893' })
  await h.cmd('insurance.settings.save', { billingNpi: '1234567893', taxId: '123456789', address: '100 Main St', city: 'Austin', state: 'TX', postalCode: '78701', senderId: 'BALMTEST', contactName: 'Jordan Clinic', contactPhone: '5125550100' })
  const payer = await h.cmd('insurance.payer.save', { name: 'Aetna', payerId: '60054', receiverId: 'AETNA', unitMethod: 'cms', fees: [{ code: '97110', cents: 3500 }, { code: '97140', cents: 2500 }] })
  await h.cmd('insurance.enrollment.save', { payerId: payer.id, practitionerId: priya.id, taxonomy: '225100000X', active: true })
  const patient = await h.cmd('client.save', { firstName: 'Maya', lastName: 'Lee', dateOfBirth: '1988-04-02' })
  const policy = await h.cmd('insurance.policy.save', { clientId: patient.id, payerId: payer.id, memberId: 'MEMBER123', relationship: '18', patientSex: 'F', address: '200 Oak St', city: 'Austin', state: 'TX', postalCode: '78701', ...coverage })
  const appointmentId = await pastVisit(h, patient.id, priya, service.id), serviceDate = await visitDate(h, appointmentId)
  await h.cmd('appointment.attend', { id: appointmentId })
  const note = await h.cmd('note.write', { clientId: patient.id, appointmentId, body: 'Synthetic therapy visit: progressed knee strength and manual therapy.', charges: [{ code: '97110', minutes: 23 }, { code: '97140', minutes: 15 }] }, priya.cookie)
  await h.cmd('note.sign', { id: note.id, revision: 1, signature: 'Priya Shah', attest: true }, priya.cookie)
  await h.cmd('pay.codes.save', { appointmentId, icd10: 'M25.561' })
  const invoice = await h.cmd('invoice.prepare', { appointmentId })
  await h.cmd('invoice.approve', { id: invoice.id })
  // Exercise every downstream billing journey through a real biller session;
  // owner configuration and clinical attestations retain their existing actors.
  const biller=await h.staff('InsuranceBiller','biller'),nativeCommand=h.cmd
  const ownerCommands=new Set(['insurance.settings.save','insurance.payer.save','insurance.enrollment.save','insurance.medicare.settings.save','insurance.supervision.save','insurance.claim.necessity','insurance.denial.appeal'])
  h.cmd=(name,input,cookie,status,headers)=>nativeCommand(name,input,cookie ?? (name.startsWith('insurance.')&&!ownerCommands.has(name)?biller.cookie:h.owner),status,headers)
  return { patient, priya, payer, policy, appointmentId, serviceDate, invoice, biller }
}

test('signed care becomes a scrubbed 837P, a payer acknowledgment and an ERA with the right patient balance exactly once', async () => {
  const submissions = []
  await run(async h => {
    const c = await setup(h)
    const auth = await h.cmd('insurance.authorization.save', { policyId: c.policy.id, number: 'AUTH12', ...coverage, visits: 12 })
    const inquiry = await h.cmd('insurance.eligibility.prepare', { policyId: c.policy.id, serviceDate: c.serviceDate })
    const exported = await h.send(`/api/balm/insurance/270/${inquiry.id}`, undefined, h.owner)
    assert.equal(exported.status, 200); assert.match(exported.text, /ST\*270\*/)
    const trace = exported.text.match(/TRN\*1\*([^*~]+)/)[1]
    await h.cmd('insurance.eligibility.submit', { id: inquiry.id })
    const checked = await h.cmd('insurance.eligibility.import', { id: inquiry.id, x12: await fixture('271.x12', { TRACE: trace }) })
    assert.equal(checked.status, 'active'); assert.equal(checked.copayCents, 3000)
    assert.ok(checked.benefits.some(b => b.percent === .2)); assert.ok(checked.benefits.some(b => b.quantity === 8))
    const claim = await h.cmd('insurance.claim.prepare', { appointmentId: c.appointmentId, policyId: c.policy.id })
    assert.equal(claim.status, 'ready'); assert.deepEqual(claim.errors, [])
    const batch = await h.cmd('insurance.batch.prepare', { claimIds: [claim.id] })
    const sent = await h.cmd('insurance.batch.submit', { id: batch.id })
    assert.equal(sent.status, 'submitted')
    const x12 = submissions.find(s => s.kind === '837P').body
    assert.match(x12, /HI\*ABK:M25561/); assert.match(x12, /SV1\*HC:97110:GP\*70.00\*UN\*2/); assert.match(x12, /SV1\*HC:97140:GP\*25.00\*UN\*1/)
    await h.cmd('insurance.acknowledgment.import', { payerId: c.payer.id, x12: await fixture('277CA.x12', { CLAIM: claim.id }) })
    assert.equal((await patientFile(h, c.patient.id)).insurance.claims[0].status, 'accepted')
    const originalPaid = await fixture('835-paid.x12', { CLAIM: claim.id })
    for (const payerSegments of [['N1*PR*OTHER PAYER*XV*99999'], ['N1*PR*AETNA', 'REF*2U*99999'], ['N1*PR*AETNA*XV*60054', 'REF*2U*99999']]) {
      const refused = await h.cmd('insurance.remittance.import', { payerId: c.payer.id, x12: payerLoop(originalPaid, payerSegments) }, h.owner, 400)
      assert.match(refused.code, /payer_does_not_match/)
    }
    // With no explicit identifier in the payer loop, the chosen payer is still
    // checked against every claim before any balance can be posted.
    const otherPayer = await h.cmd('insurance.payer.save', { name: 'Other payer', payerId: '99999', unitMethod: 'cms', fees: [] })
    const paid = payerLoop(originalPaid, ['N1*PR*AETNA'])
    const wrongSelection = await h.cmd('insurance.remittance.import', { payerId: otherPayer.id, x12: paid }, h.owner, 400)
    assert.match(wrongSelection.code, /claim_payer_does_not_match/)
    await h.cmd('insurance.remittance.import', { payerId: c.payer.id, x12: paid })
    await h.cmd('insurance.remittance.import', { payerId: c.payer.id, x12: paid })
    const file = await patientFile(h, c.patient.id)
    assert.equal((await h.state()).insurance.batches.find(b => b.id === batch.id).can_submit, 0)
    assert.equal(file.invoices[0].paid_cents, 6000); assert.equal(file.invoices[0].adjusted_cents, 2000)
    assert.equal(file.billing.ledger.balanceCents, 1500); assert.equal(file.billing.ledger.patientBalanceCents, 1500); assert.equal(file.billing.ledger.paymentsCents, 6000); assert.equal(file.billing.ledger.adjustmentsCents, 2000)
    assert.equal(file.insurance.authorizations.find(a => a.id === auth.id).used_visits, 1)
    await h.cmd('payment.record', { invoiceId: c.invoice.id, amountCents: 1600, reference: 'TOO-MUCH' }, h.owner, 409)
    assert.equal((await patientFile(h, c.patient.id)).billing.ledger.balanceCents, 1500)
    await h.cmd('payment.record', { invoiceId: c.invoice.id, amountCents: 1500, reference: 'PATIENT-PR3' })
    assert.equal((await patientFile(h, c.patient.id)).billing.ledger.balanceCents, 0)
    await h.cmd('insurance.authorization.save', { id: auth.id, policyId: c.policy.id, number: 'AUTH12', ...coverage, visits: 2 })
    const date = new Date(Date.now() + 86400000).toISOString().slice(0, 10), booking = { clientId: c.patient.id, practitionerId: c.priya.id, serviceId: (await h.state()).services[0].id, date, time: '12:00' }
    const warning = await h.cmd('appointment.book', booking, h.owner, 409)
    assert.ok(warning.detail.insuranceBooking.warnings.some(w => w.code === 'authorization_low'))
    await h.cmd('appointment.book', { ...booking, acknowledgeInsurance: 'on' })
    assert.equal((await patientFile(h, c.patient.id)).insurance.authorizations[0].remaining_visits, 0)
    const receptionist = await h.staff('Robin', 'reception')
    await h.cmd('insurance.claim.necessity', { id: claim.id, medicalNecessity: 'Not allowed' }, receptionist.cookie, 403)
    assert.equal((await h.send(`/api/balm/insurance/837P/${batch.id}`)).status, 401)
  }, { auth: { BALM_INSURANCE_ADAPTER_URL: 'https://clearinghouse.clinic.example/x12', BALM_INSURANCE_ADAPTER_TOKEN: 'test-edge-token' }, outbound: async request => {
    assert.equal(request.url, 'https://clearinghouse.clinic.example/x12')
    assert.equal(request.headers.get('authorization'), 'Bearer test-edge-token')
    const input = await request.json(); assert.equal(request.headers.get('idempotency-key'), input.id); submissions.push(input)
    return Response.json(JSON.parse(await fixture('submitted.json')))
  } })
})

test('a payer denial lands with its reason and fix, and the clinician can draft an appeal and correct the claim', async () => {
  await run(async h => {
    const c = await setup(h)
    await h.cmd('insurance.payer.save', { id: c.payer.id, name: 'Medicare', payerId: '60054', receiverId: 'AETNA', medicare: true, unitMethod: 'cms', fees: [{ code: '97110', cents: 3500 }, { code: '97140', cents: 2500 }] })
    await h.cmd('insurance.medicare.save', { clientId: c.patient.id, year: +c.serviceDate.slice(0, 4), therapyGroup: 'pt_slp', thresholdCents: 248000, externalUsedCents: 247000, source: 'Synthetic beneficiary expense record and threshold' })
    const deniedAuth = await h.cmd('insurance.authorization.save', { policyId: c.policy.id, number: 'DENIED-AUTH', startsOn: c.serviceDate, endsOn: coverage.endsOn, visits: 12 })
    // A different authorization already on file is not a new payer decision.
    await h.cmd('insurance.authorization.save', { policyId: c.policy.id, number: 'EARLIER-AUTH', ...coverage, visits: 12 })
    const claim = await h.cmd('insurance.claim.prepare', { appointmentId: c.appointmentId, policyId: c.policy.id })
    assert.equal(claim.status, 'draft'); assert.ok(claim.errors.some(e => e.code === 'kx_medical_necessity_required'))
    assert.equal(claim.snapshot.authorization, 'DENIED-AUTH')
    const documented = await h.cmd('insurance.claim.necessity', { id: claim.id, medicalNecessity: 'Continued skilled therapy is required to safely progress gait and restore knee function.' }, c.priya.cookie)
    assert.equal(documented.status, 'ready')
    const clinicalFile = await patientFile(h, c.patient.id, c.priya.cookie)
    assert.ok(clinicalFile.insurance.claims[0].snapshot.lines.every(l => l.modifiers.includes('KX')))
    const batch = await h.cmd('insurance.batch.prepare', { claimIds: [claim.id] })
    const offline = await h.cmd('insurance.batch.submit', { id: batch.id }); assert.equal(offline.status, 'unavailable')
    await h.send(`/api/balm/insurance/837P/${batch.id}`, undefined, h.owner)
    const denied835 = payerLoop(await fixture('835-denied.x12', { CLAIM: claim.id }), ['N1*PR*AETNA', 'REF*2U*60054'])
    await h.cmd('insurance.remittance.import', { payerId: c.payer.id, x12: denied835 })
    const state = await h.state(), denial = state.insurance.queue.find(q => q.id === claim.id)
    const deniedFile = await patientFile(h, c.patient.id)
    assert.equal(deniedFile.billing.ledger.patientBalanceCents, 0); assert.equal(deniedFile.billing.ledger.insurancePendingCents, 9500)
    assert.equal(denial.status, 'denied'); assert.match(JSON.stringify(denial), /authoriz/i)
    const page = await h.send('/app/insurance', undefined, h.owner)
    assert.equal(page.status, 200); assert.match(page.text, /197/); assert.match(page.text, /[Aa]uthorization/)
    const appeal = await h.cmd('insurance.denial.appeal', { id: claim.id, reason: 'Authorization is present in the attached payer approval.' })
    assert.match(JSON.stringify(appeal), /Authorization is present/)
    const opened = await h.cmd('case.open', { clientId: c.patient.id, policyId: c.policy.id, receivedOn: coverage.startsOn, referringFirst: 'Anil', referringLast: 'Patel' })
    const caseView = async () => (await h.send('/api/balm/cases', undefined, h.owner)).value.cases.find(x => x.referral.id === opened.id)
    const blocked = (await caseView()).steps.find(s => s.kind === 'denial.fix')
    assert.ok(blocked.blocked, 'the denied number and another pre-denial authorization cannot unlock the correction')
    assert.ok(!blocked.citations.some(citation => citation.href.endsWith(`#authorization-${deniedAuth.id}`)), 'the denied number is not cited as authorization for a corrected claim')
    await h.cmd('case.approve', { caseId: opened.id, key: blocked.key, digest: blocked.digest }, h.owner, 409)
    const other = await h.staff('Riley')
    await h.cmd('insurance.authorization.save', { policyId: c.policy.id, number: 'OTHER-PROVIDER-AUTH', practitionerId: other.id, ...coverage, visits: 12 })
    assert.ok((await caseView()).steps.find(s => s.kind === 'denial.fix').blocked, 'authorization for another practitioner cannot cover this visit')
    const newAuth = await h.cmd('insurance.authorization.save', { policyId: c.policy.id, number: 'CORRECTED-AUTH', ...coverage, visits: 12 })
    const reviewed = (await caseView()).steps.find(s => s.kind === 'denial.fix')
    assert.equal(reviewed.blocked, undefined)
    assert.ok(reviewed.citations.some(citation => citation.href.endsWith(`#authorization-${newAuth.id}`)))
    assert.ok(!reviewed.citations.some(citation => citation.href.endsWith(`#authorization-${deniedAuth.id}`)))
    await h.cmd('case.approve', { caseId: opened.id, key: blocked.key, digest: blocked.digest }, h.owner, 409)
    const approved = await h.form('/app/action?name=case.approve&returnTo=/app/cases', { caseId: opened.id, key: reviewed.key, digest: reviewed.digest, reviewed: 'on' }, h.owner)
    assert.equal(approved.status, 303, approved.text)
    const history = (await caseView()).history.find(step => step.kind === 'denial.fix')
    assert.equal(history.result.claimStatus, 'batched')
    const exportResult = await h.send(`/api/balm/insurance/837P/${history.result.batchId}`, undefined, h.owner)
    assert.match(exportResult.text, /REF\*G1\*CORRECTED-AUTH~/)
    assert.doesNotMatch(exportResult.text, /REF\*G1\*DENIED-AUTH~/)
    assert.match(exportResult.text, /REF\*F8\*PAYERDENIED001/); assert.match(exportResult.text, /11:B:7/)
  })
})

test('Medicare spending is reconciled by year and discipline; KX, assistant splits and captured ABN choices control the exported claim', async () => {
  await run(async h => {
    const c = await setup(h), year = +c.serviceDate.slice(0, 4)
    await h.cmd('insurance.payer.save', { id: c.payer.id, name: 'Medicare', payerId: '60054', receiverId: 'AETNA', medicare: true, unitMethod: 'cms', fees: [{ code: '97110', cents: 3500 }, { code: '97140', cents: 2500 }] })
    const settings = { year, therapyGroup: 'pt_slp', thresholdCents: 100000, reviewCents: 120000, publishedOn: `${year - 1}-10-30`, source: 'Synthetic annual policy for this public-door flow' }
    await h.cmd('insurance.medicare.settings.save', settings)
    await h.cmd('insurance.medicare.settings.save', { ...settings, therapyGroup: 'ot' })
    await h.cmd('insurance.medicare.settings.save', { ...settings, year: year + 1 })
    await h.cmd('insurance.medicare.save', { clientId: c.patient.id, year: year + 1, therapyGroup: 'pt_slp', externalUsedCents: 999999, source: 'Synthetic separate future-year recognized expense record' })
    await h.cmd('insurance.medicare.save', { clientId: c.patient.id, year, therapyGroup: 'pt_slp', externalUsedCents: 115000, source: 'Synthetic Medicare-recognized PT and SLP expenses from other providers' })
    await h.cmd('insurance.medicare.save', { clientId: c.patient.id, year, therapyGroup: 'ot', externalUsedCents: 0, source: 'Synthetic separate OT record' })
    const claim = await h.cmd('insurance.claim.prepare', { appointmentId: c.appointmentId, policyId: c.policy.id })
    assert.ok(claim.errors.some(e => e.code === 'kx_medical_necessity_required'))
    assert.ok(claim.snapshot.lines.every(l => !l.modifiers.includes('KX')))
    assert.equal(claim.snapshot.kx.targetedReview, true)
    await h.cmd('insurance.claim.necessity', { id: claim.id, medicalNecessity: 'Synthetic skilled maintenance: prevent functional decline with clinician-directed progression.' }, c.priya.cookie)
    const receptionist = await h.staff('RobinMedicare', 'reception')
    await h.cmd('insurance.medicare.service.save', { id: claim.id, code: '97110', assistantUnits: 1, assistantBasis: 'Not a permitted assertion' }, receptionist.cookie, 403)
    await h.cmd('insurance.medicare.service.save', { id: claim.id, code: '97110', assistantUnits: 1, assistantBasis: 'PT and PTA each independently furnished qualifying minutes; one unit qualifies for CQ under CMS final-unit rules.' }, c.priya.cookie)
    const clinical = (await patientFile(h, c.patient.id, c.priya.cookie)).insurance.claims.find(x => x.id === claim.id)
    const split = clinical.snapshot.lines.filter(l => l.code === '97110')
    assert.equal(split.length, 2); assert.equal(split.reduce((t, l) => t + l.units, 0), 2)
    assert.equal(split.filter(l => l.modifiers.includes('CQ')).reduce((t, l) => t + l.units, 0), 1)
    assert.ok(split.every(l => l.modifiers.includes('KX') && l.modifiers.includes('GP')))
    const reception = (await patientFile(h, c.patient.id, receptionist.cookie)).insurance.claims.find(x => x.id === claim.id)
    assert.equal(reception.snapshot.medicareServices['97110'].assistantBasis, undefined)
    const batch = await h.cmd('insurance.batch.prepare', { claimIds: [claim.id] })
    const x12 = await h.send(`/api/balm/insurance/837P/${batch.id}`, undefined, h.owner)
    assert.match(x12.text, /SV1\*HC:97110:GP:KX:CQ\*35.00\*UN\*1/)
    await h.cmd('insurance.medicare.recognized.save', { id: claim.id, recognizedCents: 6400, source: 'Synthetic Medicare recognized amount after reductions' })

    const appointmentId = await pastVisit(h, c.patient.id, c.priya, (await h.state()).services[0].id, h.owner, 6)
    await h.cmd('appointment.attend', { id: appointmentId })
    const note = await h.cmd('note.write', { clientId: c.patient.id, appointmentId, body: 'Synthetic subsequent maintenance service.', charges: [{ code: '97110', minutes: 23 }, { code: '97140', minutes: 15 }] }, c.priya.cookie)
    await h.cmd('note.sign', { id: note.id, revision: 1, signature: 'Priya Shah', attest: true }, c.priya.cookie)
    await h.cmd('pay.codes.save', { appointmentId, icd10: 'M25.561' })
    const invoice = await h.cmd('invoice.prepare', { appointmentId }); await h.cmd('invoice.approve', { id: invoice.id })
    const next = await h.cmd('insurance.claim.prepare', { appointmentId, policyId: c.policy.id })
    assert.equal(next.snapshot.kx.usedCents, 115000 + 6400)
    const ot = (await patientFile(h, c.patient.id)).insurance.medicare.find(m => m.year === year && m.therapy_group === 'ot')
    assert.equal(ot.usedCents, 0); assert.ok(ot.usedCents < ot.thresholdCents)
    assert.equal(ot.source, 'Synthetic separate OT record')
    await h.cmd('insurance.claim.necessity', { id: next.id, medicalNecessity: 'Synthetic supporting record for the covered procedure.' }, c.priya.cookie)
    // A synthetic signed original is test data only, submitted through the real public command.
    const document = 'data:application/pdf;base64,' + Buffer.from('%PDF-1.4\nSynthetic signed CMS-R-131 test original\n%%EOF').toString('base64')
    const notice = { id: next.id, code: '97110', coverage: 'medical_necessity_denial', hasAbn: true, abnDocument: document, issuedOn: next.snapshot.serviceDate, signedOn: next.snapshot.serviceDate, notifier: 'Synthetic clinic', beneficiary: 'Synthetic beneficiary signature', option: 2, services: 'Maintenance procedure', reason: 'This particular service does not require skilled therapy.', estimatedCents: 7000 }
    const held = await h.cmd('insurance.medicare.service.save', notice, c.priya.cookie)
    assert.ok(held.errors.some(e => e.code === 'abn_no_medicare_claim'))
    await h.cmd('insurance.batch.prepare', { claimIds: [next.id] }, h.owner, 409)
    await h.cmd('insurance.medicare.service.save', { ...notice, option: 1 }, c.priya.cookie)
    const captured = (await patientFile(h, c.patient.id, c.priya.cookie)).insurance.claims.find(x => x.id === next.id)
    const abnId = captured.snapshot.medicareServices['97110'].abnId
    assert.ok(captured.snapshot.lines.find(l => l.code === '97110').modifiers.includes('GA'))
    assert.ok(!captured.snapshot.lines.find(l => l.code === '97110').modifiers.includes('KX'))
    const original = await h.send(`/api/balm/insurance/abn/${abnId}`, undefined, c.priya.cookie)
    assert.equal(original.status, 200); assert.match(original.text, /Synthetic signed CMS-R-131/)
    assert.equal((await h.send(`/api/balm/insurance/abn/${abnId}`, undefined, receptionist.cookie)).status, 403)
    const abnBatch = await h.cmd('insurance.batch.prepare', { claimIds: [next.id] })
    assert.match((await h.send(`/api/balm/insurance/837P/${abnBatch.id}`, undefined, h.owner)).text, /SV1\*HC:97110:GP:GA\*/)
  })
})

test('CHART-006 primary slice: CMS, AMA and fixed-threshold note previews agree on invoice, superbill and claim, with frozen payer basis', async () => {
  await run(async h => {
    const base = await setup(h), service = (await h.state()).services[0]
    await h.cmd('settings.save', { clinicName: 'Riverside Therapy', timeZone: 'Australia/Brisbane', taxId: '12-3456789', practiceNpi: '1234567893', address: '100 Main St, Austin TX 78701' })
    for (const [method, expectedUnits, expectedCents] of [['cms', [0, 1], 2500], ['ama', [1, 1], 6000]]) {
      const payer = await h.cmd('insurance.payer.save', { name: method.toUpperCase() + ' Health', payerId: method.toUpperCase(), unitMethod: method, fees: [{ code: '97110', cents: 3500 }, { code: '97140', cents: 2500 }] })
      await h.cmd('insurance.enrollment.save', { payerId: payer.id, practitionerId: base.priya.id, taxonomy: '225100000X', active: true })
      const patient = await h.cmd('client.save', { firstName: 'Elena', lastName: method, dateOfBirth: '1975-03-04' })
      const policy = await h.cmd('insurance.policy.save', { clientId: patient.id, payerId: payer.id, memberId: method + '-123', relationship: '18', patientSex: 'F', address: '200 Oak St', city: 'Austin', state: 'TX', postalCode: '78701', ...coverage })
      const visit = await pastVisit(h, patient.id, base.priya, service.id, h.owner, method === 'cms' ? 5 : 8)
      await h.cmd('appointment.attend', { id: visit })
      await h.cmd('pay.codes.save', { appointmentId: visit, icd10: 'M25.561, M54.50' })
      const note = await h.cmd('note.write', { clientId: patient.id, appointmentId: visit, body: 'Reviewed therapeutic exercise and manual therapy.', charges: [{ code: '97110', minutes: 8, diagnosisCodes: ['M25.561'] }, { code: '97140', minutes: 8, diagnosisCodes: ['M54.50'] }] }, base.priya.cookie)
      const preview = async () => (await patientFile(h, patient.id, base.priya.cookie)).notes.find(n => n.id === note.id).billing
      let signingRevision = 1
      if (method === 'cms') {
        assert.equal((await preview()).cmsTie.resolved, false, 'a CMS boundary tie is provisional until the clinician chooses')
        const unresolved = await h.cmd('note.sign', { id: note.id, revision: 1, signature: 'Priya Shah', attest: true }, base.priya.cookie, 400)
        assert.match(unresolved.error, /Choose exactly 1.*97110, 97140/)
        await h.cmd('note.amend', { id: note.id, revision: 1, body: 'Reviewed treatment.', charges: [{ code: '97110', minutes: 8, cmsTieChosen: 'guess' }] }, base.priya.cookie, 400)
        await h.cmd('note.amend', { id: note.id, revision: 1, body: 'Reviewed treatment.', charges: [{ code: '97161', minutes: 0, cmsTieChosen: true }] }, base.priya.cookie, 400)
        await h.cmd('note.amend', { id: note.id, revision: 1, body: 'Reviewed treatment.', charges: [{ code: '97110', minutes: 8, cmsTieChosen: true }, { code: '97140', minutes: 8, cmsTieChosen: true }] }, base.priya.cookie)
        await h.cmd('note.sign', { id: note.id, revision: 2, signature: 'Priya Shah', attest: true }, base.priya.cookie, 400)
        // The actual edit form records the clinician's choice of the second code.
        const saved = await h.form('/app/action?name=note.amend&returnTo=' + encodeURIComponent('/app/clients/' + patient.id), { id: note.id, revision: '2', body: 'Reviewed therapeutic exercise and manual therapy.', charge_code_0: '97110', charge_minutes_0: '8', charge_code_1: '97140', charge_minutes_1: '8', charge_cms_tie_1: 'on', charge_diagnoses_0: 'M25.561', charge_diagnoses_1: 'M54.50' }, base.priya.cookie)
        assert.equal(saved.status, 303)
        signingRevision = 3
        assert.deepEqual((await preview()).cmsTie.selected, ['97140'])
        assert.equal((await preview()).cmsTie.resolved, true)
      }
      const draft = await preview()
      assert.deepEqual(draft.lines.map(l => l.units), expectedUnits, 'draft units follow the covering primary payer')
      assert.equal(draft.timedUnits, expectedUnits.reduce((a, b) => a + b, 0))
      assert.equal(draft.units, expectedUnits.reduce((a, b) => a + b, 0))
      assert.equal(draft.method, method)
      // A covering secondary policy must not change the primary preview.
      await h.cmd('insurance.policy.save', { clientId: patient.id, payerId: base.payer.id, priority: 2, memberId: method + '-secondary', relationship: '18', patientSex: 'F', address: '200 Oak St', city: 'Austin', state: 'TX', postalCode: '78701', ...coverage })
      assert.deepEqual((await preview()).lines.map(l => l.units), expectedUnits)
      await h.cmd('note.sign', { id: note.id, revision: signingRevision, signature: 'Priya Shah', attest: true }, base.priya.cookie)
      assert.deepEqual((await preview()).lines, draft.lines, 'signing keeps the same primary-payer calculation')
      await h.cmd('pay.codes.save', { appointmentId: visit, cpt: '97110 GP, 97140 GP', icd10: 'M25.561, M54.50' })
      const invoice = await h.cmd('invoice.prepare', { appointmentId: visit })
      assert.deepEqual(invoice.snapshot.procedures.map(p => p.units), expectedUnits)
      assert.equal(invoice.snapshot.amountCents, expectedCents)
      assert.equal(invoice.snapshot.timedUnitBasis.method, method)
      assert.equal(invoice.snapshot.timedUnitBasis.payerId, payer.id)
      assert.equal(invoice.snapshot.timedUnitBasis.payerVersion, (await h.state()).insurance.payers.find(p => p.id === payer.id).version)
      await h.cmd('invoice.approve', { id: invoice.id })
      const original = await h.send(`/api/balm/invoices/${invoice.id}.html`, undefined, h.owner)
      assert.equal(original.status, 200)
      assert.ok(original.text.includes(method === 'ama' ? 'AMA/CPT per-service substantial portion' : 'CMS 8-minute rule'))
      const superbill = await h.send(`/api/balm/superbills/${invoice.id}.pdf`, undefined, h.owner)
      assert.equal(superbill.status, 200, superbill.text)
      assert.ok(superbill.text.includes(method === 'ama' ? 'AMA/CPT per-service' : 'CMS 8-minute rule'))
      if (method === 'cms') assert.ok(!superbill.text.includes('97110'), 'zero-unit procedures are not billed on a superbill')
      const date = await visitDate(h, visit)
      assert.equal((await h.send(`/api/balm/period-superbills/${patient.id}.pdf?from=${date}&to=${date}`, undefined, h.owner)).status, 200)
      const claim = await h.cmd('insurance.claim.prepare', { appointmentId: visit, policyId: policy.id })
      assert.equal(claim.status, 'ready', JSON.stringify(claim.errors))
      assert.deepEqual(claim.snapshot.lines.map(l => l.units), expectedUnits.filter(u => u > 0))
      assert.equal(claim.snapshot.payer.unitMethod, method)
      assert.deepEqual(claim.snapshot.lines.map(l => l.diagnosisPointers), method === 'ama' ? [[1], [2]] : [[2]])
      const batch = await h.cmd('insurance.batch.prepare', { claimIds: [claim.id] })
      const x12 = await h.send(`/api/balm/insurance/837P/${batch.id}`, undefined, h.owner)
      assert.match(x12.text, /SV1\*HC:97140:GP\*25.00\*UN\*1/)
      if (method === 'ama') assert.match(x12.text, /SV1\*HC:97110:GP\*35.00\*UN\*1/)
      else assert.doesNotMatch(x12.text, /SV1\*HC:97110/)
      // Later payer settings cannot rewrite issued invoice bytes or superbill units.
      await h.cmd('insurance.payer.save', { id: payer.id, name: 'Changed Health', payerId: method.toUpperCase(), unitMethod: method === 'cms' ? 'ama' : 'cms', fees: [{ code: '97110', cents: 3500 }, { code: '97140', cents: 2500 }] })
      assert.equal((await h.send(`/api/balm/invoices/${invoice.id}.html`, undefined, h.owner)).text, original.text)
      assert.equal((await h.send(`/api/balm/superbills/${invoice.id}.pdf`, undefined, h.owner)).text, superbill.text)
      const current = await preview()
      assert.deepEqual(current.lines.map(l => l.units), method === 'cms' ? [1, 1] : [1, 0], 'current preview follows the edited method while issued documents stay fixed')
    }
    const cash = await h.cmd('client.save', { firstName: 'Avery', lastName: 'Self-pay', dateOfBirth: '1980-04-02' })
    const cashVisit = await pastVisit(h, cash.id, base.priya, service.id, h.owner, 11)
    const cashNote = await h.cmd('note.write', { clientId: cash.id, appointmentId: cashVisit, body: 'Synthetic self-pay treatment.', charges: [{ code: '97110', minutes: 10 }, { code: '97140', minutes: 8, cmsTieChosen: true }, { code: '97161', minutes: 0 }] }, base.priya.cookie)
    let cashPreview = (await patientFile(h, cash.id, base.priya.cookie)).notes.find(n => n.id === cashNote.id).billing
    assert.deepEqual(cashPreview.lines.map(l => l.units), [1, 0, 1], 'cash uses pooled CMS timed minutes and one untimed unit')
    assert.equal(cashPreview.timedMinutes, 18)
    assert.equal(cashPreview.timedUnits, 1)
    assert.equal(cashPreview.units, 2)
    assert.equal(cashPreview.method, 'cms')
    const unknown = await h.cmd('insurance.payer.save', { name: 'Undecided Health', payerId: 'UNDECIDED' })
    const date = await visitDate(h, cashVisit)
    // Both ends of the coverage date are inclusive in the clinic's time zone.
    const policy = await h.cmd('insurance.policy.save', { clientId: cash.id, payerId: unknown.id, memberId: 'pending-method', relationship: '18', patientSex: 'F', address: '200 Oak St', city: 'Austin', state: 'TX', postalCode: '78701', startsOn: date, endsOn: date })
    cashPreview = (await patientFile(h, cash.id, base.priya.cookie)).notes.find(n => n.id === cashNote.id).billing
    assert.equal(cashPreview.method, null, 'missing method is not presented as configured CMS')
    assert.equal(cashPreview.payer, 'Undecided Health')
    assert.deepEqual(cashPreview.lines.map(l => l.units), [1, 0, 1], 'unconfigured method remains a provisional CMS calculation')
    await h.cmd('appointment.attend', { id: cashVisit })
    await h.cmd('note.sign', { id: cashNote.id, revision: 1, signature: 'Priya Shah', attest: true }, base.priya.cookie)
    const unconfiguredInvoice = await h.cmd('invoice.prepare', { appointmentId: cashVisit })
    await h.cmd('invoice.approve', { id: unconfiguredInvoice.id })
    const held = await h.cmd('insurance.claim.prepare', { appointmentId: cashVisit, policyId: policy.id })
    assert.equal(held.status, 'draft')
    assert.ok(held.errors.some(e => e.code === 'payer_unit_method_missing'), 'preview does not bypass the existing claim hold')
    // A policy outside the service date must not supply the note's method.
    const later = new Date(Date.parse(date + 'T12:00:00Z') + 86400000).toISOString().slice(0, 10)
    await h.cmd('insurance.policy.save', { id: policy.id, clientId: cash.id, payerId: unknown.id, memberId: 'pending-method', relationship: '18', patientSex: 'F', address: '200 Oak St', city: 'Austin', state: 'TX', postalCode: '78701', startsOn: later, endsOn: later })
    assert.equal((await patientFile(h, cash.id, base.priya.cookie)).notes.find(n => n.id === cashNote.id).billing.payerId, null)
    // A tied boundary can have more than one remaining unit. Choose exactly two
    // out of three equal remainders, while preserving the first code's whole unit.
    const boundaryPatient = await h.cmd('client.save', { firstName: 'Rowan', lastName: 'Synthetic tie', dateOfBirth: '1980-01-01' })
    const boundaryVisit = await pastVisit(h, boundaryPatient.id, base.priya, service.id, h.owner, 20)
    const boundaryCharges = [{ code: '97110', minutes: 23 }, { code: '97140', minutes: 8, cmsTieChosen: true }, { code: '97530', minutes: 8, cmsTieChosen: true }]
    const boundary = await h.cmd('note.write', { clientId: boundaryPatient.id, appointmentId: boundaryVisit, body: 'Synthetic three-code CMS treatment.', charges: boundaryCharges }, base.priya.cookie)
    const boundaryPreview = (await patientFile(h, boundaryPatient.id, base.priya.cookie)).notes.find(n => n.id === boundary.id).billing
    assert.deepEqual(boundaryPreview.lines.map(l => l.units), [1, 1, 1])
    assert.deepEqual(boundaryPreview.cmsTie.selected, ['97140', '97530'])
    assert.equal(boundaryPreview.cmsTie.units, 2)
    await h.cmd('note.sign', { id: boundary.id, revision: 1, signature: 'Priya Shah', attest: true }, base.priya.cookie)
    await h.cmd('note.amend', { id: boundary.id, revision: 1, body: 'Attempted changed choice', charges: boundaryCharges.map(c => ({ code: c.code, minutes: c.minutes })) }, base.priya.cookie, 409)


    // INS-001 / CHART-006: positive whole-minute thresholds count each code
    // independently, and zero-unit signed codes remain named scrubber errors.
    const fixedInput = { name: 'Fixed Health', payerId: 'FIXED', unitMethod: 'fixed', fixedUnitMinutes: 15, fees: [{ code: '97110', cents: 3500 }, { code: '97140', cents: 2500 }, { code: '97161', cents: 10000 }] }
    for (const fixedUnitMinutes of [undefined, '', 0, -1, 2.5]) await h.cmd('insurance.payer.save', { ...fixedInput, fixedUnitMinutes }, h.owner, 400)
    await h.cmd('insurance.payer.save', fixedInput, base.priya.cookie, 403)
    await h.cmd('insurance.payer.save', { ...fixedInput, medicare: true }, h.owner, 400)
    const fixed = await h.cmd('insurance.payer.save', fixedInput)
    await h.cmd('insurance.enrollment.save', { payerId: fixed.id, practitionerId: base.priya.id, taxonomy: '225100000X', active: true })
    const fixedPatient = await h.cmd('client.save', { firstName: 'Robin', lastName: 'Threshold', dateOfBirth: '1980-01-01' })
    const fixedPolicy = await h.cmd('insurance.policy.save', { clientId: fixedPatient.id, payerId: fixed.id, memberId: 'fixed-member', relationship: '18', patientSex: 'F', address: '200 Oak St', city: 'Austin', state: 'TX', postalCode: '78701', ...coverage })
    const zeroVisit = await pastVisit(h, fixedPatient.id, base.priya, service.id, h.owner, 14)
    await h.cmd('appointment.attend', { id: zeroVisit })
    const zeroNote = await h.cmd('note.write', { clientId: fixedPatient.id, appointmentId: zeroVisit, body: 'Synthetic short exercise and manual therapy.', charges: [{ code: '97110', minutes: 8 }, { code: '97140', minutes: 8 }] }, base.priya.cookie)
    await h.cmd('note.sign', { id: zeroNote.id, revision: 1, signature: 'Priya Shah', attest: true }, base.priya.cookie)
    const zeroInvoice = await h.cmd('invoice.prepare', { appointmentId: zeroVisit })
    assert.deepEqual(zeroInvoice.snapshot.procedures.map(l => l.units), [0, 0])
    assert.equal(zeroInvoice.snapshot.amountCents, 0, 'below-threshold signed minutes must not fall back to the service price')
    await h.cmd('invoice.approve', { id: zeroInvoice.id })
    const zeroClaim = await h.cmd('insurance.claim.prepare', { appointmentId: zeroVisit, policyId: fixedPolicy.id }, h.owner, 400)
    assert.equal((await patientFile(h, fixedPatient.id)).insurance.claims.length, 0, 'a zero-dollar bill is refused without inventing a claim charge')
    const thresholdErrors = zeroClaim.detail.scrubErrors.filter(e => e.code === 'timed_code_below_threshold')
    assert.deepEqual(thresholdErrors.map(e => e.field).sort(), ['lines.97110', 'lines.97140'])
    const authorization = await h.cmd('insurance.authorization.save', { policyId: fixedPolicy.id, number: 'FIXED-UNITS', ...coverage, allowanceKind: 'units', units: 5, unitsPerVisit: 2, lowRemainder: 2 })
    const fixedVisit = await pastVisit(h, fixedPatient.id, base.priya, service.id, h.owner, 17)
    await h.cmd('appointment.attend', { id: fixedVisit })
    const fixedNote = await h.cmd('note.write', { clientId: fixedPatient.id, appointmentId: fixedVisit, body: 'Synthetic complete timed units plus evaluation.', charges: [{ code: '97110', minutes: 30 }, { code: '97140', minutes: 29 }, { code: '97161', minutes: 0 }] }, base.priya.cookie)
    let fixedFile = await patientFile(h, fixedPatient.id, base.priya.cookie)
    assert.deepEqual(fixedFile.notes.find(n => n.id === fixedNote.id).billing.lines.map(l => l.units), [2, 1, 1])
    await h.cmd('note.sign', { id: fixedNote.id, revision: 1, signature: 'Priya Shah', attest: true }, base.priya.cookie)
    fixedFile = await patientFile(h, fixedPatient.id)
    let counted = fixedFile.insurance.authorizations.find(a => a.id === authorization.id)
    assert.deepEqual([counted.used_units, counted.remaining_allowance], [4, 1], 'authorization usage uses the same fixed-unit method')
    assert.ok((await h.state()).dailyClose.authorizations.some(a => a.clientId === fixedPatient.id && a.kind === 'low_authorization'))
    await h.cmd('pay.codes.save', { appointmentId: fixedVisit, icd10: 'M25.561' })
    const fixedInvoice = await h.cmd('invoice.prepare', { appointmentId: fixedVisit })
    assert.deepEqual(fixedInvoice.snapshot.procedures.map(l => l.units), [2, 1, 1])
    assert.equal(fixedInvoice.snapshot.amountCents, 19500)
    assert.equal(fixedInvoice.snapshot.timedUnitBasis.fixedUnitMinutes, 15)
    await h.cmd('invoice.approve', { id: fixedInvoice.id })
    const fixedClaim = await h.cmd('insurance.claim.prepare', { appointmentId: fixedVisit, policyId: fixedPolicy.id })
    assert.equal(fixedClaim.status, 'ready', JSON.stringify(fixedClaim.errors))
    assert.deepEqual(fixedClaim.snapshot.lines.map(l => l.units), [2, 1, 1])
    assert.equal(fixedClaim.snapshot.payer.fixedUnitMinutes, 15)
    const fixedBatch = await h.cmd('insurance.batch.prepare', { claimIds: [fixedClaim.id] })
    const fixedX12 = await h.send(`/api/balm/insurance/837P/${fixedBatch.id}`, undefined, h.owner)
    assert.match(fixedX12.text, /SV1\*HC:97110:GP\*70.00\*UN\*2/)
    assert.match(fixedX12.text, /SV1\*HC:97140:GP\*25.00\*UN\*1/)
    const fixedHtml = (await h.send(`/api/balm/invoices/${fixedInvoice.id}.html`, undefined, h.owner)).text
    const fixedPdf = (await h.send(`/api/balm/superbills/${fixedInvoice.id}.pdf`, undefined, h.owner)).text
    await h.cmd('insurance.payer.save', { ...fixedInput, id: fixed.id, fixedUnitMinutes: 30 })
    fixedFile = await patientFile(h, fixedPatient.id)
    assert.deepEqual(fixedFile.notes.find(n => n.id === fixedNote.id).billing.lines.map(l => l.units), [1, 0, 1])
    counted = fixedFile.insurance.authorizations.find(a => a.id === authorization.id)
    assert.deepEqual([counted.used_units, counted.remaining_allowance], [2, 3])
    assert.ok(!(await h.state()).dailyClose.authorizations.some(a => a.clientId === fixedPatient.id && a.kind === 'low_authorization'), 'daily close clears the fixed-unit low remainder when recalculated coverage suffices')
    assert.equal((await h.send(`/api/balm/invoices/${fixedInvoice.id}.html`, undefined, h.owner)).text, fixedHtml)
    assert.equal((await h.send(`/api/balm/superbills/${fixedInvoice.id}.pdf`, undefined, h.owner)).text, fixedPdf)
    await h.cmd('insurance.payer.save', { ...fixedInput, id: fixed.id, unitMethod: 'ama' })
    const amaAgain = (await patientFile(h, fixedPatient.id)).notes.find(n => n.id === fixedNote.id).billing
    assert.deepEqual(amaAgain.lines.map(l => l.units), [2, 2, 1], 'switching methods clears the old threshold')
  })
})


test('CHART-006 selected diagnoses follow signed procedures into claims and fixed superbills without retargeting on reorder', async () => {
  await run(async h => {
    const base = await setup(h), service = (await h.state()).services[0]
    await h.cmd('settings.save', { clinicName: 'Riverside Therapy', timeZone: 'Australia/Brisbane', taxId: '12-3456789', practiceNpi: '1234567893', address: '100 Main St, Austin TX 78701' })
    const patient = await h.cmd('client.save', { firstName: 'Synthetic', lastName: 'Diagnosis selections', dateOfBirth: '1980-01-01' })
    const policy = await h.cmd('insurance.policy.save', { clientId: patient.id, payerId: base.payer.id, memberId: 'DIAG-123', relationship: '18', patientSex: 'F', address: '200 Oak St', city: 'Austin', state: 'TX', postalCode: '78701', ...coverage })
    const visit = await pastVisit(h, patient.id, base.priya, service.id, h.owner, 5)
    await h.cmd('appointment.attend', { id: visit })
    const codes = icd10 => h.cmd('pay.codes.save', { appointmentId: visit, icd10 })
    await codes('M25.561, M54.50, R26.2, M25.562, R53.1')
    const input = { clientId: patient.id, appointmentId: visit, body: 'Synthetic knee exercise and separate lumbar manual treatment.' }
    const charges = [{ code: '97110', minutes: 23, diagnosisCodes: ['M25.561', 'R26.2'] }, { code: '97140', minutes: 15, diagnosisCodes: ['M54.50'] }]
    for (const diagnosisCodes of [['M25.561', 'M25.561'], ['M25.561', 'M54.50', 'R26.2', 'M25.562', 'R53.1'], ['M99.99'], [2]]) {
      await h.cmd('note.write', { ...input, charges: [{ ...charges[0], diagnosisCodes }] }, base.priya.cookie, 400)
    }
    const note = await h.cmd('note.write', { ...input, charges }, base.priya.cookie)
    // Exercise the production edit form, including a different selection for each CPT.
    assert.equal((await h.form('/app/action?name=note.amend&returnTo=' + encodeURIComponent('/app/clients/' + patient.id), {
      id: note.id, revision: '1', body: input.body, charge_code_0: '97110', charge_minutes_0: '23', charge_diagnoses_0: 'm25.561, r26.2',
      charge_code_1: '97140', charge_minutes_1: '15', charge_diagnoses_1: 'm54.50'
    }, base.priya.cookie)).status, 303)
    // Removing a selected diagnosis after saving cannot turn the signature into approval of another diagnosis.
    await codes('M25.561, R26.2')
    const refused = await h.cmd('note.sign', { id: note.id, revision: 2, signature: 'Priya Shah', attest: true }, base.priya.cookie, 400)
    assert.equal(refused.code, 'selected_diagnosis_missing_from_visit')
    assert.equal((await patientFile(h, patient.id, base.priya.cookie)).notes.find(n => n.id === note.id).status, 'draft')
    await codes('M25.561, M54.50, R26.2')
    await h.cmd('note.sign', { id: note.id, revision: 2, signature: 'Priya Shah', attest: true }, base.priya.cookie)
    await h.cmd('note.amend', { id: note.id, revision: 2, body: 'Attempt to relink a signed service', charges: [{ ...charges[0], diagnosisCodes: ['M54.50'] }] }, base.priya.cookie, 409)
    const invoice = await h.cmd('invoice.prepare', { appointmentId: visit })
    assert.deepEqual(invoice.snapshot.procedures.map(p => p.diagnosisCodes), [['M25.561', 'R26.2'], ['M54.50']])
    await h.cmd('invoice.approve', { id: invoice.id })
    const original = await h.send(`/api/balm/superbills/${invoice.id}.pdf`, undefined, h.owner)
    assert.equal(original.status, 200, original.text)
    const assertLinks = text => {
      const printed = [...text.matchAll(/\(([^()]*)\) Tj/g)].map(m => m[1])
      assert.ok(printed.slice(printed.indexOf('97110') + 1, printed.indexOf('97140')).includes('A, C'), 'exercise links only to the selected knee and gait diagnoses')
      assert.ok(printed.slice(printed.indexOf('97140') + 1).includes('B'), 'manual therapy links to the selected lumbar diagnosis')
    }
    assertLinks(original.text)
    const date = await visitDate(h, visit), period = await h.send(`/api/balm/period-superbills/${patient.id}.pdf?from=${date}&to=${date}`, undefined, h.owner)
    assert.equal(period.status, 200); assertLinks(period.text)
    await codes('R26.2, M54.50, M25.561')
    assert.equal((await h.send(`/api/balm/superbills/${invoice.id}.pdf`, undefined, h.owner)).text, original.text)
    assert.equal((await h.send(`/api/balm/period-superbills/${patient.id}.pdf?from=${date}&to=${date}`, undefined, h.owner)).text, period.text)
    const claim = await h.cmd('insurance.claim.prepare', { appointmentId: visit, policyId: policy.id })
    assert.equal(claim.status, 'ready', JSON.stringify(claim.errors))
    assert.deepEqual(claim.snapshot.lines.map(l => l.diagnosisPointers), [[3, 1], [2]])
    assert.deepEqual(claim.snapshot.lines.map(l => l.units), [2, 1])
    await codes('M25.561, R26.2')
    const incomplete = await h.cmd('insurance.claim.scrub', { id: claim.id })
    assert.equal(incomplete.status, 'draft')
    assert.ok(incomplete.errors.some(e => e.code === 'diagnosis_pointer_invalid' && e.field === 'lines.97140.diagnosisPointers'))
    await h.cmd('insurance.batch.prepare', { claimIds: [claim.id] }, h.owner, 409)
    await codes('R26.2, M54.50, M25.561')
    assert.equal((await h.cmd('insurance.claim.scrub', { id: claim.id })).status, 'ready')
    const batch = await h.cmd('insurance.batch.prepare', { claimIds: [claim.id] })
    const x12 = await h.send(`/api/balm/insurance/837P/${batch.id}`, undefined, h.owner)
    assert.equal(x12.status, 200)
    assert.match(x12.text, /SV1\*HC:97110:GP\*70.00\*UN\*2\*\*\*3:1~/)
    assert.match(x12.text, /SV1\*HC:97140:GP\*25.00\*UN\*1\*\*\*2~/)
    const signed = (await patientFile(h, patient.id, base.priya.cookie)).notes.find(n => n.id === note.id)
    assert.deepEqual(signed.revisions[0].charges, charges, 'the signed code identities survive subsequent visit edits')
  })
})

test('INS-012: balanced manual EOB batches post group checks, CARC/PR, interest and recoupments once into statements and deposits',async()=>{const {manualPayerJourney}=await import('./manual-payer-journey.mjs');await run(manualPayerJourney)})


test('INS-008: sourced claim work follows a KX denial through correction and payment',async()=>{const {denialWorkJourney}=await import('./denial-work-journey.mjs');await denialWorkJourney()})


test('INS-013: prior adjudications reach secondary and tertiary claims, crossover waits without duplicates, and patient balances wait for all payers',async()=>{const {cobJourney}=await import('./cob-journey.mjs');await run(h=>cobJourney(h,process.env.BALM_COB_VALIDATION),{auth:{BALM_INSURANCE_ADAPTER_URL:'https://clearinghouse.clinic.example/x12',BALM_INSURANCE_ADAPTER_TOKEN:'synthetic-balm-30'},outbound:async request=>{assert.equal(request.url,'https://clearinghouse.clinic.example/x12');return Response.json({status:'submitted',reference:'synthetic-balm-31'})}})})
