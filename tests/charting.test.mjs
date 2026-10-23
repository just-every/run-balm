import { chartFixture } from './chart-template-journey.mjs'
import { modelEdge as supervisionModelEdge } from './defensibility-clinic.mjs'
// Charting through the public doors: discipline templates, sign and lock,
// addenda, the physician-certified plan of care, CPT units by the 8-minute rule
// carried to the invoice, and the scribe with its model faked at the network edge.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { run } from './harness.mjs'
import { clinic, pastVisit, visitDate } from './clinic.mjs'
import { mriUpload } from './chart-document-fixtures.mjs'

const daily = { ...chartFixture().sections, subjective: 'Knee pain 4/10 after stairs; HEP daily.', objective: 'Ther ex 25 min: step-ups 2x12. Flexion 118 deg.', assessment: 'Improving tolerance to stairs.', plan: 'Progress step height.' }
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
  assert.match((await h.send(schedule, undefined, priya.cookie)).text, /Notes to sign[\s\S]*Note not signed/)

  // The visit's template frames the note; required sections are enforced at signing, not while drafting.
  const note = await h.cmd('note.write', { clientId: client.id, appointmentId: visit, sections: { ...daily, goals: '' } }, priya.cookie)
  assert.equal(note.template, 'pt.daily')
  const sign = (input, cookie = priya.cookie, status = 200) => h.cmd('note.sign', { id: note.id, signature: 'Priya', attest: true, ...input }, cookie, status)
  await sign({ revision: 1 }, priya.cookie, 400)
  await h.cmd('note.amend', { ...chartFixture(), id: note.id, revision: 1, sections: { ...daily, goals: 'STG 1: stairs reciprocally, progressing.' } }, priya.cookie)
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
  const historyPlan=await h.send('/api/balm/clients/'+client.id+'/history?historyType=plan&historyText=Stairs',undefined,priya.cookie)
  assert.equal(historyPlan.status,200,historyPlan.text);assert.deepEqual(historyPlan.value.entries.map(r=>r.id),[plan.id])
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
    const unavailable=await h.cmd('note.write', { clientId: client.id, appointmentId: visit, body: 'x', charges: [{ code: '12345', minutes: 10 }] }, priya.cookie, 409)
    assert.match(unavailable.code,/licensed CPT catalog containing 12345/)
    assert.equal((await view(h,client.id,priya.cookie)).notes.length,notes.length,'an unavailable catalog procedure creates no draft')

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
    const licensed=(await h.state()).billingCodeCatalog
    assert.deepEqual(draft.revisions[0].charges,[['97110',23],['97140',10]].map(([code,minutes])=>({...licensed.find(c=>c.code===code),minutes})))
    // The scribe never signs: the practitioner completes the missing goals and signs.
    await h.cmd('note.sign', { id: drafted.id, revision: 1, signature: 'Priya', attest: true }, priya.cookie, 400)
    await h.cmd('note.amend', { ...chartFixture(), id: drafted.id, revision: 1, totalTimedMinutes: 33, totalTreatmentMinutes: 33, sections: { ...Object.fromEntries(draft.revisions[0].sections.map(s => [s.id, s.text])), diagnosis: 'M25.561', response: 'Synthetic treatment response reviewed by the clinician', goals: 'STG 1 progressing.' }, charges: draft.revisions[0].charges.map(c=>({...c,parameters:'Synthetic clinician-reviewed intervention parameters'})) }, priya.cookie)
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
  const initial = await h.cmd('note.write', { ...chartFixture('evaluation'), clientId: patient.id, appointmentId: history[0].id, template: 'pt.evaluation', sections: { ...daily, diagnosis: 'M25.561', goals: 'Walk stairs with good control' }, totalTreatmentMinutes: 40 }, priya.cookie)
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


test('MOBILE-001: replay a disconnected draft save once, refuse changed payloads and intervening edits, and keep clinical authority', () => run(async h => {
  const { service, practitioners: [priya, sam] } = await clinic(h, ['Priya', 'Sam'])
  const client = await h.cmd('client.save', { firstName: 'Marisol', lastName: 'Diaz', dateOfBirth: '1980-03-07' })
  const visit = await pastVisit(h, client.id, priya, service.id)
  const input = { clientId: client.id, appointmentId: visit, body: 'Walking tolerance improved to 15 minutes.', expectedActorId: (await h.state(priya.cookie)).actor.id, requestId: crypto.randomUUID() }
  const saved = await h.cmd('note.write', input, priya.cookie)
  assert.deepEqual(await h.cmd('note.write', input, priya.cookie), saved)
  assert.equal((await view(h, client.id, priya.cookie)).notes.length, 1, 'a lost success response cannot create a second note')
  await h.cmd('note.write', { ...input, body: 'Different content' }, priya.cookie, 409)
  await h.cmd('note.write', input, sam.cookie, 403)
  await h.cmd('note.write', { ...input, expectedActorId: undefined }, sam.cookie, 404)
  const amendment = { id: saved.id, revision: 1, body: 'Tolerated step-ups without increased pain.', requestId: crypto.randomUUID() }
  const answers = await Promise.all([h.cmd('note.amend', amendment, priya.cookie), h.cmd('note.amend', amendment, priya.cookie)])
  assert.deepEqual(answers[0], answers[1])
  assert.equal(answers[0].revision, 2)
  await h.cmd('note.amend', { ...amendment, requestId: crypto.randomUUID(), body: 'Stale text must not overwrite the saved note.' }, priya.cookie, 409)
  const final = (await view(h, client.id, priya.cookie)).notes[0]
  assert.deepEqual(final.revisions.map(r => r.number), [2, 1])
  assert.equal(final.revisions[0].body, amendment.body)
}))

