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
  const ownerCommands=new Set(['insurance.schedule.save','insurance.license.save','insurance.settings.save','insurance.payer.save','insurance.enrollment.save','insurance.medicare.settings.save','insurance.supervision.save','insurance.claim.necessity','insurance.denial.appeal'])
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
    const baa=(await h.send('/api/balm/readiness.json',undefined,h.owner)).value.baas.find(b=>b.processor==='clearinghouse')
    await h.cmd('readiness.baa.revoke',{id:baa.id})
    const fresh=await h.cmd('insurance.eligibility.prepare',{policyId:c.policy.id,serviceDate:c.serviceDate})
    const before=submissions.length
    assert.equal((await h.cmd('insurance.eligibility.submit',{id:fresh.id})).status,'unavailable')
    assert.equal(submissions.length,before,'revoked clearinghouse BAA blocks X12 before the gateway edge')
  }, { auth: { BALM_INSURANCE_ADAPTER_URL: 'https://clearinghouse.clinic.example/x12', BALM_INSURANCE_ADAPTER_TOKEN: 'synthetic-balm-insurance-edge' }, outbound: async request => {
    assert.equal(request.url, 'https://clearinghouse.clinic.example/x12')
    assert.equal(request.headers.get('authorization'), 'Bearer synthetic-balm-insurance-edge')
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
    const approved = await h.form('/app/action?name=case.approve&returnTo=/app/cases', { caseId: opened.id, key: reviewed.key, digest: reviewed.digest, reviewed: 'on' }, c.biller.cookie)
    assert.equal(approved.status, 303, approved.text)
    const history = (await caseView()).history.find(step => step.kind === 'denial.fix')
    assert.equal(history.approved_by,'insurancebiller@clinic.example')
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
      if(process.env.BALM_UI_SCREENSHOTS){const {viewportProof}=await import('./viewport-proof.mjs');await viewportProof(h,[{name:'CHART-006-'+method+'-units',path:'/app/clients/'+patient.id,cookie:base.priya.cookie,selector:'#note-'+note.id+' .units'},{name:'CHART-006-'+method+'-edit',path:'/app/clients/'+patient.id,cookie:base.priya.cookie,open:'Edit draft',selector:'.charges'}])}
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
    if(process.env.BALM_UI_SCREENSHOTS){const {viewportProof}=await import('./viewport-proof.mjs');await viewportProof(h,[{name:'CHART-006-fixed-zero',path:'/app/clients/'+fixedPatient.id,cookie:base.priya.cookie,selector:'.units'}])}
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
    // The clause's complete Medicare example: 38 timed minutes plus an untimed evaluation.
    const medicare=await h.cmd('insurance.payer.save',{name:'Synthetic Medicare allocation',payerId:'SYNTHETIC38',receiverId:'SYNTHETIC38',medicare:true,unitMethod:'cms',fees:[{code:'97110',cents:3500},{code:'97140',cents:2500},{code:'97161',cents:10000}]})
    await h.cmd('insurance.enrollment.save',{payerId:medicare.id,practitionerId:base.priya.id,taxonomy:'225100000X',active:true})
    await h.cmd('insurance.medicare.settings.save',{year,therapyGroup:'pt_slp',thresholdCents:250000,reviewCents:300000,publishedOn:`${year-1}-10-30`,source:'CMS synthetic-year published threshold fixture'})
    const patient38=await h.cmd('client.save',{firstName:'Synthetic',lastName:'Medicare allocation',dateOfBirth:'1950-01-01'})
    const policy38=await h.cmd('insurance.policy.save',{clientId:patient38.id,payerId:medicare.id,memberId:'synthetic-balm-38',relationship:'18',patientSex:'F',address:'200 Oak St',city:'Austin',state:'TX',postalCode:'78701',...coverage})
    const visit38=await pastVisit(h,patient38.id,base.priya,service.id,h.owner,19)
    await h.cmd('appointment.attend',{id:visit38})
    await h.cmd('pay.codes.save',{appointmentId:visit38,icd10:'M25.561, M54.50'})
    const note38=await h.cmd('note.write',{clientId:patient38.id,appointmentId:visit38,body:'Synthetic documented skilled exercise, manual therapy and initial evaluation.',charges:[{code:'97110',minutes:23,diagnosisCodes:['M25.561']},{code:'97140',minutes:15,diagnosisCodes:['M54.50']},{code:'97161',minutes:0,diagnosisCodes:['M25.561']}]},base.priya.cookie)
    const preview38=(await patientFile(h,patient38.id,base.priya.cookie)).notes.find(n=>n.id===note38.id).billing
    assert.deepEqual([preview38.timedMinutes,preview38.timedUnits,preview38.units],[38,3,4])
    assert.deepEqual(preview38.lines.map(l=>[l.code,l.units]),[['97110',2],['97140',1],['97161',1]])
    await h.cmd('note.sign',{id:note38.id,revision:1,signature:'Priya Shah',attest:true},base.priya.cookie)
    const invoice38=await h.cmd('invoice.prepare',{appointmentId:visit38});await h.cmd('invoice.approve',{id:invoice38.id})
    const claim38=await h.cmd('insurance.claim.prepare',{appointmentId:visit38,policyId:policy38.id})
    assert.equal(claim38.status,'ready',JSON.stringify(claim38.errors))
    assert.deepEqual(claim38.snapshot.lines.map(l=>[l.code,l.units,l.modifiers,l.diagnosisPointers]),[['97110',2,['GP'],[1]],['97140',1,['GP'],[2]],['97161',1,['GP'],[1]]])
    const batch38=await h.cmd('insurance.batch.prepare',{claimIds:[claim38.id]})
    const x1238=await h.send('/api/balm/insurance/837P/'+batch38.id,undefined,h.owner)
    for(const segment of [/SV1\*HC:97110:GP\*70.00\*UN\*2/,/SV1\*HC:97140:GP\*25.00\*UN\*1/,/SV1\*HC:97161:GP\*100.00\*UN\*1/])assert.match(x1238.text,segment)
    if(process.env.BALM_UI_SCREENSHOTS){const {viewportProof}=await import('./viewport-proof.mjs');await viewportProof(h,[{name:'CHART-006-medicare-38',path:'/app/clients/'+patient38.id,cookie:base.priya.cookie,selector:'#note-'+note38.id},{name:'CHART-006-medicare-charge',path:'/app/clients/'+patient38.id,cookie:h.owner,selector:'#claim-'+claim38.id}])}
  },{browserHttps:!!process.env.BALM_UI_SCREENSHOTS})
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
    const originalSignedCharges=JSON.stringify((await patientFile(h,patient.id,base.priya.cookie)).notes.find(n=>n.id===note.id).revisions[0].charges)
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
    assert.equal(JSON.stringify(signed.revisions[0].charges),originalSignedCharges,'the signed code identities and licensed release metadata survive subsequent visit edits')
  })
})

