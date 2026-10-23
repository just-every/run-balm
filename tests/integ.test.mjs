import {test} from 'node:test'
import assert from 'node:assert/strict'
import {createHmac,timingSafeEqual} from 'node:crypto'
import {harness} from './harness.mjs'
import {clinic,pastVisit} from './clinic.mjs'
import {viewportProof} from './viewport-proof.mjs'

test('scoped keys read only authorized fields, prepare invoices for a human, and lose authority on revocation', {timeout:120000}, async()=>{
 const h=await harness()
 try{
  await h.finishSetup()
  const {service,practitioners:[priya]}=await clinic(h)
  const patient=await h.cmd('client.save',{firstName:'Marisol',lastName:'Diaz',email:'marisol@patient.example'})
  const visit=await pastVisit(h,patient.id,priya,service.id)
  await h.cmd('appointment.attend',{id:visit},priya.cookie)
  await h.cmd('note.write',{clientId:patient.id,appointmentId:visit,body:'Clinical narrative never belongs in an API feed.'},priya.cookie)
  const key=await h.cmd('agent.create',{label:'Schedule and invoice preparation',scopes:['appointments.read','invoice.prepare']})
  const headers={authorization:'Bearer '+key.token}
  const read=await h.send('/api/balm/agent/appointments',undefined,'',headers)
  assert.equal(read.status,200,read.text);assert.ok(read.value.records.some(a=>a.id===visit))
  assert.ok(!read.text.includes('marisol@')&&!read.text.includes('Clinical narrative'))
  for(const path of ['context','patients','charges','payments','other'])assert.equal((await h.send('/api/balm/agent/'+path,undefined,'',headers)).status,403,path)
  assert.equal((await h.send('/api/balm/agent/command',{name:'invoice.prepare',input:{appointmentId:visit}},'',headers)).status,200)
  const invoice=(await h.state()).invoices.find(i=>i.appointment_id===visit)
  assert.equal(invoice.status,'draft')
  assert.equal((await h.send('/api/balm/agent/command',{name:'invoice.approve',input:{id:invoice.id}},'',headers)).status,403)
  assert.equal((await h.send('/api/balm/agent/command',{name:'intake.prepare',input:{title:'Refused',questions:[]}},'',headers)).status,403)
  await h.cmd('invoice.approve',{id:invoice.id})
  await h.cmd('payment.record',{invoiceId:invoice.id,amountCents:9500,reference:'synthetic-balm-201'})
  for(const scope of ['patients','charges','payments']){
   const scoped=await h.cmd('agent.create',{label:scope,scopes:[scope+'.read']})
   const response=await h.send('/api/balm/agent/'+scope,undefined,'',{authorization:'Bearer '+scoped.token})
   assert.equal(response.status,200,response.text)
   assert.ok(response.value.records.length>0)
   assert.ok(!response.text.includes('Clinical narrative')&&!response.text.includes('token_hash'))
  }
  await h.cmd('agent.create',{label:'Invalid clinical scope',scopes:['records.read']},h.owner,400)
  await h.cmd('agent.create',{label:'No scopes',scopes:[]},h.owner,400)
  assert.equal((await h.send('/api/balm/command',{name:'invoice.prepare',input:{appointmentId:visit}},'',headers)).status,401)
  await h.cmd('agent.revoke',{id:key.id})
  assert.equal((await h.send('/api/balm/agent/appointments',undefined,'',headers)).status,401)
  const audit=(await h.db.prepare("SELECT action FROM bm_audit WHERE client_id=?").bind(patient.id).all()).results.map(r=>r.action)
  for(const action of ['integration.appointments_read','integration.patients_read','integration.charges_read','integration.payments_read'])assert.ok(audit.includes(action),action)
 }finally{await h.close()}
})

