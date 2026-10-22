import assert from 'node:assert/strict'
import {execFileSync} from 'node:child_process'
import {pathToFileURL} from 'node:url'
import {run} from './harness.mjs'
import {clinic,pastVisit,slots,bookOnline} from './clinic.mjs'
import {portalLogin} from './portal-billing.mjs'
// Independent federal holiday calendar for the current proof window; fixture
// dates include observed holidays rather than importing the product calculator.
const holidays=new Set(['2026-01-01','2026-01-19','2026-02-16','2026-05-25','2026-06-19','2026-07-03','2026-09-07','2026-10-12','2026-11-11','2026-11-26','2026-12-25','2027-01-01','2027-01-18','2027-02-15','2027-05-31','2027-06-18','2027-07-05','2027-09-06','2027-10-11','2027-11-11','2027-11-25','2027-12-24','2027-12-31'])
const plus=(date,n)=>new Date(Date.parse(date+'T12:00:00Z')+n*86400000).toISOString().slice(0,10)
const ahead=(date,n)=>{let d=date;while(n){d=plus(d,1);if(![0,6].includes(new Date(d+'T12:00:00Z').getUTCDay())&&!holidays.has(d))n--}return d}
export async function goodFaithJourney(h){
 await h.finishSetup()
 const {service,practitioners:[priya,other]}=await clinic(h,['Priya','Other'])
 const reception=await h.staff('EstimateDesk','reception')
 const patient=await h.cmd('client.save',{firstName:'Maya',lastName:'Estimate',dateOfBirth:'1988-04-02',email:'estimate@patient.example'})
 const otherPatient=await h.cmd('client.save',{firstName:'Other',lastName:'Estimate',email:'other-estimate@patient.example'})
 const today=new Date(Date.now()+10*3600000).toISOString().slice(0,10)
 const visit=await pastVisit(h,patient.id,priya,service.id)
 const signed=await h.cmd('note.write',{clientId:patient.id,appointmentId:visit,body:'Synthetic planned evaluation'},priya.cookie)
 const plan=await h.cmd('plan.send',{clientId:patient.id,noteId:signed.id,diagnoses:'M25.561 anticipated knee evaluation',shortTermGoals:'Evaluate function',longTermGoals:'Plan rehabilitation',frequencyPerWeek:1,durationWeeks:1,interventions:'Evaluation',startDate:today,physicianName:'Synthetic Physician',physicianEmail:'physician@example.test',signature:'Priya',credentials:'PT',attest:true},priya.cookie)
 const requests=[],originals=[]
 for(const [days,due] of [[4,1],[12,3],[null,3]]){
  const deliveryMethod=days===12?'portal':'paper'
  const appointment=days===null?null:await h.cmd('appointment.book',{clientId:patient.id,practitionerId:priya.id,serviceId:service.id,date:ahead(today,days),time:'10:00',coverageChoice:'self_pay',deliveryMethod})
  const input={clientId:patient.id,appointmentId:appointment?.appointmentId,coverageKind:'self_pay',coverageAttestation:'Patient explicitly elected self-pay for the anticipated course',deliveryMethod,attest:true}
  for(const cookie of [reception.cookie,priya.cookie])await h.cmd('estimate.request',input,cookie,403)
  const pending=appointment?(await h.state()).pendingEstimates.find(r=>r.appointment_id===appointment.appointmentId):null
  const request=appointment?{id:pending.id,dueOn:pending.due_on}:await h.cmd('estimate.request',input)
  const schedule=await h.send('/app',undefined,h.owner)
  assert.ok(schedule.text.includes(new Intl.DateTimeFormat('en-US',{timeZone:'UTC',month:'short',day:'numeric',year:'numeric'}).format(new Date(request.dueOn+'T00:00:00Z'))),'due date is on the owner schedule until issued')
  assert.equal(request.dueOn,ahead(today,due),`${days} business days scheduling deadline`)
  await h.cmd('estimate.prepare',{requestId:request.id,planId:plan.id,fromOn:plus(today,-2),throughOn:ahead(today,20),lines:[{serviceId:service.id,quantity:1}],attest:true},h.owner,400)
  const draft=await h.cmd('estimate.prepare',{requestId:request.id,planId:plan.id,fromOn:plus(today,-2),throughOn:ahead(today,20),lines:[{serviceId:service.id,quantity:1,code:'97161'}],attest:true})
  await h.cmd('estimate.issue',{id:draft.id,sha256:'wrong',attest:true},h.owner,409)
  const issued=await h.cmd('estimate.issue',{id:draft.id,sha256:draft.sha256,attest:true})
  assert.ok(issued.issuedAt.slice(0,10)<=request.dueOn)
  await h.cmd('estimate.issue',{id:draft.id,sha256:draft.sha256,attest:true},h.owner,409)
  assert.ok(!(await h.state()).pendingEstimates.some(r=>r.id===request.id),'issued request leaves the due queue')
  const issuedFile=(await h.send('/api/balm/clients/'+patient.id,undefined,h.owner)).value.estimates.issued.find(e=>e.id===issued.id)
  const paper={id:issued.id,sha256:issuedFile.sha256,method:days===4?'handed':'mailed',deliveredOn:today,attest:true}
  if(deliveryMethod==='paper')await h.cmd('estimate.deliver',paper,h.owner,409)
  const original=await h.send('/api/balm/estimates/'+issued.id+'.pdf',undefined,h.owner)
  assert.equal(original.status,200);assert.match(original.text,/Good Faith Estimate/);assert.match(original.text,/120 calendar days/);assert.match(original.text,/95.00/)
  assert.match(original.text,/M25.561/);assert.match(original.text,/97161/);assert.ok(!original.text.includes('TBD'))
  if(deliveryMethod==='paper'){
   await h.cmd('estimate.deliver',paper,reception.cookie,403)
   await h.cmd('estimate.deliver',{...paper,sha256:'wrong'},h.owner,409)
   await h.cmd('estimate.deliver',paper)
   await h.cmd('estimate.deliver',paper,h.owner,409)
   const receipt=(await h.send('/api/balm/clients/'+patient.id,undefined,h.owner)).value.estimates.issued.find(e=>e.id===issued.id).delivery
   assert.equal(receipt.method,paper.method);assert.equal(receipt.original_sha256,paper.sha256)
  }
  originals.push({id:issued.id,text:original.text});requests.push(request)
 }
 const file=async()=>{const response=await h.send('/api/balm/clients/'+patient.id,undefined,h.owner);assert.equal(response.status,200,response.text);return response.value}
 assert.equal((await file()).estimates.issued.length,3)
 const portal=await portalLogin(h,'estimate@patient.example'),unrelated=await portalLogin(h,'other-estimate@patient.example')
 const home=await h.send('/portal/home',undefined,portal);assert.equal(home.status,200)
 for(const doc of originals){assert.ok(home.text.includes('/portal/estimates/'+doc.id+'.pdf'));assert.equal((await h.send('/portal/estimates/'+doc.id+'.pdf',undefined,portal)).text,doc.text);assert.equal((await h.send('/portal/estimates/'+doc.id+'.pdf',undefined,unrelated)).status,404)}
 // A later price or name edit cannot change an issued original.
 await h.cmd('service.save',{id:service.id,name:'Updated evaluation',priceCents:12000})
 for(const doc of originals)assert.equal((await h.send('/api/balm/estimates/'+doc.id+'.pdf',undefined,h.owner)).text,doc.text)
 const staleRequest=await h.cmd('estimate.request',{clientId:patient.id,coverageKind:'uninsured',coverageAttestation:'Patient confirmed uninsured',deliveryMethod:'portal',attest:true})
 const staleDraft=await h.cmd('estimate.prepare',{requestId:staleRequest.id,planId:plan.id,fromOn:plus(today,-2),throughOn:ahead(today,20),lines:[{serviceId:service.id,quantity:1,code:'97161'}],attest:true})
 await h.cmd('service.save',{id:service.id,name:'Current evaluation',priceCents:13000})
 await h.cmd('estimate.issue',{id:staleDraft.id,sha256:staleDraft.sha256,attest:true},h.owner,409)
 await h.cmd('appointment.attend',{id:visit})
 const invoice=await h.cmd('invoice.prepare',{appointmentId:visit,amountCents:49499})
 await h.cmd('invoice.approve',{id:invoice.id})
 assert.equal((await file()).estimates.issued[0].disputeFlag,false,'$399.99 over does not flag')
 const another=await pastVisit(h,patient.id,priya,service.id,h.owner,4)
 await h.cmd('appointment.attend',{id:another})
 const oneCent=await h.cmd('invoice.prepare',{appointmentId:another,amountCents:1})
 await h.cmd('invoice.approve',{id:oneCent.id})
 assert.equal((await file()).estimates.issued[0].disputeFlag,true,'exactly $400 above flags')
 // An uncoded referral cannot be used to issue a misleading estimate.
 const uncoded=await h.cmd('case.open',{clientId:patient.id,receivedOn:today,referringFirst:'Synthetic',referringLast:'Referrer',diagnosis:'Knee pain'})
 await h.cmd('estimate.prepare',{requestId:staleRequest.id,referralId:uncoded.id,fromOn:today,throughOn:ahead(today,20),lines:[{serviceId:service.id,quantity:1,code:'97161'}],attest:true},h.owner,400)
 const open=await slots(h,service.id,other.id)
 const online=await bookOnline(h,service.id,other.id,open[0],{firstName:'Online',email:'synthetic-balm-online@patient.example',coverageChoice:'uninsured',deliveryMethod:'paper'})
 assert.equal(online.status,303,online.text)
 const onlinePending=(await h.state()).pendingEstimates.find(r=>r.delivery_method==='paper'&&r.patient==='Online Lee')
 assert.ok(onlinePending,'self-pay online booking atomically opens a request')
 const unknown=await bookOnline(h,service.id,other.id,open[4],{firstName:'Unknown',email:'synthetic-balm-unknown@patient.example',coverageChoice:'unknown'})
 assert.equal(unknown.status,303,unknown.text)
 assert.ok(!(await h.state()).pendingEstimates.some(r=>r.patient==='Unknown Lee'),'unknown coverage never becomes self-pay')
 const audit=(await h.db.prepare('SELECT action FROM bm_audit WHERE client_id=?').bind(patient.id).all()).results
 for(const action of ['estimate.requested','estimate.prepared','estimate.issued','estimate.downloaded','estimate.paper_delivered'])assert.ok(audit.some(a=>a.action===action),action)
 return {patient,service,requests,originals,portal}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 const head=execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim()
 assert.equal(execFileSync('git',['status','--porcelain'],{encoding:'utf8'}).trim(),'','timing journey requires a clean committed candidate')
 await run(goodFaithJourney)
 console.log('PASS PAY-007 timing journey head='+head+' run=sx-balm-c24-gfe-'+head)
}