test('INS-012: balanced manual EOB batches post group checks, CARC/PR, interest and recoupments once into statements and deposits',async()=>{const {manualPayerJourney}=await import('./manual-payer-journey.mjs');await run(manualPayerJourney)})


test('INS-008: sourced claim work follows a KX denial through correction and payment',async()=>{const {denialWorkJourney}=await import('./denial-work-journey.mjs');await denialWorkJourney()})


test('INS-013: prior adjudications reach secondary and tertiary claims, crossover waits without duplicates, and patient balances wait for all payers',async()=>{const {cobJourney}=await import('./cob-journey.mjs');await run(h=>cobJourney(h,process.env.BALM_COB_VALIDATION),{auth:{BALM_INSURANCE_ADAPTER_URL:'https://clearinghouse.clinic.example/x12',BALM_INSURANCE_ADAPTER_TOKEN:'synthetic-balm-30'},outbound:async request=>{assert.equal(request.url,'https://clearinghouse.clinic.example/x12');return Response.json({status:'submitted',reference:'synthetic-balm-31'})}})})


test('CODE-001: effective CMS quarters, billable diagnosis children, clinician distinct-service attestations, MUE and licensed charge delivery',async()=>{
 const {codeSetJourney,codeSetEdge}=await import('./code-sets-journey.mjs')
 const {codeSetClaimAdapter}=await import('./code-sets-claims.mjs')
 const edge=codeSetEdge({therapyMue:true})
 await run(async h=>{await h.finishSetup();await codeSetJourney(h,edge,await codeSetClaimAdapter(h))},{codeSetEdge:edge})
})

test('CODE-001: explicit durable continuation preserves cursors and publishes only after every archive checksum',async()=>{const {codeImportJourney}=await import('./code-import-journey.mjs');await codeImportJourney()})