test('booking webhooks require owner consent and explicit approval, verify raw-body HMAC, and never retry an uncertain send', {timeout:120000}, async()=>{
 const received=[];let fail=false;let redirect=false
 const h=await harness({browserHttps:!!process.env.BALM_UI_SCREENSHOTS,outbound:async request=>{
  assert.equal(request.url,'https://integrations.synthetic-balm.com/bookings')
  const body=await request.text();received.push({body,signature:request.headers.get('balm-signature'),idempotency:request.headers.get('idempotency-key')})
  if(fail)throw Error('Synthetic transport failure after body receipt')
  return new Response(null,{status:redirect?302:204,headers:redirect?{location:'https://other.synthetic-balm.com/'}:{}})
 }})
 try{
  await h.finishSetup()
  const {service,practitioners:[priya]}=await clinic(h)
  const patient=await h.cmd('client.save',{firstName:'Marisol',lastName:'Diaz',email:'marisol@patient.example'})
  const input={url:'https://integrations.synthetic-balm.com/bookings',consent:true}
  await h.cmd('integration.hook.create',{url:input.url},h.owner,400)
  await h.cmd('integration.hook.create',input,priya.cookie,403)
  for(const url of ['http://public.com/','https://127.0.0.1/','https://localhost/','https://x.internal/','https://user:password@public.com/'])await h.cmd('integration.hook.create',{url,consent:true},h.owner,400)
  const hook=await h.cmd('integration.hook.create',input)
  const visit=await pastVisit(h,patient.id,priya,service.id)
  assert.equal(received.length,0,'booking alone never makes an outbound webhook call')
  const state=await h.state();assert.ok(state.integrations.events.some(e=>e.id===visit))
  assert.ok(!JSON.stringify(state).includes(hook.secret))
  const deliver={hookId:hook.id,eventId:visit,confirm:true}
  await h.cmd('integration.hook.deliver',{...deliver,confirm:false},h.owner,400)
  await h.cmd('integration.hook.deliver',deliver,priya.cookie,403)
  assert.equal((await h.cmd('integration.hook.deliver',deliver)).outcome,'accepted')
  const receipt=received[0],parts=Object.fromEntries(receipt.signature.split(',').map(v=>v.split('=')))
  const expected=createHmac('sha256',hook.secret).update(parts.t+'.'+receipt.body).digest()
  assert.ok(timingSafeEqual(expected,Buffer.from(parts.v1,'hex')))
  const event=JSON.parse(receipt.body)
  assert.deepEqual(Object.keys(event).sort(),['appointmentId','createdAt','id','type'])
  assert.equal(event.appointmentId,visit);assert.equal(event.type,'appointment.booked')
  assert.ok(!receipt.body.includes('Marisol')&&!receipt.body.includes('patient.example'))
  await h.cmd('integration.hook.deliver',deliver,h.owner,409)
  assert.equal(received.length,1)
  const uncertain=await pastVisit(h,patient.id,priya,service.id,h.owner,5)
  fail=true
  assert.equal((await h.cmd('integration.hook.deliver',{hookId:hook.id,eventId:uncertain,confirm:true})).outcome,'uncertain')
  await h.cmd('integration.hook.deliver',{hookId:hook.id,eventId:uncertain,confirm:true},h.owner,409)
  assert.equal(received.length,2)
  fail=false;redirect=true
  const redirected=await pastVisit(h,patient.id,priya,service.id,h.owner,8)
  assert.equal((await h.cmd('integration.hook.deliver',{hookId:hook.id,eventId:redirected,confirm:true})).outcome,'refused')
  assert.equal(received.length,3,'redirect target is never fetched')
  await viewportProof(h,[{name:'integration-permissions-and-hooks',path:'/app/agent',cookie:h.owner}])
  await h.cmd('integration.hook.revoke',{id:hook.id})
  const next=await pastVisit(h,patient.id,priya,service.id,h.owner,11)
  await h.cmd('integration.hook.deliver',{hookId:hook.id,eventId:next,confirm:true},h.owner,404)
  assert.equal(received.length,3)
 }finally{await h.close()}
})
