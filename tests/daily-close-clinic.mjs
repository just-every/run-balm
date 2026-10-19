import assert from 'node:assert/strict'
import {clinic,pastVisit,slots,visitDate} from './clinic.mjs'
const shift=(date,days)=>new Date(Date.parse(date+'T00:00:00Z')+days*86400_000).toISOString().slice(0,10)
const local=iso=>new Date(Date.parse(iso)+10*3600_000).toISOString()
export async function dailyCloseClinic(h){
 await h.finishSetup();const {service,practitioners:[priya]}=await clinic(h)
 await h.cmd('staff.save',{id:priya.id,name:'Priya Shah',email:priya.email,role:'practitioner',credentials:'PT',active:true})
 await h.cmd('pay.npi.save',{staffId:priya.id,npi:'1234567893'})
 await h.cmd('insurance.settings.save',{billingNpi:'1234567893',taxId:'123456789',address:'100 Main St',city:'Austin',state:'TX',postalCode:'78701',senderId:'BALMTEST',contactName:'Jordan Clinic',contactPhone:'5125550100'})
 const payer=await h.cmd('insurance.payer.save',{name:'Aetna',payerId:'60054',receiverId:'AETNA',unitMethod:'cms',fees:[{code:'97110',cents:3500}]})
 await h.cmd('insurance.enrollment.save',{payerId:payer.id,practitionerId:priya.id,taxonomy:'225100000X',active:true})
 const make=(firstName,lastName)=>h.cmd('client.save',{firstName,lastName,dateOfBirth:'1988-04-02',email:firstName.toLowerCase()+'@patient.example'})
 const patient=await make('Maya','Lee'),noCharge=await make('Noah','Kim'),late=await make('Elena','Martinez'),pending=await make('Ava','Ng'),future=await make('Tomorrow','Only')
 const today=local(new Date().toISOString()).slice(0,10),coverage={startsOn:shift(today,-365),endsOn:shift(today,365)}
 const policy=await h.cmd('insurance.policy.save',{clientId:patient.id,payerId:payer.id,memberId:'MEMBER123',relationship:'18',patientSex:'F',address:'200 Oak St',city:'Austin',state:'TX',postalCode:'78701',...coverage})

 const visit=await pastVisit(h,patient.id,priya,service.id),otherVisit=await pastVisit(h,noCharge.id,priya,service.id,h.owner,5)
 for(const id of [visit,otherVisit])await h.cmd('appointment.attend',{id})
 const authorization=await h.cmd('insurance.authorization.save',{policyId:policy.id,number:'AUTH12',...coverage,visits:2})
 await h.cmd('pay.copay.save',{clientId:patient.id,copay:'30.00'})
 const signNote=async(clientId,appointmentId)=>{
  const note=await h.cmd('note.write',{clientId,appointmentId,body:'Private therapy narrative: improved knee strength.',charges:[{code:'97110',minutes:15}]},priya.cookie)
  await h.cmd('note.sign',{id:note.id,revision:1,signature:'Priya Shah',attest:true},priya.cookie);return note
 }
 await signNote(patient.id,visit);await h.cmd('pay.codes.save',{appointmentId:visit,icd10:'M25.561'})
 const invoice=await h.cmd('invoice.prepare',{appointmentId:visit});await h.cmd('invoice.approve',{id:invoice.id})
 const auto=(await h.state()).invoices.find(i=>i.appointment_id===otherVisit&&i.status==='draft')
 await h.cmd('invoice.void',{id:auto.id,reason:'Rebuild this visit charge after documentation review'})
 const book=async clientId=>{const at=local((await slots(h,service.id,priya.id))[0]);return h.cmd('appointment.book',{clientId,practitionerId:priya.id,serviceId:service.id,date:at.slice(0,10),time:at.slice(11,16),acknowledgeInsurance:true})}
 await book(late.id);await book(pending.id);await book(future.id)
 const plan=async(clientId,startDate)=>h.cmd('plan.send',{clientId,diagnoses:'M25.561',shortTermGoals:'Walk comfortably',longTermGoals:'Return to community walking',frequencyPerWeek:2,durationWeeks:12,interventions:'Therapeutic exercise',startDate,physicianName:'Dr Anika Patel',physicianEmail:'physician@clinic.example',signature:'Priya Shah',credentials:'PT',attest:true},priya.cookie)
 const certify=async p=>{assert.equal((await h.form('/plan/'+p.token,{name:'Anika Patel',credentials:'MD',npi:'1234567893',attest:'on'})).status,303)}
 await certify(await plan(patient.id,await visitDate(h,visit)));await certify(await plan(noCharge.id,await visitDate(h,otherVisit)))
 const latePlan=await plan(late.id,shift(today,-35)),pendingPlan=await plan(pending.id,today)
 const intake=async clientId=>{
  const booking=await book(clientId);assert.ok(booking.token)
  const path='/intake/'+booking.token,page=await h.send(path)
  const consents=Object.fromEntries([...page.text.matchAll(/name="(consentVersion[^"]*)" value="([^"]+)"/g)].flatMap(([,name,value])=>[[name,value],[name.replace('Version','Accepted'),'on']]))
  const formId=page.text.match(/name="formId" value="([^"]+)"/)[1]
  assert.equal((await h.form(path,{formId,q_reason:'Recovery update',q_emergency:'Alex +1 312 555 0111',q_consent:'yes',...consents,signerName:'Patient',signerRelationship:'patient',signatureTyped:'Patient'})).status,303)
 }

 return {service,priya,payer,plan,patient,noCharge,late,pending,future,policy,authorization,visit,otherVisit,invoice,latePlan,pendingPlan,today,coverage,certify,signNote,intake}
}