test('INS-005: referring NPI and dated 97140/97530 edit hold a claim until attested correction; payer authorization, certification and filing requirements hold every export',async()=>{
 const {codeSetEdge}=await import('./code-sets-journey.mjs')
 const {codeSetClaimAdapter}=await import('./code-sets-claims.mjs')
 const edge=codeSetEdge({therapyPtp:true})
 await run(async h=>{
  await h.finishSetup()
  const scrub=await codeSetClaimAdapter(h),state=await h.state(),payer=state.insurance.payers[0],clinician=state.staff.find(p=>p.role==='practitioner')
  await h.cmd('insurance.payer.save',{id:payer.id,name:payer.name,payerId:payer.payer_id,unitMethod:'cms',requiresReferral:true,fees:['00530','00532','0932T','97110','97140','97530'].map(code=>({code,cents:1000}))})
  const distinct={code1:'97140',code2:'97530',modifier:'59',reason:'Synthetic separate encounters and sites reviewed by the treating clinician',attested:true}
  const held=await scrub({date:'2026-10-01',diagnoses:['M25.561'],lines:[{code:'97140',units:1,modifiers:[]},{code:'97530',units:1,modifiers:[]}],distinctServices:[distinct]})
  assert.equal(held.status,'draft')
  assert.ok(held.errors.some(e=>e.code==='referring_npi_missing'))
  const edit=held.errors.find(e=>e.code==='ncci_ptp');assert.ok(edit);assert.match(edit.message,/97140/);assert.match(edit.message,/97530/);assert.match(edit.message,/32\.3 r0/)
  const claim=(await h.state()).insurance.queue.find(c=>c.id===held.id),patient=claim.client_id,visit=claim.appointment_id,policy=claim.policy_id
  let browser,context,page
  const capture=async(name,anchor='#claim-'+held.id)=>{
   if(!process.env.BALM_UI_SCREENSHOTS)return
   if(!browser){
    const {chromium}=await import('@playwright/test'),{mkdir}=await import('node:fs/promises');await mkdir(process.env.BALM_UI_SCREENSHOTS,{recursive:true})
    browser=await chromium.launch({headless:true,args:['--use-mock-keychain','--password-store=basic']});context=await browser.newContext({ignoreHTTPSErrors:true})
    for(const [pattern,path,contentType]of [['**/rer-theme.css','public/rer-theme.css','text/css'],['**/fonts/fonts.css','public/fonts/fonts.css','text/css'],['**/brand/mark.svg','public/brand/mark.svg','image/svg+xml']])await context.route(pattern,r=>r.fulfill({path,contentType}))
    await context.route('**/fonts/inter/*.woff2',r=>r.fulfill({path:'public'+new URL(r.request().url()).pathname,contentType:'font/woff2'}))
    const [key,...value]=h.owner.split('=');await context.addCookies([{name:key,value:value.join('='),url:h.origin,secure:true}]);page=await context.newPage()
   }
   for(const width of [1440,390]){
    await page.setViewportSize({width,height:1000});await page.goto(h.origin+(anchor==='#claim-requirements'?'/app/insurance':'/app/clients/'+patient))
    const target=page.locator(anchor);if(anchor==='#claim-requirements'){
     await target.locator('summary').click()
     const rule=target.locator('form').first();await rule.locator('[name=authorization]').check();await rule.locator('[name=certification]').check();await rule.locator('[name=filing]').check()
     await rule.locator('[name=source]').fill('synthetic-balm-1 payer contract, authorization/certification and filing section')
     await Promise.all([page.waitForNavigation(),rule.getByRole('button',{name:'Save claim requirements',exact:true}).click()]);await target.locator('summary').click()
    }
    await target.scrollIntoViewIfNeeded();assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),name+' fits '+width)
    // Audit this screen's icon-only controls; each needs the shared delayed hover / immediate focus tooltip.
    const iconControls=page.locator('button,a').filter({visible:true});
    for(const el of await iconControls.all()){
     const text=(await el.innerText()).trim(),label=await el.getAttribute('aria-label')
     if(label&&!/[a-zA-Z]{2}/.test(text)){
      const tip=el.locator('[role=tooltip]');assert.equal(await tip.count(),1,'icon-only '+label+' has a tooltip')
      await el.focus();assert.equal(await tip.isVisible(),true,'keyboard focus shows '+label)
      await page.locator('h1').click();await el.hover();await page.waitForTimeout(350);assert.equal(await tip.isVisible(),true,'hover shows '+label)
     }
    }
    await page.screenshot({path:process.env.BALM_UI_SCREENSHOTS+'/'+name+'-'+width+'.png'})
   }
  }
  try{
   await capture('INS-005-held-edit')
   await h.cmd('insurance.batch.prepare',{claimIds:[held.id]},h.owner,409)
   await h.cmd('pay.codes.save',{appointmentId:visit,icd10:'M25.561',cpt:'97140\n97530 59'})
   const fixed=await h.cmd('insurance.claim.correct',{id:held.id,referringFirst:'synthetic-balm-1',referringLast:'synthetic-balm-2',referringNpi:'1234567893'})
   assert.equal(fixed.status,'ready',JSON.stringify(fixed.errors));assert.deepEqual(fixed.errors,[])
   const requirements={payerId:payer.id,authorization:true,certification:true,filing:true,source:'synthetic-balm-1 payer contract, authorization/certification and filing section'}
   const biller=await h.staff('synthetic-balm-94','biller')
   await h.cmd('insurance.requirements.save',requirements,biller.cookie,403)
   await h.cmd('insurance.requirements.save',requirements)
   const required=await h.cmd('insurance.claim.scrub',{id:fixed.id})
   for(const code of ['authorization_required','plan_certification_required','filing_rule_required'])assert.ok(required.errors.some(e=>e.code===code),code)
   await capture('INS-005-payer-requirements','#claim-requirements')
   await h.cmd('insurance.authorization.save',{policyId:policy,number:'synthetic-balm-95',startsOn:'2026-10-01',endsOn:'2026-12-31',visits:12})
   const plan=await h.cmd('plan.send',{clientId:patient,practitionerId:clinician.id,diagnoses:'M25.561',shortTermGoals:'Synthetic short-term goal',longTermGoals:'Synthetic long-term goal',frequencyPerWeek:2,durationWeeks:12,interventions:'Synthetic documented distinct manual therapy and therapeutic activities',startDate:'2026-10-01',physicianName:'synthetic-balm-1 synthetic-balm-2',physicianEmail:'synthetic-balm-1@example.test',signature:clinician.name,credentials:'PT',attest:true},await h.signIn(clinician.email))
   assert.equal((await h.form('/plan/'+plan.token,{name:'synthetic-balm-1 synthetic-balm-2',credentials:'MD',npi:'1234567893',attest:'on'})).status,303)
   await h.cmd('insurance.filing.save',{payerId:payer.id,kind:'initial',basis:'service_date',days:0,effectiveFrom:'2026-10-01',source:'synthetic-balm-1 expired initial filing instruction'})
   const expired=await h.cmd('insurance.claim.scrub',{id:fixed.id})
   assert.deepEqual(expired.errors.map(e=>e.code),['timely_filing_expired'])
   assert.match(expired.errors[0].message,/2026-10-01/)
   await capture('INS-005-filing-held','#claim-'+fixed.id)
   await h.cmd('insurance.filing.save',{payerId:payer.id,kind:'initial',basis:'service_date',days:3660,effectiveFrom:'2026-10-01',source:'synthetic-balm-1 corrected payer filing instruction'})
   assert.equal((await h.cmd('insurance.claim.scrub',{id:fixed.id})).status,'ready')
   await capture('INS-005-clean-attested','#claim-'+fixed.id)
   const batch=await h.cmd('insurance.batch.prepare',{claimIds:[fixed.id]})
   const x12=await h.send('/api/balm/insurance/837P/'+batch.id,undefined,h.owner)
   assert.equal(x12.status,200,x12.text);assert.match(x12.text,/SV1\*HC:97530:59:GP\*10.00\*UN\*1/);assert.match(x12.text,/NM1\*DN\*1\*SYNTHETIC-BALM-2\*SYNTHETIC-BALM-1/)
   await h.cmd('insurance.filing.save',{payerId:payer.id,kind:'initial',basis:'service_date',days:0,effectiveFrom:'2026-10-01',source:'synthetic-balm-1 newly corrected expiration'})
   assert.equal((await h.send('/api/balm/insurance/837P/'+batch.id,undefined,h.owner)).status,409,'a previously prepared file cannot bypass the current filing deadline')
   const sent=await h.cmd('insurance.batch.submit',{id:batch.id},h.owner,409);assert.match(sent.code,/filing deadline/)
   const denied=(await fixture('835-denied.x12',{CLAIM:fixed.id})).replace('*4*95*','*4*20*').replace('197*95~','197*20~').replace('AETNA*XV*60054','SYNTHETIC*XV*SYNTHETIC70')
   await h.cmd('insurance.remittance.import',{payerId:payer.id,x12:denied})
   await h.cmd('insurance.authorization.save',{policyId:policy,number:'synthetic-balm-97',startsOn:'2026-10-01',endsOn:'2026-12-31',visits:12})
   const replacement=await h.cmd('insurance.claim.correct',{id:fixed.id})
   assert.deepEqual(replacement.errors.map(e=>e.code),['filing_rule_required'])
   await h.cmd('insurance.filing.save',{payerId:payer.id,kind:'correction',basis:'adjudication_date',days:30,effectiveFrom:'2026-10-01',source:'synthetic-balm-1 corrected claims section'})
   assert.deepEqual((await h.cmd('insurance.claim.scrub',{id:replacement.id})).errors.map(e=>e.code),['filing_date_required'])
   await h.cmd('insurance.filing.date',{id:fixed.id,adjudicationOn:new Date().toISOString().slice(0,10),source:'synthetic-balm-1 actual payer decision date'})
   assert.equal((await h.cmd('insurance.claim.scrub',{id:replacement.id})).status,'ready')
   const correction=await h.cmd('insurance.batch.prepare',{claimIds:[replacement.id]})
   const corrected=await h.send('/api/balm/insurance/837P/'+correction.id,undefined,h.owner)
   assert.equal(corrected.status,200,corrected.text);assert.match(corrected.text,/11:B:7/);assert.match(corrected.text,/REF\*F8\*PAYERDENIED001/)

  }finally{await browser?.close()}
 },{codeSetEdge:edge,browserHttps:!!process.env.BALM_UI_SCREENSHOTS,auth:{BALM_INSURANCE_ADAPTER_URL:'https://clearinghouse.clinic.example/x12',BALM_INSURANCE_ADAPTER_TOKEN:'synthetic-balm-96'},outbound:async()=>{throw Error('Scrubber must refuse before any payer request')}})
})


