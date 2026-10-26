import assert from 'node:assert/strict'
import {clinic,pastVisit,visitDate} from './clinic.mjs'
import {chartFixture} from './chart-template-journey.mjs'

export async function authorizationRequestFixture(h,custom=false){
 await h.finishSetup()
 const {service,practitioners:[priya]}=await clinic(h)
 await h.cmd('staff.save',{id:priya.id,name:'Priya Shah',email:priya.email,role:'practitioner',credentials:'PT',active:true})
 const biller=await h.staff('PriorBiller','biller'),reception=await h.staff('PriorDesk','reception')
 const payer=await h.cmd('insurance.payer.save',{name:'Synthetic Therapy Payer',payerId:'SYNTHETICBALM1',unitMethod:'cms'})
 const patient=await h.cmd('client.save',{firstName:'Maya',lastName:'River',dateOfBirth:'1988-04-02'})
 const policy=await h.cmd('insurance.policy.save',{clientId:patient.id,payerId:payer.id,memberId:'synthetic-balm-1',relationship:'18',patientSex:'F',address:'200 Oak St',city:'Austin',state:'TX',postalCode:'78701',startsOn:'2000-01-01',endsOn:'2099-12-31'})
 const referral=await h.cmd('case.open',{clientId:patient.id,policyId:policy.id,receivedOn:'2000-01-01',referringFirst:'Synthetic',referringLast:'Physician',episodeTitle:'Knee therapy',source:'physician'})
 const appointmentId=await pastVisit(h,patient.id,priya,service.id,h.owner,4,{episodeId:referral.episodeId})
 await h.cmd('appointment.attend',{id:appointmentId})
 const chosen=custom?await h.cmd('template.save',{baseKey:'pt.evaluation',title:'Knee therapy evaluation',bodyRegion:'Lower extremity',customFields:[]}):null
 const note=await h.cmd('note.write',{clientId:patient.id,appointmentId,template:chosen?.id??'pt.evaluation',...chartFixture('evaluation')},priya.cookie)
 await h.cmd('note.measure',{noteId:note.id,kind:'score',name:'LEFS',value:'42',unit:'points'},priya.cookie)
 await h.cmd('note.measure',{noteId:note.id,kind:'rom',name:'Knee flexion',side:'right',value:'95',unit:'degrees'},priya.cookie)
 const plan=await h.cmd('plan.send',{clientId:patient.id,noteId:note.id,episodeId:referral.episodeId,diagnoses:'M25.561',shortTermGoals:'Walk 10 minutes without pain',longTermGoals:'Resume independent community walking',frequencyPerWeek:2,durationWeeks:6,interventions:'Graded strengthening and gait training',startDate:await visitDate(h,appointmentId),physicianName:'Synthetic Physician',physicianEmail:'synthetic-balm-2@example.test',signature:'Priya Shah',credentials:'PT',attest:true},priya.cookie)
 const input={referralId:referral.id,noteId:note.id,planId:plan.id}
 const sign=()=>h.cmd('note.sign',{id:note.id,revision:1,signature:'Priya Shah',attest:true},priya.cookie)
 const today=new Date().toISOString().slice(0,10)
 const approval={decision:'approved',decidedOn:today,reference:'synthetic-balm-5',reason:'Approved in the payer portal; reviewed written decision',number:'synthetic-balm-6',startsOn:'2000-01-01',endsOn:'2099-12-31',visits:2,bookingAction:'block',lowRemainder:2,attest:true}
 return {service,priya,biller,reception,payer,patient,policy,referral,appointmentId,note,plan,input,sign,today,approval}
}

