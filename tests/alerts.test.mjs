import { test } from 'node:test'
import assert from 'node:assert/strict'
import { run } from './harness.mjs'
import { clinic, pastVisit, visitDate } from './clinic.mjs'

test('CHART-010: a precaution follows the patient into the chart, calendar, check-in and next note', () => run(async h => {
  await h.finishSetup()
  const { service, practitioners: [priya] } = await clinic(h)
  const reception = await h.staff('Rosa', 'reception')
  const client = await h.cmd('client.save', { firstName: 'Taylor', lastName: 'Nguyen' })
  const visit = await pastVisit(h, client.id, priya, service.id)
  const path = '/app/clients/' + client.id, api = '/api/balm/clients/' + client.id
  const precaution = 'Partial weight-bearing: 25 percent on the left leg.'
  const response = await h.form(`/app/action?name=client.alert.save&returnTo=${encodeURIComponent(path)}`, {
    clientId: client.id, kind: 'precaution', text: precaution, active: 'true',
  }, priya.cookie)
  assert.equal(response.status, 303, response.text)
  const important = 'Face the patient when speaking; hearing aids in use.'
  await h.cmd('client.alert.save', { clientId: client.id, kind: 'important', text: important })
  const file = await h.send(api, undefined, priya.cookie)
  assert.equal(file.status, 200, file.text)
  assert.ok(file.value.alerts.some(a => a.kind === 'precaution' && a.text === precaution && a.active))
  const chart = await h.send(path, undefined, priya.cookie)
  assert.equal(chart.status, 200, chart.text)
  const header = chart.text.slice(0, chart.text.indexOf('<div class="grid">'))
  assert.ok(header.includes(precaution), 'the chart header shows the precaution before its panels')
  assert.ok(header.includes(important), 'important notes use the same clinical surfaces')
  const calendar = '/app?' + new URLSearchParams({ date: await visitDate(h, visit), appt: visit })
  const before = await h.send(calendar, undefined, reception.cookie)
  assert.equal(before.status, 200, before.text)
  assert.ok(before.text.includes(precaution), 'reception sees the precaution beside the visit at check-in')
  assert.match(before.text, /name=pay\.checkin/)
  const checked = await h.form('/app/action?name=pay.checkin&returnTo=' + encodeURIComponent(calendar), { appointmentId: visit }, reception.cookie)
  assert.equal(checked.status, 303, checked.text)
  assert.ok((await h.send(calendar, undefined, reception.cookie)).text.includes(precaution))
  const appointment = (await h.state(priya.cookie)).appointments.find(a => a.id === visit)
  assert.ok(appointment.alerts.some(a => a.text === precaution))
  const compose = await h.send(path + '?compose=' + visit, undefined, priya.cookie)
  assert.equal(compose.status, 200, compose.text)
  const notes = compose.text.match(/<section[^>]*id="notes"[^>]*>([\s\S]*?)<\/section>/)?.[1]
  assert.ok(notes?.includes(precaution), 'the next note shows the active precaution inside its composition panel')
  assert.match(notes, /name=note\.write/)
  const audit = (await h.send(api, undefined, h.owner)).value.audit
  assert.ok(audit.some(a => a.action === 'alert.created' && a.actor_email === priya.email))
  assert.ok(audit.some(a => a.action === 'alert.read' && a.actor_email === reception.email))
  assert.ok(!JSON.stringify(audit).includes(precaution), 'clinical alert text stays outside the audit')
}))

test('CHART-010: alert editing is scoped, concurrent changes conflict, and deactivation removes visit warnings', () => run(async h => {
  const { service, practitioners: [priya, sam] } = await clinic(h, ['Priya', 'Sam'])
  const reception = await h.staff('Rosa', 'reception')
  const client = await h.cmd('client.save', { firstName: 'Jordan', lastName: 'Diaz' })
  const other = await h.cmd('client.save', { firstName: 'Separate', lastName: 'Patient' })
  const visit = await pastVisit(h, client.id, priya, service.id)
  const input = { clientId: client.id, kind: 'medical', text: 'Latex allergy; use latex-free equipment.', active: true }
  await h.cmd('client.alert.save', input, reception.cookie, 403)
  await h.cmd('client.alert.save', input, sam.cookie, 404)
  const saved = await h.cmd('client.alert.save', input)
  const key = await h.cmd('agent.create', { label: 'Scheduling assistant' })
  const auth = { authorization: 'Bearer ' + key.token }
  assert.equal((await h.send('/api/balm/agent/command', { name: 'client.alert.save', input }, '', auth)).status, 403)
  assert.ok(!(await h.send('/api/balm/agent/context', undefined, '', auth)).text.includes(input.text))
  assert.equal((await h.send('/api/balm/clients/' + client.id, undefined, sam.cookie)).status, 404)
  assert.ok((await h.send('/api/balm/clients/' + client.id, undefined, reception.cookie)).value.alerts.some(a => a.id === saved.id))
  await h.cmd('client.alert.save', { ...input, id: saved.id, clientId: other.id, version: saved.version }, h.owner, 404)
  await h.cmd('client.alert.save', { ...input, kind: 'unsupported' }, h.owner, 400)
  await h.cmd('client.alert.save', { ...input, text: '' }, h.owner, 400)
  const race = await Promise.all(['Revised medical warning A', 'Revised medical warning B'].map(text => h.send('/api/balm/command', {
    name: 'client.alert.save', input: { ...input, id: saved.id, version: saved.version, text },
  }, priya.cookie)))
  assert.deepEqual(race.map(r => r.status).sort(), [200, 409])
  const api = '/api/balm/clients/' + client.id
  const updated = (await h.send(api, undefined, h.owner)).value.alerts.find(a => a.id === saved.id)
  assert.ok(updated.version > saved.version)
  assert.equal(updated.updated_by, priya.email)
  await h.cmd('client.alert.save', { ...input, id: saved.id, version: saved.version, active: false }, h.owner, 409)
  await h.cmd('client.alert.save', { ...input, text: updated.text, id: saved.id, version: updated.version, active: false }, priya.cookie)
  const inactive = (await h.send(api, undefined, h.owner)).value.alerts.find(a => a.id === saved.id)
  assert.equal(inactive.active, 0)
  const appointment = (await h.state(reception.cookie)).appointments.find(a => a.id === visit)
  assert.ok(!appointment.alerts.some(a => a.id === saved.id), 'inactive alerts are retained in the chart but stop warning on visits')
  const calendar = '/app?' + new URLSearchParams({ date: await visitDate(h, visit), appt: visit })
  assert.ok(!(await h.send(calendar, undefined, reception.cookie)).text.includes(updated.text))
}))
