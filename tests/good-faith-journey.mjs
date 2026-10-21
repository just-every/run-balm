import assert from 'node:assert/strict'
import {execFileSync} from 'node:child_process'
import {pathToFileURL} from 'node:url'
import {run} from './harness.mjs'
import {clinic,pastVisit} from './clinic.mjs'
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
 const plan=await h.cmd('plan.send',{clientId:patient.id,noteId:signed.id,diagnoses:'Anticipated knee evaluation',shortTermGoals:'Evaluate function',longTermGoals:'Plan rehabilitation',frequencyPerWeek:1,durationWeeks:1,interventions:'Evaluation',startDate:today,physicianName:'Synthetic Physician',physicianEmail:'physician@example.test',signature:'Priya',credentials:'PT',attest:true},priya.cookie)
 const requests=[],originals=[]
 for(const [days,due] of [[4,1],[12,3],[null,3]]){
  const appointment=days===null?null:await h.cmd('appointment.book',{clientId:patient.id,practitionerId:priya.id,serviceId:service.id,date:ahead(today,days),time:'10:00'})
  const input={clientId:patient.id,appointmentId:appointment?.appointmentId,coverageKind:'self_pay',coverageAttestation:'Patient explicitly elected self-pay for the anticipated course',attest:true}
  for(const cookie of [reception.cookie,priya.cookie])await h.cmd('estimate.request',input,cookie,403)
  const request=await h.cmd('estimate.request',input)
  assert.equal(request.dueOn,ahead(today,due),`${days} business days scheduling deadline`)
  const draft=await h.cmd('estimate.prepare',{requestId:request.id,planId:plan.id,fromOn:plus(today,-2),throughOn:ahead(today,20),lines:[{serviceId:service.id,quantity:1}],attest:true})
  await h.cmd('estimate.issue',{id:draft.id,sha256:'wrong',attest:true},h.owner,409)
  const issued=await h.cmd('estimate.issue',{id:draft.id,sha256:draft.sha256,attest:true})
  assert.ok(issued.issuedAt.slice(0,10)<=request.dueOn)
  await h.cmd('estimate.issue',{id:draft.id,sha256:draft.sha256,attest:true},h.owner,409)
  const original=await h.send('/api/balm/estimates/'+issued.id+'.pdf',undefined,h.owner)
  assert.equal(original.status,200);assert.match(original.text,/Good Faith Estimate/);assert.match(original.text,/120 calendar days/);assert.match(original.text,/95.00/)
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
 const staleRequest=await h.cmd('estimate.request',{clientId:patient.id,coverageKind:'uninsured',coverageAttestation:'Patient confirmed uninsured',attest:true})
 const staleDraft=await h.cmd('estimate.prepare',{requestId:staleRequest.id,fromOn:plus(today,-2),throughOn:ahead(today,20),lines:[{serviceId:service.id,quantity:1}],attest:true})
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
 const audit=(await h.db.prepare('SELECT action FROM bm_audit WHERE client_id=?').bind(patient.id).all()).results
 for(const action of ['estimate.requested','estimate.prepared','estimate.issued','estimate.downloaded'])assert.ok(audit.some(a=>a.action===action),action)
 return {patient,service,requests,originals,portal}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 const head=execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim()
 assert.equal(execFileSync('git',['status','--porcelain'],{encoding:'utf8'}).trim(),'','timing journey requires a clean committed candidate')
 await run(goodFaithJourney)
 console.log('PASS PAY-007 timing journey head='+head+' run=sx-balm-c23-gfe-'+head)
}
