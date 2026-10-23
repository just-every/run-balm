import { portalLogin } from './portal-billing.mjs'
import { viewportProof } from './viewport-proof.mjs'
import { mkdir, writeFile } from 'node:fs/promises'
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


test('patient record requests keep a 30-day deadline, release exact reviewed originals, and isolate every download', {timeout:120_000}, async () => {
  const h=await harness({browserHttps:!!process.env.BALM_UI_SCREENSHOTS})
  try {
    await h.finishSetup()
    const {service,practitioners:[priya]}=await clinic(h)
    const desk=await h.staff('Rosa','reception')
    const patient=await h.cmd('client.save',{firstName:'Marisol',lastName:'Diaz',dateOfBirth:'1980-03-07',email:'marisol@patient.example'})
    const other=await h.cmd('client.save',{firstName:'Una',lastName:'Other',email:'una@patient.example'})
    const visit=await pastVisit(h,patient.id,priya,service.id)
    await h.cmd('note.write',{clientId:patient.id,appointmentId:visit,body:'Patient record narrative: knee improving.'},priya.cookie)
    const patientCookie=await portalLogin(h,'marisol@patient.example'),otherCookie=await portalLogin(h,'una@patient.example')
    assert.equal((await h.form('/portal/action',{name:'record.request',clientId:other.id},patientCookie)).status,303)
    assert.equal((await h.form('/portal/action',{name:'record.request'},patientCookie)).status,303)
    let state=await h.state(), request=state.recordRequests.find(r=>r.client_id===patient.id)
    assert.equal(state.recordRequests.length,1,'repeat request reuses the outstanding request')
    assert.equal(Date.parse(request.due_at)-Date.parse(request.requested_at),30*86400_000)
    assert.equal((await h.state(desk.cookie)).recordRequests.length,0)
    assert.match((await h.send('/app',undefined,h.owner)).text,/Patient record requests/)
    assert.ok(!(await h.send('/app',undefined,desk.cookie)).text.includes('Patient record requests'))
    await h.cmd('record.prepare',{id:request.id},priya.cookie,403)
    await h.cmd('record.prepare',{id:request.id},desk.cookie,403)
    const prepared=await h.cmd('record.prepare',{id:request.id})
    assert.equal((await h.send('/portal/records/'+request.id+'.json',undefined,patientCookie)).status,404)
    const pdf=await h.send('/api/balm/records/'+prepared.packageId+'.pdf',undefined,h.owner)
    assert.equal(pdf.status,200,pdf.text);assert.match(pdf.text,/^%PDF/);assert.match(pdf.text,/Patient record narrative/)
    const fhir=await h.send('/api/balm/records/'+prepared.packageId+'.json',undefined,h.owner)
    assert.equal(fhir.status,200,fhir.text);assert.equal(fhir.headers.get('cache-control'),'no-store')
    assert.match(fhir.headers.get('content-type'),/application\/fhir\+json/)
    assert.equal(fhir.value.resourceType,'Bundle')
    assert.deepEqual(fhir.value.entry.filter(e=>e.resource.resourceType==='Patient').map(e=>e.resource.id),[patient.id])
    assert.ok(!fhir.text.includes('una@patient.example')&&!fhir.text.includes('token_hash')&&!fhir.text.includes('SESSION_SECRET'))
    const note=fhir.value.entry.find(e=>e.resource.type?.coding?.some(c=>c.code==='11506-3'))
    assert.match(Buffer.from(note.resource.content[0].attachment.data,'base64').toString(),/knee improving/)
    assert.equal((await h.send('/api/balm/records/'+prepared.packageId+'.json',undefined,priya.cookie)).status,403)
    await h.cmd('record.release',{id:request.id,packageId:prepared.packageId,sha256:prepared.sha256},h.owner,400)
    await h.cmd('record.release',{id:request.id,packageId:prepared.packageId,sha256:'0'.repeat(64),confirm:true},h.owner,409)
    await viewportProof(h,[{name:'record-requested',path:'/portal/home',cookie:patientCookie,selector:'#records'},
      {name:'record-review',path:'/app',cookie:h.owner,selector:'#record-requests',tooltips:['Previous day','Next day']}])
    await h.cmd('record.release',{id:request.id,packageId:prepared.packageId,sha256:prepared.sha256,confirm:true})
    assert.equal((await h.send('/portal/records/'+request.id+'.json',undefined,otherCookie)).status,404)
    assert.equal((await h.send('/portal/records/'+request.id+'.json',undefined,h.owner)).status,303)
    for(const [extension,original] of [['pdf',pdf],['json',fhir]]) {
      const downloaded=await h.send('/portal/records/'+request.id+'.'+extension,undefined,patientCookie)
      assert.equal(downloaded.status,200);assert.equal(downloaded.text,original.text)
      assert.equal(downloaded.headers.get('cache-control'),'no-store')
    }
    // A later clinical change never alters the released originals.
    await h.cmd('note.write',{clientId:patient.id,appointmentId:visit,body:'Later record update.'},priya.cookie)
    assert.equal((await h.send('/portal/records/'+request.id+'.json',undefined,patientCookie)).text,fhir.text)
    await h.cmd('record.release',{id:request.id,packageId:prepared.packageId,sha256:prepared.sha256,confirm:true},h.owner,409)
    await assert.rejects(h.db.prepare("UPDATE bm_record_parts SET content='changed' WHERE package_id=?").bind(prepared.packageId).run())
    await assert.rejects(h.db.prepare('DELETE FROM bm_record_requests WHERE id=?').bind(request.id).run())
    const released=(await h.state()).recordRequests[0]
    assert.ok(released.released_at);assert.equal(released.package_id,prepared.packageId)
    await viewportProof(h,[{name:'record-released',path:'/portal/home',cookie:patientCookie,selector:'#records'}])
    if(process.env.BALM_RECORD_EXPORT){await mkdir(process.env.BALM_RECORD_EXPORT,{recursive:true});await writeFile(process.env.BALM_RECORD_EXPORT+'/record.json',fhir.text);await writeFile(process.env.BALM_RECORD_EXPORT+'/record.pdf',Buffer.from(pdf.text,'binary'))}
    const events=(await h.db.prepare("SELECT action,detail FROM bm_audit WHERE client_id=? AND action LIKE 'record.%'").bind(patient.id).all()).results
    for(const name of ['record.requested','record.prepared','record.released','record.downloaded'])assert.ok(events.some(r=>r.action===name),name)
    assert.ok(!JSON.stringify(events).includes('knee improving'))
    await h.cmd('client.save',{id:patient.id,firstName:'Marisol',lastName:'Diaz',email:'new@patient.example'})
    assert.equal((await h.send('/portal/records/'+request.id+'.json',undefined,patientCookie)).status,303,'a changed identity revokes access to prior releases')
  } finally {await h.close()}
})


