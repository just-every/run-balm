import { test } from 'node:test'
import assert from 'node:assert/strict'
import { run } from './harness.mjs'
import { bookOnline, clinic, slots } from './clinic.mjs'

const consentFields = page => Object.fromEntries([...page.matchAll(/name="(consentVersion[^"]*)" value="([^"]+)"/g)].flatMap(([,name,value]) => [[name,value], [name.replace('Version','Accepted'),'on']]))

test('a parent signs each clinic policy, then re-signs only the changed version from an emailed link', () => run(async h => {
  await h.finishSetup()
  const { service, practitioners: [priya] } = await clinic(h)
  const desk = await h.staff('Rosa', 'reception')
  for (const kind of ['hipaa','financial','cancellation','telehealth','sms']) {
    await h.cmd('consent.publish', { kind, title: `${kind} clinic document`, body: `Clinic ${kind} document. Ask the clinic if you have questions.`, version: 0 })
  }
  await h.cmd('consent.publish', { kind:'hipaa',title:'Unauthorized change',body:'Changed',version:1 }, desk.cookie, 403)
  const booked = await bookOnline(h, service.id, priya.id, (await slots(h, service.id, priya.id))[0], { dateOfBirth:'2016-04-02' })
  const path = booked.location.split('?')[0], page = await h.send(path)
  const signing = { signerName:'Alex Lee',signerRelationship:'parent',signatureTyped:'Alex Lee' }
  const fields = { formId:'intake-v1',q_reason:'Private concern',q_emergency:'Alex Lee',q_consent:'yes',...consentFields(page.text),...signing }
  assert.equal((await h.form(path, {...fields,consentAccepted_hipaa:''})).status,400)
  assert.equal((await h.form(path, fields)).status,303)
  const client = (await h.state()).clients.find(c=>c.first_name==='Maya')
  const file = () => h.send('/api/balm/clients/'+client.id, undefined, h.owner)
  const before = (await file()).value.intakeDocuments
  assert.equal(before.consents.length,6)
  const originals = new Map()
  for (const consent of before.consents) {
    assert.equal(consent.signer_relationship,'parent')
    const pdf = await h.send('/app/intake/consents/'+consent.id+'.pdf',undefined,h.owner)
    assert.equal(pdf.status,200); assert.match(pdf.text,/Alex Lee/)
    originals.set(consent.id,pdf.text)
  }
  await h.cmd('consent.publish', {kind:'cancellation',title:'Cancellation policy',body:'Please give two business days notice when canceling.',version:1})
  assert.deepEqual((await file()).value.intakeDocuments.pendingPolicies.map(p=>p.kind),['cancellation'])
  const requested = await h.cmd('consent.request',{clientId:client.id})
  assert.equal(requested.mail,'sent')
  const mail=h.mail.findLast(m=>m.text.includes('/consent/'))
  assert.ok(!mail.text.includes('Private concern'))
  const renewalPath=new URL(mail.text.match(/https?:\/\/\S+\/consent\/\S+/)[0]).pathname
  const renewal=await h.send(renewalPath)
  assert.equal(Object.keys(consentFields(renewal.text)).length,2)
  await h.cmd('consent.publish', {kind:'cancellation',title:'Cancellation policy',body:'Please give three business days notice when canceling.',version:2})
  assert.equal((await h.form(renewalPath,{...consentFields(renewal.text),...signing})).status,409)
  const latest=await h.send(renewalPath)
  assert.equal((await h.form(renewalPath,{...consentFields(latest.text),...signing})).status,303)
  assert.equal((await h.form(renewalPath,{...consentFields(latest.text),...signing})).status,409)
  const after=(await file()).value.intakeDocuments
  assert.equal(after.consents.length,7);assert.deepEqual(after.pendingPolicies,[])
  for(const [id,bytes] of originals) assert.equal((await h.send('/app/intake/consents/'+id+'.pdf',undefined,h.owner)).text,bytes)
  assert.equal((await h.send('/app/intake/consents/'+after.consents[0].id+'.pdf',undefined,desk.cookie)).status,403)
}))