test('INS-001: dated plan contracts price service-date units and fees without rewriting issued documents; owner records provider licenses',async()=>{
 await run(async h=>{
  const c=await setup(h),state=await h.state(),service=state.services[0]
  const second=await h.staff('synthetic-balm-101','practitioner',{discipline:'pt'})
  await h.cmd('pay.npi.save',{staffId:second.id,npi:'1234567893'})
  await h.cmd('insurance.enrollment.save',{payerId:c.payer.id,practitionerId:second.id,taxonomy:'225100000X',active:true})
  const license={practitionerId:second.id,state:'TX',number:'synthetic-balm-102',startsOn:'2020-01-01',endsOn:'2030-12-31',source:'synthetic-balm-103 state board certificate'}
  await h.cmd('insurance.license.save',license,c.biller.cookie,403)
  await h.cmd('insurance.license.save',license)
  const plan='synthetic-balm-104',day=c.serviceDate
  const schedule={payerId:c.payer.id,planName:plan,effectiveOn:'2020-01-01',kind:'contracted',unitMethod:'ama',fees:[{code:'97110',cents:2100},{code:'97140',cents:1900}],source:'synthetic-balm-105 original plan contract'}
  await h.cmd('insurance.schedule.save',schedule,c.biller.cookie,403)
  await h.cmd('insurance.schedule.save',schedule)
  const later=await h.cmd('insurance.schedule.save',{...schedule,effectiveOn:day,unitMethod:'fixed',fixedUnitMinutes:10,fees:[{code:'97110',cents:3000},{code:'97140',cents:2000}],source:'synthetic-balm-106 plan amendment'})
  const oldDay=new Date(Date.parse(day+'T12:00:00Z')-5*86400000).toISOString().slice(0,10)
  const bundle={provider:'cliniko',practitionerId:c.priya.id,serviceId:service.id,dateFormat:'MDY',files:[
   {kind:'patients',name:'patients.csv',csv:'Patient ID,First Name,Last Name,Date of Birth\nsynthetic-balm-110,Synthetic,Dated plan,1980-01-01\n'},
   {kind:'appointments',name:'appointments.csv',csv:`Source ID,Patient ID,Start At,End At,Status\nsynthetic-balm-111,synthetic-balm-110,${oldDay}T01:00:00+10:00,${oldDay}T01:45:00+10:00,booked\nsynthetic-balm-112,synthetic-balm-110,${day}T01:00:00+10:00,${day}T01:45:00+10:00,booked\n`}]}
  const preview=await h.cmd('movein.preview',bundle);assert.equal(preview.canApply,true)
  const moved=await h.cmd('movein.apply',{...bundle,fingerprint:preview.fingerprint,acceptanceReason:'Reviewed synthetic dated contract test appointments'})
  const patient={id:moved.records.find(r=>r.target_table==='bm_clients').target_id}
  const policy=await h.cmd('insurance.policy.save',{clientId:patient.id,payerId:c.payer.id,planName:plan,memberId:'synthetic-balm-107',relationship:'18',patientSex:'F',address:'100 Synthetic St',city:'Austin',state:'TX',postalCode:'78701',...coverage})
  const make=async(hours,minutes)=>{
   const visit=moved.records.find(r=>r.source_id===(hours===60?'synthetic-balm-111':'synthetic-balm-112')).target_id
   await h.cmd('appointment.attend',{id:visit})
   await h.cmd('pay.codes.save',{appointmentId:visit,icd10:'M25.561'})
   const note=await h.cmd('note.write',{clientId:patient.id,appointmentId:visit,body:'Synthetic skilled care',charges:[{code:'97110',minutes},{code:'97140',minutes}]},c.priya.cookie)
   await h.cmd('note.sign',{id:note.id,revision:1,signature:'Priya Shah',attest:true},c.priya.cookie)
   const invoice=await h.cmd('invoice.prepare',{appointmentId:visit});await h.cmd('invoice.approve',{id:invoice.id})
   const claim=await h.cmd('insurance.claim.prepare',{appointmentId:visit,policyId:policy.id})
   return {visit,note,invoice,claim,date:await visitDate(h,visit)}
  }
  const old=await make(60,8),current=await make(5,20)
  assert.ok(old.date<day)
  assert.deepEqual(old.invoice.snapshot.procedures.map(l=>l.units),[1,1]);assert.equal(old.invoice.snapshot.amountCents,4000)
  assert.deepEqual(current.claim.snapshot.lines.map(l=>l.units),[2,2]);assert.equal(current.invoice.snapshot.amountCents,10000)
  assert.equal(current.invoice.snapshot.timedUnitBasis.schedule.id,later.id)
  const auth=await h.cmd('insurance.authorization.save',{policyId:policy.id,number:'synthetic-balm-108',...coverage,allowanceKind:'units',units:8,unitsPerVisit:2,lowRemainder:2})
  let file=await patientFile(h,patient.id)
  assert.equal(file.insurance.authorizations.find(a=>a.id===auth.id).used_units,6)
  assert.ok((await h.state()).dailyClose.authorizations.some(a=>a.clientId===patient.id&&a.kind==='low_authorization'))
  const frozen=(await h.send('/api/balm/invoices/'+current.invoice.id+'.html',undefined,h.owner)).text
  await h.cmd('insurance.schedule.save',{...schedule,effectiveOn:'2090-01-01',unitMethod:'cms',fees:[{code:'97110',cents:9000},{code:'97140',cents:9000}]})
  const refreshed=await h.cmd('insurance.claim.scrub',{id:current.claim.id});assert.equal(refreshed.status,'ready')
  file=await patientFile(h,patient.id,c.priya.cookie)
  assert.deepEqual(file.notes.find(n=>n.id===current.note.id).billing.lines.map(l=>l.units),[2,2])
  assert.equal((await h.send('/api/balm/invoices/'+current.invoice.id+'.html',undefined,h.owner)).text,frozen)
  assert.equal((await h.state()).insurance.licenses[0].number,license.number)
  assert.equal((await h.state(c.biller.cookie)).insurance.licenses.length,0)
  if(process.env.BALM_UI_SCREENSHOTS){
   const {viewportProof}=await import('./viewport-proof.mjs')
   await viewportProof(h,[{name:'INS-001-dated-schedules',path:'/app/insurance',cookie:h.owner,selector:'#dated-billing',openSelector:'#dated-billing > summary',interact:async({page,width})=>{
    const form=page.locator('#dated-billing form');await form.locator('[name=planName]').fill('synthetic-balm-'+width)
    await form.locator('[name=effectiveOn]').fill('2026-01-01');await form.locator('[name=unitMethod]').selectOption('ama');await form.locator('[name=feeSchedule]').fill('97110 21.00\n97140 19.00');await form.locator('[name=source]').fill('synthetic-balm-109 browser contract')
    await Promise.all([page.waitForNavigation(),form.getByRole('button',{name:'Record dated schedule',exact:true}).click()]);await page.locator('#dated-billing > summary').click()
   }},{name:'INS-001-license',path:'/app/insurance',cookie:h.owner,selector:'#provider-licenses',openSelector:'#provider-licenses > summary'}])
  }
 },{browserHttps:!!process.env.BALM_UI_SCREENSHOTS})
})

