import assert from 'node:assert/strict'
import { pastVisit } from './clinic.mjs'

export const cutoverInventory = () => ({ provider: 'cliniko', files: [
  { kind: 'patients', name: 'patients.csv', csv: 'Source ID,First Name,Last Name,Date of Birth\nsynthetic-balm-600,Inventory,Patient,1980-01-15' },
  ...['invoices', 'authorizations', 'claims'].map((kind, i) => ({ kind, name: kind + '.csv', csv: `Source ID,Patient ID,Reference\nsynthetic-balm-${601 + i},synthetic-balm-600,Original ${kind} record` })),
] })

export async function reconciliationInventory(h) {
  const input = cutoverInventory()
  const preview = await h.cmd('movein.prepare', input)
  const expected = { patients: 1, documents: 0, insurance: 0, invoices: 1, authorizations: 1, claims: 1, appointmentsByMonth: {}, balancesByPatient: {} }
  assert.deepEqual(preview.reconciliation.source, expected)
  assert.deepEqual(preview.reconciliation.planned, { ...expected, invoices: 0, authorizations: 0, claims: 0 })
  assert.deepEqual(preview.reconciliation.mismatches, ['invoices', 'authorizations', 'claims'].map(metric => ({ metric, source: 1, planned: 0 })))
  assert.deepEqual(preview.migrationReport.unmappedRecords.map(r => [r.file, r.row, r.reason, r.blocking]), ['invoices', 'authorizations', 'claims'].map(kind => [kind + '.csv', 2, 'inventory_not_carried', false]))
  assert.deepEqual(preview.migrationReport.countDifferences.map(d => d.uploadedInventory), [1, 1, 1])
  const agent = await h.cmd('agent.create', { label: 'Inventory preparation', scopes: ['migration.prepare'] })
  const metadata = await h.send('/api/balm/agent/command', { name: 'movein.prepare', input }, '', { authorization: 'Bearer ' + agent.token })
  assert.equal(metadata.status, 200, metadata.text)
  assert.doesNotMatch(metadata.text, /synthetic-balm-60[0-3]|Inventory Patient|Original invoices record/)
  assert.deepEqual(metadata.value.result.migrationReport.countDifferences.map(d => [d.source, d.planned]), [[1, 0], [1, 0], [1, 0]])
  assert.deepEqual(preview.inventory.map(r => r.sourceId), ['synthetic-balm-601', 'synthetic-balm-602', 'synthetic-balm-603'])
  const approval = { ...input, fingerprint: preview.fingerprint, mappingApproval: preview.mappingDigest, cutoverApproval: preview.fingerprint }
  await h.cmd('movein.cutover', approval, h.owner, 409)
  const changed = await h.cmd('movein.prepare', { ...input, expectedTotals: { invoices: 2, authorizations: 3, claims: 4, documents: 5, insurance: 6 } })
  assert.deepEqual(changed.reconciliation.source, { ...expected, invoices: 2, authorizations: 3, claims: 4, documents: 5, insurance: 6 })
  await h.cmd('movein.cutover', { ...approval, expectedTotals: { invoices: 2 }, acceptanceReason: 'Stale approval must not authorize different totals.' }, h.owner, 409)
  for (const key of ['invoices', 'authorizations', 'claims', 'documents', 'insurance']) await h.cmd('movein.preview', { ...input, expectedTotals: { [key]: -1 } }, h.owner, 400)
  const bad = structuredClone(input)
  bad.files[1].csv = bad.files[1].csv.replace('synthetic-balm-600,Original', 'absent-patient,Original')
  const invalid = await h.cmd('movein.prepare', bad)
  assert.equal(invalid.canApply, false)
  assert.ok(invalid.migrationReport.unmappedRecords.some(r => r.file === 'invoices.csv' && r.row === 2 && r.blocking && r.reason === 'missing_patient_reference'))
  await h.cmd('movein.cutover', { ...bad, fingerprint: invalid.fingerprint, mappingApproval: invalid.mappingDigest, cutoverApproval: invalid.fingerprint, acceptanceReason: 'Invalid patient references cannot be waived.' }, h.owner, 409)
  const duplicate = structuredClone(input)
  duplicate.files[1].csv += '\nsynthetic-balm-601,synthetic-balm-600,Duplicate original'
  assert.equal((await h.cmd('movein.preview', duplicate)).canApply, false)
  const applied = await h.cmd('movein.cutover', { ...approval, acceptanceReason: 'Owner retains the originals and will carry invoices, authorizations and claims separately; this patient-list import is incomplete.' })
  assert.equal(applied.records.length, 1)
  assert.deepEqual(applied.job.report.reconciliation, preview.reconciliation)
  assert.deepEqual((await h.cmd('movein.journal', { jobId: applied.job.id })).job.report.migrationReport.unmappedRecords, preview.migrationReport.unmappedRecords)
  for (const table of ['bm_invoices', 'bm_authorizations', 'bm_migrated_claims']) assert.equal((await h.db.prepare('SELECT COUNT(*) AS n FROM ' + table).first()).n, 0)
  assert.equal((await h.cmd('movein.cutover', { ...approval, acceptanceReason: 'Unchanged repeat.' })).job.id, applied.job.id)
  await h.cmd('movein.undo', { jobId: applied.job.id })
  assert.equal((await h.state()).clients.length, 0)
}

