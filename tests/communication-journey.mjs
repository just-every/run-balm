import assert from 'node:assert/strict'
import {clinic} from './clinic.mjs'

export async function communicationFixture(h) {
 await h.finishSetup()
 const {service,practitioners:[priya,sam]}=await clinic(h,['Priya','Sam'])
 const reception=await h.staff('Rosa','reception')
 const patient=await h.cmd('client.save',{firstName:'Ava',lastName:'Ng',email:'ava@client.example'})
 const other=await h.cmd('client.save',{firstName:'Noah',lastName:'Kim',email:'noah@client.example'})
 for(const [clientId,practitionerId,date] of [[patient.id,priya.id,'2099-03-02'],[patient.id,sam.id,'2099-03-03'],[other.id,priya.id,'2099-03-04']])await h.cmd('appointment.book',{clientId,practitionerId,serviceId:service.id,date,time:'10:00'})
 const call={clientId:patient.id,direction:'incoming',occurredAt:'2000-01-02T10:30',recipient:priya.id,disposition:'Shoulder exercise question; clinician returned call'}
 const search=async(cookie=h.owner,query='',channel='',clientId=patient.id)=>{
  const r=await h.send('/api/balm/clients/'+clientId+'/communications?'+new URLSearchParams({communicationQuery:query,communicationChannel:channel}),undefined,cookie)
  assert.equal(r.status,200,r.text);return r.value
 }
 return {patient,other,priya,sam,reception,call,search}
}