test('CHART-009: immutable MRI scan and photos, chart text/date/type search, shared treating access and administrative refusal', () => run(async h => {
  await h.finishSetup()
  const { service, practitioners: [priya, evan, unrelated] } = await clinic(h, ['Priya','Evan','Sam'])
  const reception = await h.staff('Rosa','reception')
  const patient = await h.cmd('client.save',{firstName:'Marisol',lastName:'Diaz',dateOfBirth:'1980-03-07'})
  const unvisited = await h.cmd('client.save',{firstName:'New',lastName:'Referral'})
  await pastVisit(h,patient.id,priya,service.id,h.owner,2)
  await pastVisit(h,patient.id,evan,service.id,h.owner,5)
  const {mriUpload,mriReport,chartPhoto} = await import('./chart-document-fixtures.mjs')
  const mri = await h.cmd('chart.document.upload',mriUpload(patient.id,'2026-10-01'))
  const photos=[]
  for(const [index,description]of ['Knee flexion baseline','Knee flexion follow-up'].entries()) photos.push(await h.cmd('chart.document.upload',{
    clientId:patient.id,title:description,documentType:'photo',documentDate:index?'2026-10-15':'2026-10-01',searchText:description,
    attachment:chartPhoto,attachmentName:'knee-'+index+'.png',createdBy:h.auth.OWNER_EMAIL},priya.cookie))
  const uploadPath='/app/action?name=chart.document.upload&returnTo='+encodeURIComponent('/app/clients/'+patient.id)
  const multipart = async(fields,bytes=mriReport(),mime='application/pdf')=>{
    const body=new FormData();for(const [key,value]of Object.entries(fields))body.set(key,value)
    body.set('attachment',new File([bytes],'hand-filed-MRI.pdf',{type:mime}))
    const encoded=new Request(h.origin+uploadPath,{method:'POST',body})
    return h.mf.dispatchFetch(h.origin+uploadPath,{method:'POST',headers:{origin:h.origin,cookie:priya.cookie,'content-type':encoded.headers.get('content-type')},body:new Uint8Array(await encoded.arrayBuffer()),redirect:'manual'})
  }
  const referral=await multipart({clientId:patient.id,title:'Referring physician order',documentType:'order',documentDate:'2026-09-30',searchText:'Physical therapy ordered after MRI'})
  assert.equal(referral.status,303,await referral.text())
  const note=await h.cmd('note.write',{clientId:patient.id,body:'MRI reviewed. Baseline knee flexion 100 degrees.'},priya.cookie)
  const search=async(filters={},cookie=priya.cookie)=>h.send('/api/balm/clients/'+patient.id+'/history?'+new URLSearchParams(filters),undefined,cookie)
  let found=await search({historyText:'mRi',historyType:'imaging',historyFrom:'2026-10-01',historyTo:'2026-10-01'})
  assert.equal(found.status,200,found.text)
  assert.deepEqual(found.value.entries.map(r=>r.id),[mri.id])
  assert.equal(found.value.entries[0].filedBy,h.auth.OWNER_EMAIL)
  const download=await h.mf.dispatchFetch(h.origin+found.value.entries[0].url,{headers:{cookie:evan.cookie}})
  assert.equal(download.status,200)
  assert.equal(download.headers.get('cache-control'),'no-store')
  assert.match(download.headers.get('content-disposition'),/^attachment;/)
  assert.deepEqual(Buffer.from(await download.arrayBuffer()),mriReport(),'a second treating clinician reads the owner-filed original')
  found=await search({historyType:'photo',historyText:'KNEE',historyFrom:'2026-10-01',historyTo:'2026-10-15'},evan.cookie)
  assert.deepEqual(found.value.entries.map(r=>r.id).sort(),photos.map(p=>p.id).sort(),'both inclusive dates and another author’s photos')
  assert.ok(found.value.entries.every(r=>r.filedBy===priya.email),'uploads retain the authenticated author, ignoring a posted author')
  for(const photo of photos){const response=await h.mf.dispatchFetch(h.origin+'/api/balm/chart-documents/'+photo.id,{headers:{cookie:evan.cookie}});assert.deepEqual(Buffer.from(await response.arrayBuffer()),Buffer.from(chartPhoto.split(',')[1],'base64'))}
  assert.equal((await search({historyFrom:'2026-10-02',historyTo:'2026-10-14',historyType:'photo'})).value.total,0)
  assert.equal((await search({historyText:'no such phrase'})).value.total,0)
  found=await search({historyText:'MRI',historyType:'note'})
  assert.deepEqual(found.value.entries.map(r=>r.id),[note.id])
  assert.equal((await search({historyText:'MRI',historyType:'note'},evan.cookie)).value.total,0,'shared documents do not widen author-only note access')
  assert.equal((await search({historyType:'order'})).value.total,1)
  assert.equal((await search({historyType:'referral'})).value.total,0)
  for(const [kind,title] of [['referral','Referral from Dr Patel'],['signed_plan','Returned signed plan scan']]) {
    const file=await h.cmd('chart.document.upload',{...mriUpload(patient.id,'2026-10-01'),documentType:kind,title,attachmentName:kind+'.pdf',attachment:'data:application/pdf;base64,'+mriReport(title,'Therapy records for Marisol Diaz. Filed original scan.').toString('base64')},evan.cookie)
    assert.deepEqual((await search({historyType:kind},priya.cookie)).value.entries.map(r=>r.id),[file.id])
  }
  assert.deepEqual((await search({historyText:'ligament',historyType:'imaging'})).value.entries.map(r=>r.id),[mri.id])
  assert.equal((await search({historyFrom:'2026-10-15',historyTo:'2026-10-01'})).status,400)
  const page=await h.send('/app/clients/'+patient.id+'?historyText=MRI&historyType=imaging',undefined,evan.cookie)
  assert.ok(page.text.includes('Faxed right knee MRI report')&&page.text.includes('/api/balm/chart-documents/'+mri.id))
  for(const cookie of [reception.cookie,unrelated.cookie]){
    assert.equal((await search({},cookie)).status,cookie===reception.cookie?403:404)
    assert.equal((await h.send('/api/balm/chart-documents/'+mri.id,undefined,cookie)).status,cookie===reception.cookie?403:404)
    await h.cmd('chart.document.upload',mriUpload(patient.id,'2026-10-01'),cookie,cookie===reception.cookie?403:404)
  }
  const deskFile=await view(h,patient.id,reception.cookie)
  assert.equal(deskFile.chartHistory,null)
  assert.ok(!JSON.stringify(deskFile).includes('knee-MRI-report.pdf'))
  assert.ok(!(await h.send('/app/clients/'+patient.id,undefined,reception.cookie)).text.includes('Chart history'))
  const key=await h.cmd('agent.create',{label:'Chart access refused'})
  assert.equal((await h.send('/api/balm/agent/command',{name:'chart.document.upload',input:mriUpload(patient.id,'2026-10-01')},'',{authorization:'Bearer '+key.token})).status,403)
  assert.equal((await h.send('/api/balm/chart-documents/'+mri.id,undefined,'',{authorization:'Bearer '+key.token})).status,401)
  assert.equal((await h.send('/api/balm/clients/'+patient.id+'/history',undefined,'',{authorization:'Bearer '+key.token})).status,401)
  assert.equal((await h.send('/api/balm/chart-documents/'+mri.id)).status,401)
  const count=(await search()).value.total
  assert.equal((await multipart({clientId:patient.id,title:'Invalid file',documentType:'imaging',documentDate:'2026-10-01'},Buffer.from('This is not a PDF document.'))).status,400)
  assert.equal((await multipart({clientId:patient.id,title:'Too large',documentType:'imaging',documentDate:'2026-10-01'},Buffer.alloc(1_000_001))).status,413)
  assert.equal((await search()).value.total,count)
  await assert.rejects(h.db.prepare('UPDATE bm_chart_documents SET title=? WHERE id=?').bind('Changed',mri.id).run())
  await assert.rejects(h.db.prepare('DELETE FROM bm_chart_documents WHERE id=?').bind(mri.id).run())
  await h.cmd('chart.document.upload',mriUpload(unvisited.id,'2026-10-01'))
  await h.cmd('client.erase',{id:unvisited.id},h.owner,409)
  const audit=[];let before=''
  do {
    const file=(await h.send('/api/balm/clients/'+patient.id+(before?'?auditBefore='+before:''),undefined,h.owner)).value
    audit.push(...file.audit);before=file.auditPage.older
  } while(before)
  for(const action of ['chart.document_uploaded','chart.history_searched','chart.document_read','chart.document_downloaded'])assert.ok(audit.some(r=>r.action===action),action)
  assert.ok(!JSON.stringify(audit).includes('ligament')&&!JSON.stringify(audit).includes('knee-MRI-report'))
}))

