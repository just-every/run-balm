import assert from 'node:assert/strict'
import { run } from './harness.mjs'
import { clinic, pastVisit, visitDate } from './clinic.mjs'

const gateway = 'https://synthetic-balm-1.example/claims'
const plus = (date, days) => new Date(Date.parse(date) + days * 86400000).toISOString().slice(0, 10)
const era = (claim, date, paid) => {
  const segments = ['ST*835*0001*005010X221A1', `BPR*I*${paid ? 95 : 0}*C*CHK************${date.replaceAll('-', '')}`,
    `TRN*1*synthetic-balm-${paid ? 5 : 4}*1234567890`, 'N1*PR*synthetic-balm-1*XV*SYNTHETICBALM1', 'N1*PE*synthetic-balm-2*XX*1234567893',
    `CLP*${claim}*${paid ? 1 : 4}*95*${paid ? 95 : 0}*0*CI*synthetic-balm-${paid ? 7 : 6}`,
    ...paid ? [] : ['CAS*CO*4*95']]
  return [...segments, `SE*${segments.length + 1}*0001`].join('~') + '~'
}

/** Public command/form doors and the real X12 transport; only the paid gateway
 * is faked. Parent registers this one business journey in insurance.test.mjs. */
export async function denialWorkJourney(options={}) {
  const sent = []
  await run(async h => {
    await h.finishSetup()
    const { service, practitioners: [therapist] } = await clinic(h)
    await h.cmd('staff.save', { id: therapist.id, name: 'Priya Shah', email: therapist.email, role: 'practitioner', credentials: 'PT', active: true })
    await h.cmd('pay.npi.save', { staffId: therapist.id, npi: '1234567893' })
    await h.cmd('insurance.settings.save', { billingNpi: '1234567893', taxId: '123456789', address: '100 synthetic-balm-1', city: 'Austin', state: 'TX', postalCode: '78701', contactName: 'synthetic-balm-1 synthetic-balm-2', contactPhone: '5125550100' })
    const payer = await h.cmd('insurance.payer.save', { name: 'Horizon Health', payerId: 'SYNTHETICBALM1', receiverId: 'SYNTHETICBALM1', medicare: true, unitMethod: 'cms', fees: [{ code: '97110', cents: 3500 }, { code: '97140', cents: 2500 }] })
    await h.cmd('insurance.enrollment.save', { payerId: payer.id, practitionerId: therapist.id, taxonomy: '225100000X', active: true })
    // The documented reviewed import supplies a historical visit through the
    // public move-in door; ordinary staff booking correctly refuses old dates.
    const serviceDay=new Date(Date.now()+10*3600000-3*86400000).toISOString().slice(0,10)
    const start=serviceDay+'T00:00:00.000Z',end=serviceDay+'T00:45:00.000Z'
    const bundle={provider:'cliniko',practitionerId:therapist.id,serviceId:service.id,dateFormat:'MDY',files:[
     {kind:'patients',name:'patients.csv',csv:'Patient ID,First Name,Last Name,Date of Birth\nsynthetic-balm-1,Maya,Lee,1988-04-02\n'},
     {kind:'appointments',name:'appointments.csv',csv:'Source ID,Patient ID,Start At,End At,Status\nsynthetic-balm-2,synthetic-balm-1,'+start+','+end+',booked\n'}]}
    const preview=await h.cmd('movein.preview',bundle);assert.equal(preview.canApply,true,JSON.stringify(preview.diagnostics))
    await h.cmd('movein.apply',{...bundle,fingerprint:preview.fingerprint,acceptanceReason:'Reviewed historical synthetic therapy visit for denial follow-up.'})
    const imported=await h.state(),patient=imported.clients.find(c=>c.first_name==='Maya'&&c.last_name==='Lee')
    const visit=imported.appointments.find(a=>a.client_id===patient.id).id,date=await visitDate(h,visit)
    const year = new Date().getUTCFullYear(), coverage = { startsOn: `${year - 1}-01-01`, endsOn: `${year + 1}-12-31` }
    const policy = await h.cmd('insurance.policy.save', { clientId: patient.id, payerId: payer.id, memberId: 'synthetic-balm-3', relationship: '18', patientSex: 'F', address: '100 synthetic-balm-1', city: 'Austin', state: 'TX', postalCode: '78701', ...coverage })
    await h.cmd('insurance.authorization.save', { policyId: policy.id, number: 'synthetic-balm-4', ...coverage, visits: 12 })
    await h.cmd('appointment.attend', { id: visit })
    const note = await h.cmd('note.write', { clientId: patient.id, appointmentId: visit, body: 'Synthetic skilled therapy: progressive gait and knee strengthening.', charges: [{ code: '97110', minutes: 23 }, { code: '97140', minutes: 15 }] }, therapist.cookie)
    await h.cmd('note.sign', { id: note.id, revision: 1, signature: 'Priya Shah', attest: true }, therapist.cookie)
    await h.cmd('pay.codes.save', { appointmentId: visit, icd10: 'M25.561' })
    const invoice = await h.cmd('invoice.prepare', { appointmentId: visit }); await h.cmd('invoice.approve', { id: invoice.id })
    const biller = await h.staff('ClaimsBiller', 'biller'), reception = await h.staff('ClaimsDesk', 'reception')
    const billing = (name, input) => h.cmd(name, input, biller.cookie)
    const work = input => billing('insurance.work.read', input ?? {})
    await h.cmd('insurance.work.read', {}, therapist.cookie, 403)
    await h.cmd('insurance.work.read', {}, reception.cookie, 403)
    const spending = { clientId: patient.id, year: +date.slice(0, 4), therapyGroup: 'pt_slp', thresholdCents: 248000, externalUsedCents: 0, source: 'synthetic-balm-1 reviewed beneficiary spending' }
    await h.cmd('insurance.medicare.settings.save', { year: spending.year, therapyGroup: 'pt_slp', thresholdCents: 248000, reviewCents: 300000, publishedOn: `${spending.year}-01-01`, source: 'synthetic-balm-1 reviewed annual CMS setting' })
    await billing('insurance.medicare.save', spending)
    const original = await billing('insurance.claim.prepare', { appointmentId: visit, policyId: policy.id })
    assert.equal(original.status, 'ready')
    assert.ok(original.snapshot.lines.every(l => !l.modifiers.includes('KX')))
    const originalBatch = await billing('insurance.batch.prepare', { claimIds: [original.id] })
    await billing('insurance.batch.submit', { id: originalBatch.id })
    assert.doesNotMatch(sent[0].body, /:KX/)
    assert.ok((await work({ reason: 'unpaid' })).queue.some(c => c.id === original.id), 'submitted unpaid claims remain actionable')
    await billing('insurance.remittance.import', { payerId: payer.id, x12: era(original.id, date, false) })
    const denied = (await work()).queue.find(c => c.id === original.id)
    assert.equal(denied.status, 'denied'); assert.equal(denied.open_cents, 9500)
    assert.equal(denied.deadlines.find(d => d.kind === 'correction').completed, false, 'an original submission does not complete a correction')
    assert.match(denied.next, /KX/); assert.ok(denied.deadlines.every(d => d.dueOn === null && d.unknown))
    const rule = { payerId: payer.id, kind: 'initial', basis: 'service_date', days: 90, effectiveFrom: date, source: 'synthetic-balm-1 documented payer instruction, section 2' }
    await h.cmd('insurance.filing.save', rule, reception.cookie, 403)
    await h.cmd('insurance.filing.save', { ...rule, source: '' }, biller.cookie, 400)
    await billing('insurance.filing.save', rule)
    await billing('insurance.filing.save', { ...rule, kind: 'correction', days: 30, basis: 'adjudication_date' })
    await billing('insurance.filing.save', { ...rule, kind: 'appeal', days: 60, basis: 'adjudication_date' })
    let current = (await work()).queue.find(c => c.id === original.id)
    assert.equal(current.deadlines.find(d => d.kind === 'initial').dueOn, plus(date, 90))
    assert.equal(current.deadlines.find(d => d.kind === 'correction').dueOn, null, 'import time is not a payer decision date')
    await billing('insurance.filing.date', { id: original.id, adjudicationOn: date, source: 'synthetic-balm-2 dated payer decision' })
    current = (await work()).queue.find(c => c.id === original.id)
    assert.equal(current.deadlines.find(d => d.kind === 'correction').dueOn, plus(date, 30))
    assert.equal(current.deadlines.find(d => d.kind === 'appeal').dueOn, plus(date, 60))
    await billing('insurance.filing.save', { ...rule, kind: 'appeal', days: 0, basis: 'adjudication_date', source: 'synthetic-balm-6 corrected payer instruction' })
    current = (await work()).queue.find(c => c.id === original.id)
    assert.equal(current.deadlines.find(d => d.kind === 'appeal').overdue, true)
    assert.equal((await work()).rules.filter(r => r.kind === 'appeal').length, 2, 'superseding an instruction retains its source history')
    const filtered = await work({ payerId: payer.id, age: current.age, reason: 'carc_4' })
    assert.deepEqual(filtered.queue.map(c => c.id), [original.id])
    assert.equal((await work({ age: current.age === '0-30' ? '31-60' : '0-30' })).queue.length, 0)
    assert.equal((await work({ reason: 'carc_197' })).queue.length, 0)
    assert.equal((await work({ payerId: 'synthetic-balm-99' })).queue.length, 0)
    await options.onDenied?.(h,{payer,patient,biller,therapist,original,date})
    const appeal = await h.cmd('insurance.denial.appeal', { id: original.id, reason: 'Synthetic payer spending record supports the required modifier.' }, therapist.cookie)
    assert.equal(appeal.status, 'draft_not_sent')
    if(options.recordActions)await options.recordActions(h,{payer,patient,biller,therapist,original,date})
    else{
    await billing('insurance.claim.action', { id: original.id, kind: 'followup', on: date, source: 'synthetic-balm-3 payer call confirmation' })
    await billing('insurance.claim.action', { id: original.id, kind: 'appeal_sent', on: date, source: 'synthetic-balm-4 external appeal receipt' })
    }
    assert.equal(sent.length, 1, 'recording completed work does not send anything')
    current = (await work()).queue.find(c => c.id === original.id)
    assert.equal(current.deadlines.find(d => d.kind === 'appeal').completed, true)
    // Payer-provided spending explains why the originally valid claim now needs KX.
    await billing('insurance.medicare.save', { ...spending, externalUsedCents: 247000, source: 'synthetic-balm-5 payer spending correction' })
    const replacement = await billing('insurance.claim.correct', { id: original.id })
    assert.equal(replacement.status, 'draft')
    await h.cmd('insurance.claim.necessity', { id: replacement.id, medicalNecessity: 'Skilled therapy remains necessary for safe gait progression and knee function.' }, therapist.cookie)
    const batch = await billing('insurance.batch.prepare', { claimIds: [replacement.id] })
    const submitted = await billing('insurance.batch.submit', { id: batch.id })
    assert.equal(submitted.status, 'submitted'); assert.equal(sent.length, 2)
    assert.match(sent[1].body, /11:B:7/); assert.match(sent[1].body, /REF\*F8\*SYNTHETIC-BALM-6~/); assert.match(sent[1].body, /:KX\*/)
    await billing('insurance.remittance.import', { payerId: payer.id, x12: era(replacement.id, date, true) })
    const final = await work()
    assert.ok(!final.queue.some(c => c.id === original.id || c.id === replacement.id))
    assert.equal(final.history.find(c => c.id === replacement.id).status, 'paid')
    const history = final.history.find(c => c.id === replacement.id)
    for (const action of ['insurance.claim_prepared', 'insurance.claim_submitted', 'insurance.remittance_posted', 'insurance.appeal_drafted', 'insurance.claim_corrected', 'insurance.medical_necessity_attested']) assert.ok(history.actions.some(a => a.action === action), action)
    assert.equal(history.externalActions.length, 2)
    const file = (await h.send(`/api/balm/clients/${patient.id}`, undefined, h.owner)).value
    assert.equal(file.billing.ledger.insurancePendingCents, 0); assert.equal(file.billing.ledger.patientBalanceCents, 0)
    const page = await h.send('/app/insurance', undefined, biller.cookie)
    assert.equal(page.status, 200); assert.match(page.text, /Claim action history/)
    await options.onPaid?.(h,{payer,patient,biller,therapist,original,replacement,date})
  }, {browserHttps:!!options.browserHttps, auth: { BALM_INSURANCE_ADAPTER_URL: gateway, BALM_INSURANCE_ADAPTER_TOKEN: 'synthetic-balm-1' }, outbound: async request => {
    assert.equal(request.url, gateway); assert.equal(request.method, 'POST')
    assert.equal(request.headers.get('authorization'), 'Bearer synthetic-balm-1')
    const input = await request.json(); assert.equal(request.headers.get('idempotency-key'), input.id)
    assert.equal(input.kind, '837P'); assert.match(input.body, /ST\*837\*/)
    sent.push(input)
    return Response.json({ status: 'submitted', reference: `synthetic-balm-${sent.length}` })
  } })
}