export const cutoverClaims = payerId => ({ provider: 'cliniko', files: [
  { kind: 'patients', name: 'patients.csv', csv: 'Source ID,First Name,Last Name,Date of Birth\nsynthetic-balm-610,Carried,Patient,1980-01-15' },
  { kind: 'balances', name: 'aging.csv', csv: 'Patient ID,Balance\nsynthetic-balm-610,120.00' },
  { kind: 'claims', name: 'claims.csv', csv: 'Source ID,Patient ID,Payer ID,Patient control,Payer control,Service date,Billed,Balance,Status\n' +
    `synthetic-balm-611,synthetic-balm-610,${payerId},synthetic-balm-612,synthetic-balm-613,2026-01-15,100.00,80.00,open\n` +
    `synthetic-balm-614,synthetic-balm-610,${payerId},synthetic-balm-615,synthetic-balm-616,2026-01-16,50.00,40.00,denied` },
] })

export async function reconciliationClaimCarry(h, reception) {
  const payer = await h.cmd('insurance.payer.save', { name: 'Synthetic carry payer', payerId: '60054' })
  const input = cutoverClaims(payer.id)
  await h.cmd('insurance.runout.close', { attest: true })
  const closed = await h.cmd('movein.prepare', input)
  assert.equal(closed.canApply, false)
  assert.ok(closed.diagnostics.some(d => d.code === 'claim_runout_closed'))
  await h.cmd('movein.cutover', { ...input, fingerprint: closed.fingerprint, mappingApproval: closed.mappingDigest, cutoverApproval: closed.fingerprint, acceptanceReason: 'A closed run-out cannot be bypassed.' }, h.owner, 409)
  assert.equal((await h.state()).clients.length, 0)
  await h.cmd('insurance.runout.reopen', { attest: true })
  const preview = await h.cmd('movein.prepare', input)
  assert.equal(preview.canApply, true, JSON.stringify(preview.diagnostics))
  assert.equal(preview.reconciliation.source.claims, 2)
  assert.equal(preview.reconciliation.planned.claims, 2)
  assert.deepEqual(preview.reconciliation.planned.balancesByPatient, { 'synthetic-balm-610': 12000 })
  assert.deepEqual(preview.reconciliation.mismatches, [])
  const key = await h.cmd('agent.create', { label: 'Claim carry preparation', scopes: ['migration.prepare'] })
  const agent = await h.send('/api/balm/agent/command', { name: 'movein.prepare', input }, '', { authorization: 'Bearer ' + key.token })
  assert.equal(agent.status, 200)
  assert.equal(agent.value.result.counts.claims, 2)
  assert.doesNotMatch(agent.text, /Carried Patient|synthetic-balm-61[0-9]|2026-01-15/)
  assert.equal((await h.send('/api/balm/agent/command', { name: 'movein.cutover', input }, '', { authorization: 'Bearer ' + key.token })).status, 403)
  const approval = p => ({ fingerprint: p.fingerprint, mappingApproval: p.mappingDigest, cutoverApproval: p.fingerprint, acceptanceReason: 'Checked original claim controls and source aging. Carried receivables remain under retention custody.' })
  const submit = async bad => {
    const p = await h.cmd('movein.prepare', bad)
    assert.equal(p.canApply, false, JSON.stringify(p.diagnostics))
    await h.cmd('movein.cutover', { ...bad, ...approval(p) }, h.owner, 409)
    assert.equal((await h.cmd('insurance.runout.read', {})).claims.length, 0)
    assert.equal((await h.state()).clients.length, 0)
    return p
  }
  const difference = await submit({ ...input, expectedTotals: { balancesByPatient: { 'synthetic-balm-610': 12100 } } })
  assert.deepEqual(difference.reconciliation.mismatches, [{ metric: 'balancesByPatient:synthetic-balm-610', source: 12100, planned: 12000 }])
  const invalidPayer = structuredClone(input)
  invalidPayer.files[2].csv = invalidPayer.files[2].csv.replaceAll(payer.id, 'synthetic-balm-absent')
  assert.ok((await submit(invalidPayer)).diagnostics.some(d => d.code === 'claim_payer_not_found'))
  const ambiguous = structuredClone(input)
  ambiguous.files[2].csv = ambiguous.files[2].csv.replace('synthetic-balm-615', 'synthetic-balm-612')
  assert.ok((await submit(ambiguous)).diagnostics.some(d => d.code === 'claim_control_ambiguous'))
  const absentPatient = structuredClone(input)
  absentPatient.files[2].csv = absentPatient.files[2].csv.replace('synthetic-balm-611,synthetic-balm-610', 'synthetic-balm-611,synthetic-balm-absent')
  assert.ok((await submit(absentPatient)).diagnostics.some(d => d.code === 'missing_patient_reference'))
  const noAging = { ...input, files: input.files.filter(f => f.kind !== 'balances') }
  assert.ok((await submit(noAging)).diagnostics.some(d => d.code === 'claim_aging_required'))
  const badAmount = structuredClone(input)
  badAmount.files[2].csv = badAmount.files[2].csv.replace('100.00,80.00', '100.00,101.00')
  assert.ok((await submit(badAmount)).diagnostics.some(d => d.code === 'invalid_row'))
  await h.cmd('insurance.payer.save', { id: payer.id, name: 'Synthetic carry payer reviewed', payerId: '60054' })
  await h.cmd('movein.cutover', { ...input, ...approval(preview) }, h.owner, 409)
  const current = await h.cmd('movein.prepare', input)
  const accepted = { ...input, ...approval(current) }
  await h.cmd('movein.cutover', accepted, reception.cookie, 403)
  const biller = await h.staff('CarryBiller', 'biller')
  await h.cmd('movein.cutover', accepted, biller.cookie, 403)
  const anonymous = await h.send('/api/balm/command', { name: 'movein.cutover', input: accepted })
  assert.equal(anonymous.status, 401)
  const stale = structuredClone(input)
  stale.files[2].csv = stale.files[2].csv.replace('80.00', '79.00')
  await h.cmd('movein.cutover', { ...stale, ...approval(current) }, h.owner, 409)
  assert.equal((await h.state()).clients.length, 0)
  const attempts = await Promise.all([h.send('/api/balm/command', { name: 'movein.cutover', input: accepted }, h.owner), h.send('/api/balm/command', { name: 'movein.cutover', input: accepted }, h.owner)])
  assert.ok(attempts.some(r => r.status === 200))
  assert.ok(attempts.every(r => r.status === 200 || r.status === 409), JSON.stringify(attempts.map(r => r.value)))
  const applied = attempts.find(r => r.status === 200).value.result
  assert.deepEqual(applied.records.map(r => r.kind).sort(), ['balance', 'claim', 'claim', 'patient'])
  assert.deepEqual(applied.job.report.reconciliation, preview.reconciliation)
  let report = await h.cmd('insurance.runout.read', {})
  assert.deepEqual(report.claims.map(c => [c.source_claim, c.patient_control, c.payer_control, c.service_date, c.billed_cents, c.initial_cents, c.balance_cents, c.status]), [
    ['synthetic-balm-611', 'synthetic-balm-612', 'synthetic-balm-613', '2026-01-15', 10000, 8000, 8000, 'open'],
    ['synthetic-balm-614', 'synthetic-balm-615', 'synthetic-balm-616', '2026-01-16', 5000, 4000, 4000, 'denied'],
  ])
  assert.equal(report.totals.remainingCents, 12000)
  assert.equal((await h.cmd('movein.cutover', accepted)).job.id, applied.job.id)
  await h.cmd('movein.undo', { jobId: applied.job.id }, h.owner, 409)
  const changed = structuredClone(input)
  changed.files[2].csv = changed.files[2].csv.replace('synthetic-balm-611', 'synthetic-balm-617')
  assert.ok((await h.cmd('movein.prepare', changed)).diagnostics.some(d => d.code === 'claim_already_carried'))
  // The existing run-out door recognizes the same source hash, so it cannot import the carried claim again.
  const runoutInput = { source: 'cliniko', csv: `Source claim,Patient ID,Payer ID,Patient control,Payer control,Service date,Billed,Balance,Status\nsynthetic-balm-611,${preview.patients[0].id},${payer.id},synthetic-balm-612,synthetic-balm-613,2026-01-15,100.00,80.00,open` }
  const runoutPreview = await h.cmd('insurance.runout.preview', runoutInput)
  assert.equal((await h.cmd('insurance.runout.apply', { ...runoutInput, fingerprint: runoutPreview.fingerprint, expectedBalanceCents: 8000 })).imported, 0)
  const segments = ['ST*835*0001*005010X221A1', 'BPR*I*60.00*C*CHK************20260120', 'TRN*1*synthetic-balm-618*1234567890', 'N1*PR*SYNTHETIC*XV*60054', 'CLP*synthetic-balm-612*1*100*60*20*CI*synthetic-balm-613', 'CAS*CO*45*20', 'CAS*PR*3*20']
  const x12 = segments.join('~') + `~SE*${segments.length + 1}*0001~`
  const payment = await h.cmd('insurance.remittance.import', { payerId: payer.id, x12 })
  assert.equal(payment.claims[0].migrated, true)
  assert.equal(payment.depositCents, 6000)
  report = await h.cmd('insurance.runout.read', {})
  assert.equal(report.totals.importedCents, 12000)
  assert.equal(report.totals.remainingCents, 4000)
  assert.equal(report.posted.paidCents, 6000)
  assert.equal(report.posted.adjustmentCents, 2000)
  assert.equal(report.deposits[0].migratedCents, 6000)
  assert.equal(report.deposits[0].suspenseCents, 0)
  assert.equal((await h.cmd('insurance.remittance.import', { payerId: payer.id, x12 })).duplicate, true)
  assert.equal((await h.cmd('movein.cutover', accepted)).job.id, applied.job.id)
  assert.equal((await h.cmd('insurance.runout.read', {})).totals.remainingCents, 4000)
  const journal = await h.cmd('movein.journal', { jobId: applied.job.id })
  assert.deepEqual(journal.job.report.reconciliation, preview.reconciliation)
  assert.equal((await h.db.prepare('SELECT COUNT(*) AS n FROM bm_invoices').first()).n, 0, 'carry creates no duplicate collectible invoices')
  await h.cmd('movein.undo', { jobId: applied.job.id }, h.owner, 409)
  assert.equal((await h.state()).clients.length, 1)
}

