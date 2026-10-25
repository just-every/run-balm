import assert from 'node:assert/strict'
import { clinic, pastVisit } from './clinic.mjs'
import { portalLogin } from './portal-billing.mjs'

export async function statementCyclesJourney(h, hooks={}) {
  await h.finishSetup()
  const {service,practitioners:[priya]}=await clinic(h), desk=await h.staff('Rosa','reception')
  await h.cmd('staff.save',{id:priya.id,name:'Priya',email:priya.email,role:'practitioner',credentials:'PT',active:true})
  const clients=[],invoices=[]
  for(const [index,name] of ['Marisol','Jordan','Held','Minimum','Insurance'].entries()) {
    const patient=await h.cmd('client.save',{firstName:name,lastName:'Rivera',dateOfBirth:'1980-03-07',email:name.toLowerCase()+'@patient.example',phone:'5125550100'})
    clients.push(patient)
    const visit=await pastVisit(h,patient.id,priya,service.id,h.owner,index+1)
    if(index===4) {
      const payer=await h.cmd('insurance.payer.save',{name:'Synthetic payer',payerId:'SYNTHETIC105',unitMethod:'cms',fees:[]})
      const policy=await h.cmd('insurance.policy.save',{clientId:patient.id,payerId:payer.id,memberId:'synthetic-balm-106',relationship:'18',patientSex:'F',address:'200 Oak St',city:'Austin',state:'TX',postalCode:'78701',startsOn:'2020-01-01',endsOn:'2035-12-31'})
      patient.policy=policy
      await h.cmd('note.write',{clientId:patient.id,appointmentId:visit,body:'Synthetic treatment',charges:[{code:'97110',minutes:15}]},priya.cookie).then(async note=>h.cmd('note.sign',{id:note.id,revision:1,signature:'Priya',attest:true},priya.cookie))
    }
    await h.cmd('appointment.attend',{id:visit},priya.cookie)
    const invoice=await h.cmd('invoice.prepare',{appointmentId:visit});await h.cmd('invoice.approve',{id:invoice.id});invoices.push(invoice)
    if(index===4)await h.cmd('insurance.claim.prepare',{appointmentId:visit,policyId:patient.policy.id})
    await h.cmd('pay.cycle.preference',{clientId:patient.id,channel:index===1?'mail':'email',address:'200 Main Street\nAustin TX 78701',authorized:true,evidence:'Patient signed delivery preference',hold:index===2},desk.cookie)
  }
  await h.cmd('payment.record',{invoiceId:invoices[3].id,amountCents:9400,reference:'synthetic-balm-101'})
  const before=(await h.send('/api/balm/reports/financial?from=2020-01-01&to=2030-01-01',undefined,h.owner)).value
  await h.cmd('pay.cycle.run',{cycleOn:'2025-01-01',confirm:true},priya.cookie,403)
  const mailBefore=h.mail.length
  const batch=await h.cmd('pay.cycle.run',{cycleOn:'2025-01-01',confirm:true},desk.cookie)
  assert.equal(batch.issued,2);assert.equal(batch.totalCents,19000)
  const file=async client=>(await h.send('/api/balm/clients/'+client.id,undefined,desk.cookie)).value
  const f=await file(clients[0]),m=await file(clients[1])
  const original=f.billing.statements[0],mailOriginal=m.billing.statements[0]
  assert.equal(original.amount_cents,9500);assert.equal(mailOriginal.amount_cents,9500)
  assert.equal(f.billing.cycle.deliveries[0].outcome,'accepted');assert.equal(m.billing.cycle.deliveries[0].outcome,'prepared')
  const notice=h.mail.slice(mailBefore).filter(m=>m.to.includes('marisol@patient.example'))
  assert.equal(notice.length,1);assert.ok(notice[0].text.includes('/portal'));assert.ok(!notice[0].text.includes('Marisol'))
  const pdf=await h.send('/api/balm/statement-batches/'+batch.id+'.pdf',undefined,desk.cookie)
  assert.equal(pdf.status,200);for(const word of ['Jordan Rivera','Austin TX 78701','$95.00'])assert.ok(pdf.text.includes(word),word)
  assert.match(pdf.text,/54\.00 738\.00 Td/);assert.match(pdf.text,/54\.00 660\.00 Td/)
  const vendor=await h.send('/api/balm/statement-batches/'+batch.id+'.csv',undefined,desk.cookie)
  assert.equal(vendor.status,200);assert.ok(vendor.text.includes('Jordan Rivera'));assert.match(vendor.text,/"TOTAL","","","9500",""/)
  assert.equal((await h.send('/api/balm/statement-batches/'+batch.id+'.csv',undefined,priya.cookie)).status,403)
  const after=(await h.send('/api/balm/reports/financial?from=2020-01-01&to=2030-01-01',undefined,h.owner)).value
  assert.deepEqual(after.summary,before.summary,'statement issuance changes no financial figures')
  assert.equal((await h.cmd('pay.cycle.run',{cycleOn:'2025-01-20',confirm:true},desk.cookie)).duplicate,true)
  assert.equal(h.mail.slice(mailBefore).filter(m=>m.to.includes('marisol@patient.example')).length,1)
  const cookie=await portalLogin(h,'marisol@patient.example'),otherCookie=await portalLogin(h,'jordan@patient.example')
  assert.equal((await h.send(new URL(notice[0].text.match(/https?:\/\/[^\s]+/)[0]).pathname,undefined,cookie)).status,303)
  const bytes=(await h.send('/portal/statements/'+original.id+'.pdf',undefined,cookie)).text
  assert.match(bytes,/\$95\.00/)
  assert.equal((await h.send('/portal/statements/'+original.id+'.pdf',undefined,otherCookie)).status,404)
  const vendorOriginal=vendor.text.match(/,"([A-Za-z0-9+/=]{100,})"/)[1]
  const firstMailBytes=(await h.send('/api/balm/issued-statements/'+mailOriginal.id+'.pdf',undefined,desk.cookie)).text
  assert.equal(Buffer.from(vendorOriginal,'base64').toString(),firstMailBytes,'vendor file carries the exact printable original')
  await h.cmd('payment.record',{invoiceId:invoices[0].id,amountCents:2500,reference:'synthetic-balm-102'},desk.cookie)
  const later=await h.cmd('pay.cycle.run',{cycleOn:'2025-02-01',confirm:true},desk.cookie)
  assert.equal(later.totalCents,16500)
  const history=(await file(clients[0])).billing.statements
  assert.equal(history.length,2);assert.deepEqual(history.map(s=>s.amount_cents).sort((a,b)=>a-b),[7000,9500])
  const home=await h.send('/portal/home',undefined,cookie)
  for(const s of history)assert.ok(home.text.includes('/portal/statements/'+s.id+'.pdf'))
  assert.equal((await h.send('/portal/statements/'+original.id+'.pdf',undefined,cookie)).text,bytes)
  assert.equal((await h.send('/api/balm/issued-statements/'+mailOriginal.id+'.pdf',undefined,desk.cookie)).text,firstMailBytes)
  const latest=history.find(s=>s.id!==original.id)
  assert.match((await h.send('/portal/statements/'+latest.id+'.pdf',undefined,cookie)).text,/\$70\.00/)
  await hooks.issued?.({clients,desk,batch,cookie,original,mailOriginal})
  await h.cmd('pay.cycle.mailed',{clientId:clients[1].id,statementId:mailOriginal.id,occurredOn:new Date(Date.parse(mailOriginal.issued_at)+10*3600000).toISOString().slice(0,10),reference:'Postal handoff synthetic-balm-103'},desk.cookie)
  await h.cmd('pay.cycle.returned',{clientId:clients[1].id,statementId:mailOriginal.id,occurredOn:new Date(Date.parse(mailOriginal.issued_at)+10*3600000).toISOString().slice(0,10),reference:'Undeliverable synthetic-balm-104'},desk.cookie)
  assert.equal((await file(clients[1])).billing.cycle.preference.hold,1)
  const third=await h.cmd('pay.cycle.run',{cycleOn:'2025-03-01',confirm:true},desk.cookie)
  assert.equal(third.issued,1)
  await hooks.returned?.({clients,desk,batch,cookie})
  await h.cmd('pay.cycle.preference',{clientId:clients[2].id,channel:'text',authorized:true,evidence:'Patient requested monthly text notices'})
  const {installmentTick}=await import('./payment-plan-fixtures.mjs')
  let future
  for(const [days,message] of [[40,'at least 30 days old'],[80,'at least 60 days old'],[120,'at least 90 days old']]) {
    future=new Date(Date.parse(original.issued_at)+days*86400000).toISOString().slice(0,10)
    await installmentTick(h,future)
    const aged=(await file(clients[0])).billing.statements.find(s=>s.due_on===future.slice(0,7)+'-01')
    assert.ok(aged,'monthly scheduler issues the next cycle without staff action')
    assert.ok((await h.send('/portal/statements/'+aged.id+'.pdf',undefined,cookie)).text.includes(message))
  }
  assert.ok((await file(clients[2])).billing.cycle.deliveries.some(d=>d.outcome==='submitted'))
  const count=(await file(clients[0])).billing.statements.length
  await installmentTick(h,future)
  assert.equal((await file(clients[0])).billing.statements.length,count)
  return {clients,desk,batch,cookie}
}

export const statementCycleHarnessOptions={
 auth:{SMS_PROVIDER:'twilio',TWILIO_ACCOUNT_SID:'synthetic-balm-110',TWILIO_AUTH_TOKEN:'synthetic-balm-111',TWILIO_FROM:'+15005550006'},
 outbound:async request=>{
  assert.equal(new URL(request.url).hostname,'api.twilio.com')
  const fields=new URLSearchParams(await request.text())
  assert.ok(fields.get('Body').includes('/portal'));assert.ok(!fields.get('Body').includes('Held'))
  return Response.json({sid:'synthetic-balm-112',status:'queued'})
 }
}