test('a verified guardian switches between two minors without seeing unrelated records and submitted insurance is audited without changing verified coverage', {timeout:120000}, async()=>{
 const h=await harness({browserHttps:!!process.env.BALM_UI_SCREENSHOTS})
 try{
  await h.finishSetup()
  const {service,practitioners:[priya]}=await clinic(h)
  const child1=await h.cmd('client.save',{firstName:'Lucia',lastName:'Diaz',dateOfBirth:'2014-03-07',email:'lucia@patient.example'})
  const child2=await h.cmd('client.save',{firstName:'Mateo',lastName:'Diaz',dateOfBirth:'2016-09-12',email:'mateo@patient.example'})
  const foreign=await h.cmd('client.save',{firstName:'Una',lastName:'Other',dateOfBirth:'2015-01-01',email:'una@patient.example'})
  const adult=await h.cmd('client.save',{firstName:'Adult',lastName:'Patient',dateOfBirth:'1980-01-01'})
  for(const [i,child] of [child1,child2,foreign].entries()){
   await pastVisit(h,child.id,priya,service.id,h.owner,2+i*3)
   await h.cmd('exercise.assign',{clientId:child.id,title:child.id===child1.id?'Lucia home task':child.id===child2.id?'Mateo home task':'Unrelated private program',sets:1,reps:'5',instructions:'Follow the clinician instructions.'},priya.cookie)
  }
  const future=await h.cmd('appointment.book',{clientId:child1.id,practitionerId:priya.id,serviceId:service.id,date:new Date(Date.now()+2*86400_000+10*3600_000).toISOString().slice(0,10),time:'10:00'})
  const grant={email:'guardian@family.example',name:'Alex Diaz',relationship:'parent',verification:'Synthetic guardian authority checked and confidential-care restrictions reviewed.',verified:true}
  await h.cmd('guardian.grant',{...grant,clientId:child1.id},priya.cookie,403)
  await h.cmd('guardian.grant',{...grant,clientId:child1.id,verified:false},h.owner,400)
  await h.cmd('guardian.grant',{...grant,clientId:adult.id},h.owner,409)
  const first=await h.cmd('guardian.grant',{...grant,clientId:child1.id})
  await h.cmd('guardian.grant',{...grant,clientId:child2.id})
  const cookie=await portalLogin(h,'guardian@family.example')
  assert.equal((await h.send('/api/balm/state',undefined,cookie)).status,401)
  assert.equal((await h.form('/portal/action',{name:'guardian.select',id:foreign.id},cookie)).status,404)
  for(const child of [child1,child2]){
   assert.equal((await h.form('/portal/action',{name:'guardian.select',id:child.id},cookie)).status,303)
   const home=await h.send('/portal/home',undefined,cookie)
   assert.equal(home.status,200,home.text)
   assert.match(home.text,new RegExp(child.id===child1.id?'Lucia home task':'Mateo home task'))
   assert.ok(!home.text.includes(child.id===child1.id?'Mateo home task':'Lucia home task'))
   assert.ok(!home.text.includes('Unrelated private program')&&!home.text.includes('una@patient.example'))
  }
  await h.form('/portal/action',{name:'guardian.select',id:child1.id},cookie)
  const opened=await h.form('/portal/action',{name:'intake.open',appointmentId:future.appointmentId},cookie)
  assert.equal(opened.status,303)
  const intake=await h.send(opened.location)
  const accepted=Object.fromEntries([...intake.text.matchAll(/name="(consentVersion[^"]*)" value="([^"]+)"/g)].flatMap(([,name,value])=>[[name,value],[name.replace('Version','Accepted'),'on']]))
  assert.equal((await h.form(opened.location,{formId:'intake-v1',q_reason:'Synthetic child intake',q_emergency:'Alex Diaz',q_consent:'yes',...accepted,signerName:'Alex Diaz',signerRelationship:'parent',signatureTyped:'Alex Diaz'})).status,303)
  const updates={name:'profile.insurance',payer:'New synthetic plan',memberId:'MEM-CHILD-1',subscriber:'Alex Diaz',relationship:'child',group:'FAMILY',confirm:'on',clientId:foreign.id}
  assert.equal((await h.form('/portal/action',updates,cookie)).status,303)
  assert.equal((await h.form('/portal/action',{name:'profile.contact',email:'new-guardian@family.example',phone:'3125550104',confirm:'on'},cookie)).status,303)
  const file=(await h.send('/api/balm/clients/'+child1.id,undefined,h.owner)).value
  assert.equal(file.portalProfileChanges.length,2)
  assert.equal(file.portalProfileChanges.find(r=>r.kind==='insurance').payload.memberId,'MEM-CHILD-1')
  assert.equal(file.client.email,'lucia@patient.example','unverified contact submission cannot take over sign-in')
  const policies=await h.db.prepare('SELECT COUNT(*) AS n FROM bm_policies WHERE client_id=?').bind(child1.id).first()
  assert.equal(policies.n,0,'unverified coverage never mutates active payer policy')
  assert.equal((await h.send('/api/balm/clients/'+foreign.id,undefined,h.owner)).value.portalProfileChanges.length,0)
  const events=(await h.db.prepare("SELECT action,actor_role,detail FROM bm_audit WHERE client_id=?").bind(child1.id).all()).results
  assert.ok(events.some(r=>r.action==='portal.insurance_update_submitted'&&r.actor_role==='guardian'))
  assert.ok(!JSON.stringify(events).includes('MEM-CHILD-1'))
  await viewportProof(h,[{name:'guardian-child-and-profile',path:'/portal/home',cookie,selector:'#children'},
   {name:'guardian-insurance-update',path:'/portal/home',cookie,selector:'#profile',open:'Update insurance details'},
   {name:'guardian-owner-grant',path:'/app/clients/'+child1.id,cookie:h.owner,open:'Grant verified guardian access',selector:'form[action*="guardian.grant"]'}])
  await h.cmd('guardian.revoke',{id:first.id})
  assert.equal((await h.send('/portal/home',undefined,cookie)).status,303)
  const again=await portalLogin(h,'guardian@family.example')
  assert.equal((await h.form('/portal/action',{name:'guardian.select',id:child1.id},again)).status,404)
  assert.equal((await h.send('/portal/home',undefined,again)).status,200)
  assert.equal((await h.form('/portal/signout',{},again)).status,303)
  assert.equal((await h.send('/portal/home',undefined,again)).status,303)
 }finally{await h.close()}
})

