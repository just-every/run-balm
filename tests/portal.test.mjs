import { test } from 'node:test'
import assert from 'node:assert/strict'
import { harness } from './harness.mjs'
import { clinic, pastVisit } from './clinic.mjs'

// One clinical journey through the actual staff and patient doors. The harness
// fakes only the external mail provider, never patient authentication or D1.
test('PORTAL-003 CHART-009: a clinician assigns an illustrated home exercise, the signed-in patient opens and completes it, and the chart shows adherence', { timeout: 120_000 }, async () => {
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
    // PORTAL-003: the patient uploads an original photo through the real
    // multipart portal door. Content and filenames stay out of notices/audit.
    const photoBytes = Buffer.from(png.split(',')[1], 'base64')
    const upload = async (path, fields, cookie, filename = 'shoulder-photo.png', bytes = photoBytes, mime = 'image/png') => {
      const body = new FormData()
      for (const [key, value] of Object.entries(fields)) body.set(key, value)
      body.set('attachment', new File([bytes], filename, { type: mime }))
      const encoded = new Request(h.origin + path, { method: 'POST', body })
      return h.mf.dispatchFetch(h.origin + path, { method: 'POST', headers: { origin: h.origin, cookie, 'content-type': encoded.headers.get('content-type') }, body: new Uint8Array(await encoded.arrayBuffer()), redirect: 'manual' })
    }
    const patientText = 'My shoulder has been sore after the new exercise.'
    let submitted = await upload('/portal/action', { name: 'message.send', recipient: priya.id, body: patientText, clientId: foreign.id }, patientCookie)
    assert.equal(submitted.status, 303, await submitted.text())
    let clinicalFile = (await h.send('/api/balm/clients/' + client.id, undefined, priya.cookie)).value
    const patientMessage = clinicalFile.messages.messages.find(m => m.body === patientText)
    assert.equal(patientMessage.practitionerId, priya.id)
    assert.equal(patientMessage.attachments.length, 1)
    const original = patientMessage.attachments[0]
    const automatic = clinicalFile.messages.messages.filter(m => m.automated && m.replyTo === patientMessage.id)
    assert.equal(automatic.length, 1)
    assert.match(automatic[0].body, /911/)
    assert.ok((await h.send('/portal/home', undefined, patientCookie)).text.includes(automatic[0].body))
    const clinicNotice = h.mail.filter(m => m.subject === 'A secure message needs your attention')
    assert.ok(clinicNotice.some(m => m.to.includes('priya@clinic.example')))
    assert.ok(clinicNotice.every(m => !m.to.includes('rosa@clinic.example') && !m.text.includes(patientText) && !m.html.includes('shoulder-photo')))
    const history=await h.send('/api/balm/clients/'+client.id+'/history?historyType=message_attachment&historyText=shoulder-photo',undefined,priya.cookie)
    assert.equal(history.status,200,history.text)
    assert.deepEqual(history.value.entries.map(r=>r.id),[original.id])
    const downloadPath = '/api/balm/messages/attachments/' + original.id
    assert.equal((await h.send(downloadPath)).status, 401)
    assert.equal((await h.send(downloadPath, undefined, reception.cookie)).status, 404)
    assert.equal((await h.send(downloadPath, undefined, other.cookie)).status, 404)
    assert.equal((await h.send('/api/balm/clients/'+client.id+'/history?historyType=message_attachment&historyText=shoulder-photo',undefined,other.cookie)).status,404)
    const download = await h.mf.dispatchFetch(h.origin + downloadPath, { headers: { cookie: priya.cookie } })
    assert.equal(download.status, 200)
    assert.equal(download.headers.get('cache-control'), 'no-store')
    assert.match(download.headers.get('content-disposition'), /^attachment;/)
    assert.deepEqual(Buffer.from(await download.arrayBuffer()), photoBytes)
    const patientDownload = await h.mf.dispatchFetch(h.origin + '/portal/messages/attachments/' + original.id, { headers: { cookie: patientCookie } })
    assert.equal(patientDownload.status, 200)
    assert.deepEqual(Buffer.from(await patientDownload.arrayBuffer()), photoBytes)

    // A clinic reply also stores an original attachment and stays in the same destination.
    const clinicReply = 'Pause that exercise until we review it at your next visit.'
    submitted = await upload('/app/action?name=message.send&returnTo=' + encodeURIComponent('/app/clients/' + client.id),
      { clientId: client.id, replyTo: patientMessage.id, body: clinicReply, delivery: 'shown' }, priya.cookie, 'exercise-guide.png')
    assert.equal(submitted.status, 200, await submitted.text())
    clinicalFile = (await h.send('/api/balm/clients/' + client.id, undefined, priya.cookie)).value
    const replyMessage = clinicalFile.messages.messages.find(m => m.body === clinicReply)
    assert.equal(replyMessage.replyTo, patientMessage.id)
    assert.equal(replyMessage.attachments.length, 1)
    const clinicalLink = await h.cmd('message.link', { clientId: client.id, delivery: 'shown' }, priya.cookie)
    const clinicalPath = new URL(clinicalLink.url).pathname
    const linkedDownload = await h.mf.dispatchFetch(h.origin + clinicalPath + '/attachments/' + original.id)
    assert.equal(linkedDownload.status, 200)
    assert.deepEqual(Buffer.from(await linkedDownload.arrayBuffer()), photoBytes)

    // Routing excludes the reception user from all clinical content, including
    // attachment metadata and private credentials, and delivers administrative messages to them.
    const deskText = 'Could you send a receipt for my last visit?'
    submitted = await upload('/portal/action', { name: 'message.send', recipient: 'front_desk', body: deskText }, patientCookie, 'receipt-question.png')
    assert.equal(submitted.status, 303, await submitted.text())
    const desk = (await h.send('/api/balm/clients/' + client.id, undefined, reception.cookie)).value.messages
    assert.ok(desk.messages.some(m => m.body === deskText))
    assert.ok(desk.messages.every(m => m.route === 'front_desk'))
    assert.ok(!JSON.stringify(desk).includes(patientText) && !JSON.stringify(desk).includes(original.id))
    const deskMessage = desk.messages.find(m => m.body === deskText)
    assert.ok(h.mail.some(m => m.subject === 'A secure message needs your attention' && m.to.includes('rosa@clinic.example')))
    const deskReply = await h.cmd('message.send', { clientId: client.id, replyTo: deskMessage.id, body: 'Your receipt is in the statements section.', delivery: 'shown' }, reception.cookie)
    const deskPath = new URL(deskReply.url).pathname
    const deskPage = await h.send(deskPath)
    assert.ok(deskPage.text.includes(deskText) && !deskPage.text.includes(patientText))
    assert.equal((await h.send(deskPath + '/attachments/' + original.id)).status, 404)
    assert.equal((await h.send('/api/balm/messages/attachments/' + deskMessage.attachments[0].id, undefined, reception.cookie)).status, 200)
    assert.equal((await h.send('/api/balm/messages/attachments/' + deskMessage.attachments[0].id, undefined, priya.cookie)).status, 404)
    await h.cmd('message.send', { clientId: client.id, replyTo: patientMessage.id, body: 'Forbidden clinical reply', delivery: 'shown' }, reception.cookie, 404)
    await h.cmd('message.revoke', { clientId: client.id }, reception.cookie)
    assert.equal((await h.send(deskPath)).status, 404)
    assert.equal((await h.send(clinicalPath)).status, 200, 'reception cannot revoke practitioner credentials')
    assert.ok(!(await h.send('/api/balm/clients/' + client.id, undefined, priya.cookie)).value.messages.messages.some(m => m.body === deskText))

    // Two treating practitioners still have separate clinical destinations.
    await pastVisit(h, client.id, other, service.id, h.owner, 8)
    assert.equal((await h.form('/portal/action', { name: 'message.send', recipient: other.id, body: 'A private question for my second practitioner.' }, patientCookie)).status, 303)
    const secondThread = (await h.send('/api/balm/clients/' + client.id, undefined, other.cookie)).value.messages
    assert.ok(secondThread.messages.some(m => m.body === 'A private question for my second practitioner.'))
    assert.ok(!JSON.stringify(secondThread).includes(patientText))
    assert.equal((await h.send(downloadPath, undefined, other.cookie)).status, 404)
    const otherHistory=await h.send('/api/balm/clients/'+client.id+'/history?historyType=message_attachment&historyText=shoulder-photo',undefined,other.cookie)
    assert.equal(otherHistory.status,200,otherHistory.text);assert.equal(otherHistory.value.total,0)
    const unrelated = await h.staff('Morgan')
    assert.equal((await h.form('/portal/action', { name: 'message.send', recipient: unrelated.id, body: 'Not assigned to this patient.' }, patientCookie)).status, 404)
    const countBefore = (await h.send('/api/balm/clients/' + client.id, undefined, h.owner)).value.messages.messages.length
    submitted = await upload('/portal/action', { name: 'message.send', recipient: priya.id, body: 'Invalid file is not retained.' }, patientCookie, 'bad.png', Buffer.from('This is not an image file.'), 'image/png')
    assert.equal(submitted.status, 400, await submitted.text())
    assert.equal((await h.send('/api/balm/clients/' + client.id, undefined, h.owner)).value.messages.messages.length, countBefore)
    await assert.rejects(h.db.prepare('UPDATE bm_message_attachments SET filename=? WHERE id=?').bind('changed.png', original.id).run())
    await assert.rejects(h.db.prepare('UPDATE bm_messages SET route=? WHERE id=?').bind('front_desk', patientMessage.id).run())
    await assert.rejects(h.db.prepare('DELETE FROM bm_messages WHERE id=?').bind(automatic[0].id).run())

    // A different authenticated patient cannot fetch the uploaded original.
    await h.form('/portal', { email: 'una@patient.example' })
    const otherNotice = h.mail.findLast(m => m.to.includes('una@patient.example') && m.text.includes('/portal/confirm?token='))
    const otherToken = new URL(otherNotice.text.match(/https?:\/\/[^\s]+\/portal\/confirm\?token=[^\s]+/)[0]).searchParams.get('token')
    const otherSignin = await h.mf.dispatchFetch(h.origin + '/portal/confirm', { method: 'POST', headers: { origin: h.origin, 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ token: otherToken }), redirect: 'manual' })
    const otherCookie = otherSignin.headers.get('set-cookie').split(';')[0]
    assert.equal((await h.send('/portal/messages/attachments/' + original.id, undefined, otherCookie)).status, 404)
    await h.cmd('message.revoke', { clientId: client.id }, priya.cookie)
    assert.equal((await h.send(clinicalPath + '/attachments/' + original.id)).status, 404)
    const statement = await h.send('/portal/statement.pdf', undefined, patientCookie)
    assert.equal(statement.status, 200); assert.match(statement.text, /^%PDF/)
    assert.equal((await h.form('/portal/signout', {}, patientCookie)).status, 303)
    assert.equal((await h.send('/portal/home', undefined, patientCookie)).status, 303)
    const audit = []
    let before = ''
    do {
      const auditFile = (await h.send('/api/balm/clients/' + client.id + (before ? '?auditBefore=' + before : ''), undefined, h.owner)).value
      audit.push(...auditFile.audit)
      before = auditFile.auditPage.older
    } while (before)
    for (const action of ['message.sent', 'message.read', 'message.auto_replied', 'message.attachment_added', 'message.attachment_downloaded']) assert.ok(audit.some(a => a.action === action), action)
    assert.ok(!JSON.stringify(audit).includes(patientText) && !JSON.stringify(audit).includes('shoulder-photo.png'))
    for (const action of ['exercise.assigned', 'exercise.seen', 'exercise.done', 'exercise.adherence_read']) assert.ok(audit.some(a => a.action === action), action)
    assert.ok(!JSON.stringify(audit).includes('Straighten your knee'))
  } finally { await h.close() }
})
