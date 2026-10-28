import { chartFixture } from './chart-template-journey.mjs'
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { run } from './harness.mjs'
import { bookOnline, clinic, pastVisit, slots } from './clinic.mjs'

// OWN-001 evidence for the existing clinic loop, not HIPAA-005 deployment gating.
// Assert every attempted request, including failures that handlers might catch.
const ownedRun = fn => run(async h => {
  await fn(h)
  assert.ok(h.outboundRequests.length > 0, 'OWN-001 positive control: enabled invitation/intake mail traversed the observed network edge')
  assert.deepEqual(h.outboundRequests, h.mail.map(() => ({ method: 'POST', origin: 'https://api.resend.com', pathname: '/emails' })), 'OWN-001: the mail provider is the only outbound destination in this clinic journey; no license, telemetry or disabled integration request')
})

const intakeToken = location => location.match(/\/intake\/([\w-]+)/)[1]

test('OWN-001: online booking for a new client delivers the intake link, refuses a taken slot and records the visit', () => ownedRun(async h => {
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

test('OWN-001: INTAKE-001: intake answers reach only the treating practitioner and the owner, once, and every read is audited', () => ownedRun(async h => {
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

test('OWN-001: a treatment note is readable only by its practitioner and the owner, and amendments keep history', () => ownedRun(async h => {
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
  // Follow the public audit cursor: added clinical reads can fill the first page.
  let auditFile = await view(h.owner)
  const audit = [...auditFile.audit]
  while (auditFile.auditPage.older !== null) {
    auditFile = (await h.send('/api/balm/clients/' + client.id + '?auditBefore=' + auditFile.auditPage.older, undefined, h.owner)).value
    audit.push(...auditFile.audit)
  }
  for (const [who, action] of [[priya.email, 'note.written'], [priya.email, 'note.amended'], [h.auth.OWNER_EMAIL, 'note.read'], [priya.email, 'note.read'], [h.auth.OWNER_EMAIL, 'agent.context']]) assert.ok(audit.some(a => a.actor_email === who && a.action === action), action)
  assert.ok(!audit.some(a => a.actor_email === sam.email && a.action === 'note.read'))
}))

test('OWN-001: invoices: prepared from an attended visit, approved by a person, numbered once, exported as exact bytes and paid once', () => ownedRun(async h => {
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
  // A preview and a paused import supply no authority after patient mode changes.
  const more='ID,First Name,Last Name,Date of Birth,Email,Mobile\n'+Array.from({length:24},(_,i)=>`${9000+i},Synthetic${i},Hosting,1980-01-01,,`).join('\n')
  const planned=await h.cmd('import.preview',{csv:more})
  await h.cmd('hosting.mode',{mode:'blocked',reason:'Synthetic readiness changed',attest:true})
  await h.cmd('import.apply',{csv:more,fingerprint:planned.fingerprint},h.owner,409)
  assert.equal((await h.state()).clients.length,2)
  await h.cmd('hosting.mode',{mode:'demo',reason:'Synthetic data only',attest:true})
  let resumed=(await h.cmd('import.apply',{csv:more,fingerprint:planned.fingerprint})).job
  assert.equal(resumed.state,'applying')
  const paused=(await h.state()).clients.length
  await h.cmd('hosting.mode',{mode:'blocked',reason:'Synthetic readiness changed',attest:true})
  await h.cmd('import.resume',{jobId:resumed.id},h.owner,409)
  assert.equal((await h.state()).clients.length,paused)
  await h.cmd('hosting.mode',{mode:'demo',reason:'Synthetic data only',attest:true})
  while(resumed.state==='applying')resumed=(await h.cmd('import.resume',{jobId:resumed.id})).job
  assert.equal((await h.state()).clients.length,26)
  let reversal=(await h.cmd('import.undo',{jobId:resumed.id})).job
  while(reversal.state!=='undone')reversal=(await h.cmd('import.undo',{jobId:resumed.id})).job
  assert.deepEqual((await h.state()).clients.map(c=>c.last_name).sort(),after)
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
  // A finished hour-long visit that does not run past midnight Brisbane.
  const hoursBack=+wall(new Date(Date.now()-2*3600_000).toISOString()).slice(11,13)===23?3:2
  const ended=wall(new Date(Date.now()-hoursBack*3600_000).toISOString())
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


test('ROLE-002: owner-assigned jobs restrict billing, supervised staff and one-location managers with audited refusals', () => run(async h => {
 await h.finishSetup()
 const {service,practitioners:[priya,other]}=await clinic(h,['Priya','Other'])
 const biller=await h.staff('Billing','biller')
 const releaseReception=await h.staff('ReleaseReception','reception')
 const location=await h.cmd('location.save',{name:'North clinic'}),south=await h.cmd('location.save',{name:'South clinic'})
 const northRoom=await h.cmd('room.save',{name:'North room'}),southRoom=await h.cmd('room.save',{name:'South room'})
 await h.cmd('room.location',{roomId:northRoom.id,locationId:location.id})
 await h.cmd('room.location',{roomId:southRoom.id,locationId:south.id})
 const manager=await h.staff('Manager','location_manager',{locationId:location.id})
 const patient=await h.cmd('client.save',{firstName:'North',lastName:'Patient',dateOfBirth:'1980-01-01'})
 const hidden=await h.cmd('client.save',{firstName:'South',lastName:'Patient'})
 const visit=await pastVisit(h,patient.id,priya,service.id,h.owner,2,{roomId:northRoom.id})
 await pastVisit(h,hidden.id,other,service.id,h.owner,3,{roomId:southRoom.id})
 await h.cmd('appointment.attend',{id:visit})
 const note=await h.cmd('note.write',{clientId:patient.id,appointmentId:visit,body:'Private clinical narrative'},priya.cookie)
 const invoice=await h.cmd('invoice.prepare',{appointmentId:visit},biller.cookie)
 await h.cmd('invoice.approve',{id:invoice.id},biller.cookie)
 await h.cmd('payment.record',{invoiceId:invoice.id,amountCents:1000,reference:'synthetic-balm-role-payment'},biller.cookie)
 const entry=await h.cmd('pay.entry.prepare',{clientId:patient.id,invoiceId:invoice.id,kind:'write_off',amountCents:500,reference:'synthetic-balm-role-writeoff',reason:'Approved courtesy adjustment',occurredOn:new Date().toISOString().slice(0,10)},biller.cookie)
 await h.cmd('pay.entry.approve',{id:entry.id,sha256:entry.sha256,attest:true},biller.cookie)
 const report=await h.send('/api/balm/reports/financial',undefined,biller.cookie)
 assert.equal(report.status,200);assert.equal(report.value.summary.adjustmentsCents,500)
 assert.equal((await h.send('/api/balm/reports/financial/summary.csv',undefined,biller.cookie)).status,200)
 const file=await h.send('/api/balm/clients/'+patient.id,undefined,biller.cookie)
 assert.equal(file.status,200);assert.equal(file.value.notes,null);assert.equal(file.value.intake,null);assert.ok(!file.text.includes('Private clinical narrative'))
 for(const path of ['/app/invoices','/app/insurance','/app/reports','/app/clients/'+patient.id]) assert.equal((await h.send(path,undefined,biller.cookie)).status,200,path)
 for(const path of ['/app/clinic','/app/intake','/app/import','/app/agent','/api/balm/reports','/api/balm/chart-documents/missing']) assert.equal((await h.send(path,undefined,biller.cookie)).status,403,path)
 await h.cmd('note.sign',{id:note.id,revision:1,signature:'Priya',credentials:'PT',attest:true},priya.cookie)
 const payer=await h.cmd('insurance.payer.save',{name:'Synthetic release payer',payerId:'SYNTHETICRELEASE',receiverId:'SYNTHETIC',unitMethod:'cms',fees:[{code:'97110',cents:3500}]})
 await h.cmd('insurance.policy.save',{clientId:patient.id,payerId:payer.id,memberId:'synthetic-balm-1',relationship:'18',patientSex:'F',address:'100 Main St',city:'Austin',state:'TX',postalCode:'78701',startsOn:'2020-01-01',endsOn:'2099-12-31'})
 const release=await h.cmd('note_release.prepare',{clientId:patient.id,payerId:payer.id,purpose:'records_request',reference:'synthetic-balm-1',appointmentIds:[visit]},biller.cookie)
 const releasePath='/api/balm/note-releases/'+release.id+'.pdf'
 assert.equal((await h.send(releasePath,undefined,biller.cookie)).status,403)
 await h.cmd('note_release.approve',{id:release.id,sha256:release.sha256,attest:true},biller.cookie,403)
 await h.cmd('note_release.approve',{id:release.id,sha256:release.sha256,attest:true},h.owner,409)
 const originalRelease=await h.send(releasePath,undefined,h.owner)
 assert.match(originalRelease.text,/Private clinical narrative/)
 await h.cmd('note_release.approve',{id:release.id,sha256:'wrong',attest:true},h.owner,409)
 await h.cmd('note_release.approve',{id:release.id,sha256:release.sha256,attest:true})
 assert.equal((await h.send(releasePath,undefined,biller.cookie)).text,originalRelease.text)
 assert.equal((await h.send(releasePath,undefined,priya.cookie)).status,403)
 assert.equal((await h.send(releasePath,undefined,releaseReception.cookie)).status,403)
 await h.cmd('note_release.prepare',{clientId:patient.id},releaseReception.cookie,403)
 assert.equal((await h.send(releasePath,undefined,manager.cookie)).status,403)
 if(process.env.BALM_UI_SCREENSHOTS){const {viewportProof}=await import('./viewport-proof.mjs');await viewportProof(h,[{name:'ROLE-002-release-owner',path:'/app/clients/'+patient.id,cookie:h.owner,selector:'#payer-releases'},{name:'ROLE-002-release-biller',path:'/app/clients/'+patient.id,cookie:biller.cookie,selector:'#payer-releases'}])}
 const noWrites=['note_release.approve','note_release.revoke','assistant_daily.save','note.supervision','staff.save','location.save','room.location','client.save','appointment.book','appointment.attend','note.write','note.sign','note.cosign','note.check','care_team.grant','chart.break_glass','insurance.settings.save','insurance.payer.save','insurance.claim.necessity','backup.now','retention.destroy','unknown.future.command']
 const before=await h.state()
 for(const name of noWrites) await h.cmd(name,{},biller.cookie,403)
 const after=await h.state()
 assert.deepEqual(after.clients,before.clients);assert.deepEqual(after.appointments,before.appointments)
 const local=await h.state(manager.cookie)
 assert.equal(local.location.name,'North clinic');assert.deepEqual(local.location.appointments.map(a=>a.id),[visit]);assert.equal(local.location.counts.attended,1)
 assert.ok(!JSON.stringify(local).includes('South Patient'));assert.ok(!JSON.stringify(local).includes('Private clinical narrative'))
 assert.equal((await h.send('/api/balm/reports/location?locationId='+south.id,undefined,manager.cookie)).value.name,'North clinic')
 for(const path of ['/app','/app/reports']) assert.equal((await h.send(path,undefined,manager.cookie)).status,200)
 for(const path of ['/app/clients','/app/clients/'+patient.id,'/api/balm/reports/financial','/app/insurance']) assert.equal((await h.send(path,undefined,manager.cookie)).status,403,path)
 for(const name of ['client.save','invoice.prepare','location.save','note_release.prepare','assistant_daily.save','unknown.future.command']) await h.cmd(name,{},manager.cookie,403)
 const southVisit=(await h.state()).appointments.find(a=>a.client_id===hidden.id).id
 const today=new Date(Date.now()+10*3600000).toISOString().slice(0,10),tomorrow=new Date(Date.now()+2*86400000+10*3600000).toISOString().slice(0,10)
 const booking={clientId:patient.id,practitionerId:priya.id,serviceId:service.id,roomId:northRoom.id,date:tomorrow,time:'14:00'}
 for(const invalid of [{...booking,roomId:southRoom.id},{...booking,roomId:''},{...booking,clientId:hidden.id}])await h.cmd('appointment.book',invalid,manager.cookie,403)
 const managed=await h.cmd('appointment.book',booking,manager.cookie)
 await h.cmd('appointment.move',{id:managed.appointmentId,date:tomorrow,time:'15:00',roomId:southRoom.id},manager.cookie,403)
 await h.cmd('appointment.move',{id:southVisit,date:tomorrow,time:'15:00',roomId:northRoom.id},manager.cookie,403)
 await h.cmd('appointment.cancel',{id:southVisit,reason:'Outside location',confirm:true},manager.cookie,403)
 await h.cmd('pay.checkin',{appointmentId:southVisit},manager.cookie,403)
 await h.cmd('appointment.move',{id:managed.appointmentId,date:tomorrow,time:'15:00',roomId:northRoom.id},manager.cookie)
 await h.cmd('appointment.cancel',{id:managed.appointmentId,reason:'Patient requested cancellation',confirm:true},manager.cookie)
 const checkin=await pastVisit(h,patient.id,priya,service.id,h.owner,1,{roomId:northRoom.id})
 await h.cmd('pay.checkin',{appointmentId:checkin,charge:true},manager.cookie,403)
 assert.equal((await h.state(manager.cookie)).location.appointments.find(a=>a.id===checkin).checked_in_at,null)
 await h.cmd('pay.checkin',{appointmentId:checkin},manager.cookie)
 assert.ok((await h.state(manager.cookie)).location.appointments.find(a=>a.id===checkin).checked_in_at)
 const managedState=await h.state(manager.cookie)
 assert.ok(!JSON.stringify(managedState).includes('South Patient'));assert.ok(!JSON.stringify(managedState).includes('Private clinical narrative'))
 if(process.env.BALM_UI_SCREENSHOTS){const {viewportProof}=await import('./viewport-proof.mjs');await viewportProof(h,[{name:'ROLE-002-location',path:'/app',cookie:manager.cookie},{name:'ROLE-002-location-reports',path:'/app/reports',cookie:manager.cookie}])}
 for(const kind of ['assistant','student','fellow']) {
  await h.cmd('staff.save',{name:'Unassigned',email:'unassigned@clinic.example',role:kind},h.owner,400)
  const trainee=await h.staff(kind,kind,{discipline:'pt',supervisorId:priya.id})
  await h.cmd('hours.save',{practitionerId:trainee.id,hours:[0,1,2,3,4,5,6].map(weekday=>({weekday,start:'00:00',end:'24:00'}))})
  const ownVisit=await pastVisit(h,patient.id,trainee,service.id)
  const sections={subjective:'Daily symptoms',objective:'Skilled treatment',assessment:'Response to treatment',goals:'Progress',plan:'Continue daily treatment'}
  if(kind==='assistant') {
   const beforeNotes=(await h.send('/api/balm/clients/'+patient.id,undefined,h.owner)).value.notes
   for(const template of ['pt.evaluation','ot.evaluation','slp.evaluation','pt.progress','ot.progress','slp.progress','pt.discharge','ot.discharge','slp.discharge',''])
    await h.cmd('note.write',{clientId:patient.id,appointmentId:ownVisit,template,body:'Prohibited clinical draft'},trainee.cookie,403)
   for(const code of ['97161','97162','97163','97164','97165','97166','97167','97168','92521','92522','92523','92524','92610'])
    await h.cmd('note.write',{clientId:patient.id,appointmentId:ownVisit,template:'pt.daily',sections,charges:[{code}]},trainee.cookie,403)
   assert.deepEqual((await h.send('/api/balm/clients/'+patient.id,undefined,h.owner)).value.notes,beforeNotes,'prohibited drafts and charges are unwritten')
   await h.cmd('plan.send',{clientId:patient.id},trainee.cookie,403)
  }
  const draft=await h.cmd('note.write',{clientId:patient.id,appointmentId:ownVisit,...(kind==='assistant'?{template:'pt.daily',sections}:{body:kind+' draft'})},trainee.cookie)
  if(kind==='assistant') {
   await h.cmd('note.amend',{id:draft.id,revision:1,sections,charges:[{code:'97164'}]},trainee.cookie,403)
   const unchanged=(await h.send('/api/balm/clients/'+patient.id,undefined,h.owner)).value.notes.find(n=>n.id===draft.id)
   assert.equal(unchanged.revisions[0].number,1);assert.deepEqual(unchanged.revisions[0].charges,[])
  }
  await h.cmd('note.amend',{id:draft.id,revision:1,...(kind==='assistant'?{...chartFixture(),sections:{...chartFixture().sections,...sections}}:{body:kind+' revised draft'})},trainee.cookie)
  for(const name of ['note_release.prepare','note_release.approve','note_release.revoke','note.supervision','assistant_daily.save','note.sign','note.addendum','note.cosign','appointment.book','appointment.attend','client.save','pay.invoice.charge','chart.break_glass','agent.create','unknown.future.command']) await h.cmd(name,{},trainee.cookie,403)
  await h.cmd('note.submit',{id:draft.id,revision:2,signature:kind,credentials:kind==='assistant'?'PTA':kind==='fellow'?'CF-SLP':'SPT',attest:true},trainee.cookie)
  assert.ok((await h.state(priya.cookie)).coSignQueue.some(n=>n.note_id===draft.id))
  await h.cmd('note.cosign',{id:draft.id,revision:2,signature:'Priya',credentials:'PT',attest:true,supervisionGiven:'in_room'},priya.cookie)
  const coSigned=(await h.send('/api/balm/clients/'+patient.id,undefined,h.owner)).value.notes.find(n=>n.id===draft.id)
  assert.equal(coSigned.signature.name,'Priya');assert.equal(coSigned.submissions[0].author_name,kind)
  assert.equal((await h.send('/api/balm/clients/'+hidden.id,undefined,trainee.cookie)).status,404)
  for(const path of [releasePath,'/app/clinic','/api/balm/reports/financial','/api/balm/chart-documents/missing']) assert.equal((await h.send(path,undefined,trainee.cookie)).status,403)
 }
 await h.cmd('note_release.revoke',{id:release.id})
 assert.equal((await h.send(releasePath,undefined,biller.cookie)).status,403)
 const audit=(await h.send('/api/balm/access-refusals',undefined,h.owner)).value
 for(const member of [biller,manager]) assert.ok(audit.some(a=>a.actor_email===member.email && a.actor_role===member.role))
 assert.ok(audit.filter(a=>a.actor_role==='assistant' && a.detail==='POST /api/balm/command').length>=24,'each assistant template/code refusal is audited')
 assert.ok(audit.some(a=>a.actor_role==='student'));assert.ok(audit.some(a=>a.actor_role==='assistant'));assert.ok(audit.some(a=>a.actor_role==='fellow'))
 await h.cmd('staff.save',{id:biller.id,name:'Billing',email:biller.email,role:'biller',active:false})
 await h.state(biller.cookie,403)
 const refused=(await h.send('/api/balm/access-refusals',undefined,h.owner)).value
 assert.ok(refused.some(a=>a.actor_email===biller.email&&a.detail==='inactive staff access refused'))
 assert.equal((await h.send('/api/balm/access-refusals.csv',undefined,h.owner)).status,200)
 assert.equal((await h.send('/api/balm/access-refusals',undefined,priya.cookie)).status,403)
},{browserHttps:!!process.env.BALM_UI_SCREENSHOTS}))