test('CHART-013: the owner grants and revokes care-team note access, and break glass opens a chart for 12 hours with the owner notified and every read audited', () => run(async h => {
  await h.finishSetup()
  const { service, practitioners: [priya, sam, lee] } = await clinic(h, ['Priya', 'Sam', 'Lee'])
  const reception = await h.staff('Rosa', 'reception')
  const patient = await h.cmd('client.save', { firstName: 'Marisol', lastName: 'Diaz', dateOfBirth: '1984-05-06' })
  const visit = await pastVisit(h, patient.id, priya, service.id)
  const note = await h.cmd('note.write', { clientId: patient.id, appointmentId: visit, body: 'Private Priya narrative: right knee effusion.' }, priya.cookie)
  await h.cmd('note.sign', { id: note.id, revision: 1, signature: 'Priya', credentials: 'PT', attest: true }, priya.cookie)
  const mri = await h.cmd('chart.document.upload', mriUpload(patient.id, '2026-10-01'))
  const file = cookie => h.send('/api/balm/clients/' + patient.id, undefined, cookie)
  const download = cookie => h.mf.dispatchFetch(h.origin + '/api/balm/chart-documents/' + mri.id, { headers: { cookie } })
  const ownerAudit = async () => (await file(h.owner)).value.audit

  // Outside the chart: refused, with only the emergency form offered.
  assert.equal((await file(sam.cookie)).status, 404)
  const refused = await h.send('/app/clients/' + patient.id, undefined, sam.cookie)
  assert.equal(refused.status, 404); assert.match(refused.text, /name=chart\.break_glass/); assert.ok(!refused.text.includes('Private Priya narrative'))

  // Grant: only the owner; the grantee reads every note, read-only, and nothing else of the file.
  for (const cookie of [reception.cookie, priya.cookie]) await h.cmd('care_team.grant', { clientId: patient.id, practitionerId: sam.id }, cookie, 403)
  const grant = await h.cmd('care_team.grant', { clientId: patient.id, practitionerId: sam.id })
  await h.cmd('care_team.grant', { clientId: patient.id, practitionerId: sam.id }, h.owner, 409)
  const granted = (await file(sam.cookie)).value
  assert.deepEqual(granted.notes.map(n => [n.id, n.mine]), [[note.id, false]]); assert.match(granted.notes[0].revisions[0].body, /Private Priya narrative/)
  assert.equal(granted.careAccess.teamOnly, true); assert.deepEqual([granted.intake, granted.plans, granted.appointments], [[], [], []])
  assert.ok(!granted.chartHistory.entries.some(e => e.id === mri.id), 'a grant reads notes, not uploaded documents')
  assert.equal((await download(sam.cookie)).status, 404)
  await h.cmd('note.amend', { id: note.id, body: 'Sam rewrites it', reason: 'Correction' }, sam.cookie, 404)
  await h.cmd('note.addendum', { id: note.id, body: 'Sam adds to it' }, sam.cookie, 404)
  const page = await h.send('/app/clients/' + patient.id, undefined, sam.cookie)
  assert.equal(page.status, 200); assert.match(page.text, /Private Priya narrative/); assert.match(page.text, /granted you access/)
  assert.ok((await ownerAudit()).some(a => a.action === 'care_team.granted' && a.subject_id === grant.id))
  assert.ok((await ownerAudit()).some(a => a.action === 'note.read' && a.actor_email === sam.email && /care team grant/.test(a.detail)))
  assert.match((await h.send('/app/clients/' + patient.id, undefined, h.owner)).text, /id="grant-/)

  // Revoke: refused again.
  await h.cmd('care_team.revoke', { id: grant.id }, sam.cookie, 403)
  await h.cmd('care_team.revoke', { id: grant.id })
  assert.equal((await file(sam.cookie)).status, 404)
  assert.ok((await ownerAudit()).some(a => a.action === 'care_team.revoked' && a.subject_id === grant.id))

  // Break glass: practitioners only, with a real reason, for 12 hours of notes and documents.
  const reason = 'Covering Priya today; patient called with acute knee swelling.'
  await h.cmd('chart.break_glass', { clientId: patient.id, reason }, reception.cookie, 403)
  await h.cmd('chart.break_glass', { clientId: patient.id, reason: 'urgent' }, lee.cookie, 400)
  const before = Date.now(), glass = await h.cmd('chart.break_glass', { clientId: patient.id, reason }, lee.cookie)
  const hours = (Date.parse(glass.expiresAt) - before) / 3600_000
  assert.ok(Math.abs(hours - 12) < 1 / 3600, 'open for 12 hours')
  const emergency = (await file(lee.cookie)).value
  assert.match(emergency.notes[0].revisions[0].body, /Private Priya narrative/); assert.equal(emergency.careAccess.breakGlass.reason, reason)
  assert.ok(emergency.chartHistory.entries.some(e => e.id === mri.id))
  assert.equal((await download(lee.cookie)).status, 200)
  await h.cmd('note.write', { clientId: patient.id, body: 'Lee writes into the chart' }, lee.cookie, 404)
  const audit = await ownerAudit()
  assert.ok(audit.some(a => a.action === 'chart.break_glass' && a.actor_email === lee.email && a.detail.includes(reason)))
  assert.ok(audit.some(a => a.action === 'note.break_glass_read' && a.subject_id === note.id && a.detail === 'break glass: ' + reason))
  assert.ok(audit.some(a => a.action === 'chart.document_downloaded' && a.actor_email === lee.email && a.detail === 'break glass: ' + reason))

  // The owner's notice: names and the reason, labelled as an in-app notice, never note text.
  const notices = (await h.state()).breakGlass
  assert.deepEqual(notices.map(n => [n.id, n.practitioner, n.client, n.reason]), [[glass.id, 'Lee', 'Marisol Diaz', reason]])
  assert.ok(!JSON.stringify(notices).includes('Private Priya narrative'))
  const today = (await h.send('/app', undefined, h.owner)).text
  assert.match(today, /id="break-glass-notices"/); assert.match(today, /Notified in Balm/)
  for (const cookie of [lee.cookie, reception.cookie]) assert.equal((await h.state(cookie)).breakGlass, null)

  // The owner ends it early, then acknowledges the notice.
  await h.cmd('chart.break_glass.end', { id: glass.id }, lee.cookie, 403)
  await h.cmd('chart.break_glass.end', { id: glass.id })
  assert.equal((await file(lee.cookie)).status, 404); assert.equal((await download(lee.cookie)).status, 404)
  await h.cmd('chart.break_glass.acknowledge', { id: glass.id })
  assert.deepEqual((await h.state()).breakGlass, [])
  assert.ok((await ownerAudit()).some(a => a.action === 'chart.break_glass_ended' && a.subject_id === glass.id))
}))

test('CHART-005: measures recorded at evaluation and three later visits show their change on the progress report and graph, under note access and audit', () => run(async h => {
  await h.finishSetup()
  const { service, practitioners: [priya, sam, lee] } = await clinic(h, ['Priya', 'Sam', 'Lee'])
  const reception = await h.staff('Rosa', 'reception')
  const patient = await h.cmd('client.save', { firstName: 'Ana', lastName: 'Ruiz', dateOfBirth: '1979-03-04' })
  const flexion = [95, 105, 115, 122], lefs = [38, 46, 52, 61], notes = []
  for (const [i, template] of ['pt.evaluation', 'pt.daily', 'pt.daily', 'pt.progress'].entries()) {
    const visit = await pastVisit(h, patient.id, priya, service.id, h.owner, 2 + (3 - i) * 4)
    const note = await h.cmd('note.write', { clientId: patient.id, appointmentId: visit, template }, priya.cookie)
    await h.cmd('note.measure', { noteId: note.id, kind: 'rom', name: 'Knee flexion', side: 'right', value: String(flexion[i]), unit: 'degrees' }, priya.cookie)
    await h.cmd('note.measure', { noteId: note.id, kind: 'score', name: 'LEFS', value: String(lefs[i]), unit: 'points' }, priya.cookie)
    notes.push(note)
  }
  const [evaluation, , , progress] = notes
  // Structured fields: graded muscle tests, flowsheets, and per-kind units and bounds.
  const grade = await h.cmd('note.measure', { noteId: progress.id, kind: 'mmt', name: 'Quadriceps', side: 'right', value: '4+' }, priya.cookie)
  assert.equal(grade.value, 4.25)
  await h.cmd('note.measure', { noteId: progress.id, kind: 'mmt', name: 'Quadriceps', value: '5+' }, priya.cookie, 400)
  await h.cmd('note.measure', { noteId: progress.id, kind: 'rom', name: 'Knee flexion', value: '120', unit: 'cm' }, priya.cookie, 400)
  await h.cmd('note.measure', { noteId: progress.id, kind: 'girth', name: 'Knee joint line', side: 'right', value: '41.5', unit: 'cm' }, priya.cookie)
  await h.cmd('note.measure', { noteId: progress.id, kind: 'gait', name: 'Timed Up and Go', value: '9.8', unit: 'seconds' }, priya.cookie)
  await h.cmd('note.measure', { noteId: progress.id, kind: 'balance', name: 'Single-leg stance', side: 'right', value: '22', unit: 'seconds' }, priya.cookie)
  const flow = await h.cmd('note.measure', { noteId: progress.id, kind: 'flowsheet', name: 'Leg press', value: '40', unit: 'lb', sets: 3, reps: 10 }, priya.cookie)
  assert.deepEqual([flow.sets, flow.reps], [3, 10])
  await h.cmd('note.measure', { noteId: progress.id, kind: 'flowsheet', name: 'Leg press', value: '40', unit: 'lb' }, priya.cookie, 400)
  for (const cookie of [reception.cookie, sam.cookie]) await h.cmd('note.measure', { noteId: evaluation.id, kind: 'score', name: 'LEFS', value: '70', unit: 'points' }, cookie, 404)

  const file = cookie => h.send('/api/balm/clients/' + patient.id, undefined, cookie)
  const owner = (await file(h.owner)).value
  const knee = owner.measures.find(m => m.name === 'Knee flexion'), score = owner.measures.find(m => m.name === 'LEFS')
  assert.deepEqual(knee.points.map(p => p.value), flexion); assert.equal(knee.baseline.noteId, evaluation.id); assert.equal(knee.change, 27)
  assert.deepEqual(score.points.map(p => p.value), lefs); assert.equal(score.change, 23)
  const report = owner.measureChanges[progress.id]
  assert.deepEqual(report.filter(c => ['Knee flexion', 'LEFS'].includes(c.name)).map(c => [c.name, c.baseline, c.current, c.change]), [['Knee flexion', 95, 122, 27], ['LEFS', 38, 61, 23]])
  const page = (await h.send('/app/clients/' + patient.id, undefined, priya.cookie)).text
  assert.match(page, /Change since evaluation[\s\S]*Knee flexion \(right\)<\/td><td>95 degrees[^<]*<\/td><td>122 degrees<\/td><td>\+27 degrees/)
  assert.match(page, /LEFS<\/td><td>38 points[^<]*<\/td><td>61 points<\/td><td>\+23 points/)
  const svg = page.match(/<svg class="measure-graph"[^>]*data-measure="rom\|knee flexion\|right\|degrees">[\s\S]*?<\/svg>/)[0]
  assert.deepEqual([...svg.matchAll(/data-value="([^"]+)"/g)].map(m => Number(m[1])), flexion, 'the graph plots exactly the recorded entries in visit order')
  assert.match(page, /grade 4\+/)

  // Signing locks the note's measures.
  const brief = await h.cmd('note.write', { clientId: patient.id, appointmentId: await pastVisit(h, patient.id, priya, service.id, h.owner, 18), body: 'Hip check.' }, priya.cookie)
  const hip = await h.cmd('note.measure', { noteId: brief.id, kind: 'rom', name: 'Hip abduction', side: 'left', value: '30' }, priya.cookie)
  await h.cmd('note.sign', { id: brief.id, revision: 1, signature: 'Priya', credentials: 'PT', attest: true }, priya.cookie)
  await h.cmd('note.measure', { noteId: brief.id, kind: 'rom', name: 'Hip abduction', value: '35' }, priya.cookie, 409)
  await h.cmd('note.measure_remove', { id: hip.id }, priya.cookie, 409)
  await assert.rejects(h.db.prepare('DELETE FROM bm_measures WHERE id=?').bind(hip.id).run(), /note_locked/)
  await assert.rejects(h.db.prepare('UPDATE bm_measures SET value=1 WHERE id=?').bind(hip.id).run(), /note_locked/)
  const typo = await h.cmd('note.measure', { noteId: progress.id, kind: 'score', name: 'Typo', value: '1', unit: 'points' }, priya.cookie)
  await h.cmd('note.measure_remove', { id: typo.id }, sam.cookie, 404)
  await h.cmd('note.measure_remove', { id: typo.id }, priya.cookie)

  // Readers: as notes (CHART-013), with the same read audit; reception reads none.
  assert.equal((await file(reception.cookie)).value.measures, null)
  assert.equal((await file(sam.cookie)).status, 404)
  const grant = await h.cmd('care_team.grant', { clientId: patient.id, practitionerId: sam.id })
  const granted = (await file(sam.cookie)).value
  assert.deepEqual(granted.measures.find(m => m.name === 'Knee flexion').points.map(p => p.value), flexion)
  await h.cmd('care_team.revoke', { id: grant.id })
  await h.cmd('chart.break_glass', { clientId: patient.id, reason: 'Covering Priya; patient reports a fall at home.' }, lee.cookie)
  assert.equal((await file(lee.cookie)).value.measureChanges[progress.id].find(c => c.name === 'LEFS').change, 23)
  const audit = []; let before = ''
  do { const page = (await h.send('/api/balm/clients/' + patient.id + (before ? '?auditBefore=' + before : ''), undefined, h.owner)).value; audit.push(...page.audit); before = page.auditPage.older } while (before)
  assert.ok(audit.some(a => a.action === 'note.read' && a.actor_email === sam.email && a.subject_id === evaluation.id && /care team grant/.test(a.detail)))
  assert.ok(audit.some(a => a.action === 'note.break_glass_read' && a.actor_email === lee.email && a.subject_id === progress.id))
  assert.ok(audit.some(a => a.action === 'note.measured' && a.subject_id === evaluation.id))
  assert.ok(audit.some(a => a.action === 'note.measure_removed' && a.subject_id === progress.id))
}))

test('REF-003: two episodes of one patient keep visits, authorization use, outcomes, plans, reports and chart history apart; earlier records stay not assigned until a person files them', () => run(async h => {
  await h.finishSetup()
  const { service, practitioners: [priya, sam] } = await clinic(h, ['Priya', 'Sam'])
  const reception = await h.staff('Rosa', 'reception')
  const patient = await h.cmd('client.save', { firstName: 'Lena', lastName: 'Park', dateOfBirth: '1984-05-06' })
  const other = await h.cmd('client.save', { firstName: 'Omar', lastName: 'Other' })
  const shift = n => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10)
  // Filed before any episode: never guessed into one by date.
  const legacyVisit = await pastVisit(h, patient.id, priya, service.id, h.owner, 19)
  const legacyDoc = await h.cmd('chart.document.upload', mriUpload(patient.id, shift(-10)), priya.cookie)
  const knee = await h.cmd('episode.open', { clientId: patient.id, title: 'Left knee', start: 'direct_access' }, reception.cookie)
  const back = await h.cmd('episode.open', { clientId: patient.id, title: 'Low back', start: 'direct_access' }, priya.cookie)
  await h.cmd('episode.open', { clientId: patient.id, title: 'Not my patient' }, sam.cookie, 404)
  const elsewhere = await h.cmd('episode.open', { clientId: other.id, title: 'Shoulder', start: 'direct_access' })

  // With two open episodes every staff action that files a record must choose one.
  const coverage = { startsOn: shift(-30), endsOn: shift(30) }
  const payer = await h.cmd('insurance.payer.save', { name: 'Aetna', payerId: '60054', receiverId: 'AETNA', unitMethod: 'cms', fees: [{ code: '97110', cents: 3500 }] })
  const policy = await h.cmd('insurance.policy.save', { clientId: patient.id, payerId: payer.id, memberId: 'LP123', relationship: '18', patientSex: 'F', address: '200 Oak St', city: 'Austin', state: 'TX', postalCode: '78701', ...coverage })
  await h.cmd('insurance.authorization.save', { policyId: policy.id, number: 'AUTH-X', ...coverage, visits: 6 }, h.owner, 409)
  await h.cmd('appointment.book', { clientId: patient.id, practitionerId: priya.id, serviceId: service.id, date: shift(3), time: '10:00', acknowledgeInsurance: 'on' }, h.owner, 409)
  await h.cmd('chart.document.upload', mriUpload(patient.id, shift(-1)), priya.cookie, 409)
  await h.cmd('appointment.book', { clientId: patient.id, practitionerId: priya.id, serviceId: service.id, date: shift(3), time: '10:00', episodeId: elsewhere.id, acknowledgeInsurance: 'on' }, h.owner, 409)
  const kneeAuth = await h.cmd('insurance.authorization.save', { policyId: policy.id, number: 'AUTH-K', ...coverage, visits: 6, episodeId: knee.id })
  const backAuth = await h.cmd('insurance.authorization.save', { policyId: policy.id, number: 'AUTH-B', ...coverage, visits: 4, episodeId: back.id })

  // Document in both: visits, notes with measures, plans and uploads.
  const chart = async (episode, hours, template, measures) => {
    const visit = await pastVisit(h, patient.id, priya, service.id, h.owner, hours, { episodeId: episode.id, acknowledgeInsurance: 'on' })
    const note = await h.cmd('note.write', { clientId: patient.id, appointmentId: visit, template }, priya.cookie)
    for (const [kind, name, value, unit] of measures) await h.cmd('note.measure', { noteId: note.id, kind, name, value: String(value), unit }, priya.cookie)
    await h.cmd('appointment.attend', { id: visit })
    return { visit, note }
  }
  const kneeEval = await chart(knee, 17, 'pt.evaluation', [['score', 'NPRS', 7, 'points'], ['rom', 'Knee flexion', 90, 'degrees']])
  await chart(knee, 15, 'pt.daily', [['score', 'NPRS', 5, 'points']])
  const kneeProgress = await chart(knee, 13, 'pt.progress', [['score', 'NPRS', 3, 'points'], ['rom', 'Knee flexion', 120, 'degrees']])
  const backEval = await chart(back, 11, 'pt.evaluation', [['score', 'NPRS', 8, 'points']])
  const backProgress = await chart(back, 9, 'pt.progress', [['score', 'NPRS', 6, 'points']])
  const upcoming = await h.cmd('appointment.book', { clientId: patient.id, practitionerId: priya.id, serviceId: service.id, date: shift(3), time: '10:00', episodeId: back.id, acknowledgeInsurance: 'on' })
  const plan = (episodeId, frequencyPerWeek, durationWeeks, status = 200) => h.cmd('plan.send', { clientId: patient.id, episodeId, diagnoses: 'M25.562', shortTermGoals: 'Stairs', longTermGoals: 'Running', frequencyPerWeek, durationWeeks, interventions: 'Therapeutic exercise', startDate: shift(-3), physicianName: 'Dr Anika Patel', physicianEmail: 'physician@clinic.example', signature: 'Priya', credentials: 'PT', attest: true }, priya.cookie, status)
  await plan(undefined, 1, 1, 409)
  const kneePlan = await plan(knee.id, 1, 1), backPlan = await plan(back.id, 2, 4)
  const kneeDoc = await h.cmd('chart.document.upload', { ...mriUpload(patient.id, shift(-2)), episodeId: knee.id }, priya.cookie)
  const backDoc = await h.cmd('chart.document.upload', { ...mriUpload(patient.id, shift(-2)), title: 'Lumbar MRI', episodeId: back.id }, priya.cookie)

  // Visit counts, authorization use and outcomes are kept apart.
  let file = await view(h, patient.id, h.owner)
  const episode = id => file.episodes.find(e => e.id === id)
  assert.deepEqual([episode(knee.id).visits, episode(back.id).visits, episode('').visits].map(v => [v.attended, v.booked]), [[3, 0], [2, 1], [0, 1]])
  assert.deepEqual(episode(knee.id).authorizations.map(a => [a.id, a.used, a.reserved, a.remaining]), [[kneeAuth.id, 3, 0, 3]])
  assert.deepEqual(episode(back.id).authorizations.map(a => [a.id, a.used, a.reserved, a.remaining]), [[backAuth.id, 2, 1, 1]])
  assert.deepEqual([episode(knee.id).plans, episode(back.id).plans], [1, 1])
  const nprs = file.measures.filter(m => m.name === 'NPRS').map(m => [m.episodeId, m.points.map(p => p.value), m.baseline.noteId, m.change])
  assert.deepEqual(nprs.sort(), [[back.id, [8, 6], backEval.note.id, -2], [knee.id, [7, 5, 3], kneeEval.note.id, -4]].sort())
  assert.deepEqual(file.measureChanges[kneeProgress.note.id].map(c => [c.name, c.baseline, c.current]), [['NPRS', 7, 3], ['Knee flexion', 90, 120]])
  assert.deepEqual(file.measureChanges[backProgress.note.id].map(c => [c.name, c.baseline, c.current]), [['NPRS', 8, 6]])
  const page = (await h.send('/app/clients/' + patient.id, undefined, priya.cookie)).text
  assert.ok(page.includes(`data-measure="${knee.id}|score|nprs|none|points"`) && page.includes(`data-measure="${back.id}|score|nprs|none|points"`), 'one graph per episode series')
  assert.ok(page.includes('Episodes of care') && page.includes('Left knee') && page.includes('Low back'))

  // REPORT-001 counts plan-of-care completion per episode, in its CSV too.
  const report = (await h.send(`/api/balm/reports?from=${shift(-5)}&to=${shift(0)}`, undefined, h.owner)).value
  assert.deepEqual(['plans', 'completed', 'inProgress', 'droppedOff', 'attendedVisits', 'plannedVisits'].map(k => report.plans.total[k]), [2, 1, 1, 0, 5, 9])
  assert.match((await h.send(`/api/balm/reports/plans.csv?from=${shift(-5)}&to=${shift(0)}`, undefined, h.owner)).text, /"All practitioners","2","1","1","0","5","9",/)

  // Chart history: every record carries its episode and filters by it; originals reopen.
  const search = (filters, cookie = priya.cookie) => h.send('/api/balm/clients/' + patient.id + '/history?' + new URLSearchParams(filters), undefined, cookie)
  let found = await search({ historyEpisode: knee.id })
  assert.deepEqual(found.value.entries.filter(r => r.type !== 'note').map(r => r.id).sort(), [kneeDoc.id, kneePlan.id].sort())
  assert.deepEqual(found.value.entries.filter(r => r.type === 'note').map(r => r.id).length, 3)
  assert.ok(found.value.entries.every(r => r.episodeId === knee.id))
  assert.deepEqual((await search({ historyEpisode: back.id, historyType: 'imaging' })).value.entries.map(r => r.id), [backDoc.id])
  assert.deepEqual((await search({ historyEpisode: 'none', historyType: 'imaging' })).value.entries.map(r => r.id), [legacyDoc.id])
  assert.deepEqual((await search({ historyEpisode: back.id, historyType: 'plan' })).value.entries.map(r => r.id), [backPlan.id])
  assert.equal((await search({ historyEpisode: elsewhere.id })).status, 404)
  const original = await h.mf.dispatchFetch(h.origin + found.value.entries.find(r => r.id === kneeDoc.id).url, { headers: { cookie: priya.cookie } })
  assert.deepEqual(Buffer.from(await original.arrayBuffer()), (await import('./chart-document-fixtures.mjs')).mriReport())
  assert.equal((await search({ historyEpisode: knee.id }, reception.cookie)).status, 403, 'episodes add no clinical access')

  // Explicit human assignment, within the record's own patient and the person's authority.
  await h.cmd('episode.assign', { kind: 'document', recordId: legacyDoc.id, episodeId: back.id }, reception.cookie, 403)
  await h.cmd('episode.assign', { kind: 'document', recordId: legacyDoc.id, episodeId: elsewhere.id }, priya.cookie, 404)
  await h.cmd('episode.assign', { kind: 'document', recordId: legacyDoc.id, episodeId: back.id }, priya.cookie)
  await h.cmd('episode.assign', { kind: 'visit', recordId: legacyVisit, episodeId: knee.id }, reception.cookie)
  assert.deepEqual((await search({ historyEpisode: back.id, historyType: 'imaging' })).value.entries.map(r => r.id).sort(), [backDoc.id, legacyDoc.id].sort())
  assert.equal((await search({ historyEpisode: 'none', historyType: 'imaging' })).value.total, 0)
  file = await view(h, patient.id, h.owner)
  assert.deepEqual([episode(knee.id).visits.booked, episode('').visits.total], [1, 0])

  // An explicit close freezes the episode and leaves its signed records unchanged.
  const lastBack = await pastVisit(h, patient.id, priya, service.id, h.owner, 7, { episodeId: back.id, acknowledgeInsurance: 'on' })
  const signedNote = await h.cmd('note.write', { clientId: patient.id, appointmentId: lastBack, body: 'Discharge visit: independent with lumbar program.' }, priya.cookie)
  await h.cmd('note.sign', { id: signedNote.id, revision: 1, signature: 'Priya', credentials: 'PT', attest: true }, priya.cookie)
  await h.cmd('appointment.attend', { id: lastBack })
  await h.cmd('episode.close', { id: back.id, reason: 'Discharged: goals met' }, priya.cookie, 409)
  await h.cmd('appointment.cancel', { id: upcoming.appointmentId, reason: 'Patient discharged' })
  await h.cmd('episode.close', { id: back.id, reason: 'Discharged: goals met' }, priya.cookie)
  await h.cmd('episode.close', { id: back.id }, priya.cookie, 409)
  await h.cmd('episode.assign', { kind: 'document', recordId: kneeDoc.id, episodeId: back.id }, priya.cookie, 409)
  await assert.rejects(h.db.prepare('UPDATE bm_episodes SET title=? WHERE id=?').bind('Changed', back.id).run(), /episode_fixed/)
  await assert.rejects(h.db.prepare("UPDATE bm_episode_records SET episode_id=? WHERE record_kind='document' AND record_id=?").bind(knee.id, backDoc.id).run(), /episode_not_open/)
  file = await view(h, patient.id, h.owner)
  const signed = file.notes.find(n => n.id === signedNote.id)
  assert.equal(signed.status, 'signed'); assert.equal(signed.episodeId, back.id)
  assert.equal(episode(back.id).status, 'closed'); assert.equal(episode(back.id).closeReason, 'Discharged: goals met')
  // Discharged short of its planned visits with nothing booked: that episode dropped off.
  const after = (await h.send(`/api/balm/reports?from=${shift(-5)}&to=${shift(0)}`, undefined, h.owner)).value
  assert.deepEqual(['plans', 'completed', 'inProgress', 'droppedOff', 'attendedVisits', 'plannedVisits'].map(k => after.plans.total[k]), [2, 1, 0, 1, 6, 9])
  // With one episode open, new records join it without a choice.
  const later = await h.cmd('chart.document.upload', mriUpload(patient.id, shift(0)), priya.cookie)
  assert.ok((await search({ historyEpisode: knee.id, historyType: 'imaging' })).value.entries.some(r => r.id === later.id))
  const message = await h.cmd('message.send', { clientId: patient.id, body: 'Your knee program is in the portal.', delivery: 'shown' }, priya.cookie)
  assert.deepEqual((await search({ historyEpisode: knee.id, historyType: 'message' })).value.entries.map(r => r.id), [message.messageId])
  await h.cmd('client.erase', { id: other.id }, h.owner, 409)
  const audit = []; let before = ''
  do { const p = (await h.send('/api/balm/clients/' + patient.id + (before ? '?auditBefore=' + before : ''), undefined, h.owner)).value; audit.push(...p.audit); before = p.auditPage.older } while (before)
  assert.ok(audit.some(a => a.action === 'episode.assigned' && a.subject_id === legacyDoc.id && a.detail === `document: not assigned -> ${back.id}`))
  for (const action of ['episode.opened', 'episode.closed']) assert.ok(audit.some(a => a.action === action), action)
}))

test('AGENT-003: grounded pre-sign questions cite units, skilled need, plan and payer rules; clinician edits clear them without agent access', async () => {
  const { modelEdge, defensibilityClinic, weakNote, strongNote } = await import('./defensibility-clinic.mjs')
  const edge=modelEdge()
  await run(async h=>{
    const c=await defensibilityClinic(h), input={id:c.note.id,revision:1}
    const check=(cookie=c.priya.cookie,status=200)=>h.cmd('note.check',input,cookie,status)
    await check(c.priya.cookie,409)
    assert.equal(edge.seen.length,0,'no model request without a configured key')
    await h.cmd('scribe.save',{provider:'anthropic',key:'sk-ant-test-only'})
    for(const [cookie,status] of [[c.reception.cookie,403],[c.sam.cookie,404]]) await check(cookie,status)
    const agent=await h.cmd('agent.create',{label:'Desk agent'})
    assert.equal((await h.send('/api/balm/agent/command',{name:'note.check',input},'',{authorization:'Bearer '+agent.token})).status,403)
    assert.equal((await h.send('/api/balm/command',{name:'note.check',input},c.priya.cookie,{origin:'https://elsewhere.example'})).status,403)
    const first=await check()
    assert.deepEqual(first.findings.map(f=>f.kind),['units','skilled_need'])
    assert.ok(first.findings.find(f=>f.kind==='units').question.includes('fourth unit'))
    assert.ok(first.findings.every(f=>f.ruleIds.every(id=>first.rules.some(r=>r.id===id&&r.source.startsWith('https://www.cms.gov/')))))
    const sent=JSON.parse(edge.seen.at(-1).messages[0].content)
    assert.equal(sent.facts.billed.reduce((n,c)=>n+c.units,0),4)
    assert.equal(sent.facts.plan.content.shortTermGoals,'Walk 30 minutes')
    assert.ok(sent.rules.some(r=>r.id==='payer.configuration'&&r.rule.includes('Total treatment minutes')))
    assert.ok(!JSON.stringify(sent).includes('Elena')&&!JSON.stringify(sent).includes('1971-09-22')&&!JSON.stringify(sent).includes('BENEFICIARY'))
    let note=(await c.file()).notes.find(n=>n.id===c.note.id)
    assert.equal(note.status,'draft');assert.deepEqual(note.revisions[0].sections.filter(s=>Object.hasOwn(weakNote,s.id)).map(s=>s.text),Object.values(weakNote))
    assert.equal(note.defensibility.revision,1)
    const page=(await h.send(c.path,undefined,c.priya.cookie)).text
    assert.ok(page.includes(first.findings[0].question)&&page.includes('bp102c15.pdf'))
    assert.equal((await c.file(c.reception.cookie)).notes,null)
    for(const mode of ['unreachable','ungrounded','invented-evidence']) {
      edge.control.mode=mode;await check(c.priya.cookie,424)
      assert.equal((await c.file()).notes.find(n=>n.id===c.note.id).defensibility.checkedAt,first.checkedAt)
    }
    edge.control.mode='normal'
    await h.cmd('note.amend',{...chartFixture(),id:c.note.id,revision:1,sections:{...chartFixture().sections,...strongNote},charges:[{code:'97110',minutes:40,parameters:'Synthetic skilled graded loading and tactile cueing'}],totalTreatmentMinutes:40,totalTimedMinutes:40},c.priya.cookie)
    await check(c.priya.cookie,409)
    assert.ok((await h.send(c.path,undefined,c.priya.cookie)).text.includes('The draft has changed'))
    input.revision=2
    const cleared=await check()
    assert.deepEqual(cleared.findings,[])
    note=(await c.file()).notes.find(n=>n.id===c.note.id)
    assert.equal(note.billing.units,3);assert.equal(note.status,'draft');assert.equal(note.revisions.length,2)
    assert.ok((await h.send(c.path,undefined,c.priya.cookie)).text.includes('No documentation questions returned'))
    // Ten distinct treatment days trigger the source-backed progress question.
    for(let day=1;day<=10;day++) {
      const date=new Date(Date.now()+10*3600000-day*86400000).toISOString().slice(0,10)
      const visit=await pastVisit(h,c.patient.id,c.priya,c.service.id,h.owner,day+4)
      // Move the booked slot to its treatment day, retaining its distinct clinic time.
      // A fixed 10:00 slot can collide with a later pastVisit booking near midnight.
      const booked=await h.db.prepare('SELECT start_at,end_at FROM bm_appointments WHERE id=?').bind(visit).first()
      const localTime=new Date(Date.parse(booked.start_at)+10*3600000).toISOString().slice(11,23)
      const start=new Date(date+'T'+localTime+'+10:00')
      const end=new Date(+start+Date.parse(booked.end_at)-Date.parse(booked.start_at))
      await h.db.prepare('UPDATE bm_appointments SET start_at=?,end_at=? WHERE id=?').bind(start.toISOString(),end.toISOString(),visit).run()
      await h.cmd('appointment.attend',{id:visit},c.priya.cookie)
    }
    const overdue=await check()
    assert.ok(overdue.findings.some(f=>f.kind==='progress'&&f.ruleIds.includes('cms.progress')))
    const progress=await h.cmd('note.write',{...chartFixture('progress'),clientId:c.patient.id,appointmentId:c.visit,template:'pt.progress',sections:{...chartFixture('progress').sections,...strongNote,period:'Last ten treatment days'},totalTreatmentMinutes:40,totalTimedMinutes:40},c.priya.cookie)
    await h.cmd('note.sign',{id:progress.id,revision:1,signature:'Priya',attest:true},c.priya.cookie)
    const current=await check()
    assert.deepEqual(current.findings,[])
    // A payer-rule change while the model is working cannot attach obsolete findings.
    edge.control.during=async()=>{edge.control.during=null;await h.cmd('documentation.payer.save',{payerId:c.payer.id,required:['totalTreatmentMinutes','assessment','goals']})}
    await check(c.priya.cookie,409)
    assert.equal((await c.file()).notes.find(n=>n.id===c.note.id).defensibility.checkedAt,current.checkedAt)
    const audit=(await c.file(h.owner)).audit
    for(const action of ['note.read','plan.read','note.defensibility_checked']) assert.ok(audit.some(a=>a.action===action&&a.actor_email===c.priya.email))
    assert.ok(!JSON.stringify(audit).includes(weakNote.objective),'clinical text stays out of audit detail')
    await h.cmd('scribe.save',{provider:'openai',endpoint:'https://api.openai.com/v1/chat/completions',model:'test-configured-model',key:'sk-test-only'})
    assert.deepEqual((await check()).findings,[],'the configured OpenAI-compatible provider uses the same grounded result schema')
    await h.cmd('note.sign',{id:c.note.id,revision:2,signature:'Priya',attest:true},c.priya.cookie)
    await check(c.priya.cookie,409)
    assert.equal((await c.file()).notes.find(n=>n.id===c.note.id).status,'signed')
  },{outbound:edge.outbound})
  const cobEdge=modelEdge(),{cobDefensibilityJourney}=await import('./cob-defensibility-journey.mjs')
  await run(h=>cobDefensibilityJourney(h,cobEdge),{outbound:cobEdge.outbound})
})


test('CHART-008: student submission, return and supervisor co-sign lock both signatures and preserve care-team and emergency reads', () => run(async h=>{
 await h.finishSetup()
 const {service,practitioners:[priya,cover,emergency]}=await clinic(h,['Priya','Cover','Emergency'])
 await h.cmd('staff.save',{id:priya.id,name:'Priya Supervisor',email:priya.email,role:'supervisor',credentials:'PT, DPT'})
 const occupational=await h.staff('Occupational','supervisor',{discipline:'ot',credentials:'OTR/L'})
 const mismatch=await h.cmd('staff.save',{name:'Synthetic PTA',email:'synthetic-pta@clinic.example',role:'assistant',discipline:'pt',supervisorId:occupational.id},h.owner,409)
 assert.equal((await h.state()).staff.some(s=>s.email==='synthetic-pta@clinic.example'),false,'cross-discipline PTA grant is unwritten')
 assert.match(mismatch.error??mismatch.message??JSON.stringify(mismatch),/same discipline/i)
 const student=await h.staff('Student','student',{discipline:'pt',supervisorId:priya.id,credentials:'SPT'})
 await h.cmd('hours.save',{practitionerId:student.id,hours:[0,1,2,3,4,5,6].map(weekday=>({weekday,start:'00:00',end:'24:00'}))})
 const patient=await h.cmd('client.save',{firstName:'Synthetic',lastName:'Supervision',dateOfBirth:'1980-01-01'})
 await h.cmd('pay.npi.save',{staffId:priya.id,npi:'1234567893'})
 await h.cmd('insurance.settings.save',{billingNpi:'1234567893',taxId:'123456789',address:'100 Main St',city:'Austin',state:'TX',postalCode:'78701',senderId:'BALMTEST',contactName:'Jordan Clinic',contactPhone:'5125550100'})
 const payer=await h.cmd('insurance.payer.save',{name:'Supervision Health',payerId:'SYNTHETIC',receiverId:'SYNTHETIC',unitMethod:'cms',fees:[{code:'97110',cents:3500}]})
 await h.cmd('insurance.enrollment.save',{payerId:payer.id,practitionerId:priya.id,taxonomy:'225100000X',active:true})
 await h.cmd('insurance.supervision.save',{payerId:payer.id,billSupervisor:true,billable:true,minimumSupervision:'on_site'})
 const policy=await h.cmd('insurance.policy.save',{clientId:patient.id,payerId:payer.id,memberId:'synthetic-balm-2',relationship:'18',patientSex:'F',address:'200 Oak St',city:'Austin',state:'TX',postalCode:'78701',startsOn:'2020-01-01',endsOn:'2099-12-31'})
 const visit=await pastVisit(h,patient.id,student,service.id)
 await h.cmd('appointment.attend',{id:visit})
 const note=await h.cmd('note.write',{clientId:patient.id,appointmentId:visit,body:'Student clinical draft',charges:[{code:'97110',minutes:30}]},student.cookie)
 await h.cmd('scribe.save',{provider:'anthropic',key:'synthetic-balm-supervision-model'})
 const authorReview=await h.cmd('note.check',{id:note.id,revision:1},student.cookie)
 assert.ok(authorReview.rules.some(r=>r.id==='role.supervision'))
 const deadlineInput={staffId:student.id,state:'TX',hours:1,source:'Synthetic reviewed state co-signature deadline'}
 await h.cmd('supervision.deadline.save',deadlineInput,student.cookie,403)
 await h.cmd('supervision.deadline.save',deadlineInput)
 const planVisit=await pastVisit(h,patient.id,cover,service.id,h.owner,8)
 const plan=await h.cmd('plan.send',{clientId:patient.id,diagnoses:'M25.561',shortTermGoals:'Synthetic governing goal',longTermGoals:'Synthetic long-term goal',frequencyPerWeek:1,durationWeeks:2,interventions:'Synthetic governing intervention',startDate:new Date().toISOString().slice(0,10),physicianName:'Synthetic Physician',physicianEmail:'synthetic-balm-1@example.test',signature:'Cover',credentials:'PT',attest:true},cover.cookie)
 const signature={id:note.id,revision:1,signature:'Student',credentials:'SPT',attest:true}
 await h.cmd('note.submit',{...signature,signature:'Another Person'},student.cookie,400)
 if(process.env.BALM_UI_SCREENSHOTS){const {viewportProof}=await import('./viewport-proof.mjs');await viewportProof(h,[{name:'CHART-008-submission',path:'/app/clients/'+patient.id,cookie:student.cookie,selector:'select[name=planId]',open:'Review and sign'}])}
 await h.cmd('note.submit',signature,student.cookie)
 const queued=(await h.state(priya.cookie)).coSignQueue.find(n=>n.note_id===note.id)
 assert.ok(queued);assert.equal(queued.overdue,true);assert.equal(queued.deadlineRule.state,'TX')
 assert.equal(queued.due_at,new Date(Date.parse((await h.state()).appointments.find(a=>a.id===visit).end_at)+3600000).toISOString())
 let file=(await h.send('/api/balm/clients/'+patient.id,undefined,priya.cookie)).value
 assert.equal(file.plans.length,1);assert.equal(file.plans[0].id,plan.id);assert.equal(file.plans[0].content.shortTermGoals,'Synthetic governing goal')
 if(process.env.BALM_UI_SCREENSHOTS){const {viewportProof}=await import('./viewport-proof.mjs');await viewportProof(h,[
  {name:'CHART-008-deadlines',path:'/app/clinic',cookie:h.owner,selector:'form[action*="supervision.deadline.save"]'},
  {name:'CHART-008-overdue',path:'/app',cookie:priya.cookie,selector:'text=Notes awaiting your co-signature'},
  {name:'CHART-008-plan',path:'/app/clients/'+patient.id,cookie:priya.cookie,selector:'#plans'}
 ])}
 assert.equal(file.notes[0].canCosign,true);assert.equal(file.intake?.length,0);assert.equal(file.appointments.length,0)
 const supervisorReview=await h.cmd('note.check',{id:note.id,revision:1},priya.cookie)
 assert.ok(supervisorReview.rules.some(r=>r.id==='role.supervision'))
 await h.cmd('note.amend',{id:note.id,body:'Changed',revision:1},student.cookie,409)
 await h.cmd('note.cosign',{...signature,signature:'Cover',credentials:'PT'},cover.cookie,404)
 await h.cmd('note.return',{id:note.id,reason:'Clarify skilled intervention'},priya.cookie)
 assert.equal((await h.send('/api/balm/clients/'+patient.id,undefined,priya.cookie)).status,404,'return revokes submission-only access before the author edits')
 await h.cmd('note.amend',{id:note.id,revision:1,body:'Skilled student intervention with feedback',charges:[{code:'97110',minutes:30}]},student.cookie)
 await h.cmd('note.submit',{...signature,revision:2},student.cookie)
 const exact=(await h.send('/api/balm/clients/'+patient.id,undefined,priya.cookie)).value
 assert.deepEqual(exact.notes[0].revisions.map(r=>r.number),[2],'supervisor receives the submitted revision only')
 assert.equal(exact.client.email,undefined);assert.equal(exact.client.date_of_birth,undefined);assert.deepEqual(exact.episodes,[])
 const raced=await Promise.all([1,2].map(()=>h.send('/api/balm/command',{name:'note.cosign',input:{id:note.id,revision:2,signature:'Priya Supervisor',credentials:'PT, DPT',attest:true,supervisionGiven:'in_room'}},priya.cookie)))
 assert.deepEqual(raced.map(r=>r.status).sort(),[200,409])
 file=(await h.send('/api/balm/clients/'+patient.id,undefined,h.owner)).value
 const locked=file.notes.find(n=>n.id===note.id)
 assert.equal(locked.submissions[0].supervision_given,'in_room');
 assert.equal(locked.status,'signed');assert.equal(locked.signature.name,'Priya Supervisor');assert.equal(locked.submissions[0].author_name,'Student');assert.equal(locked.submissions[0].decision,'cosigned')
 assert.equal(locked.submissions.find(s=>s.revision===1).decision,'returned')
 await h.cmd('note.amend',{id:note.id,revision:2,body:'Cannot change'},student.cookie,409)
 assert.ok(!(await h.state(priya.cookie)).coSignQueue.some(n=>n.note_id===note.id))
 await h.cmd('care_team.grant',{clientId:patient.id,practitionerId:cover.id})
 assert.equal((await h.send('/api/balm/clients/'+patient.id,undefined,cover.cookie)).value.notes.find(n=>n.id===note.id).signature.name,'Priya Supervisor')
 await h.cmd('chart.break_glass',{clientId:patient.id,reason:'Emergency review for continuity of care'},emergency.cookie)
 assert.equal((await h.send('/api/balm/clients/'+patient.id,undefined,emergency.cookie)).value.notes.find(n=>n.id===note.id).submissions[0].author_name,'Student')
 await h.cmd('pay.codes.save',{appointmentId:visit,icd10:'M25.561'})
 const invoice=await h.cmd('invoice.prepare',{appointmentId:visit})
 await h.cmd('invoice.approve',{id:invoice.id})
 const biller=await h.staff('ClaimBiller','biller')
 const claim=await h.cmd('insurance.claim.prepare',{appointmentId:visit,policyId:policy.id},biller.cookie)
 assert.equal(claim.status,'ready',JSON.stringify(claim.errors))
 const claimed=(await h.send('/api/balm/clients/'+patient.id,undefined,biller.cookie)).value.insurance.claims.find(c=>c.id===claim.id)
 assert.equal(claimed.snapshot.rendering.npi,'1234567893');assert.equal(claimed.snapshot.rendering.first,'Priya');assert.equal(claimed.snapshot.rendering.last,'Supervisor')
 const batch=await h.cmd('insurance.batch.prepare',{claimIds:[claim.id]},biller.cookie)
 assert.match((await h.send('/api/balm/insurance/837P/'+batch.id,undefined,biller.cookie)).text,/NM1\*82\*1\*SUPERVISOR\*PRIYA\*\*\*\*XX\*1234567893/)
 const medicare=await h.cmd('insurance.payer.save',{name:'Synthetic Medicare',payerId:'SYNTHETICMED',receiverId:'SYNTHETICMED',medicare:true,unitMethod:'cms',fees:[{code:'97110',cents:3500},{code:'97161',cents:5000}]})
 await h.cmd('insurance.supervision.save',{payerId:medicare.id,billSupervisor:true,billable:true,minimumSupervision:'on_site'})
 await h.cmd('insurance.enrollment.save',{payerId:medicare.id,practitionerId:priya.id,taxonomy:'225100000X',active:true})
 await h.cmd('insurance.medicare.settings.save',{year:new Date().getFullYear(),therapyGroup:'pt_slp',publishedOn:new Date().getFullYear()+'-01-01',thresholdCents:248000,reviewCents:300000,source:'Synthetic published threshold for this public-door fixture'})
 await h.cmd('insurance.policy.save',{id:policy.id,clientId:patient.id,payerId:payer.id,priority:2,memberId:'synthetic-balm-2',relationship:'18',patientSex:'F',address:'200 Oak St',city:'Austin',state:'TX',postalCode:'78701',startsOn:'2020-01-01',endsOn:'2099-12-31'})
 const medicarePolicy=await h.cmd('insurance.policy.save',{clientId:patient.id,payerId:medicare.id,memberId:'synthetic-balm-3',relationship:'18',patientSex:'F',address:'200 Oak St',city:'Austin',state:'TX',postalCode:'78701',startsOn:'2020-01-01',endsOn:'2099-12-31'})
 for(const [hours,supervisionGiven] of [[4,'on_site'],[6,'in_room']]) {
  const medicareVisit=await pastVisit(h,patient.id,student,service.id,h.owner,hours)
  await h.cmd('appointment.attend',{id:medicareVisit})
  const evaluation=await h.cmd('note.write',{...chartFixture('evaluation'),clientId:patient.id,appointmentId:medicareVisit,template:'pt.evaluation',sections:{...chartFixture('evaluation').sections,diagnosis:'M25.561',subjective:'Student evaluation history',objective:'Student objective measures',assessment:'Evaluation under the therapist',goals:'Functional goal',plan:'Therapist directs the plan'},charges:[{code:'97161',minutes:20},{code:'97110',minutes:30}],totalTimedMinutes:30,totalTreatmentMinutes:50},student.cookie)
  await h.cmd('note.submit',{id:evaluation.id,revision:1,signature:'Student',credentials:'SPT',attest:true},student.cookie)
  assert.ok((await h.state(priya.cookie)).coSignQueue.some(n=>n.note_id===evaluation.id),'student evaluation reaches the co-sign queue')
  await h.cmd('note.cosign',{id:evaluation.id,revision:1,signature:'Priya Supervisor',credentials:'PT, DPT',attest:true},priya.cookie,400)
  await h.cmd('note.cosign',{id:evaluation.id,revision:1,signature:'Priya Supervisor',credentials:'PT, DPT',supervisionGiven,attest:true},priya.cookie)
  await h.cmd('pay.codes.save',{appointmentId:medicareVisit,icd10:'M25.561'})
  const i=await h.cmd('invoice.prepare',{appointmentId:medicareVisit});await h.cmd('invoice.approve',{id:i.id})
  const c=await h.cmd('insurance.claim.prepare',{appointmentId:medicareVisit,policyId:medicarePolicy.id},biller.cookie)
  if(supervisionGiven==='on_site') {
   assert.equal(c.status,'draft');assert.ok(c.errors.some(e=>e.code==='supervision_not_billable'&&e.message.includes('in the room')))
   await h.cmd('insurance.batch.prepare',{claimIds:[c.id]},biller.cookie,409)
  } else {
   assert.equal(c.status,'ready',JSON.stringify(c.errors));assert.equal(c.snapshot.rendering.npi,'1234567893')
   const b=await h.cmd('insurance.batch.prepare',{claimIds:[c.id]},biller.cookie)
   assert.match((await h.send('/api/balm/insurance/837P/'+b.id,undefined,biller.cookie)).text,/NM1\*82\*1\*SUPERVISOR\*PRIYA/)
  }
 }
 const daily=await h.staff('DailyAssistant','assistant',{discipline:'pt',supervisorId:priya.id,credentials:'PTA'})
 await h.cmd('hours.save',{practitionerId:daily.id,hours:[0,1,2,3,4,5,6].map(weekday=>({weekday,start:'00:00',end:'24:00'}))})
 const dailyPatient=await h.cmd('client.save',{firstName:'Synthetic',lastName:'Daily',dateOfBirth:'1980-01-01'})
 const dailyPolicy=await h.cmd('insurance.policy.save',{clientId:dailyPatient.id,payerId:medicare.id,memberId:'synthetic-balm-4',relationship:'18',patientSex:'F',address:'200 Oak St',city:'Austin',state:'TX',postalCode:'78701',startsOn:'2020-01-01',endsOn:'2099-12-31'})
 const dailyVisit=await pastVisit(h,dailyPatient.id,daily,service.id)
 await h.cmd('appointment.attend',{id:dailyVisit})
 const dailyNote=await h.cmd('note.write',{...chartFixture(),clientId:dailyPatient.id,appointmentId:dailyVisit,template:'pt.daily',sections:{...chartFixture().sections,subjective:'Daily symptoms',objective:'Skilled exercise',assessment:'Response',goals:'Daily function',plan:'Continue'},charges:[{code:'97110',minutes:30,parameters:'Synthetic skilled exercise parameters'}]},daily.cookie)
 const ownSignature={id:dailyNote.id,revision:1,signature:'DailyAssistant',credentials:'PTA',attest:true}
 await h.cmd('note.sign',ownSignature,daily.cookie,403)
 const ruleInput={staffId:daily.id,state:'TX',payerId:medicare.id,startsOn:'2020-01-01',endsOn:'2099-12-31',stateSource:'Synthetic reviewed state daily-note permission',payerSource:'Synthetic reviewed payer daily-note permission',attest:true}
 await h.cmd('assistant_daily.save',ruleInput,daily.cookie,403)
 const wrongPayer=await h.cmd('assistant_daily.save',{...ruleInput,payerId:''})
 const expiredRule=await h.cmd('assistant_daily.save',{...ruleInput,startsOn:'1900-01-01',endsOn:'1900-12-31'})
 for(const ruleId of [wrongPayer.id,expiredRule.id])await h.cmd('note.sign',{...ownSignature,ruleId},daily.cookie,403)
 const rule=await h.cmd('assistant_daily.save',ruleInput)
 await h.cmd('note.sign',{...ownSignature,ruleId:'missing'},daily.cookie,403)
 if(process.env.BALM_UI_SCREENSHOTS){const {viewportProof}=await import('./viewport-proof.mjs');await viewportProof(h,[{name:'CHART-008-assistant-rule',path:'/app/clinic',cookie:h.owner,selector:'form[action*="assistant_daily.save"]'},{name:'CHART-008-assistant-sign',path:'/app/clients/'+dailyPatient.id,cookie:daily.cookie,open:'Sign daily note under a recorded rule'}])}
 await h.cmd('note.sign',{...ownSignature,ruleId:rule.id},daily.cookie)
 const signedDaily=(await h.send('/api/balm/clients/'+dailyPatient.id,undefined,h.owner)).value.notes.find(n=>n.id===dailyNote.id)
 assert.equal(signedDaily.signature.name,'DailyAssistant');assert.equal(signedDaily.status,'signed');assert.equal(signedDaily.assistantDaily.rule.id,rule.id)
 await h.cmd('note.amend',{id:dailyNote.id,revision:1,body:'Cannot rewrite'},daily.cookie,409)
 assert.ok((await h.state(priya.cookie)).coSignQueue.some(n=>n.note_id===dailyNote.id&&n.kind==='supervision_details'))
 await h.cmd('pay.codes.save',{appointmentId:dailyVisit,icd10:'M25.561'})
 const dailyInvoice=await h.cmd('invoice.prepare',{appointmentId:dailyVisit});await h.cmd('invoice.approve',{id:dailyInvoice.id})
 const unreviewed=await h.cmd('insurance.claim.prepare',{appointmentId:dailyVisit,policyId:dailyPolicy.id},biller.cookie)
 assert.notEqual(unreviewed.status,'ready','an assistant signature alone never proves billable supervision')
 await h.cmd('insurance.batch.prepare',{claimIds:[unreviewed.id]},biller.cookie,409)
 const endorsement={id:dailyNote.id,signature:'Priya Supervisor',credentials:'PT',supervisionGiven:'on_site',attest:true}
 await h.cmd('note.supervision',endorsement,cover.cookie,404)
 await h.cmd('note.supervision',endorsement,priya.cookie)
 await h.cmd('note.supervision',endorsement,priya.cookie,409)
 const finalDaily=(await h.send('/api/balm/clients/'+dailyPatient.id,undefined,priya.cookie)).value.notes.find(n=>n.id===dailyNote.id)
 assert.equal(finalDaily.signature.sha256,signedDaily.signature.sha256,'supervision attestation cannot rewrite the assistant signature')
 assert.equal(finalDaily.assistantDaily.endorsement.supervisor_name,'Priya Supervisor')
 const dailyClaim=await h.cmd('insurance.claim.scrub',{id:unreviewed.id},biller.cookie)
 assert.equal(dailyClaim.status,'ready',JSON.stringify(dailyClaim.errors));assert.equal((await h.send('/api/balm/clients/'+dailyPatient.id,undefined,biller.cookie)).value.insurance.claims.find(c=>c.id===unreviewed.id).snapshot.rendering.npi,'1234567893')
 await h.cmd('assistant_daily.revoke',{id:rule.id})
 assert.ok(!(await h.state(daily.cookie)).assistantDailyRules.some(r=>r.id===rule.id))
 const laterDailyVisit=await pastVisit(h,dailyPatient.id,daily,service.id,h.owner,4)
 const laterDaily=await h.cmd('note.write',{...chartFixture(),clientId:dailyPatient.id,appointmentId:laterDailyVisit,template:'pt.daily',sections:{...chartFixture().sections,subjective:'Later history',objective:'Later skilled work',assessment:'Response',goals:'Function',plan:'Continue'}},daily.cookie)
 await h.cmd('note.sign',{...ownSignature,id:laterDaily.id,ruleId:rule.id},daily.cookie,403)
 assert.equal((await h.send('/api/balm/clients/'+dailyPatient.id,undefined,h.owner)).value.notes.find(n=>n.id===dailyNote.id).signature.sha256,signedDaily.signature.sha256)
 const audit=(await h.db.prepare('SELECT action,actor_email FROM bm_audit WHERE client_id=?').bind(patient.id).all()).results
 for(const action of ['plan.read','note.submitted','note.returned','note.signed','note.read','note.break_glass_read']) assert.ok(audit.some(a=>a.action===action),action)
},{outbound:supervisionModelEdge().outbound,browserHttps:!!process.env.BALM_UI_SCREENSHOTS}))

test('CHART-002: PT, OT and SLP complete signed episodes, carry only earlier episode facts, and preserve signed custom template versions', () => run(async h => {
  const { customizedTemplateJourney } = await import('./chart-template-journey.mjs')
  await customizedTemplateJourney(h)
},{browserHttps:!!process.env.BALM_UI_SCREENSHOTS}))
