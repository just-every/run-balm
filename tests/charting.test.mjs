// Charting through the public doors: discipline templates, sign and lock,
// addenda, the physician-certified plan of care, CPT units by the 8-minute rule
// carried to the invoice, and the scribe with its model faked at the network edge.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { run } from './harness.mjs'
import { clinic, pastVisit, visitDate } from './clinic.mjs'

const daily = { subjective: 'Knee pain 4/10 after stairs; HEP daily.', objective: 'Ther ex 25 min: step-ups 2x12. Flexion 118 deg.', assessment: 'Improving tolerance to stairs.', plan: 'Progress step height.' }
const view = async (h, clientId, cookie) => (await h.send('/api/balm/clients/' + clientId, undefined, cookie)).value

test('CHART-004: sign and lock a note, keep its original beside addenda, close overdue drafts, and certify the plan of care from the physician’s link', () => run(async h => {
  await h.finishSetup()
  const { service, practitioners: [priya, sam] } = await clinic(h, ['Priya', 'Sam'])
  const reception = await h.staff('Rosa', 'reception')
  await h.cmd('service.save', { id: service.id, name: 'Initial consultation', durationMinutes: 45, priceCents: 9500, noteTemplate: 'pt.daily' })
  await h.cmd('staff.save', { id: priya.id, name: 'Priya', email: priya.email, role: 'practitioner', credentials: 'PT, DPT', active: true })
  const client = await h.cmd('client.save', { firstName: 'Noah', lastName: 'Kim', dateOfBirth: '1979-11-30' }, reception.cookie)
  const visit = await pastVisit(h, client.id, priya, service.id, reception.cookie)
  await pastVisit(h, client.id, sam, service.id, reception.cookie, 5)
  await h.cmd('appointment.attend', { id: visit }, priya.cookie)
  const schedule = '/app?date=' + await visitDate(h, visit, reception.cookie)
  assert.match((await h.send(schedule, undefined, priya.cookie)).text, /Notes to sign[\s\S]*No note yet/)

  // The visit's template frames the note; required sections are enforced at signing, not while drafting.
  const note = await h.cmd('note.write', { clientId: client.id, appointmentId: visit, sections: { ...daily, goals: '' } }, priya.cookie)
  assert.equal(note.template, 'pt.daily')
  const sign = (input, cookie = priya.cookie, status = 200) => h.cmd('note.sign', { id: note.id, signature: 'Priya', attest: true, ...input }, cookie, status)
  await sign({ revision: 1 }, priya.cookie, 400)
  await h.cmd('note.amend', { id: note.id, revision: 1, sections: { ...daily, goals: 'STG 1: stairs reciprocally, progressing.' } }, priya.cookie)
  await sign({ revision: 1 }, priya.cookie, 409)
  await sign({ revision: 2, signature: 'Sam' }, priya.cookie, 400)
  await sign({ revision: 2 }, sam.cookie, 404)
  const signed = await sign({ revision: 2 })
  assert.deepEqual([signed.status, signed.signer.name, signed.signer.credentials], ['signed', 'Priya', 'PT, DPT'])
  const original = (await view(h, client.id, priya.cookie)).notes.find(n => n.id === note.id)
  assert.equal(original.signature.signedAt, signed.signedAt)
  assert.equal(original.signature.sha256, signed.sha256)
  const lockedPage = (await h.send('/app/clients/' + client.id, undefined, priya.cookie)).text
  assert.ok(lockedPage.includes('Add an addendum'))
  assert.ok(!lockedPage.includes('Edit draft'))

  // Signed is locked, in the handler and in the database; changes become signed addenda.
  const locked = await h.cmd('note.amend', { id: note.id, revision: 2, sections: daily }, priya.cookie, 409)
  assert.equal(locked.code, 'note_signed_add_an_addendum')
  await sign({ revision: 2 }, priya.cookie, 409)
  assert.match(String(await h.db.prepare("INSERT INTO bm_note_revisions(note_id,number,body,written_at) VALUES(?,3,'x','now')").bind(note.id).run().catch(e => e.message)), /note_locked/)
  await h.cmd('note.addendum', { id: note.id, body: 'Late entry: patient reported mild swelling after the session.' }, sam.cookie, 404)
  await h.cmd('note.addendum', { id: note.id, body: 'Late entry: patient reported mild swelling after the session.' }, priya.cookie)
  const own = (await view(h, client.id, priya.cookie)).notes[0]
  assert.equal(own.status, 'signed'); assert.equal(own.signature.revision, 2); assert.equal(own.addenda.length, 1)
  assert.deepEqual(own.signature, original.signature)
  assert.deepEqual(own.revisions, original.revisions)
  assert.deepEqual([own.addenda[0].body, own.addenda[0].name, own.addenda[0].credentials], ['Late entry: patient reported mild swelling after the session.', 'Priya', 'PT, DPT'])
  const amendedPage = (await h.send('/app/clients/' + client.id, undefined, priya.cookie)).text
  assert.ok(amendedPage.includes(daily.subjective) && amendedPage.includes(own.addenda[0].body))
  assert.deepEqual(own.revisions[0].sections.map(s => s.label), ['Subjective', 'Objective measures', 'Assessment', 'Goal progress', 'Plan'])
  assert.match((await h.send(schedule, undefined, priya.cookie)).text, /All 1 note signed/)
  const desk = await h.state(reception.cookie)
  assert.equal(desk.appointments.find(a => a.id === visit).note_status, 'signed')
  assert.ok(!JSON.stringify(desk).includes('Knee pain'))

  // Time passage is arranged in stored creation times; all notes and edits use
  // the command door. Older drafts cannot hide behind a newer signed note.
  const unmarkedVisit = await pastVisit(h, client.id, priya, service.id, reception.cookie, 6)
  const drafts = []
  for (const [appointmentId, author, age] of [[visit, priya, 25], [visit, priya, 26], [null, priya, 25], [unmarkedVisit, priya, 25], [null, priya, 23], [null, sam, 25]]) {
    const draft = await h.cmd('note.write', { clientId: client.id, appointmentId, body: 'Private unsigned treatment narrative.' }, author.cookie)
    await h.db.prepare('UPDATE bm_notes SET created_at=? WHERE id=?').bind(new Date(Date.now() - age * 3600_000).toISOString(), draft.id).run()
    drafts.push(draft)
  }
  await h.cmd('note.amend', { id: drafts[0].id, revision: 1, body: 'Revised private unsigned treatment narrative.' }, priya.cookie)
  const overdueIds = async cookie => (await h.state(cookie)).documentationClose.filter(i => i.noteId).map(i => i.noteId).sort()
  assert.deepEqual(await overdueIds(priya.cookie), drafts.slice(0, 4).map(n => n.id).sort())
  assert.deepEqual(await overdueIds(sam.cookie), [drafts[5].id])
  assert.deepEqual(await overdueIds(h.owner), [...drafts.slice(0, 4), drafts[5]].map(n => n.id).sort())
  assert.deepEqual((await h.state(reception.cookie)).documentationClose, [])
  const close = (await h.state(priya.cookie)).documentationClose
  assert.ok(!JSON.stringify(close).toLowerCase().includes('private unsigned treatment narrative'))
  assert.ok(close.find(i => i.noteId === drafts[0].id).dueAt)
  const closePage = (await h.send(schedule, undefined, priya.cookie)).text
  for (const draft of drafts.slice(0, 4)) assert.ok(closePage.includes('#note-' + draft.id))
  assert.ok(!closePage.includes('#note-' + drafts[4].id) && !closePage.includes('#note-' + drafts[5].id))
  const settings = { lateDays: 30, kxNearCents: 20000, unsignedNoteHours: 48 }
  await h.cmd('documentation.settings.save', settings, priya.cookie, 403)
  await h.cmd('documentation.settings.save', { ...settings, unsignedNoteHours: 0 }, h.owner, 400)
  const settingsPage = (await h.send('/app/clinic', undefined, h.owner)).text
  assert.ok(settingsPage.includes('name="unsignedNoteHours"'))
  const settingsAction = settingsPage.match(/action="([^"]*name=documentation.settings.save[^"]*)"/)[1].replaceAll('&amp;', '&')
  assert.equal((await h.form(settingsAction, { lateDays: '30', kxNear: '200.00', unsignedNoteHours: '48' }, h.owner)).status, 303)
  assert.deepEqual(await overdueIds(priya.cookie), [])
  await h.cmd('documentation.settings.save', { ...settings, unsignedNoteHours: 12 })
  assert.deepEqual(await overdueIds(priya.cookie), drafts.slice(0, 5).map(n => n.id).sort())
  // Existing integrations that only save plan/KX settings preserve the deadline.
  await h.cmd('documentation.settings.save', { lateDays: 30, kxNearCents: 20000 })
  assert.deepEqual(await overdueIds(priya.cookie), drafts.slice(0, 5).map(n => n.id).sort())
  await h.cmd('note.sign', { id: drafts[2].id, revision: 1, signature: 'Priya', attest: true }, priya.cookie)
  assert.ok(!(await overdueIds(priya.cookie)).includes(drafts[2].id))

  // The plan of care goes to the referring physician, who signs from the link without an account.
  const plan = await h.cmd('plan.send', { clientId: client.id, diagnoses: 'M22.2X1 Patellofemoral disorders, right knee', shortTermGoals: 'Stairs reciprocally in 3 weeks', longTermGoals: 'Return to running 5 km pain-free',
    frequencyPerWeek: 2, durationWeeks: 6, interventions: '97110, 97140, home program', startDate: '2026-10-19', physicianName: 'Dr. Anika Patel', physicianEmail: 'apatel@referrer.example', signature: 'Priya', attest: true }, priya.cookie)
  assert.equal(plan.mail, 'sent')
  const mail = h.mail.find(m => m.to.includes('apatel@referrer.example'))
  assert.ok(mail.text.includes('/plan/' + plan.token)); assert.ok(!mail.text.includes('Noah'))
  const page = await h.send('/plan/' + plan.token)
  assert.equal(page.status, 200); assert.ok(page.text.includes('Return to running 5 km') && page.text.includes('2 times a week for 6 weeks'))
  assert.equal((await h.form('/plan/' + plan.token, { name: 'Anika Patel', credentials: 'MD' })).status, 400)
  assert.equal((await h.form('/plan/' + plan.token, { name: 'Anika Patel', credentials: 'MD', npi: '1234567893', attest: 'on' })).status, 303)
  assert.equal((await h.form('/plan/' + plan.token, { name: 'Someone Else', credentials: 'MD', attest: 'on' })).status, 409)
  assert.match((await h.send('/plan/' + plan.token)).text, /Plan of care signed/)
  assert.equal((await h.send('/plan/' + plan.token.replace(/.$/, c => c === 'A' ? 'B' : 'A'))).status, 404)
  const certified = (await view(h, client.id, h.owner)).plans
  assert.deepEqual([certified[0].status, certified[0].certifierName, certified[0].content.certifiedThrough], ['certified', 'Anika Patel', '2026-11-29'])
  const front = (await view(h, client.id, reception.cookie)).plans[0]
  assert.deepEqual([front.status, front.content], ['certified', null])
  assert.match((await h.send(schedule, undefined, reception.cookie)).text, /Plan of care signed by Dr\. Anika Patel/)
  let auditPage = await view(h, client.id, h.owner)
  const audit = [...auditPage.audit]
  while (auditPage.auditPage.older) {
    auditPage = (await h.send(`/api/balm/clients/${client.id}?auditBefore=${auditPage.auditPage.older}`, undefined, h.owner)).value
    audit.push(...auditPage.audit)
  }
  for (const action of ['note.signed', 'note.addendum', 'plan.sent', 'plan.opened', 'plan.certified']) assert.ok(audit.some(a => a.action === action), action)
}))

