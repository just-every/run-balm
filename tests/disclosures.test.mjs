import { test } from 'node:test'
import assert from 'node:assert/strict'
import { run } from './harness.mjs'
import { clinic, pastVisit } from './clinic.mjs'

const today = () => new Date(Date.now() + 10 * 3600_000).toISOString().slice(0, 10)
const release = clientId => ({ clientId, recipient: 'Attorney Morgan, legal@example.test', purpose: 'Patient-requested litigation records', basis: 'Written patient authorization retained by the practice', records: 'Evaluation and signed treatment notes', releasedAt: '2001-01-02T00:00:00+10:00' })

test('HIPAA-003: completed external releases and individual clinical accesses produce patient date-range reports', () => run(async h => {
  await h.finishSetup()
  const { service, practitioners: [priya] } = await clinic(h)
  const client = await h.cmd('client.save', { firstName: 'Riley', lastName: 'Chen' })
  const other = await h.cmd('client.save', { firstName: 'Other', lastName: 'Patient' })
  const path = `/api/balm/clients/${client.id}`
  const visit = await pastVisit(h, client.id, priya, service.id)
  await h.cmd('note.write', { clientId: client.id, appointmentId: visit, body: 'Private clinical narrative stays out of the report.' }, priya.cookie)
  await h.cmd('appointment.attend', { id: visit }, priya.cookie)
  const invoice = await h.cmd('invoice.prepare', { appointmentId: visit })
  await h.cmd('invoice.approve', { id: invoice.id })
  assert.equal((await h.send(`/api/balm/invoices/${invoice.id}.html`, undefined, h.owner)).status, 200)
  await h.send(path, undefined, priya.cookie)
  await h.send(path, undefined, priya.cookie)
  const attorney = await h.cmd('disclosure.record', release(client.id))
  const submitted = await h.form(`/app/action?name=disclosure.record&returnTo=${encodeURIComponent('/app/clients/' + client.id)}`, {
    ...release(client.id), releasedAt: '', releasedDate: '2001-01-02', releasedTime: '23:59',
    recipient: 'Referring provider, provider@example.test', purpose: 'Continuity of care', basis: 'Treatment disclosure',
  }, h.owner)
  assert.equal(submitted.status, 303, submitted.text)
  await h.cmd('disclosure.record', { ...release(client.id), releasedAt: '2001-01-01T23:59:59+10:00', recipient: 'Earlier release' })
  await h.cmd('disclosure.record', { ...release(client.id), releasedAt: '2001-01-03T00:00:00+10:00', recipient: 'Later release' })
  await h.cmd('disclosure.record', { ...release(other.id), recipient: 'Another patient recipient' })
  const accounting = await h.send(path + '/disclosures?from=2001-01-02&to=2001-01-02', undefined, h.owner)
  assert.equal(accounting.status, 200, accounting.text)
  assert.equal(accounting.value.disclosures.length, 2)
  assert.ok(accounting.value.disclosures.some(d => d.id === attorney.id && d.records === release(client.id).records))
  assert.ok(accounting.value.disclosures.some(d => d.recipient.startsWith('Referring provider') && d.released_at === '2001-01-02T13:59:00.000Z'))
  const report = await h.send(path + `/access-report?from=${today()}&to=${today()}`, undefined, h.owner)
  assert.equal(report.status, 200, report.text)
  const noteReads = report.value.access.filter(a => a.action === 'note.read' && a.actor_email === priya.email)
  assert.equal(noteReads.length, 2, 'each clinical read remains a separate report event')
  assert.notEqual(noteReads[0].sequence, noteReads[1].sequence)
  assert.ok(report.value.access.some(a => a.action === 'file.viewed'))
  assert.ok(report.value.access.some(a => a.action === 'invoice.downloaded' && a.subject_id === invoice.id))
  assert.ok(!report.value.access.some(a => a.action === 'invoice.prepared' || a.action === 'note.written'))
  assert.ok(!report.text.includes('Private clinical narrative'))
  const earlier = await h.send(path + '/access-report?from=2001-01-02&to=2001-01-02', undefined, h.owner)
  assert.deepEqual(earlier.value.access, [])
  assert.equal(earlier.value.disclosures.length, 2)
  const file = await h.send(path, undefined, h.owner)
  assert.equal(file.value.disclosures.length, 4)
  assert.ok(!JSON.stringify(file.value.audit).includes('legal@example.test'), 'disclosure personal details stay outside the access audit')
  const page = await h.send('/app/clients/' + client.id, undefined, h.owner)
  assert.equal(page.status, 200)
  assert.match(page.text, /name=disclosure\.record/)
  const csv = await h.send(path + '/disclosures?from=2001-01-02&to=2001-01-02&format=csv', undefined, h.owner)
  assert.equal(csv.status, 200, csv.text)
  assert.match(csv.headers.get('content-type'), /text\/csv/)
  assert.ok(csv.text.includes('legal@example.test') && csv.text.includes('provider@example.test'))
  assert.ok(!csv.text.includes('Earlier release') && !csv.text.includes('Another patient recipient'))
}))

test('HIPAA-003: disclosure recording and reports require a native owner and preserve completed accounting', () => run(async h => {
  const { practitioners: [priya] } = await clinic(h)
  const reception = await h.staff('Rosa', 'reception')
  const client = await h.cmd('client.save', { firstName: 'Avery', lastName: 'Park' })
  const input = release(client.id), path = `/api/balm/clients/${client.id}`
  for (const cookie of [priya.cookie, reception.cookie]) {
    await h.cmd('disclosure.record', input, cookie, 403)
    for (const report of ['disclosures', 'access-report']) assert.equal((await h.send(`${path}/${report}?from=2001-01-01&to=2001-01-03`, undefined, cookie)).status, 403)
  }
  assert.equal((await h.send(path + '/disclosures?from=2001-01-01&to=2001-01-03')).status, 401)
  const key = await h.cmd('agent.create', { label: 'Assistant' })
  const agent = await h.send('/api/balm/agent/command', { name: 'disclosure.record', input }, '', { authorization: 'Bearer ' + key.token })
  assert.equal(agent.status, 403)
  for (const invalid of [{ records: '' }, { basis: '' }, { releasedAt: '2001-02-30T12:00:00Z' }, { releasedAt: '2001-01-01T12:00:00' }, { releasedAt: new Date(Date.now() + 86400_000).toISOString() }]) {
    await h.cmd('disclosure.record', { ...input, ...invalid }, h.owner, 400)
  }
  const saved = await h.cmd('disclosure.record', { ...input, recipient: '=Spreadsheet formula' })
  const csv = await h.send(path + '/disclosures?from=2001-01-02&to=2001-01-02&format=csv', undefined, h.owner)
  assert.ok(csv.text.includes("'=Spreadsheet formula"))
  for (const query of ['from=2001-01-03&to=2001-01-01', 'from=2001-02-30&to=2001-03-01', 'from=bad&to=bad']) {
    assert.equal((await h.send(path + '/disclosures?' + query, undefined, h.owner)).status, 400)
  }
  await assert.rejects(h.db.prepare('UPDATE bm_disclosures SET recipient=? WHERE id=?').bind('Changed', saved.id).run(), /disclosure_append_only/)
  await assert.rejects(h.db.prepare('DELETE FROM bm_disclosures WHERE id=?').bind(saved.id).run(), /disclosure_append_only/)
  await h.cmd('client.erase', { id: client.id }, h.owner, 409)
  const accounting = await h.send(path + '/disclosures?from=2001-01-02&to=2001-01-02', undefined, h.owner)
  assert.equal(accounting.value.disclosures[0].id, saved.id)
}))
