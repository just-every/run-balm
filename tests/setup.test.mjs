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

test('a new clinic chooses its own time zone first; weekly hours set with the form decide the times /book offers, breaks and days off included', () => run(async h => {
  await h.finishSetup()
  // No zone is assumed: the owner's first page asks for it (US zones first), and booking waits for it.
  const first = await h.send('/app/clinic', undefined, h.owner)
  assert.match(first.text, /<h1>Your clinic’s time zone<\/h1>/); assert.doesNotMatch(first.text, /Australia\/Brisbane" selected|Times are in/)
  assert.match(first.text, /<option value="">Choose your clinic’s time zone<\/option><optgroup label="United States"><option value="America\/New_York">/)
  assert.match((await h.send('/book')).text, /Online booking is not open yet/)
  assert.equal((await h.cmd('appointment.book', { clientId: 'none', practitionerId: 'none', serviceId: 'none', date: '2030-01-07', time: '09:00' }, h.owner, 409)).code, 'clinic_time_zone_not_set')
  const chosen = await h.form('/app/action?name=settings.save&returnTo=%2Fapp', { clinicName: 'Lakeside Therapy', timeZone: zone, abn: '', address: '', bookingOpen: 'true' }, h.owner)
  assert.equal(chosen.status, 303); assert.equal(chosen.location, '/app')
  assert.match((await h.send('/app', undefined, h.owner)).text, /Times are in Central time \(America\/Chicago\)\./)
  const service = await h.cmd('service.save', { name: 'Evaluation', durationMinutes: 45, priceCents: 15000 })
  const sarah = await h.staff('Sarah', 'practitioner', { profession: 'Physical Therapist' })
  const hours = { practitionerId: sarah.id, hoursForm: 'on', d1_open: 'on', d1_start: '09:00', d1_end: '17:00', d1_break0_start: '12:00', d1_break0_end: '13:00', d3_open: 'on', d3_start: '08:00', d3_end: '12:00' }
  const outside = await h.form('/app/action?name=hours.save&returnTo=/app/clinic', { ...hours, d1_break0_end: '18:00' }, h.owner)
  assert.equal(outside.status, 400); assert.match(outside.text, /Monday: a break must fall inside the working hours/)
  assert.equal((await h.form('/app/action?name=hours.save&returnTo=/app/clinic', hours, h.owner)).status, 303)
  const clinicPage = await h.send('/app/clinic', undefined, h.owner)
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
}))

test('a Cliniko patient export is uploaded as a file, read with US dates, flagged where ambiguous, and imported from a readable preview', () => run(async h => {
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