test('billed CPT units follow the 8-minute rule onto the invoice, and the scribe drafts from dictation with the clinic’s own key', async () => {
  const seen = []
  // The model's network edge: answers as Anthropic's Messages API does.
  const model = async request => {
    const body = await request.json()
    seen.push({ key: request.headers.get('x-api-key'), body })
    const draft = { sections: { subjective: 'Pt reports L knee 3/10 after stairs.', objective: 'Ther ex 23 min: SLR 3x10. Manual 10 min: patellar mobs gr III.', assessment: 'Tolerated well.', goals: '', plan: 'Progress step height.' },
      charges: [{ code: '97110', minutes: 23 }, { code: '97140', minutes: 10 }, { code: '99999', minutes: 5 }], note: 'No goal status was dictated.' }
    return Response.json({ id: 'msg_test', type: 'message', role: 'assistant', model: body.model, content: [{ type: 'text', text: JSON.stringify(draft) }], stop_reason: 'end_turn' })
  }
  await run(async h => {
    await h.finishSetup()
    const { service, practitioners: [priya] } = await clinic(h)
    await h.cmd('staff.save', { id: priya.id, name: 'Priya', email: priya.email, role: 'practitioner', credentials: 'PT', active: true })
    const client = await h.cmd('client.save', { firstName: 'Ava', lastName: 'Ng', dateOfBirth: '1992-06-15' })
    const visit = await pastVisit(h, client.id, priya, service.id)
    // CMS's worked examples: whole units first, the rest to the most minutes left over.
    const cases = [[[['97110', 33], ['97140', 7]], { 97110: 2, 97140: 1 }, 3], [[['97112', 24], ['97110', 23]], { 97112: 2, 97110: 1 }, 3],
      [[['97110', 7]], { 97110: 0 }, 0], [[['97530', 7], ['97140', 7]], { 97530: 1, 97140: 0 }, 1], [[['97110', 8], ['97161', 0]], { 97110: 1, 97161: 1 }, 2], [[['97110', 52], ['97116', 15]], { 97110: 3, 97116: 1 }, 4]]
    for (const [n, [charges]] of cases.entries()) await h.cmd('note.write', { clientId: client.id, appointmentId: visit, body: `Units case ${n}`, charges: charges.map(([code, minutes]) => ({ code, minutes })) }, priya.cookie)
    const notes = (await view(h, client.id, priya.cookie)).notes
    for (const [n, [, units, total]] of cases.entries()) {
      const billing = notes.find(x => x.revisions[0].body === `Units case ${n}`).billing
      assert.deepEqual([Object.fromEntries(billing.lines.map(l => [l.code, l.units])), billing.units], [units, total], `case ${n}`)
    }
    await h.cmd('note.write', { clientId: client.id, appointmentId: visit, body: 'x', charges: [{ code: '97110', minutes: 0 }] }, priya.cookie, 400)
    await h.cmd('note.write', { clientId: client.id, appointmentId: visit, body: 'x', charges: [{ code: '12345', minutes: 10 }] }, priya.cookie, 400)

    // No key: the scribe says so and drafts nothing.
    const dictation = 'Pt reports L knee 3/10 after stairs. Ther ex 23 min SLR 3x10. Manual 10 min patellar mobs. Progress step height.'
    const ask = { clientId: client.id, appointmentId: visit, template: 'pt.daily', dictation }
    const missing = await h.send('/api/balm/command', { name: 'note.scribe', input: ask }, priya.cookie)
    assert.deepEqual([missing.status, missing.value.code], [409, 'add_a_key_to_use_the_scribe'])
    assert.equal(seen.length, 0)
    await h.cmd('scribe.save', { provider: 'anthropic', key: 'sk-ant-test-key-4242' }, priya.cookie, 403)
    await h.cmd('scribe.save', { provider: 'anthropic', key: 'sk-ant-test-key-4242' })
    const status = await h.state()
    assert.equal(status.scribe.ready, true); assert.equal(status.scribe.saved.key_hint, '…4242'); assert.ok(!JSON.stringify(status).includes('sk-ant-test-key-4242'))

    // Saving ran the test on made-up dictation; Ready follows that test.
    assert.equal(seen.length, 1); assert.ok(!JSON.stringify(seen[0].body).includes('Ava'))
    const drafted = await h.cmd('note.scribe', ask, priya.cookie)
    assert.equal(seen[1].key, 'sk-ant-test-key-4242')
    assert.equal(seen[1].body.output_config.format.type, 'json_schema')
    const sent = JSON.stringify(seen[1].body)
    assert.ok(sent.includes('Ther ex 23 min')); assert.ok(!sent.includes('Ava') && !sent.includes('1992-06-15'))
    const draft = (await view(h, client.id, priya.cookie)).notes.find(n => n.id === drafted.id)
    assert.deepEqual([draft.status, draft.template, draft.revisions[0].draftedBy], ['draft', 'pt.daily', 'scribe'])
    assert.deepEqual(draft.revisions[0].charges, [{ code: '97110', minutes: 23 }, { code: '97140', minutes: 10 }])
    // The scribe never signs: the practitioner completes the missing goals and signs.
    await h.cmd('note.sign', { id: drafted.id, revision: 1, signature: 'Priya', attest: true }, priya.cookie, 400)
    await h.cmd('note.amend', { id: drafted.id, revision: 1, sections: { ...Object.fromEntries(draft.revisions[0].sections.map(s => [s.id, s.text])), goals: 'STG 1 progressing.' }, charges: draft.revisions[0].charges }, priya.cookie)
    await h.cmd('note.sign', { id: drafted.id, revision: 2, signature: 'priya ', attest: 'on' }, priya.cookie)

    // The signed note's units travel to the invoice and its fixed bytes.
    await h.cmd('appointment.attend', { id: visit }, priya.cookie)
    const invoice = await h.cmd('invoice.prepare', { appointmentId: visit })
    assert.deepEqual(invoice.snapshot.procedures.map(p => [p.code, p.minutes, p.units]), [['97110', 23, 1], ['97140', 10, 1]])
    await h.cmd('invoice.approve', { id: invoice.id })
    const bytes = (await h.send(`/api/balm/invoices/${invoice.id}.html`, undefined, h.owner)).text
    assert.match(bytes, /97110[\s\S]*97140[\s\S]*8-minute rule/)
    const page = (await h.send('/app/clients/' + client.id, undefined, priya.cookie)).text
    assert.match(page, /8-minute rule · 33 timed min · 2 units/)
  }, { outbound: model })
})