test('SMS portal codes are generic, hash-only, one-use credentials and never authenticate staff', {timeout:120000},async()=>{
 const texts=[]
 const h=await harness({auth:{SMS_PROVIDER:'twilio',TWILIO_ACCOUNT_SID:'synthetic-balm-301',TWILIO_AUTH_TOKEN:'synthetic-balm-302',TWILIO_FROM:'+13125550100'},outbound:async request=>{
  assert.equal(request.url,'https://api.twilio.com/2010-04-01/Accounts/synthetic-balm-301/Messages.json')
  assert.equal(request.headers.get('authorization'),'Basic '+Buffer.from('synthetic-balm-301:synthetic-balm-302').toString('base64'))
  const message=new URLSearchParams(await request.text());texts.push(Object.fromEntries(message));return Response.json({sid:'synthetic-balm-303',status:'queued'})
 }})
 try{
  await h.finishSetup()
  await clinic(h)
  const patient=await h.cmd('client.save',{firstName:'SMS',lastName:'Patient',dateOfBirth:'1980-01-01',phone:'3125550102'})
  const unknown=await h.form('/portal/sms',{phone:'3125550199'})
  assert.equal(unknown.status,200);assert.equal(texts.length,0)
  const requested=await h.form('/portal/sms',{phone:'3125550102'})
  assert.equal(requested.status,200);assert.match(requested.text,/If one patient file matches/)
  assert.equal(texts.length,1)
  const key=requested.text.match(/name="id" value="([^"]+)"/)[1],code=texts[0].Body.match(/code is (\d{6})/)[1]
  const stored=await h.db.prepare('SELECT * FROM bm_portal_sms_codes WHERE id=?').bind(key).first()
  assert.ok(stored.code_hash&&!JSON.stringify(stored).includes(code))
  assert.equal(Date.parse(stored.expires_at)-Date.parse(stored.created_at),300000)
  const wrong=code==='000000'?'000001':'000000'
  assert.equal((await h.form('/portal/sms/confirm',{id:key,code:wrong})).status,410)
  const result=await h.send('/portal/sms/confirm',{id:key,code})
  assert.equal(result.status,303,result.text)
  assert.equal((await h.form('/portal/sms/confirm',{id:key,code})).status,410)
  assert.equal((await h.send('/portal/home',undefined,result.cookie)).status,200)
  assert.equal((await h.send('/api/balm/state',undefined,result.cookie)).status,401)
  await h.cmd('client.save',{id:patient.id,firstName:'SMS',lastName:'Patient',phone:'3125550103'})
  assert.equal((await h.send('/portal/home',undefined,result.cookie)).status,303)
  await h.cmd('client.save',{firstName:'Shared',lastName:'Phone',phone:'3125550103'})
  await h.form('/portal/sms',{phone:'3125550103'})
  assert.equal(texts.length,1,'shared numbers never choose or expose a patient')
 }finally{await h.close()}
})