test('MOVE-007: reviewed aging and mixed 835 retain migrated payments and unmatched suspense without losing or duplicating a deposit',async()=>{
 await run(async h=>{
  const c=await setup(h),owner=h.owner
  const claim=await h.cmd('insurance.claim.prepare',{appointmentId:c.appointmentId,policyId:c.policy.id})
  const batch=await h.cmd('insurance.batch.prepare',{claimIds:[claim.id]});await h.send('/api/balm/insurance/837P/'+batch.id,undefined,owner)
  const csvHeader='Source claim,Patient ID,Payer ID,Patient control,Payer control,Service date,Billed,Balance,Status\n'
  const csv=csvHeader+`synthetic-balm-201,${c.patient.id},${c.payer.id},synthetic-balm-202,synthetic-balm-203,${c.serviceDate},100.00,80.00,open\n`
  const input={source:'synthetic-balm-200',csv}
  await h.cmd('insurance.runout.preview',input,c.biller.cookie,403)
  const preview=await h.cmd('insurance.runout.preview',input,owner)
  assert.equal(preview.count,1);assert.equal(preview.balanceCents,8000)
  await h.cmd('insurance.runout.apply',{...input,fingerprint:preview.fingerprint,expectedBalanceCents:8100},owner,409)
  await h.cmd('insurance.runout.apply',{...input,csv:csv.replace('80.00','70.00'),fingerprint:preview.fingerprint,expectedBalanceCents:7000},owner,409)
  assert.equal((await h.cmd('insurance.runout.read',{},owner)).claims.length,0)
  const applied=await h.cmd('insurance.runout.apply',{...input,fingerprint:preview.fingerprint,expectedBalanceCents:8000},owner)
  const make=(trace,claims)=>{
   const segments=['ST*835*0001*005010X221A1',`BPR*I*${claims.reduce((t,r)=>t+r.paid,0).toFixed(2)}*C*CHK************20261023`,`TRN*1*${trace}*1234567890`,'N1*PR*AETNA*XV*60054',...claims.flatMap(r=>[`CLP*${r.id}*${r.denied?'4':'1'}*${r.billed}*${r.paid}*${r.pr??0}*CI*${r.control??''}`,`CAS*CO*${r.denied?'197':'45'}*${r.co}`,...(r.pr?[`CAS*PR*3*${r.pr}`]:[]),...(r.patient?[`NM1*QC*1*${r.patient.last}*${r.patient.first}`,`DTM*232*${c.serviceDate.replaceAll('-','')}`]:[])])]
   return segments.join('~')+`~SE*${segments.length+1}*0001~`
  }
  const mixed=make('synthetic-balm-204',[
   {id:claim.id,billed:95,paid:60,co:20,pr:15,control:'synthetic-balm-205'},
   {id:'synthetic-balm-202',billed:100,paid:50,co:20,pr:30,control:'synthetic-balm-203'},
   {id:'synthetic-balm-206',billed:40,paid:30,co:10,control:'synthetic-balm-207'},
  ])
  // A failed native line refuses the complete mixed import; no partial ledger writes.
  await h.cmd('insurance.remittance.import',{payerId:c.payer.id,x12:mixed.replace(`CLP*${claim.id}*1*95`,`CLP*${claim.id}*1*96`)},owner,400)
  assert.equal((await h.cmd('insurance.runout.read',{},owner)).totals.remainingCents,8000)
  const posted=await h.cmd('insurance.remittance.import',{payerId:c.payer.id,x12:mixed},owner)
  assert.equal(posted.depositCents,14000);assert.equal(posted.claims.length,3)
  let report=await h.cmd('insurance.runout.read',{},owner)
  assert.equal(report.totals.importedCents,8000);assert.equal(report.totals.remainingCents,1000)
  assert.equal(report.posted.paidCents,5000);assert.equal(report.posted.adjustmentCents,2000)
  assert.equal(report.totals.importedCents-report.posted.paidCents-report.posted.adjustmentCents,report.totals.remainingCents)
  assert.equal(report.suspense.length,1);assert.equal(report.suspense[0].paid_cents,3000)
  assert.equal(report.deposits[0].nativeCents,6000);assert.equal(report.deposits[0].migratedCents,5000);assert.equal(report.deposits[0].suspenseCents,3000)
  assert.equal(report.deposits[0].nativeCents+report.deposits[0].migratedCents+report.deposits[0].suspenseCents,report.deposits[0].depositCents)
  assert.equal(Object.values(report.totals.byPayerAge).reduce((t,n)=>t+n,0),1000)
  const native=(await patientFile(h,c.patient.id)).insurance.claims.find(q=>q.id===claim.id)
  assert.equal(native.payer_paid_cents,6000)
  assert.equal((await h.cmd('insurance.remittance.import',{payerId:c.payer.id,x12:mixed},owner)).duplicate,true)
  assert.equal((await h.cmd('insurance.runout.apply',{...input,fingerprint:preview.fingerprint,expectedBalanceCents:8000},owner)).imported,0)
  await h.cmd('insurance.runout.close',{attest:true},owner,409)
  const screen=await h.send('/app/insurance',undefined,owner);assert.match(screen.text,/Unmatched remittances/);assert.match(screen.text,/synthetic-balm-206/)
  const deskState=await h.state(c.biller.cookie);assert.equal(deskState.insurance.runout,null)
  if(process.env.BALM_UI_SCREENSHOTS){const {viewportProof}=await import('./viewport-proof.mjs');await viewportProof(h,[{name:'MOVE-007-mixed-835',path:'/app/insurance',cookie:owner,selector:'#runout',open:'Migrated claims'}])}
  // Later reviewed source aging can identify the suspense claim without replaying the original deposit.
  const secondCsv=csvHeader+`synthetic-balm-208,${c.patient.id},${c.payer.id},synthetic-balm-209,synthetic-balm-207,${c.serviceDate},40.00,40.00,open\n`
  const second={source:input.source,csv:secondCsv},secondPreview=await h.cmd('insurance.runout.preview',second,owner)
  const secondApplied=await h.cmd('insurance.runout.apply',{...second,fingerprint:secondPreview.fingerprint,expectedBalanceCents:4000},owner)
  await h.cmd('insurance.runout.resolve',{id:report.suspense[0].id,claimId:applied.claims[0],attest:true},owner,409)
  await h.cmd('insurance.runout.resolve',{id:report.suspense[0].id,claimId:secondApplied.claims[0],attest:true},owner)
  await h.cmd('insurance.runout.resolve',{id:report.suspense[0].id,claimId:secondApplied.claims[0],attest:true},owner,409)
  report=await h.cmd('insurance.runout.read',{},owner);assert.equal(report.suspense.length,0)
  assert.equal(report.totals.remainingCents,1000)
  assert.equal(report.deposits[0].nativeCents+report.deposits[0].migratedCents+report.deposits[0].suspenseCents,14000)
  // Payer-control and patient/date/amount fallback both match, with the latter refusing ambiguity.
  const remainder=make('synthetic-balm-210',[{id:'unknown-legacy-control',billed:100,paid:10,co:0,pr:90,control:'synthetic-balm-203'}])
  await h.cmd('insurance.remittance.import',{payerId:c.payer.id,x12:remainder},owner)
  assert.equal((await h.cmd('insurance.runout.read',{},owner)).totals.remainingCents,0)
  await h.cmd('insurance.runout.close',{attest:true},owner)
  assert.equal((await h.cmd('insurance.runout.read',{},owner)).closed,true)
 },{browserHttps:!!process.env.BALM_UI_SCREENSHOTS})
})

