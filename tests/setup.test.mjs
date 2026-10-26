import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { run } from './harness.mjs'
import { bookOnline } from './clinic.mjs'

const zone = 'America/Chicago'
const localDate = t => new Intl.DateTimeFormat('en-CA', { timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(t))
const localClock = t => new Intl.DateTimeFormat('en-GB', { timeZone: zone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(t))
const unescape = s => s.replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&')
const hiddenValue = (html, name) => unescape(html.match(new RegExp(`name="${name}" value="([^"]*)"`))[1])

test('US-001: US clinic setup, availability, booking and immutable USD invoices', () => run(async h => {
  await h.finishSetup()
  // No zone is assumed: the owner's first page asks for it (US zones first), and booking waits for it.
  const first = await h.send('/app/clinic', undefined, h.owner)
  assert.match(first.text, /<h1>Your clinic’s time zone<\/h1>/); assert.doesNotMatch(first.text, /Australia\/Brisbane" selected|Times are in/)
  assert.match(first.text, /<option value="">Choose your clinic’s time zone<\/option><optgroup label="United States"><option value="America\/New_York">/)
  assert.match((await h.send('/book')).text, /Online booking is not open yet/)
  assert.equal((await h.cmd('appointment.book', { clientId: 'none', practitionerId: 'none', serviceId: 'none', date: '2030-01-07', time: '09:00' }, h.owner, 409)).code, 'clinic_time_zone_not_set')
  const chosen = await h.form('/app/action?name=settings.save&returnTo=%2Fapp', { clinicName: 'Lakeside Therapy', timeZone: zone, taxId: '12-3456789', taxIdType: 'EIN', practiceNpi: '1234567893', streetAddress: '100 Lake Street', city: 'Chicago', state: 'IL', postalCode: '60601-1234', bookingOpen: 'true' }, h.owner)
  assert.equal(chosen.status, 303); assert.equal(chosen.location, '/app')
  assert.match((await h.send('/app', undefined, h.owner)).text, /Times are in Central time \(America\/Chicago\)\./)
  const service = await h.cmd('service.save', { name: 'Evaluation', durationMinutes: 45, priceCents: 15000 })
  const sarah = await h.staff('Sarah', 'practitioner', { profession: 'Physical Therapist' })
  const hours = { practitionerId: sarah.id, hoursForm: 'on', d1_open: 'on', d1_start: '09:00', d1_end: '17:00', d1_break0_start: '12:00', d1_break0_end: '13:00', d3_open: 'on', d3_start: '08:00', d3_end: '12:00' }
  const outside = await h.form('/app/action?name=hours.save&returnTo=/app/clinic', { ...hours, d1_break0_end: '18:00' }, h.owner)
  assert.equal(outside.status, 400); assert.match(outside.text, /Monday: a break must fall inside the working hours/)
  assert.equal((await h.form('/app/action?name=hours.save&returnTo=/app/clinic', hours, h.owner)).status, 303)
  const clinicPage = await h.send('/app/clinic', undefined, h.owner)
  assert.match(clinicPage.text, /value="1234567893"/); assert.match(clinicPage.text, /value="60601-1234"/)
  assert.match(clinicPage.text, /Monday 9:00 AM–12:00 PM, 1:00 PM–5:00 PM/); assert.match(clinicPage.text, /Wednesday 8:00 AM–12:00 PM/)
  assert.doesNotMatch(clinicPage.text, /Weekly hours \(JSON\)/)

  let monday = Date.now() + 3 * 86400_000
  while (new Date(localDate(monday) + 'T00:00:00Z').getUTCDay() !== 1) monday += 86400_000
  const day = localDate(monday), page = await h.send(`/book?serviceId=${service.id}&practitionerId=${sarah.id}&from=${day}`)
  assert.equal(page.status, 200)
  const starts = [...page.text.matchAll(/start=([0-9T%A-Z.-]+Z)/g)].map(m => decodeURIComponent(m[1]))
  const on = date => starts.filter(s => localDate(s) === date).map(localClock)
  const next = n => localDate(Date.parse(day + 'T12:00:00Z') + n * 86400_000)
  assert.deepEqual(on(day), ['09:00', '09:15', '09:30', '09:45', '10:00', '10:15', '10:30', '10:45', '11:00', '11:15', '13:00', '13:15', '13:30', '13:45', '14:00', '14:15', '14:30', '14:45', '15:00', '15:15', '15:30', '15:45', '16:00', '16:15'])
  assert.deepEqual(on(next(1)), [], 'Tuesday is not worked')
  assert.equal(on(next(2))[0], '08:00')
  const one = starts.find(s => localDate(s) === day && localClock(s) === '13:00')
  const booked = await bookOnline(h, service.id, sarah.id, one, { email: 'ana@patient.example', firstName: 'Ana' })
  assert.equal(booked.status, 303, booked.text)
  assert.match(booked.location, /^\/intake\//)
  const patient = (await h.state()).clients.find(c => c.first_name === 'Ana')
  const file = await h.send('/api/balm/clients/' + patient.id, undefined, h.owner)
  assert.equal(file.value.client.phone, '+13125550100')
  const details = { clinicName: 'Lakeside Therapy', timeZone: zone }
  for (const invalid of [{ taxId: '123' }, { practiceNpi: '1234567890' }, { state: 'ZZ' }, { postalCode: '6060' }]) await h.cmd('settings.save', { ...details, ...invalid }, h.owner, 400)
  await h.cmd('hours.save', { practitionerId: sarah.id, hours: [0,1,2,3,4,5,6].map(weekday => ({ weekday, start: '00:00', end: '24:00' })) })
  let past = Date.now() - 3 * 3600_000
  if (localClock(past) > '22:00') past -= 3 * 3600_000
  const visit = await h.cmd('appointment.book', { clientId: patient.id, practitionerId: sarah.id, serviceId: service.id, date: localDate(past), time: localClock(past) })
  await h.cmd('appointment.attend', { id: visit.appointmentId }, sarah.cookie)
  const invoice = await h.cmd('invoice.prepare', { appointmentId: visit.appointmentId })
  await h.cmd('invoice.approve', { id: invoice.id })
  const download = await h.send(`/api/balm/invoices/${invoice.id}.html`, undefined, h.owner)
  assert.equal(download.status, 200)
  for (const fact of ['USD', '$150.00', '12-3456789', '1234567893', '100 Lake Street, Chicago, IL 60601-1234', 'Apr 2, 1988']) assert.ok(download.text.includes(fact), fact)
  await h.cmd('settings.save', { ...details, taxIdType: 'SSN', taxId: '123-45-6789' })
  assert.equal((await h.state()).settings.tax_id_type, 'SSN')
  assert.equal((await h.send(`/api/balm/invoices/${invoice.id}.html`, undefined, h.owner)).text, download.text, 'issued invoice keeps its original identity')
}))

test('US-001: a Cliniko patient export is uploaded as a file, read with US dates, flagged where ambiguous, and imported from a readable preview', () => run(async h => {
  await h.finishSetup()
  await h.cmd('settings.save', { clinicName: 'Lakeside Therapy', timeZone: zone })
  const upload = async (name, text, dateFormat) => {
    // The multipart body a browser sends for the page's file field.
    const boundary = 'balm-test-boundary', part = (field, value, file) => `--${boundary}\r\nContent-Disposition: form-data; name="${field}"${file ? `; filename="${file}"\r\nContent-Type: text/csv` : ''}\r\n\r\n${value}\r\n`
    const body = part('file', text, name) + (dateFormat ? part('dateFormat', dateFormat) : '') + `--${boundary}--\r\n`
    const response = await h.mf.dispatchFetch(h.origin + '/app/action?name=import.preview&returnTo=%2Fapp%2Fimport', { method: 'POST', headers: { origin: h.origin, cookie: h.owner, 'content-type': `multipart/form-data; boundary=${boundary}` }, body, redirect: 'manual' })
    return { status: response.status, text: await response.text() }
  }
  const file = await readFile('tests/fixtures/cliniko-export-us.csv', 'utf8')
  const preview = await upload('Patients-Cliniko-20261017.csv', file)
  assert.equal(preview.status, 200, preview.text.match(/role="alert">([^<]*)/)?.[1])
  assert.match(preview.text, /Preview: Patients-Cliniko-20261017\.csv · 3 patients/)
  assert.match(preview.text, /MM\/DD\/YYYY/)
  assert.match(preview.text, /<td>Ana Lopez<\/td><td>Apr 12, 1988<\/td>/); assert.match(preview.text, /<td>Ben Okafor<\/td><td>Dec 25, 1990<\/td>/)
  assert.match(preview.text, /04\/12\/1988 is read as April 12, 1988\. Written the other way round it would be December 4, 1988/)
  assert.doesNotMatch(preview.text, /<pre>|byKind|erased_at|created_via/)

  const dayFirst = await upload('day-first.csv', file.replace('12/25/1990', '25/12/1990'))
  assert.equal(dayFirst.status, 422); assert.match(dayFirst.text, /25\/12\/1990 is not a real MM\/DD\/YYYY date\. If your file writes dates as DD\/MM\/YYYY/)

  // Browsers send every field's line breaks as CRLF, so the posted fields are normalized the same way.
  const posted = Object.fromEntries(['csvBase64', 'dateFormat', 'fingerprint'].map(name => [name, hiddenValue(preview.text, name).replace(/\r?\n/g, '\r\n')]))
  const apply = await h.form('/app/action?name=import.apply&returnTo=/app/import', posted, h.owner)
  assert.equal(apply.status, 303, apply.text)
  const s = await h.state()
  assert.deepEqual(s.clients.map(c => [c.first_name, c.date_of_birth]).sort(), [['Ana', '1988-04-12'], ['Ben', '1990-12-25'], ['Cara', '1975-06-30']])
  const job = s.importJobs[0]
  assert.equal(job.state, 'completed')
  const journal = await h.form('/app/action?name=import.journal&returnTo=/app/import', { jobId: job.id }, h.owner)
  assert.equal(journal.status, 200); assert.match(journal.text, /Imported: 3 of 3 patients/); assert.match(journal.text, /Download the original file/)
  const original = await h.send(`/api/balm/imports/${job.id}/original.csv`, undefined, h.owner)
  assert.equal(original.status, 200); assert.equal(original.text, file)
}))

test('HIPAA-001: owner records readiness facts and BAAs; SMS stays off without an active agreement', () => run(async h => {
  const { readinessFacts, recordTestBaa } = await import('./readiness-fixture.mjs')
  await h.finishSetup()
  await h.cmd('settings.save',{clinicName:'Synthetic readiness clinic',timeZone:'America/Chicago'})
  let readiness=(await h.send('/api/balm/readiness.json',undefined,h.owner)).value
  assert.equal(readiness.ready,false)
  assert.deepEqual(readiness.missing,['privacy_officer','security_officer','risk_analysis','risk_reviewed_on','encryption_at_rest','encryption_in_transit','mail_baa','sms_baa'])
  assert.deepEqual(readiness.subprocessors.map(p=>p.key),['mail','sms','fax','clearinghouse','video','scribe','backups','hosting'])
  await h.cmd('reminders.settings',{leadMinutes:'1440',sms:true},h.owner,409)
  assert.equal((await h.state()).reminders.reminder_sms,0)
  assert.equal(h.outboundRequests.length,0)
  await h.cmd('scribe.save',{provider:'anthropic',key:'synthetic-balm-907'},h.owner,409)
  await h.cmd('backup.save',{},h.owner,409)
  const incomplete={...readinessFacts,riskAnalysis:''}
  await h.cmd('readiness.save',incomplete,h.owner,400)
  assert.equal((await h.send('/api/balm/readiness.json',undefined,h.owner)).value.record,null)
  await h.cmd('readiness.save',readinessFacts)
  await h.cmd('readiness.baa.record',{processor:'sms',provider:'synthetic-balm-914',plan:'Free',reference:'synthetic-balm-915',signedOn:'2026-09-01',attest:true},h.owner,400)
  const mail=await recordTestBaa(h,'mail'),sms=await recordTestBaa(h,'sms')
  await h.cmd('reminders.settings',{leadMinutes:'1440',sms:true})
  readiness=(await h.send('/api/balm/readiness.json',undefined,h.owner)).value
  assert.equal(readiness.ready,true)
  assert.deepEqual(readiness.missing,[])
  assert.equal(readiness.record.privacy_officer,readinessFacts.privacyOfficer)
  assert.equal(readiness.record.security_officer,readinessFacts.securityOfficer)
  assert.equal(readiness.record.risk_analysis,readinessFacts.riskAnalysis)
  assert.equal(readiness.record.encryption_at_rest,readinessFacts.encryptionAtRest)
  assert.equal(readiness.record.encryption_in_transit,readinessFacts.encryptionInTransit)
  assert.deepEqual(readiness.baas.map(b=>b.id).sort(),[mail.id,sms.id].sort())
  assert.deepEqual(readiness.baas.map(b=>[b.processor,b.provider,b.plan,b.reference,b.signed_on,b.recorded_by]).sort((a,b)=>a[0].localeCompare(b[0])),[
    ['mail','synthetic-balm-904 mail','synthetic-balm-905 covered plan','synthetic-balm-906 signed agreement','2026-09-01','owner@clinic.example'],
    ['sms','synthetic-balm-904 sms','Twilio Security','synthetic-balm-906 signed agreement','2026-09-01','owner@clinic.example'],
  ])
  const response=await h.send('/api/balm/readiness.json',undefined,h.owner)
  assert.equal(response.headers.get('content-disposition'),'attachment; filename=balm-readiness.json')
  await h.cmd('client.save',{firstName:'Synthetic',lastName:'Readiness',phone:'+15125550199'})
  await h.form('/portal/sms',{phone:'+15125550199'})
  assert.equal(h.outboundRequests.filter(r=>r.origin==='https://api.twilio.com').length,1,'recorded BAA permits the configured SMS edge')
  await h.cmd('readiness.baa.revoke',{id:sms.id})
  await h.form('/portal/sms',{phone:'+15125550199'})
  assert.equal(h.outboundRequests.filter(r=>r.origin==='https://api.twilio.com').length,1,'revocation fences send even while reminders remain enabled')
  await h.cmd('reminders.settings',{leadMinutes:'1440',sms:true},h.owner,409)
  readiness=(await h.send('/api/balm/readiness.json',undefined,h.owner)).value
  assert.equal(readiness.ready,false)
  assert.deepEqual(readiness.missing,['sms_baa'])
  assert.ok(readiness.baas.find(b=>b.id===sms.id).revoked_at)
  const desk=await h.staff('ReadinessDesk','reception')
  await h.cmd('readiness.save',readinessFacts,desk.cookie,403)
  await h.cmd('readiness.baa.record',{processor:'sms'},desk.cookie,403)
  await h.cmd('readiness.baa.revoke',{id:mail.id},desk.cookie,403)
  assert.equal((await h.send('/api/balm/readiness.json',undefined,desk.cookie)).status,403)
  assert.equal((await h.state(desk.cookie)).readiness,null)
  const audits=(await h.db.prepare("SELECT action FROM bm_audit WHERE action LIKE 'readiness.%'").all()).results.map(r=>r.action)
  for(const action of ['readiness.recorded','readiness.baa_recorded','readiness.baa_revoked','readiness.exported'])assert.ok(audits.includes(action),action)
  assert.equal(h.outboundRequests.filter(r=>r.origin==='https://api.twilio.com').length,1)
}, { outbound:async request=>{assert.equal(new URL(request.url).hostname,'api.twilio.com');return Response.json({sid:'synthetic-balm-913',status:'queued'},{status:201})},readiness:false,auth:{SMS_PROVIDER:'twilio',TWILIO_ACCOUNT_SID:'synthetic-balm-908',TWILIO_AUTH_TOKEN:'synthetic-balm-909',TWILIO_FROM:'+15125550100'} }))
