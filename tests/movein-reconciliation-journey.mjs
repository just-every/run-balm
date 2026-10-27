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