test('MOVE-007: a denied legacy receivable becomes a frequency-7 signed-charge correction with its original control and no duplicate balance',async()=>{
 await run(async h=>{
  const c=await setup(h),owner=h.owner
  const input={source:'synthetic-balm-230',csv:`Source claim,Patient ID,Payer ID,Patient control,Payer control,Service date,Billed,Balance,Status\nsynthetic-balm-231,${c.patient.id},${c.payer.id},synthetic-balm-232,synthetic-balm-233,${c.serviceDate},95.00,80.00,denied\n`}
  const preview=await h.cmd('insurance.runout.preview',input,owner)
  const imported=await h.cmd('insurance.runout.apply',{...input,fingerprint:preview.fingerprint,expectedBalanceCents:8000},owner)
  const claim=await h.cmd('insurance.claim.prepare',{appointmentId:c.appointmentId,policyId:c.policy.id})
  await h.cmd('insurance.runout.correct',{id:imported.claims[0],claimId:claim.id},owner,400)
  await h.cmd('insurance.runout.correct',{id:imported.claims[0],claimId:claim.id,attest:true},c.biller.cookie,403)
  const correction=await h.cmd('insurance.runout.correct',{id:imported.claims[0],claimId:claim.id,attest:true},owner)
  assert.equal(correction.frequency,'7');assert.equal(correction.originalControl,'synthetic-balm-233')
  let report=await h.cmd('insurance.runout.read',{},owner)
  assert.equal(report.totals.remainingCents,8000);assert.equal(report.totals.importedCents,8000)
  await h.cmd('insurance.runout.correct',{id:imported.claims[0],claimId:claim.id,attest:true},owner,409)
  await h.cmd('insurance.runout.close',{attest:true},owner,409)
  const batch=await h.cmd('insurance.batch.prepare',{claimIds:[claim.id]})
  const file=await h.send('/api/balm/insurance/837P/'+batch.id,undefined,owner)
  assert.equal(file.status,200);assert.match(file.text,new RegExp(`CLM\\*${claim.id}\\*95.00\\*\\*\\*11:B:7`));assert.match(file.text,/REF\*F8\*SYNTHETIC-BALM-233/)
  const submitted=await h.cmd('insurance.batch.submit',{id:batch.id},owner)
  assert.equal(submitted.status,'submitted')
  const paid=await fixture('835-paid.x12',{CLAIM:'synthetic-balm-232'})
  // The old patient-control number follows the transferred receivable into Balm.
  await h.cmd('insurance.remittance.import',{payerId:c.payer.id,x12:paid},owner)
  report=await h.cmd('insurance.runout.read',{},owner)
  assert.equal(report.totals.remainingCents,0);assert.equal(report.posted.paidCents,6000);assert.equal(report.posted.adjustmentCents,2000)
  assert.equal(report.totals.importedCents-report.posted.paidCents-report.posted.adjustmentCents,0)
  await h.cmd('insurance.runout.close',{attest:true},owner)
  await h.cmd('insurance.runout.reopen',{attest:true},owner)
  assert.equal((await h.cmd('insurance.runout.read',{},owner)).closed,false)
  await h.cmd('insurance.runout.close',{attest:true},owner)
  if(process.env.BALM_UI_SCREENSHOTS){const {viewportProof}=await import('./viewport-proof.mjs');await viewportProof(h,[{name:'MOVE-007-corrected-runout',path:'/app/insurance',cookie:owner,selector:'#runout',open:'Migrated claims'}])}
 },{browserHttps:!!process.env.BALM_UI_SCREENSHOTS,auth:{BALM_INSURANCE_ADAPTER_URL:'https://clearinghouse.clinic.example/x12',BALM_INSURANCE_ADAPTER_TOKEN:'synthetic-balm-234'},outbound:async request=>{const sent=await request.json();assert.equal(sent.kind,'837P');assert.match(sent.body,/11:B:7/);assert.match(sent.body,/REF\*F8\*SYNTHETIC-BALM-233/);return Response.json({status:'submitted',reference:'synthetic-balm-235'})}})
})

