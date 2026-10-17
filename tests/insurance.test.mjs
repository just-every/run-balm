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
  return { patient, priya, payer, policy, appointmentId, serviceDate, invoice }
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
    const paid = await fixture('835-paid.x12', { CLAIM: claim.id })
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
    const claim = await h.cmd('insurance.claim.prepare', { appointmentId: c.appointmentId, policyId: c.policy.id })
    assert.equal(claim.status, 'draft'); assert.ok(claim.errors.some(e => e.code === 'kx_medical_necessity_required'))
    const documented = await h.cmd('insurance.claim.necessity', { id: claim.id, medicalNecessity: 'Continued skilled therapy is required to safely progress gait and restore knee function.' }, c.priya.cookie)
    assert.equal(documented.status, 'ready')
    const clinicalFile = await patientFile(h, c.patient.id, c.priya.cookie)
    assert.ok(clinicalFile.insurance.claims[0].snapshot.lines.every(l => l.modifiers.includes('KX')))
    const batch = await h.cmd('insurance.batch.prepare', { claimIds: [claim.id] })
    const offline = await h.cmd('insurance.batch.submit', { id: batch.id }); assert.equal(offline.status, 'unavailable')
    await h.send(`/api/balm/insurance/837P/${batch.id}`, undefined, h.owner)
    await h.cmd('insurance.remittance.import', { payerId: c.payer.id, x12: await fixture('835-denied.x12', { CLAIM: claim.id }) })
    const state = await h.state(), denial = state.insurance.queue.find(q => q.id === claim.id)
    const deniedFile = await patientFile(h, c.patient.id)
    assert.equal(deniedFile.billing.ledger.patientBalanceCents, 0); assert.equal(deniedFile.billing.ledger.insurancePendingCents, 9500)
    assert.equal(denial.status, 'denied'); assert.match(JSON.stringify(denial), /authoriz/i)
    const page = await h.send('/app/insurance', undefined, h.owner)
    assert.equal(page.status, 200); assert.match(page.text, /197/); assert.match(page.text, /[Aa]uthorization/)
    const appeal = await h.cmd('insurance.denial.appeal', { id: claim.id, reason: 'Authorization is present in the attached payer approval.' })
    assert.match(JSON.stringify(appeal), /Authorization is present/)
    await h.cmd('insurance.authorization.save', { policyId: c.policy.id, number: 'CORRECTED-AUTH', ...coverage, visits: 12 })
    const corrected = await h.cmd('insurance.claim.correct', { id: claim.id })
    assert.notEqual(corrected.id, claim.id); assert.equal(corrected.status, 'ready')
    const next = await h.cmd('insurance.batch.prepare', { claimIds: [corrected.id] })
    const exportResult = await h.send(`/api/balm/insurance/837P/${next.id}`, undefined, h.owner)
    assert.match(exportResult.text, /REF\*F8\*PAYERDENIED001/); assert.match(exportResult.text, /11:B:7/)
  })
})