export const cutoverAuthorizations = (payerId, practitionerId = '') => ({ provider: 'cliniko', files: [
  { kind: 'patients', name: 'authorization-patients.csv', csv: 'Source ID,First Name,Last Name,Date of Birth\nsynthetic-balm-630,Authorization,Visits,1980-01-15\nsynthetic-balm-631,Authorization,Units,1981-01-15' },
  { kind: 'authorizations', name: 'authorization-carry.csv', csv: 'Source ID,Patient ID,Policy ID,Payer ID,Member ID,Policy Starts On,Policy Ends On,Number,Starts On,Ends On,Cutover On,Allowance Kind,Allowance,Used,Units Per Visit,CPT Scope,Practitioner ID,Booking Action,Patient Sex,Address,City,State,Postal Code,Relationship,Subscriber First,Subscriber Last,Subscriber DOB,Subscriber Sex,Group Number,Plan Name,Priority\n' +
    `synthetic-balm-632,synthetic-balm-630,synthetic-balm-634,${payerId},synthetic-balm-636,2020-01-01,2099-12-31,synthetic-balm-638,2026-01-01,2099-12-31,2026-01-15,visits,3,1,,,${practitionerId},block,F,1 Example St,Austin,TX,78701,18,,,,,synthetic-balm-650,Source primary plan,1\n` +
    `synthetic-balm-633,synthetic-balm-631,synthetic-balm-635,${payerId},synthetic-balm-637,2020-01-01,2099-12-31,synthetic-balm-639,2026-01-01,2099-12-31,2026-01-15,units,10,4,3,97110,${practitionerId},block,M,2 Example St,Austin,TX,78701,19,Synthetic,Subscriber,1970-01-15,F,synthetic-balm-651,Source family plan,1\n` +
    `synthetic-balm-642,synthetic-balm-630,synthetic-balm-634,${payerId},synthetic-balm-636,2020-01-01,2099-12-31,synthetic-balm-644,2025-01-01,2025-12-31,2025-01-15,visits,10,8,,,${practitionerId},block,F,1 Example St,Austin,TX,78701,18,,,,,synthetic-balm-650,Source primary plan,1` },
] })