test('intake captures two policies and photo ID, creates eligibility requests, and staff verify AI suggestions against the originals', () => {
  const requests = []
  const outbound = async request => {
    assert.equal(request.url, 'https://api.anthropic.com/v1/messages')
    const body = await request.json(); requests.push(body)
    const vision = body.messages[0].content instanceof Array
    return Response.json({ content: [{ type: 'text', text: JSON.stringify(vision ? {
      payer: 'Example Health', memberId: 'MEM-100', group: 'GRP-9', subscriber: 'Alex Lee', relationship: 'child',
    } : { sections: { subjective: 'Pt reports L knee 3/10 after stairs.', objective: 'Ther ex 23 min. Manual 10 min.', assessment: 'Tolerated well.', goals: '', plan: 'Progress step height.' }, charges: [{ code: '97110', minutes: 23 }, { code: '97140', minutes: 10 }], note: '' }) }], stop_reason: 'end_turn' })
  }
  return run(async h => {
    await h.finishSetup()
    const { service, practitioners: [priya, other] } = await clinic(h, ['Priya', 'Sam'])
    const desk = await h.staff('Rosa', 'reception')
    await h.cmd('insurance.settings.save', {billingNpi:'1234567893',taxId:'123456789',address:'100 Main St',city:'Austin',state:'TX',postalCode:'78701',senderId:'BALMTEST',contactName:'Jordan Clinic',contactPhone:'5125550100'})
    const primary = await h.cmd('insurance.payer.save',{name:'Example Health',payerId:'PRIMARY',receiverId:'PRIMARY'})
    const secondary = await h.cmd('insurance.payer.save',{name:'Example Secondary',payerId:'SECONDARY',receiverId:'SECONDARY'})

    const booked = await bookOnline(h, service.id, priya.id, (await slots(h, service.id, priya.id))[0], { dateOfBirth: '2016-04-02' })
    const token = booked.location.match(/\/intake\/([\w-]+)/)[1]
    const page = await h.send('/intake/' + token)
    assert.match(page.text, /intake-signature/)
    const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl6V1sAAAAASUVORK5CYII=', 'base64')
    const photos=Object.fromEntries(['insuranceFront','insuranceBack','secondaryFront','secondaryBack','identityPhoto'].map(k=>[k,'data:image/png;base64,'+png.toString('base64')]))
    const fields = { formId: 'intake-v1', q_reason: 'Private pediatric concern', q_emergency: 'Alex Lee 555-0100', q_consent: 'yes',
      consentVersion: page.text.match(/name="consentVersion" value="([^"]+)"/)[1], consentAccepted: 'on', signerName: 'Alex Lee', signerRelationship: 'parent',
      signature: JSON.stringify([[[0.1,0.4],[0.2,0.2],[0.3,0.7],[0.5,0.4],[0.8,0.5]]]),
      insurancePayerId: primary.id, insuranceMemberId: 'MEM-10O', insuranceGroup: 'GRP-9', insuranceSubscriberFirst:'Alex',insuranceSubscriberLast:'Lee',insuranceSubscriberDob:'1985-01-12',insuranceSubscriberSex:'F',insuranceRelationship:'child',insuranceStartsOn:'2026-01-01',
      secondaryPayerId:secondary.id,secondaryMemberId:'SECOND-10',secondarySubscriberFirst:'Sam',secondarySubscriberLast:'Lee',secondarySubscriberDob:'1982-05-13',secondarySubscriberSex:'M',secondaryRelationship:'child',secondaryStartsOn:'2026-01-01',
      insurancePatientSex:'F',insuranceAddress:'200 Oak St',insuranceCity:'Austin',insuranceState:'TX',insurancePostalCode:'78701',...photos }
    assert.equal((await h.form('/intake/' + token, { ...fields, signature: '' })).status, 400)
    assert.equal((await h.form('/intake/' + token, { ...fields, insuranceSubscriberFirst: '' })).status, 400)
    const upload = new FormData()
    for (const [key, value] of Object.entries(fields)) upload.set(key, value)
    upload.set('insuranceFront', new Blob([png], { type: 'image/png' }), 'front.png')
    upload.set('insuranceBack', new Blob([png], { type: 'image/png' }), 'back.png')
    for(const name of ['secondaryFront','secondaryBack','identityPhoto'])upload.set(name,new Blob([png],{type:'image/png'}),name+'.png')
    const request = new Request(h.origin + '/intake/' + token, { method: 'POST', headers: { origin: h.origin, 'cf-connecting-ip': '192.0.2.10' }, body: upload })
    const sent = await h.mf.dispatchFetch(request.url, { method: 'POST', headers: request.headers, body: new Uint8Array(await request.arrayBuffer()), redirect: 'manual' })
    assert.equal(sent.status, 303, await sent.text())
    assert.equal((await h.form('/intake/' + token, fields)).status, 409)
    assert.ok(!(await h.send('/intake/' + token)).text.includes('Private pediatric concern'))
    const client = (await h.state()).clients.find(c => c.first_name === 'Maya')
    const file = async cookie => h.send('/api/balm/clients/' + client.id, undefined, cookie)
    const documents = (await file(priya.cookie)).value.intakeDocuments
    assert.equal(documents.consents[0].signer_relationship, 'parent')
    const consentId = documents.consents[0].id, card = documents.insurance.find(i=>i.priority===1)
    assert.equal(documents.insurance.length,2); assert.equal(documents.identities.length,1)
    const native=(await file(h.owner)).value.insurance
    assert.equal(native.policies.length,2); assert.equal(native.eligibility.length,2)
    assert.ok(native.policies.every(p=>p.eligibility_status==='unknown'))
    for(const request of native.eligibility){assert.equal(request.status,'prepared');const edi=await h.send('/api/balm/insurance/270/'+request.id,undefined,desk.cookie);assert.equal(edi.status,200);assert.match(edi.text,/ST\*270\*/)}
    const identityPath='/app/intake/identity/'+documents.identities[0].id+'/photo'
    assert.equal((await h.send(identityPath,undefined,other.cookie)).status,404)
    const identity=await h.mf.dispatchFetch(h.origin+identityPath,{headers:{cookie:desk.cookie}})
    assert.equal(identity.status,200);assert.deepEqual(Buffer.from(await identity.arrayBuffer()),png)
    const path = '/app/intake/consents/' + consentId + '.pdf'
    const pdf = await h.send(path, undefined, priya.cookie)
    assert.equal(pdf.status, 200); assert.equal(pdf.headers.get('content-type'), 'application/pdf')
    assert.match(pdf.text, /^%PDF-/); assert.match(pdf.text, /Private pediatric concern/); assert.match(pdf.text, /Alex Lee/); assert.match(pdf.text, /192\.0\.2\.10/)
    // The PDF includes actual PDF vector drawing commands, not a hash in place of the signature.
    assert.match(pdf.text, /[\d.]+ [\d.]+ m\n[\d.]+ [\d.]+ l/)
    assert.equal((await h.send(path, undefined, desk.cookie)).status, 403)
    assert.equal((await h.send(path, undefined, other.cookie)).status, 404)
    const reception = await file(desk.cookie)
    assert.equal(reception.value.intakeDocuments.consents, null); assert.ok(!reception.text.includes('Private pediatric concern'))
    const photo = await h.mf.dispatchFetch(h.origin + '/app/intake/insurance/' + card.id + '/front', { headers: { cookie: desk.cookie } })
    assert.equal(photo.status, 200); assert.deepEqual(Buffer.from(await photo.arrayBuffer()), png)
    await h.cmd('scribe.save', { provider: 'anthropic', key: 'test-model-key' })
    const read = await h.cmd('insurance.read', { id: card.id }, desk.cookie)
    assert.equal(read.draft.memberId, 'MEM-100')
    const suggested = (await file(desk.cookie)).value.intakeDocuments.insurance.find(i=>i.priority===1)
    assert.equal(suggested.member_id, 'MEM-10O'); assert.equal(suggested.verified_at, null)
    assert.equal(requests[1].messages[0].content.filter(c => c.type === 'image').length, 2)
    await h.cmd('insurance.verify', { id: card.id, version: suggested.version, payerId: primary.id, payer: read.draft.payer, subscriberFirst:'Alex',subscriberLast:'Lee',memberId: read.draft.memberId, group: read.draft.group, subscriber: read.draft.subscriber, relationship: 'child', confirm: 'on' }, desk.cookie)
    const final = (await file(h.owner)).value
    assert.equal(final.intakeDocuments.insurance.find(i=>i.priority===1).member_id, 'MEM-100')
    assert.ok(final.intakeDocuments.insurance.find(i=>i.priority===1).verified_at)
    const second = await h.send(path, undefined, h.owner)
    assert.equal(second.text, pdf.text)
    assert.equal(final.insurance.policies.find(p=>p.id===card.policy_id).member_id,'MEM-100')
    assert.equal(final.insurance.eligibility.filter(e=>e.status==='superseded').length,1)
    assert.equal(final.insurance.eligibility.filter(e=>e.status==='prepared').length,1)
    assert.equal(final.insurance.eligibility.filter(e=>e.status==='exported').length,1)
    assert.ok(final.audit.some(a => a.action === 'consent.downloaded'))
    assert.ok(!JSON.stringify(final.audit).includes('Private pediatric concern'))
  }, { outbound })
})