test('note-linked home programs retain hold dosage, three daily pain sessions and a patient-only printable copy', {timeout:120000},async()=>{
 const h=await harness({browserHttps:!!process.env.BALM_UI_SCREENSHOTS})
 try{
  await h.finishSetup()
  const {service,practitioners:[priya,other]}=await clinic(h,['Priya','Other'])
  const patient=await h.cmd('client.save',{firstName:'Marisol',lastName:'Diaz',email:'program@patient.example'})
  const foreign=await h.cmd('client.save',{firstName:'Una',lastName:'Other',email:'foreign@patient.example'})
  const visit=await pastVisit(h,patient.id,priya,service.id)
  const foreignVisit=await pastVisit(h,foreign.id,other,service.id)
  const note=await h.cmd('note.write',{clientId:patient.id,appointmentId:visit,body:'Daily note assigning a home program.'},priya.cookie)
  const foreignNote=await h.cmd('note.write',{clientId:foreign.id,appointmentId:foreignVisit,body:'Another patient note.'},other.cookie)
  await h.cmd('exercise.assign',{clientId:patient.id,noteId:foreignNote.id,title:'Refused',sets:1,reps:'5',instructions:'Must not cross patient boundaries.'},priya.cookie,404)
  const assignment=await h.cmd('exercise.assign',{clientId:patient.id,noteId:note.id,title:'Seated knee extension',sets:2,reps:'8',holdSeconds:3,frequency:'Once daily',instructions:'Sit with your back supported. Straighten your knee in a comfortable range, pause, then slowly lower.'},priya.cookie)
  const cookie=await portalLogin(h,'program@patient.example'),foreignCookie=await portalLogin(h,'foreign@patient.example')
  const today=new Date(Date.now()+10*3600_000).toISOString().slice(0,10)
  for(let offset=2;offset>=0;offset--){
   const day=new Date(Date.parse(today+'T00:00:00Z')-offset*86400_000).toISOString().slice(0,10)
   assert.equal((await h.form('/portal/action',{name:'exercise.done',id:assignment.id,day,pain:String(offset+1)},cookie)).status,303)
  }
  assert.equal((await h.form('/portal/action',{name:'exercise.done',id:assignment.id,pain:'11'},cookie)).status,400)
  assert.equal((await h.form('/portal/action',{name:'exercise.done',id:assignment.id,day:'2099-01-01',pain:'1'},cookie)).status,400)
  const next=await h.cmd('note.write',{clientId:patient.id,appointmentId:visit,body:'Next note reviews home adherence.'},priya.cookie)
  const file=(await h.send('/api/balm/clients/'+patient.id,undefined,priya.cookie)).value
  const exercise=file.homeExercises.find(e=>e.id===assignment.id)
  assert.equal(exercise.sourceNoteId,note.id);assert.equal(exercise.holdSeconds,3)
  assert.equal(exercise.sessions.length,3);assert.deepEqual(exercise.sessions.map(d=>d.pain),[3,2,1])
  const nextPage=(await h.send('/app/clients/'+patient.id,undefined,priya.cookie)).text
  assert.match(nextPage,/Home program adherence/);assert.match(nextPage,/3 sessions/)
  const pdf=await h.send('/portal/program.pdf',undefined,cookie)
  assert.equal(pdf.status,200);assert.match(pdf.text,/^%PDF/);assert.match(pdf.text,/Seated knee extension/);assert.match(pdf.text,/hold 3 seconds/)
  assert.ok(!(await h.send('/portal/program.pdf',undefined,foreignCookie)).text.includes('Seated knee extension'))
  await viewportProof(h,[{name:'program-pain-log',path:'/portal/home',cookie,selector:'#program'},
   {name:'note-program-adherence',path:'/app/clients/'+patient.id,cookie:priya.cookie,selector:'#note-'+next.id}])
 }finally{await h.close()}
})


