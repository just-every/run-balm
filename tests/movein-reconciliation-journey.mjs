import assert from 'node:assert/strict'

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
  const preview = await h.cmd('movein.prepare', input)
  assert.equal(preview.canApply, true, JSON.stringify(preview.diagnostics))
  assert.equal(preview.reconciliation.source.claims, 2)
  assert.equal(preview.reconciliation.planned.claims, 2)
  assert.deepEqual(preview.reconciliation.planned.balancesByPatient, { 'synthetic-balm-610': 12000 })
  assert.deepEqual(preview.reconciliation.mismatches, [])
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
