// Historical acceptance visits enter through the reviewed Cliniko move-in door.
// CMS is the only faked network edge; signing/invoices/scrubbing use real commands.
import assert from 'node:assert/strict'
import {clinic} from './clinic.mjs'
export async function codeSetClaimAdapter(h){
 const {service,practitioners:[clinician]}=await clinic(h,['synthetic-balm-70'])
 const signature='synthetic-balm-70 synthetic-balm-71'
 await h.cmd('staff.save',{id:clinician.id,name:signature,email:clinician.email,role:'practitioner',credentials:'PT',active:true})
 await h.cmd('pay.npi.save',{staffId:clinician.id,npi:'1234567893'})
 await h.cmd('insurance.settings.save',{billingNpi:'1234567893',taxId:'123456789',address:'100 synthetic-balm-70',city:'Austin',state:'TX',postalCode:'78701',contactName:'synthetic-balm-70',contactPhone:'5125550100'})
 const payer=await h.cmd('insurance.payer.save',{name:'synthetic-balm-70',payerId:'SYNTHETIC70',unitMethod:'cms',fees:['00530','00532','0932T','97110'].map(code=>({code,cents:1000}))})
 await h.cmd('insurance.enrollment.save',{payerId:payer.id,practitionerId:clinician.id,taxonomy:'225100000X',active:true})
 let counter=70
 return async input=>{
  const n=++counter,source='synthetic-balm-'+n
  const visits=input.visits??[input]
  const appointments=visits.map((v,i)=>{const hour=String(1+i*2).padStart(2,'0');return `${source}-visit-${i},${source},${input.date}T${hour}:00:00+10:00,${input.date}T${hour}:45:00+10:00,booked`}).join('\n')
  const bundle={provider:'cliniko',practitionerId:clinician.id,serviceId:service.id,dateFormat:'MDY',files:[
   {kind:'patients',name:'patients.csv',csv:`Patient ID,First Name,Last Name,Date of Birth\n${source},${source},synthetic-balm-70,1980-01-01\n`},
   {kind:'appointments',name:'appointments.csv',csv:`Source ID,Patient ID,Start At,End At,Status\n${appointments}\n`}]}
  const preview=await h.cmd('movein.preview',bundle)
  assert.equal(preview.canApply,true,JSON.stringify(preview.diagnostics))
  const applied=await h.cmd('movein.apply',{...bundle,fingerprint:preview.fingerprint,acceptanceReason:'Reviewed synthetic historical visit dates and patient mapping for quarterly code acceptance.'})
  const patient=applied.records.find(r=>r.target_table==='bm_clients').target_id
  const policy=await h.cmd('insurance.policy.save',{clientId:patient,payerId:payer.id,memberId:source,relationship:'18',patientSex:'F',address:'100 synthetic-balm-70',city:'Austin',state:'TX',postalCode:'78701',startsOn:'2025-01-01'})
  const claims=[]
  for(const [i,fields] of visits.entries()){
  const visit=applied.records.find(r=>r.source_id===`${source}-visit-${i}`).target_id
  await h.cmd('appointment.attend',{id:visit})
  await h.cmd('pay.codes.save',{appointmentId:visit,icd10:(fields.diagnoses??input.diagnoses).join('\n'),cpt:fields.lines.map(l=>[l.code,...l.modifiers].join(' ')).join('\n')})
  const charges=fields.lines.map(l=>({code:l.code,minutes:l.code==='97110'?l.units*15:0}))
  const note=await h.cmd('note.write',{clientId:patient,appointmentId:visit,body:'Synthetic clinician-recorded historical service documentation for code-set acceptance.',charges,clinical:{distinctServices:fields.distinctServices??[]}},clinician.cookie)
  await h.cmd('note.sign',{id:note.id,revision:1,signature,credentials:'PT',attest:true},clinician.cookie)
  const invoice=await h.cmd('invoice.prepare',{appointmentId:visit});await h.cmd('invoice.approve',{id:invoice.id})
  const claim=await h.cmd('insurance.claim.prepare',{appointmentId:visit,policyId:policy.id})
  assert.equal(claim.snapshot.serviceDate,input.date)
  claims.push(claim)
  }
  return input.visits?claims:claims[0]
 }
}