test('MOVE-007: a scanned paper EOB closes one mixed native, legacy and unmatched deposit once',async()=>{
 await run(async h=>{
  const c=await setup(h),owner=h.owner,claim=await h.cmd('insurance.claim.prepare',{appointmentId:c.appointmentId,policyId:c.policy.id})
  const exported=await h.cmd('insurance.batch.prepare',{claimIds:[claim.id]});await h.send('/api/balm/insurance/837P/'+exported.id,undefined,owner)
  const input={source:'synthetic-balm-240',csv:`Source claim,Patient ID,Payer ID,Patient control,Payer control,Service date,Billed,Balance,Status\nsynthetic-balm-241,${c.patient.id},${c.payer.id},synthetic-balm-242,synthetic-balm-243,${c.serviceDate},100.00,100.00,open\n`}
  const preview=await h.cmd('insurance.runout.preview',input,owner);await h.cmd('insurance.runout.apply',{...input,fingerprint:preview.fingerprint,expectedBalanceCents:10000},owner)
  const paper=await h.cmd('insurance.payer_batch.prepare',{payerId:c.payer.id,reference:'synthetic-balm-244',depositOn:c.serviceDate,amountCents:14000},owner)
  const add=(claimId,billedCents,paidCents,co,pr)=>h.cmd('insurance.payer_line.add',{batchId:paper.id,kind:'payment',claimId,billedCents,allowedCents:paidCents+pr,paidCents,adjustments:[{group:'CO',reason:'45',amountCents:co},...(pr?[{group:'PR',reason:'3',amountCents:pr}]:[])],payerControl:claimId==='synthetic-balm-242'?'synthetic-balm-243':'synthetic-balm-245',reason:'Synthetic original paper EOB line'},owner)
  await add(claim.id,9500,6000,2000,1500);await add('synthetic-balm-242',10000,5000,2000,3000)
  const attachment='data:application/pdf;base64,'+Buffer.from('%PDF-1.4\nsynthetic-balm-246 original paper EOB\n%%EOF').toString('base64')
  await h.cmd('insurance.payer_eob.attach',{batchId:paper.id,attachment,attachmentName:'synthetic-balm-246.pdf',attest:true},owner)
  await h.cmd('insurance.payer_batch.close',{id:paper.id,attest:true},owner,409)
  assert.equal((await h.cmd('insurance.runout.read',{},owner)).totals.remainingCents,10000)
  await add('synthetic-balm-247',4000,3000,1000,0)
  // A newly added legacy/unknown line withdraws the earlier patient-scope attestation.
  assert.match((await h.cmd('insurance.payer_batch.close',{id:paper.id,attest:true},owner,400)).code,/attach_the_scanned_EOB/)
  await h.cmd('insurance.payer_eob.attach',{batchId:paper.id,attachment,attachmentName:'synthetic-balm-246.pdf',attest:true},owner)
  const posted=await h.cmd('insurance.payer_batch.close',{id:paper.id,attest:true},owner)
  assert.equal(posted.depositCents,14000)
  const report=await h.cmd('insurance.runout.read',{},owner)
  assert.equal(report.totals.remainingCents,3000);assert.equal(report.posted.paidCents,5000);assert.equal(report.posted.adjustmentCents,2000)
  assert.equal(report.suspense.length,1);assert.equal(report.suspense[0].paid_cents,3000)
  assert.equal((await patientFile(h,c.patient.id)).insurance.claims.find(q=>q.id===claim.id).payer_paid_cents,6000)
  await h.cmd('insurance.payer_batch.close',{id:paper.id,attest:true},owner,409)
  assert.equal((await h.send('/api/balm/insurance/eob/'+paper.id,undefined,c.biller.cookie)).status,403)
  assert.equal((await h.state(c.biller.cookie)).insurance.manualPayers.some(b=>b.id===paper.id),false)
  const original=await h.send('/api/balm/insurance/eob/'+paper.id,undefined,owner);assert.equal(original.status,200);assert.match(original.text,/synthetic-balm-246 original paper EOB/)
  if(process.env.BALM_UI_SCREENSHOTS){const {viewportProof}=await import('./viewport-proof.mjs');await viewportProof(h,[{name:'MOVE-007-paper-suspense',path:'/app/insurance',cookie:owner,selector:'#runout'},{name:'MOVE-007-paper-deposit',path:'/app/insurance',cookie:owner,selector:'#payer-batch-'+paper.id}])}
 },{browserHttps:!!process.env.BALM_UI_SCREENSHOTS})
})

