import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { run } from './harness.mjs'
import { bookOnline, clinic, pastVisit, slots } from './clinic.mjs'

const intakeToken = location => location.match(/\/intake\/([\w-]+)/)[1]

test('online booking for a new client delivers the intake link, refuses a taken slot and records the visit', () => run(async h => {
  const { service, practitioners: [priya] } = await clinic(h)
  const open = await slots(h, service.id, priya.id)
  assert.ok(open.length > 10)
  const booked = await bookOnline(h, service.id, priya.id, open[0])
  assert.equal(booked.status, 303, booked.text)
  assert.match(booked.location, /\/intake\/[\w-]+\?booked=1&mail=sent/)
  assert.ok(h.mail.some(m => m.to.includes('maya@client.example') && m.text.includes(intakeToken(booked.location))))
  assert.ok(!(await slots(h, service.id, priya.id)).includes(open[0]))
  const taken = await bookOnline(h, service.id, priya.id, open[0], { email: 'other@client.example', firstName: 'Other' })
  assert.equal(taken.status, 409)
  assert.match(taken.text, /that time was just taken/); assert.match(taken.text, /value="other@client\.example"/); assert.match(taken.text, /Choose another time/)
  assert.equal((await bookOnline(h, service.id, priya.id, '2026-01-01T00:07:00.000Z')).status, 409)
  const cross = await h.mf.dispatchFetch(h.origin + '/book', { method: 'POST', headers: { origin: 'https://evil.example', 'content-type': 'application/x-www-form-urlencoded' }, body: 'serviceId=x', redirect: 'manual' })
  assert.equal(cross.status, 403)
  // Two people racing for one slot: exactly one appointment exists.
  const race = await Promise.all(['a', 'b'].map(n => bookOnline(h, service.id, priya.id, open[4], { email: `${n}@client.example`, firstName: n.toUpperCase() })))
  assert.deepEqual(race.map(r => r.status).sort(), [303, 409])
  const s = await h.state()
  assert.equal(s.appointments.filter(a => a.start_at === open[4] && a.status === 'booked').length, 1)
  assert.equal(s.clients.length, 2)
  const file = await h.send('/api/balm/clients/' + s.appointments[0].client_id, undefined, h.owner)
  assert.ok(file.value.audit.some(a => a.action === 'appointment.booked' && a.actor_role === 'online booking'))
}))

