import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { run } from './harness.mjs'
import { clinic } from './clinic.mjs'

const kinds = ['patients', 'appointments', 'notes', 'balances', 'insurance']
for (const provider of ['cliniko', 'webpt', 'simplepractice', 'jane']) {
  test(`${provider}: preview, reconcile, atomic apply, duplicate-free repeat and whole-bundle undo`, () => run(async h => {
    await h.finishSetup()
    const { service, practitioners: [therapist] } = await clinic(h)
    const reception = await h.staff('Rosa', 'reception')
    const files = await Promise.all(kinds.map(async kind => ({ kind, name: `${kind}.csv`, csv: await readFile(`tests/fixtures/movein/${provider}/${kind}.csv`, 'utf8') })))
    const input = { provider, files, practitionerId: therapist.id, serviceId: service.id, dateFormat: 'MDY' }
    await h.cmd('movein.preview', input, reception.cookie, 403)
    const preview = await h.cmd('movein.preview', input)
    assert.equal(preview.canApply, true, JSON.stringify(preview.diagnostics))
    assert.deepEqual(preview.counts, { patients: 2, appointments: 3, notes: 1, balances: 2, insurance: 2 })
    assert.deepEqual(preview.reconciliation.source, preview.reconciliation.planned)
    assert.equal(Object.keys(preview.reconciliation.planned.appointmentsByMonth).length, 2)
    assert.equal(Object.values(preview.reconciliation.planned.balancesByPatient).reduce((a, b) => a + b), 16550)
    assert.ok(preview.unmappedColumns.some(c => c.column === 'Legacy flag'))
    assert.equal((await h.state()).clients.length, 0)
    const changed = structuredClone(input)
    changed.files[0].csv = changed.files[0].csv.replace('Santos', 'Santos-Revised')
    await h.cmd('movein.apply', { ...changed, fingerprint: preview.fingerprint, acceptanceReason: 'Reviewed omissions.' }, h.owner, 409)
    assert.equal((await h.state()).clients.length, 0)
    const expectedTotals = structuredClone(preview.reconciliation.source)
    expectedTotals.patients = 3
    const balancePatient = Object.keys(expectedTotals.balancesByPatient)[0]
    expectedTotals.balancesByPatient[balancePatient] += 100
    const mismatch = await h.cmd('movein.preview', { ...input, expectedTotals })
    assert.ok(mismatch.reconciliation.mismatches.some(m => m.metric === 'patients'))
    assert.ok(mismatch.reconciliation.mismatches.some(m => m.metric === 'balancesByPatient:' + balancePatient))
    await h.cmd('movein.apply', { ...input, expectedTotals, fingerprint: mismatch.fingerprint }, h.owner, 409)
    assert.equal((await h.state()).clients.length, 0)
    const accepted = { ...input, fingerprint: preview.fingerprint, acceptanceReason: 'Checked converted reports and omitted legacy flag; retained original chart packages separately.' }
    const applied = await h.cmd('movein.apply', accepted)
    assert.equal(applied.job.state, 'applied')
    assert.equal(applied.records.length, 10)
    const state = await h.state()
    assert.equal(state.clients.length, 2)
    assert.equal(state.appointments.length, 3)
    const clientId = preview.patients[0].id
    const ownerFile = (await h.send('/api/balm/clients/' + clientId, undefined, h.owner)).value
    assert.equal(ownerFile.imported.notes.length, 1)
    assert.match(ownerFile.imported.notes[0].body, /Synthetic historical/)
    assert.equal(ownerFile.imported.notes[0].read_only, 1)
    assert.equal(ownerFile.imported.balances[0].amount_cents, 12550)
    assert.equal(ownerFile.imported.insurance.length, 1)
    const desk = await h.send('/api/balm/clients/' + clientId, undefined, reception.cookie)
    assert.equal(desk.value.imported.notes, null)
    assert.doesNotMatch(desk.text, /Synthetic historical/)
    const clinician = await h.send('/api/balm/clients/' + clientId, undefined, therapist.cookie)
    assert.equal(clinician.value.imported.notes.length, 1)
    const repeatedPreview = await h.cmd('movein.preview', input)
    assert.equal(repeatedPreview.canApply, true)
    const repeat = await h.cmd('movein.apply', accepted)
    assert.equal(repeat.job.id, applied.job.id)
    assert.equal((await h.state()).appointments.length, 3)
    await h.cmd('client.erase', { id: clientId }, h.owner, 409)
    const journal = await h.cmd('movein.journal', { jobId: applied.job.id })
    assert.deepEqual(journal.job.report.reconciliation, preview.reconciliation)
    await (await h.mf.getWorker()).scheduled({ scheduledTime: Date.now(), cron: '* * * * *' })
    const undone = await h.cmd('movein.undo', { jobId: applied.job.id })
    assert.equal(undone.job.state, 'undone')
    const end = await h.state()
    assert.equal(end.clients.length, 0)
    assert.equal(end.appointments.length, 0)
    assert.equal((await h.cmd('movein.undo', { jobId: applied.job.id })).job.state, 'undone')
  }))
}