export async function communicationJourney(h) {
 const c=await communicationFixture(h),{patient,other,priya,sam,reception,call,search}=c
 const first=await h.cmd('call.log',{...call,staffId:sam.id,staffName:'Impersonated staff'},priya.cookie)
 const desk=await h.cmd('call.log',{...call,recipient:'front_desk',direction:'outgoing',disposition:'Appointment time confirmed'},reception.cookie)
 const samCall=await h.cmd('call.log',{...call,recipient:sam.id,disposition:'Other treating conversation'},sam.cookie)
 await h.cmd('call.log',{...call,clientId:other.id,disposition:'Unrelated patient secret'},priya.cookie)
 const clinical=await h.cmd('message.send',{clientId:patient.id,recipient:priya.id,body:'Shoulder secure message',delivery:'shown'},priya.cookie)
 await h.cmd('message.send',{clientId:patient.id,recipient:'front_desk',body:'Appointment desk message',delivery:'shown'},reception.cookie)
 const authorized=await search(h.owner,'Shoulder')
 assert.equal(authorized.total,2)
 assert.deepEqual(new Set(authorized.results.map(r=>r.id)),new Set([first.id,clinical.messageId]))
 const logged=authorized.results.find(r=>r.id===first.id)
 assert.deepEqual([logged.channel,logged.direction,logged.at,logged.staff,logged.text,logged.state],['call','incoming','2000-01-02T00:30:00.000Z','Priya',call.disposition,'manually_logged'])
 const owned=await search(priya.cookie)
 assert.deepEqual(new Set(owned.results.map(r=>r.id)),new Set([first.id,clinical.messageId,...(await search(priya.cookie,'','email')).results.map(r=>r.id)]))
 assert.equal((await search(priya.cookie,'','email')).total,1,'only own visit mail metadata is searchable')
 assert.deepEqual((await search(sam.cookie,'','call')).results.map(r=>r.id),[samCall.id])
 assert.deepEqual((await search(reception.cookie,'','call')).results.map(r=>r.id),[desk.id])
 for(const cookie of [reception.cookie,sam.cookie]){
  const hidden=await search(cookie,'Shoulder')
  assert.deepEqual([hidden.total,hidden.results],[0,[]],'hidden matches leak neither counts nor snippets')
 }
 assert.deepEqual((await search(h.owner,'Unrelated patient secret')).results,[])
 assert.equal((await search(h.owner,'Unrelated patient secret','',''+other.id)).total,1)
 assert.equal((await search(h.owner,'accepted','email')).total,2,'provider acceptance stays separate from delivery')
 assert.equal((await search(h.owner,'%')).total,0,'search treats wildcard characters literally')
 assert.equal((await search(h.owner,'Shoulder','call')).total,1)
 const reply='Patient reports less pain after exercises'
 assert.equal((await h.form(new URL(clinical.url).pathname,{body:reply})).status,303)
 const incoming=await search(priya.cookie,reply,'secure_message')
 assert.equal(incoming.total,1,'a received patient message appears once in its authorized conversation')
 assert.deepEqual(incoming.results.map(r=>[r.channel,r.direction,r.staff,r.text,r.state]),[['secure_message','incoming','Patient',reply,'received_in_balm']])
 for(const cookie of [reception.cookie,sam.cookie])assert.deepEqual(await search(cookie,reply,'secure_message'),{query:reply,channel:'secure_message',total:0,results:[],limit:50})
 const email=await search(priya.cookie,'','email')
 await h.cmd('call.log',{...call,recipient:priya.id},reception.cookie,403)
 await h.cmd('call.log',{...call,recipient:'front_desk'},priya.cookie,403)
 await h.cmd('call.log',{...call,recipient:priya.id},sam.cookie,404)
 await h.cmd('call.log',{...call,clientId:crypto.randomUUID()},priya.cookie,404)
 await h.cmd('call.log',{...call,direction:'unknown'},h.owner,400)
 await h.cmd('call.log',{...call,occurredAt:'2099-01-02T10:00:00Z'},h.owner,400)
 await h.cmd('call.log',{...call,occurredAt:'2000-02-30T10:00:00Z'},h.owner,400)
 assert.equal((await h.send('/api/balm/clients/'+patient.id+'/communications')).status,401)
 const biller=await h.staff('Bill','biller')
 await h.cmd('call.log',call,biller.cookie,403)
 assert.equal((await h.send('/api/balm/clients/'+patient.id+'/communications',undefined,biller.cookie)).status,403)
 assert.equal((await h.send('/api/balm/clients/'+patient.id,undefined,biller.cookie)).value.communications,null)
 const key=await h.cmd('agent.create',{label:'Synthetic history key'})
 assert.equal((await h.send('/api/balm/agent/command',{name:'call.log',input:call},'',{authorization:'Bearer '+key.token})).status,403)
 await assert.rejects(h.db.prepare('UPDATE bm_calls SET disposition=? WHERE id=?').bind('Changed original',first.id).run(),/calls_are_health_records/)
 await assert.rejects(h.db.prepare('DELETE FROM bm_calls WHERE id=?').bind(first.id).run(),/calls_are_health_records/)
 await h.cmd('client.erase',{id:patient.id},h.owner,409)
 const enquiry=await h.cmd('client.save',{firstName:'Call',lastName:'Only'})
 await h.cmd('call.log',{...call,clientId:enquiry.id,recipient:'front_desk'},reception.cookie)
 await h.cmd('client.erase',{id:enquiry.id},h.owner,409)
 const audit=(await h.db.prepare('SELECT action,subject_id,detail FROM bm_audit WHERE client_id=?').bind(patient.id).all()).results
 for(const [action,id] of [['call.logged',first.id],['communication.call_read',first.id],['communication.secure_message_read',clinical.messageId],['communication.secure_message_read',incoming.results[0].id],['communication.email_read',email.results[0].id]])assert.ok(audit.some(a=>a.action===action&&a.subject_id===id))
 assert.ok(audit.some(a=>a.action==='communication.searched'))
 assert.ok(audit.every(a=>!a.detail.includes('Shoulder')&&!a.detail.includes(call.disposition)&&!a.detail.includes(reply)),'search terms and clinical snippets never enter the audit')
 await h.cmd('staff.save',{id:priya.id,name:'Priya',email:priya.email,role:'practitioner',active:false})
 await h.cmd('call.log',call,priya.cookie,403)
 assert.equal((await h.send('/api/balm/clients/'+patient.id+'/communications',undefined,priya.cookie)).status,403)
 return c
}