test('INTAKE-001: intake answers reach only the treating practitioner and the owner, once, and every read is audited', () => run(async h => {
  const { service, practitioners: [priya, sam] } = await clinic(h, ['Priya', 'Sam'])
  const reception = await h.staff('Rosa', 'reception')
  const booked = await bookOnline(h, service.id, priya.id, (await slots(h, service.id, priya.id))[0])
  const token = intakeToken(booked.location), page = await h.send(booked.location)
  assert.equal(page.status, 200); assert.ok(page.text.includes('What brings you in?'))
  const answers = { formId: 'intake-v1', q_reason: 'Left knee pain when running', q_emergency: 'Sam Lee 0400 111 222', q_consent: 'yes', consentVersion: page.text.match(/name="consentVersion" value="([^"]+)"/)[1], consentAccepted: 'on', signerName: 'Maya Lee', signerRelationship: 'patient', signatureTyped: 'Maya Lee' }
  assert.equal((await h.form(`/intake/${token}`, { ...answers, q_consent: '' })).status, 400)
  assert.equal((await h.form(`/intake/${token}`, answers)).status, 303)
  assert.equal((await h.form(`/intake/${token}`, answers)).status, 409)
  assert.ok(!(await h.send(`/intake/${token}`)).text.includes('Left knee'))
  const clientId = (await h.state()).clients[0].id
  const read = async cookie => h.send('/api/balm/clients/' + clientId, undefined, cookie)
  assert.equal((await read(priya.cookie)).value.intake[0].answers.reason, 'Left knee pain when running')
  assert.equal((await read(h.owner)).value.intake.length, 1)
  const desk = await read(reception.cookie)
  assert.equal(desk.status, 200); assert.equal(desk.value.intake, null); assert.equal(desk.value.notes, null)
  assert.ok(!desk.text.includes('Left knee'))
  assert.equal((await read(sam.cookie)).status, 404)
  assert.equal((await h.send('/app/clients/' + clientId, undefined, sam.cookie)).status, 404)
  const audit = (await read(h.owner)).value.audit
  assert.ok(audit.some(a => a.action === 'intake.submitted'))
  assert.equal(audit.filter(a => a.action === 'intake.read' && a.actor_email === priya.email).length, 1)
  assert.ok(audit.some(a => a.action === 'file.viewed' && a.actor_email === reception.email))
  assert.ok(!JSON.stringify(audit).includes('Left knee'))
  assert.equal((await h.db.prepare('DELETE FROM bm_audit').run().catch(e => e)).message?.includes('audit_append_only'), true)
  // Every returning booking door suppresses a second request for the current form.
  const remaining = () => slots(h, service.id, priya.id)
  const repeat = await bookOnline(h, service.id, priya.id, (await remaining())[0])
  assert.equal(repeat.status, 303); assert.match(repeat.location, /intake=on_file/)
  assert.match((await h.send(repeat.location)).text, /current intake form is already on file/)
  const local = instant => new Date(Date.parse(instant) + 10 * 3600_000).toISOString()
  const staffBook = async () => {
    const start = local((await remaining())[0])
    return h.cmd('appointment.book', { clientId, practitionerId: priya.id, serviceId: service.id, date: start.slice(0,10), time: start.slice(11,16) })
  }
  const seriesBook = async () => {
    const start = local((await remaining())[0]), date = start.slice(0,10), time = start.slice(11,16)
    return h.cmd('series.book', { clientId, practitionerId: priya.id, serviceId: service.id, firstDate:date, time, weeks:1, weekdays:[new Date(date).getUTCDay()], occurrences:[{date,time}] })
  }
  const before = h.mail.length
  for (const saved of [await staffBook(), await seriesBook()]) { assert.equal(saved.intake,'on_file'); assert.equal(saved.token,undefined) }
  assert.ok(!h.mail.slice(before).some(m => /\/intake\//.test(m.text)))
  for (const visit of (await h.state()).appointments.filter(a=>a.client_id===clientId && a.status==='booked')) await h.cmd('appointment.cancel',{id:visit.id,reason:'Patient requested cancellation'})
  // Publishing does not rewrite old answers; the next booking requests the new form.
  const draft = await h.cmd('intake.prepare', {title:'Updated intake',questions:[{id:'reason',label:'What changed?',type:'long',required:true}]})
  const published = await h.cmd('intake.publish',{id:draft.id})
  const renewed = await bookOnline(h,service.id,priya.id,(await remaining())[0])
  assert.equal(renewed.status,303); assert.match(renewed.location,/^\/intake\//)
  const renewedPath = renewed.location.split('?')[0], current = await h.send(renewedPath)
  assert.match(current.text,/What changed/)
  assert.ok(h.mail.findLast(m => m.to.includes('maya@client.example') && m.text.includes(renewedPath)))
  const renewal = {formId:published.id,q_reason:'Now able to climb stairs'}
  assert.equal((await h.form(renewedPath,{...renewal,formId:'intake-v1'})).status,409)
  assert.equal((await h.form(renewedPath,renewal)).status,303)
  assert.equal((await h.form(renewedPath,renewal)).status,409)
  const versions = (await read(h.owner)).value.intake
  assert.equal(versions.length,2)
  assert.equal(versions.find(i => i.formNumber === 1).answers.reason,'Left knee pain when running')
  assert.equal(versions.find(i => i.formNumber === published.number).answers.reason,'Now able to climb stairs')
  assert.ok(!(await h.send(renewedPath)).text.includes('Now able to climb stairs'))
  for (const book of [staffBook,seriesBook]) {
    const prepared=await h.cmd('intake.prepare',{title:'Updated history',questions:[{id:'update',label:'Current recovery update',type:'short',required:true}]})
    const version=await h.cmd('intake.publish',{id:prepared.id})
    const booking=await book()
    assert.equal(booking.intake,'ask');assert.ok(booking.token)
    assert.ok(h.mail.findLast(m=>m.text.includes('/intake/'+booking.token)))
    assert.equal((await h.form('/intake/'+booking.token,{formId:version.id,q_update:'Steady improvement'})).status,303)
  }
  assert.equal((await read(h.owner)).value.intake.length,4)


}))

test('a treatment note is readable only by its practitioner and the owner, and amendments keep history', () => run(async h => {
  await h.finishSetup()
  const { service, practitioners: [priya, sam] } = await clinic(h, ['Priya', 'Sam'])
  const reception = await h.staff('Rosa', 'reception')
  const client = await h.cmd('client.save', { firstName: 'Noah', lastName: 'Kim', dateOfBirth: '1979-11-30', email: 'noah@client.example' }, reception.cookie)
  const visit = await pastVisit(h, client.id, priya, service.id, reception.cookie)
  await pastVisit(h, client.id, sam, service.id, reception.cookie, 5)
  const note = await h.cmd('note.write', { clientId: client.id, appointmentId: visit, body: 'S: knee pain 6/10. O: reduced flexion. P: quads program.' }, priya.cookie)
  await h.cmd('note.write', { clientId: client.id, appointmentId: visit, body: 'x' }, sam.cookie, 404)
  await h.cmd('note.write', { clientId: client.id, body: 'x' }, reception.cookie, 403)
  await h.cmd('note.amend', { id: note.id, body: 'S: knee pain 5/10.', reason: 'Corrected pain score' }, sam.cookie, 404)
  await h.cmd('note.amend', { id: note.id, body: 'S: knee pain 5/10.', reason: 'Corrected pain score', revision: 1 }, priya.cookie)
  const view = async cookie => (await h.send('/api/balm/clients/' + client.id, undefined, cookie)).value
  const own = await view(priya.cookie)
  assert.deepEqual(own.notes[0].revisions.map(r => r.number), [2, 1])
  assert.ok(own.notes[0].revisions[1].body.includes('6/10'))
  assert.equal((await view(sam.cookie)).notes.length, 0)
  assert.equal((await view(reception.cookie)).notes, null)
  assert.equal((await view(h.owner)).notes.length, 1)
  const page = await h.send('/app/clients/' + client.id, undefined, sam.cookie)
  assert.equal(page.status, 200); assert.ok(!page.text.includes('knee pain'))
  const agent = await h.cmd('agent.create', { label: 'Front desk assistant' })
  const context = await h.send('/api/balm/agent/context', undefined, '', { authorization: 'Bearer ' + agent.token })
  assert.equal(context.status, 200); assert.ok(!context.text.includes('knee pain'))
  assert.equal((await h.send('/api/balm/clients/' + client.id, undefined, '', { authorization: 'Bearer ' + agent.token })).status, 401)
  const audit = (await view(h.owner)).audit
  for (const [who, action] of [[priya.email, 'note.written'], [priya.email, 'note.amended'], [h.auth.OWNER_EMAIL, 'note.read'], [priya.email, 'note.read'], [h.auth.OWNER_EMAIL, 'agent.context']]) assert.ok(audit.some(a => a.actor_email === who && a.action === action), action)
  assert.ok(!audit.some(a => a.actor_email === sam.email && a.action === 'note.read'))
}))

test('invoices: prepared from an attended visit, approved by a person, numbered once, exported as exact bytes and paid once', () => run(async h => {
  const { service, practitioners: [priya] } = await clinic(h)
  const reception = await h.staff('Rosa', 'reception')
  const client = await h.cmd('client.save', { firstName: 'Ava', lastName: 'Ng', dateOfBirth: '1992-06-15' })
  const visit = await pastVisit(h, client.id, priya, service.id)
  await h.cmd('invoice.prepare', { appointmentId: visit }, reception.cookie, 409)
  await h.cmd('appointment.attend', { id: visit }, priya.cookie)
  const key = await h.cmd('agent.create', { label: 'Billing assistant' }), agent = { authorization: 'Bearer ' + key.token }
  // An assistant imports the agent door's schema without a key, then calls with one.
  const schema = (await h.send('/api/balm/agent/openapi.json')).value
  assert.equal(schema.servers[0].url, h.origin); assert.deepEqual(Object.keys(schema.paths), ['/api/balm/agent/context', '/api/balm/agent/command'])
  const prepared = await h.send('/api/balm/agent/command', { name: 'invoice.prepare', input: { appointmentId: visit } }, '', agent)
  assert.equal(prepared.status, 200, prepared.text)
  const invoiceId = prepared.value.result.id
  assert.equal((await h.send('/api/balm/agent/command', { name: 'invoice.approve', input: { id: invoiceId } }, '', agent)).status, 403)
  assert.equal((await h.send('/api/balm/command', { name: 'invoice.approve', input: { id: invoiceId } }, '', agent)).status, 401)
  await h.cmd('invoice.approve', { id: invoiceId }, priya.cookie, 403)
  await h.cmd('invoice.prepare', { appointmentId: visit }, reception.cookie, 409)
  const approved = await h.cmd('invoice.approve', { id: invoiceId }, reception.cookie)
  assert.equal(approved.number, 'INV-000001')
  await h.cmd('invoice.approve', { id: invoiceId }, h.owner, 409)
  const first = await h.send(`/api/balm/invoices/${invoiceId}.html`, undefined, reception.cookie)
  assert.equal(first.status, 200)
  assert.match(first.headers.get('content-disposition'), /balm-INV-000001\.html/)
  for (const text of ['Riverside Physio', '12-3456789', 'Ava Ng', 'Priya', 'Initial consultation', '$95.00']) assert.ok(first.text.includes(text), text)
  await h.cmd('service.save', { id: service.id, name: 'Initial consultation', durationMinutes: 45, priceCents: 12000 })
  assert.equal((await h.send(`/api/balm/invoices/${invoiceId}.html`, undefined, h.owner)).text, first.text)
  assert.equal((await h.send(`/api/balm/invoices/${invoiceId}.html`, undefined, priya.cookie)).status, 403)
  await h.cmd('payment.record', { invoiceId, amountCents: 5000, reference: 'EFTPOS-1001' }, reception.cookie)
  await h.cmd('payment.record', { invoiceId, amountCents: 1000, reference: 'EFTPOS-1001' }, reception.cookie, 409)
  await h.cmd('payment.record', { invoiceId, amountCents: 4501, reference: 'EFTPOS-1002' }, reception.cookie, 409)
  await h.cmd('payment.record', { invoiceId, amountCents: 4500, reference: 'EFTPOS-1002' }, reception.cookie)
  await h.cmd('invoice.void', { id: invoiceId, reason: 'test' }, h.owner, 409)
  const s = await h.state(reception.cookie)
  assert.equal(s.invoices[0].paid_cents, 9500)
  // A second visit's draft is fenced by the facts it froze.
  const second = await pastVisit(h, client.id, priya, service.id, h.owner, 6)
  await h.cmd('appointment.attend', { id: second }, h.owner)
  const draft = await h.cmd('invoice.prepare', { appointmentId: second }, reception.cookie)
  await h.cmd('staff.save', { id: priya.id, name: 'Priya Shah', email: priya.email, role: 'practitioner', profession: 'Physiotherapist', providerNumber: '2534567A', active: true })
  await h.cmd('invoice.approve', { id: draft.id }, reception.cookie, 409)
  await h.finishSetup()
  const clientPath = '/app/clients/' + client.id
  const page = await h.send(clientPath, undefined, reception.cookie)
  assert.match(page.text, /name="replacesId"/)
  const refreshed = await h.form('/app/action?name=invoice.prepare&returnTo=' + encodeURIComponent(clientPath), { appointmentId: second, replacesId: draft.id, amount: '120.00' }, reception.cookie)
  assert.equal(refreshed.status, 303, refreshed.text)
  const file = (await h.send('/api/balm/clients/' + client.id, undefined, h.owner)).value
  const fresh = file.invoices.find(i => i.appointment_id === second && i.status === 'draft')
  assert.ok(fresh); assert.notEqual(fresh.id, draft.id)
  assert.equal(file.invoices.find(i => i.id === draft.id).status, 'void')
  await h.cmd('invoice.approve', { id: draft.id }, reception.cookie, 409)
  await h.cmd('invoice.approve', { id: fresh.id }, reception.cookie)
  await h.cmd('invoice.prepare', { appointmentId: second, replacesId: fresh.id }, reception.cookie, 404)
  const owner = await h.send('/api/balm/clients/' + client.id, undefined, h.owner)
  assert.equal(owner.value.audit.filter(a => a.action === 'invoice.downloaded').length, 2)
  const approvals = (await h.state()).approvals
  assert.ok(approvals.some(a => a.subject_id === invoiceId && a.prepared_role === 'agent' && a.approved_by === reception.email))
}))

test('roles, sessions and agent keys: every server door checks the live actor', () => run(async h => {
  const { service, practitioners: [priya] } = await clinic(h)
  const reception = await h.staff('Rosa', 'reception')
  await h.state('', 401)
  assert.equal((await h.send('/app', undefined, '')).status, 303)
  await h.cmd('staff.save', { name: 'X', email: 'x@clinic.example' }, reception.cookie, 403)
  await h.cmd('settings.save', { clinicName: 'Mine', timeZone: 'Australia/Brisbane' }, priya.cookie, 403)
  await h.cmd('intake.publish', { id: 'none' }, reception.cookie, 403)
  await h.cmd('client.erase', { id: 'none' }, reception.cookie, 403)
  const cross = await h.send('/api/balm/command', { name: 'client.save', input: { firstName: 'A', lastName: 'B' } }, h.owner, { origin: 'https://evil.example' })
  assert.equal(cross.status, 403)
  const malformed = await h.mf.dispatchFetch(h.origin + '/api/balm/command', { method: 'POST', headers: { origin: h.origin, cookie: h.owner, 'content-type': 'application/json' }, body: '{' })
  assert.equal(malformed.status, 400)
  assert.equal((await h.send('/app/import', undefined, reception.cookie)).status, 403)
  assert.equal((await h.cmd('import.preview', { csv: 'x' }, reception.cookie, 403)).error !== undefined, true)
  const client = await h.cmd('client.save', { firstName: 'Ava', lastName: 'Ng' }, reception.cookie)
  // A practitioner books only their own calendar and sees only their own clients.
  await h.cmd('appointment.book', { clientId: client.id, practitionerId: priya.id, serviceId: service.id, date: '2099-01-05', time: '10:00' }, priya.cookie)
  await h.cmd('appointment.book', { clientId: client.id, practitionerId: priya.id, serviceId: service.id, date: '2099-01-05', time: '10:30' }, reception.cookie, 409)
  assert.deepEqual((await h.state(priya.cookie)).clients.map(c => c.id), [client.id])
  // Deactivation removes access at once, even mid-session.
  await h.cmd('staff.save', { id: reception.id, name: 'Rosa', email: reception.email, role: 'reception', active: false })
  await h.state(reception.cookie, 403)
  await h.cmd('client.save', { firstName: 'C', lastName: 'D' }, reception.cookie, 403)
  // Agent keys prepare only, and a revoked key stops at once.
  const key = await h.cmd('agent.create', { label: 'Assistant' }), agent = (name, input) => h.send('/api/balm/agent/command', { name, input }, '', { authorization: 'Bearer ' + key.token })
  assert.equal((await agent('client.save', { firstName: 'E', lastName: 'F' })).status, 403)
  const form = await agent('intake.prepare', { title: 'Podiatry intake', questions: [{ id: 'footwear', label: 'What shoes do you wear most days?', type: 'short', required: true }] })
  assert.equal(form.status, 200)
  assert.equal((await agent('intake.publish', { id: form.value.result.id })).status, 403)
  const published = await h.cmd('intake.publish', { id: form.value.result.id })
  assert.equal(published.number, 2)
  const reminderFor = (await h.state()).appointments[0].id
  const reminder = await agent('reminder.prepare', { appointmentId: reminderFor })
  assert.equal(reminder.status, 409) // That client has no email.
  await h.cmd('agent.revoke', { id: key.id })
  assert.equal((await agent('intake.prepare', { title: 'x', questions: [] })).status, 401)
  assert.ok((await h.state()).approvals.some(a => a.subject_type === 'intake' && a.prepared_role === 'agent'))
}))

test('an agent-prepared reminder is approved by a person and exported as the exact approved text', () => run(async h => {
  const { service, practitioners: [priya] } = await clinic(h)
  await bookOnline(h, service.id, priya.id, (await slots(h, service.id, priya.id))[0])
  const appointment = (await h.state()).appointments[0]
  const key = await h.cmd('agent.create', { label: 'Reminders' })
  const prepared = await h.send('/api/balm/agent/command', { name: 'reminder.prepare', input: { appointmentId: appointment.id } }, '', { authorization: 'Bearer ' + key.token })
  assert.equal(prepared.status, 200, prepared.text)
  const approved = await h.cmd('reminder.approve', { id: prepared.value.result.id })
  assert.match(approved.text, /^To: maya@client\.example\nSubject: Reminder: Initial consultation at Riverside Physio/)
  const download = await h.send(`/api/balm/reminders/${prepared.value.result.id}.txt`, undefined, h.owner)
  assert.equal(download.text, approved.text)
  await h.cmd('reminder.approve', { id: prepared.value.result.id }, h.owner, 409)
  assert.equal((await h.send(`/api/balm/reminders/${prepared.value.result.id}.txt`, undefined, '', { authorization: 'Bearer ' + key.token })).status, 401)
}))

test('Cliniko patient CSV: preview, exact-review apply, journal with the original, and undo that keeps used clients', () => run(async h => {
  const { service, practitioners: [priya] } = await clinic(h)
  const csv = await readFile('tests/fixtures/cliniko-patients.csv', 'utf8')
  const preview = await h.cmd('import.preview', { csv })
  assert.equal(preview.clients.length, 4); assert.equal((await h.state()).clients.length, 0)
  await h.cmd('import.apply', { csv: csv.replace('Olivia', 'Olive'), fingerprint: preview.fingerprint }, h.owner, 409)
  let job = (await h.cmd('import.apply', { csv, fingerprint: preview.fingerprint })).job
  while (job.state === 'applying') job = (await h.cmd('import.resume', { jobId: job.id })).job
  assert.equal(job.state, 'completed')
  const clients = (await h.state()).clients
  assert.equal(clients.length, 4)
  assert.equal(clients.find(c => c.first_name === 'Olivia').date_of_birth, '1985-03-14')
  const journal = await h.cmd('import.journal', { jobId: job.id })
  assert.ok(JSON.stringify(journal.originals).includes('patients.csv'))
  const edited = clients.find(c => c.first_name === 'Olivia'), used = clients.find(c => c.first_name === 'Jack')
  await h.cmd('client.save', { id: edited.id, firstName: 'Olivia', lastName: 'Brown-Smith', dateOfBirth: '1985-03-14' })
  await h.cmd('appointment.book', { clientId: used.id, practitionerId: priya.id, serviceId: service.id, date: '2099-02-02', time: '09:00' })
  const again = await h.cmd('import.preview', { csv })
  assert.ok(again.conflicts.length >= 4)
  await h.cmd('import.undo', { jobId: job.id })
  const after = (await h.state()).clients.map(c => c.last_name).sort()
  assert.deepEqual(after, ['Brown-Smith', 'Wilson'])
}))

test('erasure removes an unused client, fences re-entry and import, and retains clients with health records', () => run(async h => {
  const { service, practitioners: [priya] } = await clinic(h)
  const unused = await h.cmd('client.save', { firstName: 'Olivia', lastName: 'Brown', dateOfBirth: '1985-03-14', email: 'olivia@client.example' })
  await h.cmd('client.erase', { id: unused.id })
  assert.ok(!JSON.stringify(await h.state()).includes('olivia@client.example'))
  await h.cmd('client.save', { firstName: 'Olivia', lastName: 'Brown', dateOfBirth: '1985-03-14' }, h.owner, 409)
  const csv = await readFile('tests/fixtures/cliniko-patients.csv', 'utf8')
  const preview = await h.cmd('import.preview', { csv })
  assert.ok(preview.conflicts.some(c => c.reason === 'erased_identity'))
  await h.cmd('import.apply', { csv, fingerprint: preview.fingerprint }, h.owner, 409)
  const kept = await h.cmd('client.save', { firstName: 'Noah', lastName: 'Kim' })
  await h.cmd('appointment.book', { clientId: kept.id, practitionerId: priya.id, serviceId: service.id, date: '2099-02-02', time: '09:00' })
  await h.cmd('client.erase', { id: kept.id }, h.owner, 409)
  const staff = await h.cmd('staff.save', { name: 'Never joined', email: 'never@clinic.example', role: 'reception' })
  await h.cmd('staff.erase', { id: staff.id })
  await h.cmd('staff.erase', { id: priya.id }, h.owner, 409)
  await h.cmd('staff.save', { name: 'Never joined', email: 'never@clinic.example', role: 'reception' }, h.owner, 409)
}))

test('the signed-in screens render each role’s working pages', () => run(async h => {
  await h.finishSetup()
  const { service, practitioners: [priya] } = await clinic(h)
  const reception = await h.staff('Rosa', 'reception')
  const booked = await bookOnline(h, service.id, priya.id, (await slots(h, service.id, priya.id))[0])
  assert.equal(booked.status, 303)
  const client = (await h.state()).clients[0]
  for (const path of ['/app', '/app/clients', '/app/clients/' + client.id, '/app/invoices', '/app/clinic', '/app/intake', '/app/import', '/app/agent']) {
    const page = await h.send(path, undefined, h.owner)
    assert.equal(page.status, 200, path)
    assert.match(page.headers.get('content-security-policy'), /frame-ancestors 'none'/)
  }
  assert.equal((await h.send('/app/mail', undefined, h.owner)).status, 404)
  assert.equal((await h.send('/app/clinic', undefined, reception.cookie)).status, 403)
  assert.equal((await h.send('/app/invoices', undefined, priya.cookie)).status, 403)
  const booking = await h.form('/app/action?name=client.save&returnTo=/app/clients', { firstName: 'Form', lastName: 'Client' }, reception.cookie)
  assert.equal(booking.status, 303)
  assert.equal((await h.send('/book')).status, 200)
  assert.equal((await h.send('/intake/not-a-real-token-at-all-000')).status, 404)
}))


test('INTAKE-001: all booking doors retain one open request, racing bookings cannot duplicate it, and past visits send nothing', () => run(async h => {
  const {service,practitioners:[priya]} = await clinic(h)
  const available = await slots(h,service.id,priya.id)
  const first = await bookOnline(h,service.id,priya.id,available[0])
  const path = first.location.split('?')[0], clientId = (await h.state()).clients[0].id
  const next = await bookOnline(h,service.id,priya.id,available[4])
  assert.equal(next.status,303);assert.match(next.location,/intake=link_open/)
  assert.match((await h.send(next.location)).text,/existing private intake link/)
  const local = start => new Date(Date.parse(start)+10*3600_000).toISOString()
  const fields = start => ({clientId,practitionerId:priya.id,serviceId:service.id,date:local(start).slice(0,10),time:local(start).slice(11,16)})
  const staff = await h.cmd('appointment.book',fields(available[8]))
  assert.equal(staff.intake,'link_open');assert.equal(staff.token,undefined)
  const seriesFields = fields(available[12])
  const series = await h.cmd('series.book',{...seriesFields,firstDate:seriesFields.date,weeks:1,weekdays:[new Date(seriesFields.date).getUTCDay()],occurrences:[{date:seriesFields.date,time:seriesFields.time}]})
  assert.equal(series.intake,'link_open');assert.equal(series.token,undefined)
  assert.equal(h.mail.filter(m=>m.to.includes('maya@client.example') && /\/intake\//.test(m.text)).length,1)
  const hashes = () => h.db.prepare('SELECT intake_token_hash FROM bm_appointments WHERE client_id=? AND intake_token_hash IS NOT NULL').bind(clientId).all()
  assert.equal((await hashes()).results.length,1)
  const draft=await h.cmd('intake.prepare',{title:'Updated open form',questions:[{id:'update',label:'Tell us what changed',type:'short',required:true}]})
  await h.cmd('intake.publish',{id:draft.id})
  assert.match((await h.send(path)).text,/Tell us what changed/)
  const existing=await h.cmd('appointment.book',fields(available[24]))
  assert.equal(existing.intake,'link_open');assert.equal(existing.token,undefined)
  assert.equal((await hashes()).results.length,1)
  const beforePast = h.mail.length
  const past = await pastVisit(h,clientId,priya,service.id)
  assert.equal(h.mail.length,beforePast)
  assert.equal((await h.db.prepare('SELECT intake_token_hash FROM bm_appointments WHERE id=?').bind(past).first()).intake_token_hash,null)
  // With the prior request canceled, simultaneous staff bookings allocate one link.
  const original = (await h.state()).appointments.find(a=>a.start_at===available[0])
  await h.cmd('appointment.cancel',{id:original.id,reason:'Patient requested cancellation'})
  const beforeRace = h.mail.length
  const raced = await Promise.all([available[16],available[20]].map(start=>h.cmd('appointment.book',fields(start))))
  assert.deepEqual(raced.map(r=>r.intake).sort(),['ask','link_open'])
  assert.equal(h.mail.slice(beforeRace).filter(m=>/\/intake\//.test(m.text)).length,1)
  assert.equal((await hashes()).results.filter(r=>r.intake_token_hash).length,2,'canceled original plus one live request')
  assert.equal((await h.send(path)).status,404)
}))


test('INTAKE-001: links stay usable in the waiting room, expire at scheduled end or completion, and expired requests do not suppress renewal', () => run(async h => {
  const {service,practitioners:[priya]}=await clinic(h)
  await h.cmd('service.save',{id:service.id,name:'Initial consultation',durationMinutes:60,priceCents:9500})
  const client=await h.cmd('client.save',{firstName:'Elena',lastName:'Martinez',dateOfBirth:'1971-09-22',email:'elena@client.example'})
  const start=(await slots(h,service.id,priya.id))[0]
  const wall=iso=>new Date(Date.parse(iso)+10*3600_000).toISOString()
  const at=wall(start), fields={clientId:client.id,practitionerId:priya.id,serviceId:service.id,date:at.slice(0,10),time:at.slice(11,16)}
  const visit=await h.cmd('appointment.book',fields)
  let path='/intake/'+visit.token
  // Move the real appointment to a quarter hour before now, inside today's hours.
  const waiting=wall(new Date(Math.floor(Date.now()/3600_000)*3600_000).toISOString())
  await h.cmd('appointment.move',{id:visit.appointmentId,date:waiting.slice(0,10),time:waiting.slice(11,16)})
  assert.equal((await h.send(path)).status,200,'intake remains open after start')
  await h.form('/portal',{email:'elena@client.example'})
  const message=h.mail.findLast(m=>m.text.includes('/portal/confirm?token='))
  const token=new URL(message.text.match(/https?:\/\/[^\s]+\/portal\/confirm\?token=[^\s]+/)[0]).searchParams.get('token')
  const signedIn=await h.send('/portal/confirm',{token})
  assert.equal(signedIn.status,303)
  const opened=await h.form('/portal/action',{name:'intake.open',appointmentId:visit.appointmentId},signedIn.cookie)
  assert.equal(opened.status,303);path=opened.location
  assert.equal((await h.send(path)).status,200,'portal reopens the same waiting-room request')

  const following=await h.cmd('appointment.book',fields)
  assert.equal(following.intake,'link_open');assert.equal(following.token,undefined)
  const ended=wall(new Date(Date.now()-2*3600_000).toISOString())
  await h.cmd('appointment.move',{id:visit.appointmentId,date:ended.slice(0,10),time:ended.slice(11,16)})
  assert.equal((await h.send(path)).status,404)
  assert.equal((await h.form(path,{formId:'intake-v1'})).status,404)
  await h.cmd('appointment.cancel',{id:following.appointmentId,reason:'Patient requested cancellation'})
  const renewed=await h.cmd('appointment.book',fields)
  assert.equal(renewed.intake,'ask');assert.ok(renewed.token)
  const nextPath='/intake/'+renewed.token
  await h.cmd('appointment.move',{id:renewed.appointmentId,date:waiting.slice(0,10),time:waiting.slice(11,16)})
  assert.equal((await h.send(nextPath)).status,200)
  await h.cmd('appointment.attend',{id:renewed.appointmentId})
  assert.equal((await h.send(nextPath)).status,404,'completion closes the link before its end')
  assert.equal((await h.form(nextPath,{formId:'intake-v1'})).status,404)
}))
