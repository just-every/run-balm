import { test } from 'node:test'
import assert from 'node:assert/strict'
import { harness } from './harness.mjs'
import { clinic, pastVisit } from './clinic.mjs'

// One clinical journey through the actual staff and patient doors. The harness
// fakes only the external mail provider, never patient authentication or D1.
test('a clinician assigns an illustrated home exercise, the signed-in patient opens and completes it, and the chart shows adherence', { timeout: 120_000 }, async () => {
  const h = await harness()
  try {
    await h.finishSetup()
    const { service, practitioners: [priya, other] } = await clinic(h, ['Priya', 'Evan'])
    const reception = await h.staff('Rosa', 'reception')
    const client = await h.cmd('client.save', { firstName: 'Ava', lastName: 'Ng', email: 'ava@patient.example' })
    const foreign = await h.cmd('client.save', { firstName: 'Una', lastName: 'Other', email: 'una@patient.example' })
    await pastVisit(h, client.id, priya, service.id)
    await pastVisit(h, foreign.id, other, service.id)
    const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jEAAAAABJRU5ErkJggg=='
    const exercise = await h.cmd('exercise.assign', { clientId: client.id, title: 'Seated knee extension', sets: 3, reps: '10 each side', instructions: 'Straighten your knee slowly. Pause, then lower. Stop if painful.', image: png }, priya.cookie)
    const second = await h.cmd('exercise.assign', { clientId: foreign.id, title: 'Private other exercise', sets: 2, reps: 5, instructions: 'Other patient instructions.' }, other.cookie)
    assert.ok(second.id)
    await h.cmd('exercise.assign', { clientId: client.id, title: 'Refused', sets: 1, reps: '1', instructions: 'No clinical access.' }, reception.cookie, 403)
    await h.cmd('exercise.assign', { clientId: client.id, title: 'Refused', sets: 1, reps: '1', instructions: 'Not this practitioner’s client.' }, other.cookie, 404)
    assert.equal((await h.send('/portal/home', undefined, h.owner)).status, 303)
    const requested = await h.form('/portal', { email: 'AVA@patient.example' })
    assert.equal(requested.status, 200, requested.text)
    const message = h.mail.findLast(m => m.to.includes('ava@patient.example') && m.text.includes('/portal/confirm?token='))
    assert.ok(message)
    assert.ok(!message.text.includes('Seated knee') && !message.text.includes('Ava'))
    const link = new URL(message.text.match(/https?:\/\/[^\s]+\/portal\/confirm\?token=[^\s]+/)[0])
    const confirmation = link.pathname + link.search
    assert.equal((await h.send(confirmation)).status, 200)
    // Opening the mailed GET repeatedly must not use the token (mail scanners do this).
    assert.equal((await h.send(confirmation)).status, 200)
    const confirmed = await h.mf.dispatchFetch(h.origin + '/portal/confirm', { method: 'POST', headers: { origin: h.origin, 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ token: link.searchParams.get('token') }), redirect: 'manual' })
    assert.equal(confirmed.status, 303, await confirmed.text())
    const cookie = confirmed.headers.get('set-cookie')
    assert.match(cookie, /HttpOnly/); assert.match(cookie, /SameSite=Lax/); assert.match(cookie, /Secure/)
    const patientCookie = cookie.split(';')[0]
    assert.equal((await h.form('/portal/confirm', { token: link.searchParams.get('token') })).status, 410)
    assert.equal((await h.send('/api/balm/state', undefined, patientCookie)).status, 401)
    let page = await h.send('/portal/home', undefined, patientCookie)
    assert.equal(page.status, 200, page.text)
    assert.match(page.text, /Seated knee extension/); assert.match(page.text, /10 each side/)
    assert.ok(page.text.includes(png)); assert.ok(!page.text.includes('Private other exercise'))
    assert.ok(!page.text.includes('una@patient.example'))
    assert.equal((await h.form('/portal/action', { name: 'exercise.seen', id: second.id }, patientCookie)).status, 404)
    assert.equal((await h.form('/portal/action', { name: 'exercise.seen', id: exercise.id }, patientCookie)).status, 303)
    assert.equal((await h.form('/portal/action', { name: 'exercise.done', id: exercise.id }, patientCookie)).status, 303)
    assert.equal((await h.form('/portal/action', { name: 'exercise.done', id: exercise.id }, patientCookie)).status, 303)
    const file = await h.send('/api/balm/clients/' + client.id, undefined, priya.cookie)
    assert.equal(file.status, 200, file.text)
    const assigned = file.value.homeExercises.find(e => e.id === exercise.id)
    assert.ok(assigned.seenAt); assert.ok(assigned.doneAt); assert.equal(assigned.doneDates.length, 1)
    const deskFile = await h.send('/api/balm/clients/' + client.id, undefined, reception.cookie)
    assert.equal(deskFile.value.homeExercises, null)
    const statement = await h.send('/portal/statement.pdf', undefined, patientCookie)
    assert.equal(statement.status, 200); assert.match(statement.text, /^%PDF/)
    assert.equal((await h.form('/portal/signout', {}, patientCookie)).status, 303)
    assert.equal((await h.send('/portal/home', undefined, patientCookie)).status, 303)
    const audit = (await h.send('/api/balm/clients/' + client.id, undefined, h.owner)).value.audit
    for (const action of ['exercise.assigned', 'exercise.seen', 'exercise.done', 'exercise.adherence_read']) assert.ok(audit.some(a => a.action === action), action)
    assert.ok(!JSON.stringify(audit).includes('Straighten your knee'))
  } finally { await h.close() }
})