test('the patient chooses a remembered Spanish portal interface without translating clinical content', {timeout:120000},async()=>{
 const h=await harness({browserHttps:!!process.env.BALM_UI_SCREENSHOTS})
 try{
  await h.finishSetup()
  const {service,practitioners:[priya]}=await clinic(h)
  const patient=await h.cmd('client.save',{firstName:'Marisol',lastName:'Diaz',email:'language@patient.example'})
  await pastVisit(h,patient.id,priya,service.id)
  await h.cmd('exercise.assign',{clientId:patient.id,title:'Clinician-authored title',sets:1,reps:'5',instructions:'Clinical wording is retained exactly as authored.'},priya.cookie)
  const cookie=await portalLogin(h,'language@patient.example')
  assert.equal((await h.form('/portal/action',{name:'language.choose',language:'es'},cookie)).status,303)
  const page=await h.send('/portal/home',undefined,cookie)
  assert.match(page.text,/<html lang="es">/);assert.match(page.text,/Programa de ejercicios en casa/)
  assert.match(page.text,/Clinical wording is retained exactly as authored/)
  assert.equal((await h.db.prepare('SELECT portal_language FROM bm_clients WHERE id=?').bind(patient.id).first()).portal_language,'es')
  await viewportProof(h,[{name:'patient-spanish-home',path:'/portal/home',cookie,selector:'#program'},
   {name:'patient-spanish-signin',path:'/portal?lang=es'}])
  await h.form('/portal/action',{name:'language.choose',language:'en'},cookie)
  await viewportProof(h,[{name:'patient-english-home',path:'/portal/home',cookie,selector:'#program'},{name:'patient-english-signin',path:'/portal'}])
 }finally{await h.close()}
})