export async function reconciliationAuthorizationCarry(h, therapist, service, reception) {
  const payer = await h.cmd('insurance.payer.save', { name: 'Synthetic authorization carry', payerId: 'AUTHCARRY', unitMethod: 'cms' })
  // The first clinic-local cutover morning is still the previous UTC day.
  const boundary = { ...cutoverAuthorizations(payer.id, therapist.id), practitionerId: therapist.id, serviceId: service.id }
  for (const file of boundary.files) file.csv = file.csv.replaceAll('synthetic-balm-6', 'synthetic-balm-7').replaceAll('Authorization,', 'Boundary,').replace('visits,3,1', 'visits,1,1')
  boundary.files.push({ kind: 'appointments', name: 'boundary.csv', csv: 'Source ID,Patient ID,Start At,End At,Status\nsynthetic-balm-740,synthetic-balm-730,2026-01-15T09:00:00+10:00,2026-01-15T09:45:00+10:00,booked' })
  const boundaryPreview = await h.cmd('movein.prepare', boundary)
  const boundaryApplied = await h.cmd('movein.cutover', { ...boundary, fingerprint: boundaryPreview.fingerprint, mappingApproval: boundaryPreview.mappingDigest, cutoverApproval: boundaryPreview.fingerprint, acceptanceReason: 'Reviewed clinic-local cutover morning against original usage.' })
  await h.cmd('movein.undo', { jobId: boundaryApplied.job.id }, h.owner, 409)
  const boundaryFile = (await h.send('/api/balm/clients/' + boundaryPreview.patients[0].id, undefined, h.owner)).value
  const boundaryAuth = boundaryFile.insurance.authorizations[0]
  assert.deepEqual([boundaryAuth.used_allowance, boundaryAuth.reserved_allowance, boundaryAuth.allowance_total], [1, 1, 1])
  const boundaryVisit = boundaryApplied.records.find(r => r.kind === 'appointment')
  assert.ok(boundaryFile.insurance.warnings[boundaryVisit.target_id].some(w => w.code === 'authorization_exhausted' && w.blocking), 'clinic-local cutover reservation must warn when it exceeds the allowance')
  const input = { ...cutoverAuthorizations(payer.id, therapist.id), practitionerId: therapist.id, serviceId: service.id }
  input.files.push({ kind: 'appointments', name: 'authorization-history.csv', csv: 'Source ID,Patient ID,Start At,End At,Status\nsynthetic-balm-640,synthetic-balm-630,2026-01-14T09:00:00+10:00,2026-01-14T09:45:00+10:00,attended\nsynthetic-balm-641,synthetic-balm-630,2026-01-16T09:00:00+10:00,2026-01-16T09:45:00+10:00,attended' })
  const preview = await h.cmd('movein.prepare', input)
  assert.equal(preview.canApply, true, JSON.stringify(preview.diagnostics))
  assert.equal(preview.counts.authorizations, 3)
  assert.equal(preview.counts.insurance, 2)
  assert.deepEqual(preview.reconciliation.mismatches, [])
  const approval = p => ({ fingerprint: p.fingerprint, mappingApproval: p.mappingDigest, cutoverApproval: p.fingerprint, acceptanceReason: 'Checked source allowances, prior usage, policy identity and cutover date against original payer records.' })
  const before = (await h.state()).clients.length
  for (const mutate of [b => { b.files[1].csv = b.files[1].csv.replaceAll(payer.id, 'synthetic-balm-absent') }, b => { b.files[1].csv = b.files[1].csv.replace('visits,3,1', 'visits,3,4') }, b => { b.files[1].csv = b.files[1].csv.replace('synthetic-balm-635', 'synthetic-balm-634') }, b => { b.files[1].csv = b.files[1].csv.replace('2026-01-15,units', '2025-12-31,units') }, b => { b.files[1].csv = b.files[1].csv.replaceAll(therapist.id, 'synthetic-balm-absent') }, b => { b.files[1].csv = b.files[1].csv.replace('synthetic-balm-632,synthetic-balm-630', 'synthetic-balm-632,synthetic-balm-absent') }, b => { b.files[1].csv = b.files[1].csv.replaceAll('2026-01-15,', '2090-01-15,') }]) {
    const bad = structuredClone(input); mutate(bad)
    const p = await h.cmd('movein.prepare', bad)
    assert.equal(p.canApply, false, JSON.stringify(p.diagnostics))
    await h.cmd('movein.cutover', { ...bad, ...approval(p) }, h.owner, 409)
    assert.equal((await h.state()).clients.length, before)
  }
  await h.cmd('movein.cutover', { ...input, ...approval(preview) }, reception.cookie, 403)
  await h.cmd('movein.cutover', { ...input, ...approval(preview) }, therapist.cookie, 403)
  const biller = await h.staff('AuthorizationCarryBiller', 'biller')
  await h.cmd('movein.cutover', { ...input, ...approval(preview) }, biller.cookie, 403)
  await h.cmd('insurance.payer.save', { id: payer.id, name: 'Synthetic authorization carry reviewed', payerId: 'AUTHCARRY', unitMethod: 'cms' })
  await h.cmd('movein.cutover', { ...input, ...approval(preview) }, h.owner, 409)
  const current = await h.cmd('movein.prepare', input), accepted = { ...input, ...approval(current) }
  const attempts = await Promise.all([h.send('/api/balm/command', { name: 'movein.cutover', input: accepted }, h.owner), h.send('/api/balm/command', { name: 'movein.cutover', input: accepted }, h.owner)])
  assert.ok(attempts.some(r => r.status === 200))
  assert.ok(attempts.every(r => r.status === 200 || r.status === 409))
  const applied = attempts.find(r => r.status === 200).value.result
  assert.deepEqual(applied.records.map(r => r.kind).sort(), ['appointment', 'appointment', 'authorization', 'authorization', 'authorization', 'patient', 'patient', 'policy', 'policy'])
  const clients = current.patients.map(p => p.id)
  const file = async index => (await h.send('/api/balm/clients/' + clients[index], undefined, h.owner)).value
  let visits = (await file(0)).insurance.authorizations[0], units = (await file(1)).insurance.authorizations[0]
  assert.deepEqual([visits.number, visits.visits, visits.imported_used, visits.used_visits, visits.remaining_allowance, visits.booking_action], ['synthetic-balm-638', 3, 1, 2, 1, 'block'])
  assert.equal((await file(0)).insurance.policies.length, 1, 'two source authorizations reuse the same exact native policy')
  assert.equal((await file(0)).insurance.authorizations.length, 2)
  const unitPolicy = (await file(1)).insurance.policies[0]
  assert.deepEqual([unitPolicy.relationship, unitPolicy.subscriber_first, unitPolicy.subscriber_last, unitPolicy.subscriber_dob, unitPolicy.subscriber_sex, unitPolicy.plan_name, unitPolicy.priority], ['19', 'Synthetic', 'Subscriber', '1970-01-15', 'F', 'Source family plan', 1])
  assert.deepEqual([units.units, units.imported_used, units.used_units, units.remaining_allowance, units.units_per_visit, JSON.parse(units.cpt_scope), units.practitioner_id], [10, 4, 4, 6, 3, ['97110'], therapist.id])
  for (const [auth, replacement] of [[visits, { allowanceKind: 'units', units: 12, unitsPerVisit: 3 }], [units, { allowanceKind: 'visits', visits: 12 }]]) {
    const edit = { id: auth.id, policyId: auth.policy_id, number: auth.number, startsOn: auth.starts_on, endsOn: auth.ends_on, bookingAction: auth.booking_action, practitionerId: therapist.id }
    const refused = await h.cmd('insurance.authorization.save', { ...edit, ...replacement }, h.owner, 409)
    assert.equal(refused.error, 'Imported authorization dimension cannot change.')
    await h.cmd('insurance.authorization.save', { ...edit, allowanceKind: auth.allowance_kind, visits: auth.visits, units: auth.units, unitsPerVisit: auth.units_per_visit })
  }
  assert.deepEqual([(await file(0)).insurance.authorizations[0].used_allowance, (await file(1)).insurance.authorizations[0].used_allowance], [2, 4], 'same-dimension edits preserve source usage')
  const booking = { clientId: clients[0], practitionerId: therapist.id, serviceId: service.id, date: new Date(Date.now() + 2 * 86400_000 + 10 * 3600_000).toISOString().slice(0, 10), time: '10:00', acknowledgeInsurance: true }
  const booked = { appointmentId: await pastVisit(h, clients[0], therapist, service.id, h.owner, 2, { acknowledgeInsurance: true }) }
  assert.equal((await file(0)).insurance.authorizations[0].remaining_allowance, 0)
  await h.cmd('appointment.attend', { id: booked.appointmentId })
  visits = (await file(0)).insurance.authorizations[0]
  assert.deepEqual([visits.used_visits, visits.reserved_visits, visits.remaining_allowance], [3, 0, 0])
  const exhausted = await h.cmd('appointment.book', booking, h.owner, 409)
  assert.ok(exhausted.detail.insuranceBooking.warnings.some(w => w.code === 'authorization_exhausted' && w.blocking))
  const unitVisit = { appointmentId: await pastVisit(h, clients[1], therapist, service.id, h.owner, 3, { acknowledgeInsurance: true }) }
  assert.deepEqual([(await file(1)).insurance.authorizations[0].reserved_units, (await file(1)).insurance.authorizations[0].remaining_allowance], [3, 3])
  await h.cmd('appointment.attend', { id: unitVisit.appointmentId })
  const note = await h.cmd('note.write', { clientId: clients[1], appointmentId: unitVisit.appointmentId, body: 'Synthetic reviewed care', charges: [{ code: '97110', minutes: 15 }] }, therapist.cookie)
  await h.cmd('note.sign', { id: note.id, revision: note.revision, signature: 'Priya', credentials: 'PT', attest: true }, therapist.cookie)
  units = (await file(1)).insurance.authorizations[0]
  assert.deepEqual([units.used_units, units.reserved_units, units.remaining_allowance], [5, 0, 5])
  assert.equal((await h.cmd('movein.cutover', accepted)).job.id, applied.job.id)
  assert.equal((await h.cmd('movein.apply', accepted)).job.id, applied.job.id)
  assert.equal((await file(1)).insurance.authorizations[0].remaining_allowance, 5, 'repeat cannot reset source or native usage')
  assert.deepEqual((await h.cmd('movein.journal', { jobId: applied.job.id })).job.report.reconciliation, current.reconciliation)
  await h.cmd('movein.undo', { jobId: applied.job.id }, h.owner, 409)
}


