// Charting through the public doors: discipline templates, sign and lock,
// addenda, the physician-certified plan of care, CPT units by the 8-minute rule
// carried to the invoice, and the scribe with its model faked at the network edge.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { run } from './harness.mjs'
import { clinic, pastVisit } from './clinic.mjs'

const daily = { subjective: 'Knee pain 4/10 after stairs; HEP daily.', objective: 'Ther ex 25 min: step-ups 2x12. Flexion 118 deg.', assessment: 'Improving tolerance to stairs.', plan: 'Progress step height.' }
const view = async (h, clientId, cookie) => (await h.send('/api/balm/clients/' + clientId, undefined, cookie)).value

test('a note starts from the visit’s template, is signed and locked, takes addenda, and the plan of care is certified from the physician’s link', () => run(async h => {
  await h.finishSetup()
  const { service, practitioners: [priya, sam] } = await clinic(h, ['Priya', 'Sam'])
  const reception = await h.staff('Rosa', 'reception')
  await h.cmd('service.save', { id: service.id, name: 'Initial consultation', durationMinutes: 45, priceCents: 9500, noteTemplate: 'pt.daily' })
  await h.cmd('staff.save', { id: priya.id, name: 'Priya', email: priya.email, role: 'practitioner', credentials: 'PT, DPT', active: true })
  const client = await h.cmd('client.save', { firstName: 'Noah', lastName: 'Kim', dateOfBirth: '1979-11-30' }, reception.cookie)
  const visit = await pastVisit(h, client.id, priya, service.id, reception.cookie)
  await pastVisit(h, client.id, sam, service.id, reception.cookie, 5)
  await h.cmd('appointment.attend', { id: visit }, priya.cookie)
  assert.match((await h.send('/app', undefined, priya.cookie)).text, /Notes to sign[\s\S]*No note yet/)

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

  // Signed is locked, in the handler and in the database; changes become signed addenda.
  await h.cmd('note.amend', { id: note.id, revision: 2, sections: daily }, priya.cookie, 409)
  await sign({ revision: 2 }, priya.cookie, 409)
  assert.match(String(await h.db.prepare("INSERT INTO bm_note_revisions(note_id,number,body,written_at) VALUES(?,3,'x','now')").bind(note.id).run().catch(e => e.message)), /note_locked/)
  await h.cmd('note.addendum', { id: note.id, body: 'Late entry: patient reported mild swelling after the session.' }, sam.cookie, 404)
  await h.cmd('note.addendum', { id: note.id, body: 'Late entry: patient reported mild swelling after the session.' }, priya.cookie)
  const own = (await view(h, client.id, priya.cookie)).notes[0]
  assert.equal(own.status, 'signed'); assert.equal(own.signature.revision, 2); assert.equal(own.addenda.length, 1)
  assert.deepEqual(own.revisions[0].sections.map(s => s.label), ['Subjective', 'Objective measures', 'Assessment', 'Goal progress', 'Plan'])
  assert.match((await h.send('/app', undefined, priya.cookie)).text, /All 1 note signed/)
  const desk = await h.state(reception.cookie)
  assert.equal(desk.appointments.find(a => a.id === visit).note_status, 'signed')
  assert.ok(!JSON.stringify(desk).includes('Knee pain'))

  // The plan of care goes to the referring physician, who signs from the link without an account.
  const plan = await h.cmd('plan.send', { clientId: client.id, diagnoses: 'M22.2X1 Patellofemoral disorders, right knee', shortTermGoals: 'Stairs reciprocally in 3 weeks', longTermGoals: 'Return to running 5 km pain-free',
    frequencyPerWeek: 2, durationWeeks: 6, interventions: '97110, 97140, home program', startDate: '2026-10-19', physicianName: 'Dr. Anika Patel', physicianEmail: 'apatel@referrer.example', signature: 'Priya', attest: true }, priya.cookie)
  assert.equal(plan.mail, 'sent')
  const mail = (await h.db.prepare('SELECT message FROM rer_mail_development_outbox').all()).results.map(r => JSON.parse(r.message)).find(m => m.to.includes('apatel@referrer.example'))
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
  assert.match((await h.send('/app', undefined, reception.cookie)).text, /Plan of care signed by Dr\. Anika Patel/)
  const audit = (await view(h, client.id, h.owner)).audit
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