test('a fresh licensed exercise library supports filtered search, atomic media CSV import and five-exercise assignment from a daily note', {timeout:120000},async()=>{
 const h=await harness({browserHttps:!!process.env.BALM_UI_SCREENSHOTS})
 try{
  await h.finishSetup()
  const {service,practitioners:[priya]}=await clinic(h)
  const patient=await h.cmd('client.save',{firstName:'Marisol',lastName:'Diaz',email:'library@patient.example'})
  const visit=await pastVisit(h,patient.id,priya,service.id)
  const note=await h.cmd('note.write',{clientId:patient.id,appointmentId:visit,template:'pt.daily',body:'Daily note selects home program.'},priya.cookie)
  const library=await h.send('/api/balm/exercises',undefined,priya.cookie)
  assert.equal(library.status,200,library.text)
  assert.equal(library.value.shippedCount,23);assert.deepEqual(library.value.counts,{pt:13,ot:5,slp:5})
  assert.ok(library.value.exercises.every(e=>e.image.startsWith('data:image/svg+xml;base64,')&&e.license==='CC0-1.0'&&e.source&&e.instructionsEs&&e.titleEs))
  const search=await h.send('/api/balm/exercises?q=resistance%20band&discipline=pt&region=shoulder',undefined,priya.cookie)
  assert.equal(search.value.total,2)
  assert.ok(search.value.exercises.every(e=>e.region==='shoulder'&&e.equipment==='resistance band'))
  const selected=library.value.exercises.filter(e=>e.discipline==='pt').slice(0,5)
  const assigned=await h.cmd('exercise.program.assign',{clientId:patient.id,noteId:note.id,exerciseIds:selected.map(e=>e.id)},priya.cookie)
  assert.equal(assigned.ids.length,5)
  const cookie=await portalLogin(h,'library@patient.example')
  const portal=(await h.send('/portal/home',undefined,cookie)).text
  for(const e of selected){assert.ok(portal.includes(e.title));assert.ok(portal.includes(e.image))}
  assert.match(portal,/CC0-1.0/)
  await h.form('/portal/action',{name:'language.choose',language:'es'},cookie)
  const spanish=(await h.send('/portal/home',undefined,cookie)).text
  assert.ok(spanish.includes(selected[0].titleEs)&&spanish.includes(selected[0].instructionsEs))
  const png='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jEAAAAABJRU5ErkJggg=='
  const columns='title,title_es,instructions,instructions_es,discipline,region,position,equipment,sets,reps,hold_seconds,frequency,media'
  const csv=columns+'\n'+[1,2,3].map(i=>`Practice task ${i},Tarea de la clínica ${i},"Move slowly, then rest.",Muévase despacio y descanse.,ot,hand,seated,soft ball,1,5,0,Daily,task-${i}.png`).join('\n')
  const media=Object.fromEntries([1,2,3].map(i=>['task-'+i+'.png',png]))
  await h.cmd('exercise.library.import',{csv,media:{},rights:true},priya.cookie,400)
  assert.equal((await h.send('/api/balm/exercises?q=Practice%20task',undefined,priya.cookie)).value.total,0,'a missing image refuses the complete batch')
  // Exercise the same multipart door as the actual upload form.
  const upload=new FormData();upload.set('csv',new File([csv],'practice.csv',{type:'text/csv'}));upload.set('rights','on')
  for(let i=1;i<=3;i++)upload.set('media_'+i,new File([Buffer.from(png.split(',')[1],'base64')],'task-'+i+'.png',{type:'image/png'}))
  const encoded=new Request(h.origin+'/app/action',{method:'POST',body:upload})
  const response=await h.mf.dispatchFetch(h.origin+'/app/action?name=exercise.library.import&returnTo='+encodeURIComponent('/app/clients/'+patient.id),{method:'POST',headers:{origin:h.origin,cookie:priya.cookie,'content-type':encoded.headers.get('content-type')},body:new Uint8Array(await encoded.arrayBuffer()),redirect:'manual'})
  assert.equal(response.status,303,await response.text())
  const imported=await h.send('/api/balm/exercises?q=Practice%20task',undefined,priya.cookie)
  assert.equal(imported.value.total,3);assert.ok(imported.value.exercises.every(e=>e.license.startsWith('Practice-owned')))
  await h.cmd('exercise.library.import',{csv,media,rights:true},priya.cookie)
  assert.equal((await h.send('/api/balm/exercises?q=Practice%20task',undefined,priya.cookie)).value.total,3,'repeat import keeps the original three exercises')
  await viewportProof(h,[{name:'library-search-and-assignment',path:'/app/clients/'+patient.id+'?q=resistance%20band&discipline=pt&region=shoulder',cookie:priya.cookie,selector:'#exercise-library'},
   {name:'library-csv-media-import',path:'/app/clients/'+patient.id,cookie:priya.cookie,open:'Import practice exercises with images',selector:'form[action*="exercise.library.import"]'},
   {name:'library-patient-spanish',path:'/portal/home',cookie,selector:'#program'}])
 }finally{await h.close()}
})