export const cutoverInvoices = () => ({ provider: 'cliniko', files: [
  { kind: 'patients', name: 'invoice-patients.csv', csv: 'Source ID,First Name,Last Name,Date of Birth\nsynthetic-balm-800,Historical,Invoice,1960-01-15' },
  { kind: 'invoices', name: 'invoices.csv', csv: 'Source ID,Patient ID,Reference,Issued On,Billed,Balance\nsynthetic-balm-801,synthetic-balm-800,Original invoice 801,2000-01-15,100.00,80.00\nsynthetic-balm-802,synthetic-balm-800,Original invoice 802,2000-01-16,50.00,40.00\nsynthetic-balm-803,synthetic-balm-800,Original invoice 803,2000-01-17,75.00,0.00' },
  { kind: 'balances', name: 'independent-aging.csv', csv: 'Patient ID,Balance\nsynthetic-balm-800,120.00' },
] })

export function archivedInvoiceInventory() {
  const input = cutoverInventory()
  input.files.push({ kind: 'invoices', name: 'historical-invoices.csv', csv: 'Source ID,Patient ID,Reference,Issued On,Billed,Balance\nsynthetic-balm-804,synthetic-balm-600,Archived historical invoice,2000-01-15,100.00,80.00' })
  input.files.push({ kind: 'balances', name: 'invoice-aging.csv', csv: 'Patient ID,Balance\nsynthetic-balm-600,80.00' })
  return input
}