test('INS-010: owner records carrier instructions and a patient-bound progress report in a PWK claim, while unconfigured report delivery refuses without sending',async()=>{
 await run(async h=>{
  const c=await setup(h),owner=h.owner
  const input={policyId:c.policy.id,kind:'workers_comp',claimNumber:'synthetic-balm-251',adjuster:'Synthetic Adjuster',adjusterEmail:'adjuster@example.test',employerAttorney:'Synthetic Employer',billingRequirements:'Use carrier claim number on every bill',authorizationRequirements:'Carrier authorization required for the current episode',reportRequirements:'Progress report with the billed visit',source:'synthetic-balm-252 carrier written instructions'}
  await h.cmd('insurance.injury.save',input,c.biller.cookie,403)
  const injury=await h.cmd('insurance.injury.save',input,owner)
  const pdf='data:application/pdf;base64,'+Buffer.from('%PDF-1.4\nsynthetic-balm-253 progress report\n%%EOF').toString('base64')
  const report=await h.cmd('chart.document.upload',{clientId:c.patient.id,title:'Synthetic progress report',documentType:'other',documentDate:c.serviceDate,attachment:pdf,attachmentName:'synthetic-balm-253.pdf',searchText:'Required carrier progress report'},owner)
  const other=await h.cmd('client.save',{firstName:'Synthetic',lastName:'Other injury',dateOfBirth:'1980-01-01'})
  const unrelated=await h.cmd('chart.document.upload',{clientId:other.id,title:'Other report',documentType:'other',documentDate:c.serviceDate,attachment:pdf,attachmentName:'synthetic-balm-254.pdf'},owner)
  const attach={id:injury.id,appointmentId:c.appointmentId,documentId:report.id,attachmentControl:'synthetic-balm-255',attest:true}
  await h.cmd('insurance.injury.attach',{...attach,documentId:unrelated.id},owner,409)
  await h.cmd('insurance.injury.attach',attach,c.biller.cookie,403)
  const linked=await h.cmd('insurance.injury.attach',attach,owner);assert.equal(linked.transport,'unavailable')
  const claim=await h.cmd('insurance.claim.prepare',{appointmentId:c.appointmentId,policyId:c.policy.id},owner)
  assert.equal(claim.status,'ready');assert.equal(claim.snapshot.injury.documentId,report.id)
  await h.cmd('insurance.batch.prepare',{claimIds:[claim.id]},c.biller.cookie,403)
  const batch=await h.cmd('insurance.batch.prepare',{claimIds:[claim.id]},owner)
  const downloaded=await h.send('/api/balm/insurance/837P/'+batch.id,undefined,owner)
  assert.equal(downloaded.status,200);assert.match(downloaded.text,/REF\*Y4\*SYNTHETIC-BALM-251/);assert.match(downloaded.text,/PWK\*OZ\*AA\*\*\*AC\*SYNTHETIC-BALM-255/);assert.match(downloaded.text,/SBR\*P\*18\*[^~]*\*WC~/)
  assert.equal((await h.send('/api/balm/insurance/837P/'+batch.id,undefined,c.biller.cookie)).status,403)
  const refused=await h.cmd('insurance.batch.submit',{id:batch.id},owner,409);assert.equal(refused.code,'injury_report_transport_not_configured_no_claim_sent')
  assert.ok(!h.outboundRequests.some(r=>r.origin==='https://clearinghouse.clinic.example'))
  assert.equal((await h.state(c.biller.cookie)).insurance.injuryCases,null)
  assert.equal((await patientFile(h,c.patient.id,c.biller.cookie)).insurance.claims.find(q=>q.id===claim.id).snapshot.injury,undefined)
  const state=await h.state();assert.equal(state.insurance.injuryCases[0].claim_number,input.claimNumber);assert.equal(state.insurance.injuryCases[0].report_requirements,input.reportRequirements)
  if(process.env.BALM_UI_SCREENSHOTS){const {viewportProof}=await import('./viewport-proof.mjs');await viewportProof(h,[{name:'INS-010-carrier-requirements',path:'/app/insurance',cookie:owner,selector:'#injury-cases'}])}
 },{browserHttps:!!process.env.BALM_UI_SCREENSHOTS,auth:{BALM_INSURANCE_ADAPTER_URL:'https://clearinghouse.clinic.example/x12',BALM_INSURANCE_ADAPTER_TOKEN:'synthetic-balm-256'},outbound:async()=>{throw Error('Unconfigured clinical report transport must refuse before egress')}})
})

test('MOVE-007: name/date/amount fallback posts only for one clinic patient and one migrated claim',async()=>{
 await run(async h=>{
  const c=await setup(h),owner=h.owner
  const input={source:'synthetic-balm-270',csv:`Source claim,Patient ID,Payer ID,Patient control,Payer control,Service date,Billed,Balance,Status\nsynthetic-balm-271,${c.patient.id},${c.payer.id},synthetic-balm-272,synthetic-balm-273,${c.serviceDate},60.00,60.00,open\n`}
  const add=async(value)=>{const p=await h.cmd('insurance.runout.preview',value,owner);return h.cmd('insurance.runout.apply',{...value,fingerprint:p.fingerprint,expectedBalanceCents:p.balanceCents},owner)}
  await add(input)
  const remit=(trace,amount)=>`ST*835*0001*005010X221A1~BPR*I*${amount}*C*CHK************20261023~TRN*1*${trace}*1234567890~N1*PR*AETNA*XV*60054~CLP*${trace}*1*${amount}*${amount}*0*CI*UNKNOWN~NM1*QC*1*LEE*MAYA~DTM*232*${c.serviceDate.replaceAll('-','')}~SE*8*0001~`
  const first=await h.cmd('insurance.remittance.import',{payerId:c.payer.id,x12:remit('synthetic-balm-274',60)},owner)
  assert.equal(first.claims[0].migrated,true)
  assert.equal((await h.cmd('insurance.runout.read',{},owner)).totals.remainingCents,0)
  const next={...input,csv:input.csv.replaceAll('synthetic-balm-271','synthetic-balm-275').replaceAll('synthetic-balm-272','synthetic-balm-276').replaceAll('synthetic-balm-273','synthetic-balm-277').replaceAll('60.00','70.00')}
  const moved=await add(next)
  await h.cmd('client.save',{firstName:'Maya',lastName:'Lee',dateOfBirth:'1990-01-01'})
  const ambiguous=await h.cmd('insurance.remittance.import',{payerId:c.payer.id,x12:remit('synthetic-balm-278',70)},owner)
  assert.equal(ambiguous.claims[0].suspense,true,'a same-named clinic patient prevents automatic identity selection even when only one claim matches')
  const report=await h.cmd('insurance.runout.read',{},owner)
  assert.equal(report.totals.remainingCents,7000);assert.equal(report.suspense[0].paid_cents,7000)
  await h.cmd('insurance.runout.resolve',{id:report.suspense[0].id,claimId:moved.claims[0],attest:true},owner)
  assert.equal((await h.cmd('insurance.runout.read',{},owner)).totals.remainingCents,0)
 })
})

test('signed evaluation authorization requests retain external decisions and create exactly one counted authorization',async()=>{
 const {authorizationRequestJourney}=await import('./authorization-request-journey.mjs')
 await run(authorizationRequestJourney)
})

test('INS-002: owner prepares dated eligibility cohorts, imports matched answers and reviews affected visits without inferred policy changes',async()=>{
 const {eligibilityCohortJourney}=await import('./eligibility-cohort-journey.mjs')
 await run(eligibilityCohortJourney,{browserHttps:!!process.env.BALM_UI_SCREENSHOTS})
})
