import assert from 'node:assert/strict'
import {clinic,pastVisit} from './clinic.mjs'
import {portalLogin} from './portal-billing.mjs'

/** Real commands and original downloads; only the harness's email edge is synthetic. */
export async function coProviderEstimateJourney(h){
 await h.finishSetup()
 const {service,practitioners:[therapist]}=await clinic(h,['Priya'])
 await h.cmd('settings.save',{clinicName:'Riverside Therapy',timeZone:'Australia/Brisbane',taxId:'12-3456789',practiceNpi:'1234567893',address:'100 Main St, Austin TX 78701'})
 const desk=await h.staff('QuoteDesk','reception'),patient=await h.cmd('client.save',{firstName:'Maya',lastName:'Contributor',dateOfBirth:'1988-04-02',email:'contributors@patient.example'})
 await h.cmd('client.save',{firstName:'Other',lastName:'Contributor',email:'other-contributors@patient.example'})
 const today=new Date(Date.now()+10*3600000).toISOString().slice(0,10),plus=n=>new Date(Date.parse(today+'T12:00:00Z')+n*86400000).toISOString().slice(0,10)
 const visit=await pastVisit(h,patient.id,therapist,service.id)
 const note=await h.cmd('note.write',{clientId:patient.id,appointmentId:visit,body:'Synthetic planned evaluation'},therapist.cookie)
 const plan=await h.cmd('plan.send',{clientId:patient.id,noteId:note.id,diagnoses:'M25.561 anticipated knee evaluation',shortTermGoals:'Evaluate function',longTermGoals:'Plan rehabilitation',frequencyPerWeek:1,durationWeeks:1,interventions:'Evaluation',startDate:today,physicianName:'Synthetic Physician',physicianEmail:'physician@example.test',signature:'Priya',credentials:'PT',attest:true},therapist.cookie)
 const requestInput={clientId:patient.id,coverageKind:'self_pay',coverageAttestation:'Patient explicitly elected self-pay for this course',deliveryMethod:'portal',attest:true}
 const request=await h.cmd('estimate.request',requestInput,desk.cookie)
 const quote={name:'Synthetic Imaging Center',npi:'1245319599',taxId:'98-7654321',address:'200 Main St, Austin TX 78701',sourceReference:'Written quote IMG-001 kept in clinic records',receivedOn:today,diagnosisCodes:['M25.561'],lines:[{name:'Knee imaging',code:'73721',quantity:2,unitCents:30000}],attest:true}
 const preparation={requestId:request.id,planId:plan.id,fromOn:plus(-3),throughOn:plus(30),lines:[{serviceId:service.id,quantity:1,code:'97161',unitCents:1}],contributors:[quote],attest:true}
 const file=async()=>{
  const response=await h.send('/api/balm/clients/'+patient.id,undefined,h.owner)
  assert.equal(response.status,200,response.text);return response.value.estimates
 }
 const before=(await file()).drafts.length,mailBefore=h.mail.length
 const invalidQuotes=[
  {...quote,sourceReference:''},{...quote,receivedOn:''},{...quote,receivedOn:'2026-99-99'},{...quote,address:''},
  {...quote,npi:'1245319590'},{...quote,taxId:''},{...quote,attest:false},
  {...quote,diagnosisCodes:[]},{...quote,diagnosisCodes:['not-a-code']},
  {...quote,lines:[{...quote.lines[0],code:''}]},
  {...quote,lines:[{...quote.lines[0],quantity:0}]},
  {...quote,lines:[{...quote.lines[0],unitCents:1.5}]},
  {...quote,npi:'1234567893'}
 ]
 await Promise.all(invalidQuotes.map(item=>h.cmd('estimate.prepare',{...preparation,contributors:[item]},desk.cookie,400)))
 await h.cmd('estimate.prepare',{...preparation,contributors:[quote,quote]},desk.cookie,400)
 await h.cmd('estimate.prepare',{...preparation,contributors:Array(9).fill(quote)},desk.cookie,400)
 await h.cmd('estimate.prepare',{...preparation,contributors:{}},desk.cookie,400)
 await h.cmd('estimate.prepare',{...preparation,lines:[{...preparation.lines[0],quantity:2}]},desk.cookie,400)
 assert.equal((await file()).drafts.length,before,'refused provider facts never produce a draft')
 const draft=await h.cmd('estimate.prepare',preparation,desk.cookie)
 const practiceTotalCents=9500,contributorTotalCents=quote.lines[0].quantity*quote.lines[0].unitCents
 assert.equal(draft.practiceTotalCents,practiceTotalCents,'practice still uses its current cash fee')
 assert.equal(draft.contributorTotalCents,contributorTotalCents)
 assert.equal(draft.totalCents,practiceTotalCents+contributorTotalCents)
 assert.deepEqual(draft.contributors[0],{...quote,lines:[{...quote.lines[0],totalCents:contributorTotalCents}],totalCents:contributorTotalCents})
 // An updated quote is a separate preparation, leaving the first reviewed digest intact.
 const revisedQuote={...quote,sourceReference:'Written quote IMG-002 superseding IMG-001',lines:[{...quote.lines[0],unitCents:35000}]}
 const revised=await h.cmd('estimate.prepare',{...preparation,contributors:[revisedQuote]},desk.cookie)
 assert.notEqual(revised.sha256,draft.sha256)
 await h.cmd('estimate.issue',{id:draft.id,sha256:revised.sha256,attest:true},h.owner,409)
 await h.cmd('estimate.issue',{id:draft.id,sha256:draft.sha256,attest:true},desk.cookie,403)
 const issued=await h.cmd('estimate.issue',{id:draft.id,sha256:draft.sha256,contributors:[revisedQuote],attest:true})
 assert.equal(issued.totalCents,draft.totalCents)
 await h.cmd('estimate.issue',{id:draft.id,sha256:draft.sha256,attest:true},h.owner,409)
 const original=await h.send('/api/balm/estimates/'+issued.id+'.pdf',undefined,h.owner)
 assert.equal(original.status,200,original.text)
 for(const fact of [quote.name,quote.npi,quote.taxId,quote.sourceReference,quote.receivedOn,quote.diagnosisCodes[0],quote.lines[0].code,'$600.00','$95.00','$695.00'])assert.ok(original.text.includes(fact),fact)
 assert.ok(!original.text.includes(revisedQuote.sourceReference),'issuance uses the stored reviewed quote')
 const saved=(await file()).issued.find(e=>e.id===issued.id)
 assert.equal(saved.practiceTotalCents,practiceTotalCents)
 assert.deepEqual(saved.contributors,draft.contributors)
 assert.equal(h.mail.length,mailBefore,'recording quotes and issuing estimates never sends email')
 // Other providers' quotes must never dilute the local practice's dispute threshold.
 await h.cmd('appointment.attend',{id:visit})
 const invoice=await h.cmd('invoice.prepare',{appointmentId:visit,amountCents:practiceTotalCents+39999})
 await h.cmd('invoice.approve',{id:invoice.id})
 let comparison=(await file()).issued.find(e=>e.id===issued.id)
 assert.equal(comparison.overByCents,39999);assert.equal(comparison.disputeFlag,false)
 const another=await pastVisit(h,patient.id,therapist,service.id,h.owner,5)
 await h.cmd('appointment.attend',{id:another})
 const penny=await h.cmd('invoice.prepare',{appointmentId:another,amountCents:1})
 await h.cmd('invoice.approve',{id:penny.id})
 comparison=(await file()).issued.find(e=>e.id===issued.id)
 assert.ok(comparison.billedCents<comparison.total_cents,'aggregate quote exceeds all recorded practice invoices')
 assert.equal(comparison.overByCents,40000);assert.equal(comparison.disputeFlag,true)
 const portal=await portalLogin(h,'contributors@patient.example'),unrelated=await portalLogin(h,'other-contributors@patient.example')
 const home=await h.send('/portal/home',undefined,portal)
 assert.equal(home.status,200,home.text);assert.ok(home.text.includes('/portal/estimates/'+issued.id+'.pdf'))
 assert.equal((await h.send('/portal/estimates/'+issued.id+'.pdf',undefined,portal)).text,original.text)
 assert.equal((await h.send('/portal/estimates/'+issued.id+'.pdf',undefined,unrelated)).status,404)
 // A local fee edit invalidates a pending draft, while the aggregate original stays fixed.
 const nextRequest=await h.cmd('estimate.request',requestInput)
 const next=await h.cmd('estimate.prepare',{...preparation,requestId:nextRequest.id})
 await h.cmd('service.save',{id:service.id,name:'Revised evaluation',priceCents:12000})
 await h.cmd('estimate.issue',{id:next.id,sha256:next.sha256,attest:true},h.owner,409)
 assert.equal((await h.send('/api/balm/estimates/'+issued.id+'.pdf',undefined,h.owner)).text,original.text)
 assert.equal((await h.send('/portal/estimates/'+issued.id+'.pdf',undefined,portal)).text,original.text)
 return {patient,service,request,draft,issued,original,portal}
}