export async function reconciliationInvoiceCarry(h, reception, therapist) {
  const input = cutoverInvoices(), before = (await h.state()).clients.length
  const approved = p => ({ fingerprint: p.fingerprint, mappingApproval: p.mappingDigest, cutoverApproval: p.fingerprint, acceptanceReason: 'Reviewed original invoices and independent net aging; no second bill.' })
  const preview = await h.cmd('movein.prepare', input)
  assert.equal(preview.canApply, true, JSON.stringify(preview.diagnostics))
  assert.deepEqual([preview.reconciliation.source.invoices, preview.reconciliation.planned.invoices], [3, 3])
  assert.deepEqual(preview.reconciliation.mismatches, [])
  await h.cmd('movein.cutover', { ...input, fingerprint: preview.fingerprint }, h.owner, 409)
  await h.cmd('movein.cutover', { ...input, ...approved(preview) }, reception.cookie, 403)
  const bad = structuredClone(input)
  bad.files[2].csv = bad.files[2].csv.replace('120.00', '121.00')
  const difference = await h.cmd('movein.prepare', bad)
  assert.ok(difference.diagnostics.some(d => d.code === 'invoice_balance_mismatch' && d.severity === 'error'))
  await h.cmd('movein.cutover', { ...bad, ...approved(difference) }, h.owner, 409)
  const missing = { ...input, files: input.files.filter(f => f.kind !== 'balances') }
  const incomplete = await h.cmd('movein.prepare', missing)
  assert.equal(incomplete.canApply, false)
  await h.cmd('movein.cutover', { ...missing, ...approved(incomplete) }, h.owner, 409)
  const unknown = structuredClone(input)
  unknown.files[1].csv = unknown.files[1].csv.replace('synthetic-balm-800,Original', 'synthetic-balm-absent,Original')
  const invalid = await h.cmd('movein.prepare', unknown)
  await h.cmd('movein.cutover', { ...unknown, ...approved(invalid) }, h.owner, 409)
  assert.equal((await h.state()).clients.length, before)
  const applied = await h.cmd('movein.cutover', { ...input, ...approved(preview) })
  const clientId = preview.patients[0].id
  const chart = (await h.send('/api/balm/clients/' + clientId, undefined, h.owner)).value
  assert.deepEqual(chart.imported.invoices.map(i => [i.reference, i.issued_on, i.billed_cents, i.balance_cents]), [
    ['Original invoice 801', '2000-01-15', 10000, 8000], ['Original invoice 802', '2000-01-16', 5000, 4000], ['Original invoice 803', '2000-01-17', 7500, 0],
  ])
  assert.deepEqual(chart.imported.balances.map(b => b.amount_cents), [12000])
  assert.equal(chart.invoices.length, 0, 'historical invoices never issue duplicate new bills')
  assert.deepEqual((await h.send('/api/balm/clients/' + clientId, undefined, reception.cookie)).value.imported.invoices, chart.imported.invoices)
  await h.send('/api/balm/clients/' + clientId, undefined, therapist.cookie).then(r => assert.equal(r.status, 404))
  const html = await h.send('/app/clients/' + clientId, undefined, h.owner)
  assert.match(html.text, /Original invoice 801/)
  assert.match(html.text, /Remaining at cutover/)
  assert.equal(applied.records.filter(r => r.kind === 'invoice').length, 3)
  assert.equal((await h.cmd('movein.apply', { ...input, ...approved(preview) })).job.id, applied.job.id)
  assert.deepEqual((await h.cmd('movein.journal', { jobId: applied.job.id })).job.report.reconciliation, preview.reconciliation)
  assert.ok(chart.retention.reasons.includes('retention_period_not_complete') || chart.retention.reasons.includes('last_treatment_unknown'))
  await h.cmd('client.erase', { id: clientId }, h.owner, 409)
  await h.cmd('movein.undo', { jobId: applied.job.id })
  assert.equal((await h.db.prepare('SELECT COUNT(*) AS n FROM bm_movein_invoices WHERE client_id=?').bind(clientId).first()).n, 0)
}
