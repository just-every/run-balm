import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { run } from './harness.mjs'
import { clinic } from './clinic.mjs'

const kinds = ['patients', 'appointments', 'notes', 'balances', 'insurance']
// The fixtures' booked appointments: two overlapping on the 2nd of the month after next and one on the 1st of the month after that, so they stay upcoming, outside the reminder window and in two months on any date.
const month = ahead => { const d = new Date(); d.setUTCDate(1); d.setUTCMonth(d.getUTCMonth() + ahead); return d.toISOString().slice(0, 7) }
const dated = csv => csv.replaceAll('{{MONTH1}}', month(2)).replaceAll('{{MONTH2}}', month(3))
for (const provider of ['cliniko', 'webpt', 'simplepractice', 'jane']) {
  test(`${provider}: preview, reconcile, atomic apply, duplicate-free repeat and whole-bundle undo`, () => run(async h => {
    await h.finishSetup()
    const { service, practitioners: [therapist] } = await clinic(h)
    const reception = await h.staff('Rosa', 'reception')
    const files = await Promise.all(kinds.map(async kind => ({ kind, name: `${kind}.csv`, csv: dated(await readFile(`tests/fixtures/movein/${provider}/${kind}.csv`, 'utf8')) })))
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

test('downloaded WebPT reports and SimplePractice spreadsheets move in through the page, including a clinic-size patient list', () => run(async h => {
  await h.finishSetup()
  const { service, practitioners: [therapist] } = await clinic(h)
  await h.cmd('settings.save', { clinicName: 'Lakeview Therapy', timeZone: 'America/Chicago', taxId: '36-4829175', address: '100 Example Street, Chicago IL' })
  const input = { provider: 'webpt', practitionerId: therapist.id, serviceId: service.id, files: [
    { kind: 'appointments', name: 'Scheduled Visits.csv', csv: await readFile('tests/fixtures/movein/webpt-scheduled-visits-native.csv', 'utf8') },
    { kind: 'patients', name: 'Patient Lists.csv', csv: await readFile('tests/fixtures/movein/webpt-patient-lists-native.csv', 'utf8') },
  ] }
  const preview = await h.cmd('movein.preview', input)
  assert.equal(preview.canApply, true, JSON.stringify(preview.diagnostics))
  assert.equal(preview.patients.length, 2)
  assert.equal(preview.appointments.length, 3)
  assert.ok(preview.diagnostics.some(d => d.code === 'webpt_status_not_recorded'))
  assert.equal(preview.appointments.filter(a => a.status === 'booked').length, 2)
  assert.ok(preview.appointments.some(a => a.startAt.endsWith('14:00:00.000Z')))
  assert.ok(preview.appointments.some(a => a.startAt.endsWith('15:00:00.000Z')))
  const applied = await h.cmd('movein.apply', { ...input, fingerprint: preview.fingerprint, acceptanceReason: 'Checked patient links, one therapist, one service and omitted columns against the reports.' })
  const charts = await Promise.all(preview.patients.map(p => h.send('/api/balm/clients/' + p.id, undefined, h.owner)))
  assert.equal(charts.reduce((count, chart) => count + chart.value.appointments.length, 0), 3)
  assert.equal(applied.records.filter(r => r.kind === 'appointment').length, 3)
  await h.cmd('movein.undo', { jobId: applied.job.id })

  const large = { provider: 'webpt', files: [{ kind: 'patients', name: 'Patient Lists.csv', csv: 'Patient Name,Date of Birth,Email,Phone\n' + Array.from({ length: 1284 }, (_, i) => `Patient${i} Example,01/15/1980,patient${i}@patients.example,+1 202-555-0101`).join('\n') }] }
  const bigPreview = await h.cmd('movein.preview', large)
  assert.equal(bigPreview.canApply, true, JSON.stringify(bigPreview.diagnostics))
  const big = await h.cmd('movein.apply', { ...large, fingerprint: bigPreview.fingerprint, acceptanceReason: 'Checked all names and the source patient count.' })
  assert.equal(big.records.length, 1284)
  assert.equal((await h.state()).clients.length, 1284)
  assert.equal((await h.cmd('movein.apply', { ...large, fingerprint: bigPreview.fingerprint, acceptanceReason: 'Checked again.' })).job.id, big.job.id)
  await h.cmd('movein.undo', { jobId: big.job.id })
  assert.equal((await h.state()).clients.length, 0)

  const { read, write, utils } = await import('xlsx')
  const book = read(await readFile('tests/fixtures/movein/simplepractice-client-details-report.csv', 'utf8'), { type: 'string' })
  const body = new FormData()
  body.set('provider', 'simplepractice')
  body.set('patients', new File([write(book, { type: 'array', bookType: 'xlsx' })], 'Client details.xlsx'))
  const upload = new Request(h.origin + '/app/action?name=movein.preview&returnTo=%2Fapp%2Fimport', { method: 'POST', headers: { origin: h.origin, cookie: h.owner }, body })
  const response = await h.mf.dispatchFetch(upload.url, { method: 'POST', headers: Object.fromEntries(upload.headers), body: await upload.arrayBuffer() })
  const html = await response.text()
  assert.equal(response.status, 200, html)
  assert.match(html, /Maya Santos/)
  assert.match(html, /Elliot Reed/)
  const reviewed = Object.fromEntries(['bundleBase64', 'fingerprint'].map(name => [name, html.match(new RegExp(`name="${name}" value="([^"]+)"`))?.[1]]))
  assert.ok(reviewed.bundleBase64 && reviewed.fingerprint)
  const imported = await h.form('/app/action?name=movein.apply&returnTo=%2Fapp%2Fimport', { ...reviewed, acceptanceReason: 'Checked the original report and omitted columns.', confirm: 'on' }, h.owner)
  assert.equal(imported.status, 200, imported.text)
  const moved = await h.state()
  assert.equal(moved.clients.length, 2)
  await h.cmd('movein.undo', { jobId: moved.moveinJobs.find(j => j.provider === 'simplepractice').id })

  const legacy = utils.book_new()
  utils.book_append_sheet(legacy, utils.aoa_to_sheet([
    ['Name (Last)', 'Name (First)', 'Patient ID', 'Email', 'Home Phone', 'Cell Phone', 'Date of Birth', 'Primary Insurance', 'Primary Subscriber ID'],
    ['Rivera', 'Ana', '0001001', 'ana@patients.example', '+1 202-555-0101', '+1 202-555-0102', new Date('1987-05-14T00:00:00Z'), 'Example Health Plan', 'MEMBER1001'],
  ]), 'Patients')
  const excel = new FormData()
  excel.set('provider', 'webpt')
  excel.set('patients', new File([write(legacy, { type: 'array', bookType: 'biff8' })], 'Patients.xls'))
  const native = new Request(upload.url, { method: 'POST', headers: { origin: h.origin, cookie: h.owner }, body: excel })
  const nativeResponse = await h.mf.dispatchFetch(native.url, { method: 'POST', headers: Object.fromEntries(native.headers), body: await native.arrayBuffer() })
  const nativeHtml = await nativeResponse.text()
  assert.equal(nativeResponse.status, 200, nativeHtml)
  const source = JSON.parse(Buffer.from(nativeHtml.match(/name="bundleBase64" value="([^"]+)"/)[1], 'base64').toString())
  const nativePreview = await h.cmd('movein.preview', source)
  assert.equal(nativePreview.canApply, true, JSON.stringify(nativePreview.diagnostics))
  assert.equal(nativePreview.patients[0].sourceId, '0001001')
  assert.equal(nativePreview.patients[0].dateOfBirth, '1987-05-14')
  assert.equal(nativePreview.patients[0].phone, '+1 202-555-0102')
  assert.equal(nativePreview.insurance[0].memberId, 'MEMBER1001')
}))