test('documentation warnings follow imported treatment days and payer requirements block an incomplete signature', () => run(async h => {
  await h.finishSetup()
  const { service, practitioners: [priya, sam] } = await clinic(h, ['Priya', 'Sam'])
  await h.cmd('staff.save', { id: priya.id, name: 'Priya', email: priya.email, role: 'practitioner', credentials: 'PT', active: true })
  const visits = Array.from({ length: 10 }, (_, i) => {
    const start = new Date(Date.now() - (9 - i) * 86400000 - 3 * 3600000)
    return `visit-${i},patient-1,${start.toISOString()},${new Date(+start + 45 * 60000).toISOString()},attended`
  })
  const bundle = { provider: 'cliniko', practitionerId: priya.id, serviceId: service.id, dateFormat: 'MDY', files: [
    { kind: 'patients', name: 'patients.csv', csv: 'Patient ID,First Name,Last Name,Date of Birth\npatient-1,Elena,Rivera,1988-04-12\n' },
    { kind: 'appointments', name: 'appointments.csv', csv: 'Source ID,Patient ID,Start At,End At,Status\n' + visits.join('\n') + '\n' },
  ] }
  const preview = await h.cmd('movein.preview', bundle)
  assert.equal(preview.canApply, true, JSON.stringify(preview.diagnostics))
  await h.cmd('movein.apply', { ...bundle, fingerprint: preview.fingerprint, acceptanceReason: 'Reviewed the historical treatment attendance.' })
  const patient = (await h.state()).clients[0], visit = (await h.state()).appointments.at(-1)
  const payer = await h.cmd('insurance.payer.save', { name: 'Medicare therapy', payerId: 'MEDICARE', receiverId: 'CMS', unitMethod: 'cms', medicare: true })
  const year = new Date().getUTCFullYear(), coverage = { startsOn: `${year - 1}-01-01`, endsOn: `${year + 1}-12-31` }
  await h.cmd('insurance.policy.save', { clientId: patient.id, payerId: payer.id, memberId: 'BENEFICIARY', relationship: '18', patientSex: 'F', address: '100 River St', city: 'Albany', state: 'NY', postalCode: '12207', ...coverage })
  await h.cmd('insurance.medicare.settings.save', { year, therapyGroup: 'pt_slp', thresholdCents: 250000, reviewCents: 300000, source: 'Synthetic annual CMS setting for this test', publishedOn: `${year - 1}-11-01` })
  await h.cmd('insurance.medicare.save', { clientId: patient.id, year, therapyGroup: 'pt_slp', externalUsedCents: 245000, source: 'Reviewed recognized expenses from other providers' })
  await h.cmd('documentation.settings.save', { lateDays: 3, kxNearCents: 10000 })
  await h.cmd('documentation.payer.save', { payerId: payer.id, required: ['totalTreatmentMinutes'] })
  const history = (await h.state()).appointments.filter(a => a.client_id === patient.id)
  const initial = await h.cmd('note.write', { clientId: patient.id, appointmentId: history[0].id, template: 'pt.evaluation', sections: { ...daily, diagnosis: 'M25.561', goals: 'Walk stairs with good control' }, totalTreatmentMinutes: 40 }, priya.cookie)
  await h.cmd('note.sign', { id: initial.id, revision: 1, signature: 'Priya', credentials: 'PT', attest: true }, priya.cookie)
  const ninth = await h.cmd('note.write', { clientId: patient.id, appointmentId: history[8].id, body: 'Improving knee control.' }, priya.cookie)
  assert.ok(!(await view(h, patient.id, priya.cookie)).notes.find(n => n.id === ninth.id).documentationAlerts.some(a => a.kind === 'progress'))
  const oldStart = new Date(Date.now() - 45 * 86400000).toISOString().slice(0, 10)
  await h.cmd('plan.send', { clientId: patient.id, diagnoses: 'M25.561', shortTermGoals: 'Walk stairs', longTermGoals: 'Return to community walking', frequencyPerWeek: 2, durationWeeks: 2, interventions: 'Therapeutic exercise', startDate: oldStart, physicianName: 'Anika Patel', physicianEmail: 'physician@referrer.example', signature: 'Priya', credentials: 'PT', attest: true }, priya.cookie)
  const note = await h.cmd('note.write', { clientId: patient.id, appointmentId: visit.id, body: 'Progressed therapeutic exercise; improving knee control.', charges: [{ code: '97110', minutes: 25 }], assistantInvolved: true }, priya.cookie)
  const read = async () => (await view(h, patient.id, priya.cookie)).notes.find(n => n.id === note.id)
  const kinds = new Set((await read()).documentationAlerts.map(a => a.kind))
  for (const kind of ['progress', 'plan', 'kx', 'required', 'supervision']) assert.ok(kinds.has(kind), kind)
  const close = (await h.state(priya.cookie)).documentationClose.find(v => v.id === visit.id)
  for (const kind of kinds) assert.ok(close.alerts.some(a => a.kind === kind), kind)
  const refusal = await h.cmd('note.sign', { id: note.id, revision: 1, signature: 'Priya', credentials: 'PT', attest: true }, priya.cookie, 400)
  assert.ok(refusal.error.includes('Medicare therapy'))
  assert.equal((await read()).status, 'draft')
  await h.cmd('note.amend', { id: note.id, revision: 1, body: 'Progressed therapeutic exercise; improving knee control.', charges: [{ code: '97110', minutes: 25 }], totalTreatmentMinutes: 40, totalTimedMinutes: 25, assistantInvolved: true, supervisorId: sam.id }, priya.cookie)
  const signed = await h.cmd('note.sign', { id: note.id, revision: 2, signature: 'Priya', credentials: 'PT', attest: true }, priya.cookie)
  assert.equal(signed.status, 'signed')
  assert.equal((await read()).revisions[0].documentation.totalTreatmentMinutes, 40)
  const reception = await h.staff('Robin', 'reception')
  assert.deepEqual((await h.state(reception.cookie)).documentationClose, [])
}))
