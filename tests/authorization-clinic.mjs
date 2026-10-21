import assert from 'node:assert/strict'
import {clinic,pastVisit} from './clinic.mjs'
export const localDay = t => new Date(t+10*3600_000).toISOString().slice(0,10)
export const shiftDay = (day,offset) => new Date(Date.parse(day+'T00:00:00Z')+offset*86400_000).toISOString().slice(0,10)

export async function authorizationClinic(h) {
  await h.finishSetup()
  const {service,practitioners:[priya,sam]}=await clinic(h,['Priya','Sam'])
  await h.cmd('staff.save',{id:priya.id,name:'Priya Shah',email:priya.email,role:'practitioner',credentials:'PT',active:true})
  const reception=await h.staff('Rosa','reception')
  const today=localDay(Date.now()),coverage={startsOn:shiftDay(today,-60),endsOn:shiftDay(today,30)}
  const payer=await h.cmd('insurance.payer.save',{name:'Aetna',payerId:'60054',receiverId:'AETNA',unitMethod:'cms'})
  const patient=async(first,therapist=priya)=>{
    const client=await h.cmd('client.save',{firstName:first,lastName:'Rivera',dateOfBirth:'1980-03-07',email:first.toLowerCase()+'@patient.example'})
    const policy=await h.cmd('insurance.policy.save',{clientId:client.id,payerId:payer.id,memberId:first.toUpperCase()+'123',relationship:'18',patientSex:'F',address:'200 Oak St',city:'Austin',state:'TX',postalCode:'78701',...coverage})
    return {...client,policy,therapist}
  }
  const file=async(c,cookie=h.owner)=>{const r=await h.send('/api/balm/clients/'+c.id,undefined,cookie);assert.equal(r.status,200,r.text);return r.value}
  const auth=async(c,input={})=>h.cmd('insurance.authorization.save',{policyId:c.policy.id,number:c.id.slice(0,6),...coverage,visits:12,...input})
  const book=(c,date,time='09:00',extra={},status=200)=>h.cmd('appointment.book',{clientId:c.id,practitionerId:c.therapist.id,serviceId:service.id,date,time,...extra},h.owner,status)
  const attend=async(c,hoursAgo)=>{const appointmentId=await pastVisit(h,c.id,c.therapist,service.id,h.owner,hoursAgo);await h.cmd('appointment.attend',{id:appointmentId});return appointmentId}
  // The scope journey intentionally bills 97110 and leaves 97140 at zero;
  // the clinician now records that CMS tie choice rather than relying on row order.
  const sign=async(c,appointmentId,charges=[{code:'97110',minutes:8,cmsTieChosen:true},{code:'97140',minutes:8}])=>{
    const note=await h.cmd('note.write',{clientId:c.id,appointmentId,body:'Patient tolerated therapeutic exercise and manual treatment; strength and functional tolerance improved. Continue the current plan.',charges},c.therapist.cookie)
    await h.cmd('note.sign',{id:note.id,revision:note.revision,signature:c.therapist.id===priya.id?'Priya Shah':'Sam',credentials:'PT',attest:true},c.therapist.cookie)
    return note
  }
  return {service,priya,sam,reception,today,coverage,payer,patient,file,auth,book,attend,sign}
}