export async function authorizationRequestJourney(h){
 const c=await authorizationRequestFixture(h,true)
 const command='insurance.authorization_request.'
 const file=async(cookie=h.owner)=>(await h.send('/api/balm/clients/'+c.patient.id,undefined,cookie)).value
 await h.cmd(command+'prepare',c.input,h.owner,409)
 await c.sign()
 for(const cookie of [c.biller.cookie,c.reception.cookie,c.priya.cookie])await h.cmd(command+'prepare',c.input,cookie,403)
 const request=await h.cmd(command+'prepare',c.input)
 const original=await h.send('/api/balm/insurance/authorization-request/'+request.id,undefined,h.owner)
 assert.equal(original.status,200)
 for(const text of ['Synthetic presenting condition','Walk 10 minutes without pain','LEFS: 42 points','Priya Shah','Knee flexion: 95 degrees','Synthetic precaution: protect the involved region','Perform 8 of 10 trials independently','Total treatment: 30 minutes'])assert.ok(original.text.includes(text),text+' in fixed signed packet')
 for(const cookie of ['',c.biller.cookie,c.reception.cookie,c.priya.cookie])assert.ok([401,403].includes((await h.send('/api/balm/insurance/authorization-request/'+request.id,undefined,cookie)).status))
 const client=await file(c.biller.cookie)
 assert.equal(client.notes,null,'biller never receives clinical notes')
 assert.ok(!JSON.stringify(client.insurance.authorizationRequests).includes('Synthetic presenting condition'))
 assert.equal(client.insurance.authorizationRequests[0].status,'prepared')
 await h.cmd(command+'decide',{...c.approval,...request},c.biller.cookie,409)
 const submission={...request,channel:'payer_portal',submittedOn:c.today,reference:'synthetic-balm-4',attest:true}
 await h.cmd(command+'submit',{...submission,sha256:'wrong'},c.biller.cookie,409)
 for(const cookie of [c.reception.cookie,c.priya.cookie])await h.cmd(command+'submit',submission,cookie,403)
 await h.cmd(command+'submit',submission,c.biller.cookie)
 await h.cmd(command+'submit',submission,c.biller.cookie,409)
 assert.equal((await file()).insurance.authorizationRequests[0].status,'submitted')
 const replies=await Promise.all([1,2].map(()=>h.send('/api/balm/command',{name:command+'decide',input:{...c.approval,...request}},c.biller.cookie)))
 assert.deepEqual(replies.map(r=>r.status).sort(),[200,409])
 const result=replies.find(r=>r.status===200).value.result
 const after=await file(),metadata=after.insurance.authorizationRequests.find(r=>r.id===request.id),authorization=after.insurance.authorizations.find(a=>a.id===result.authorizationId)
 assert.equal(metadata.authorization_id,authorization.id)
 assert.equal(metadata.status,'approved');assert.equal(metadata.decided_by,'priorbiller@clinic.example')
 assert.equal(authorization.policy_id,c.policy.id);assert.equal(authorization.episodeId,c.referral.episodeId)
 assert.equal(authorization.used_visits,1);assert.equal(authorization.remaining_visits,1)
 assert.ok((await h.state()).dailyClose.authorizations.some(a=>a.clientId===c.patient.id&&a.kind==='low_authorization'))
 const cases=(await h.send('/api/balm/cases',undefined,h.owner)).value.cases
 assert.equal(cases.find(r=>r.referral.id===c.referral.id).authorizationRequests[0].authorization_id,authorization.id)
 await h.cmd('note.addendum',{id:c.note.id,body:'Synthetic later clinical addendum',signature:'Priya Shah',attest:true},c.priya.cookie)
 assert.equal((await h.send('/api/balm/insurance/authorization-request/'+request.id,undefined,h.owner)).text,original.text,'later clinical additions cannot rewrite submitted packet')
 await h.cmd('client.erase',{id:c.patient.id},h.owner,409)
 for(const action of ['insurance.authorization_request_prepared','insurance.authorization_submission_recorded','insurance.authorization_decision_recorded','insurance.authorization_packet_downloaded'])assert.ok(after.audit.some(a=>a.action===action)|| (await file()).audit.some(a=>a.action===action),action+' audited')
 const denied=await h.cmd(command+'prepare',c.input)
 await h.cmd(command+'submit',{...submission,...denied},h.owner)
 await h.cmd(command+'decide',{...denied,decision:'denied',decidedOn:c.today,reference:'synthetic-balm-7',reason:'Payer requested further clinical support',attest:true},h.owner)
 assert.equal((await file()).insurance.authorizations.length,1,'denial creates no authorization')
 assert.equal(h.outboundRequests.filter(r=>!r.origin.includes('resend')).length,0,'manual request flow makes no payer call')
 return {...c,request,denied,authorization,original:original.text}
}
