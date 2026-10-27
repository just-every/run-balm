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
 const today='2026-01-02'
 const approval={decision:'approved',decidedOn:today,reference:'synthetic-balm-5',reason:'Approved in the payer portal; reviewed written decision',number:'synthetic-balm-6',startsOn:'2000-01-01',endsOn:'2099-12-31',visits:2,bookingAction:'block',cptScope:['97161'],lowRemainder:2,attest:true}
 return {service,priya,biller,reception,payer,patient,policy,referral,appointmentId,note,plan,input,sign,today,approval}
}

export async function approveAuthorizationRelease(h,request,clientId){
 const review=await h.send('/api/balm/note-releases/'+request.id+'.pdf',undefined,h.owner)
 assert.equal(review.status,200)
 const approved=await h.cmd('note_release.approve',{...request,attest:true})
 const file=(await h.send('/api/balm/clients/'+clientId,undefined,h.owner)).value
 const release=file.noteReleases.find(r=>r.id===request.id)
 assert.equal(Date.parse(approved.expiresAt)-Date.parse(release.approved_at),7*86400000,'release lasts seven days')
 return approved
}

export async function authorizationRequestJourney(h){
 const c=await authorizationRequestFixture(h,true)
 const command='insurance.authorization_request.'
 const file=async(cookie=h.owner)=>(await h.send('/api/balm/clients/'+c.patient.id,undefined,cookie)).value
 await h.cmd(command+'prepare',c.input,h.owner,409)
 await c.sign()
 for(const cookie of [c.reception.cookie,c.priya.cookie])await h.cmd(command+'prepare',c.input,cookie,403)
 const request=await h.cmd(command+'prepare',c.input,c.biller.cookie)
 assert.equal((await h.send('/api/balm/insurance/authorization-request/'+request.id,undefined,c.biller.cookie)).status,403)
 await h.cmd('note_release.approve',{...request,attest:true},h.owner,409)
 const original=await h.send('/api/balm/insurance/authorization-request/'+request.id,undefined,h.owner)
 assert.equal(original.status,200)
 for(const text of ['Synthetic presenting condition','Walk 10 minutes without pain','LEFS: 42 points','Priya Shah','Knee flexion: 95 degrees','Synthetic precaution: protect the involved region','Perform 8 of 10 trials independently','Total treatment: 30 minutes'])assert.ok(original.text.includes(text),text+' in fixed signed packet')
 for(const cookie of ['',c.biller.cookie,c.reception.cookie,c.priya.cookie])assert.ok([401,403].includes((await h.send('/api/balm/insurance/authorization-request/'+request.id,undefined,cookie)).status))
 const client=await file(c.biller.cookie)
 assert.equal(client.notes,null,'biller never receives clinical notes')
 assert.ok(!JSON.stringify(client.insurance).includes('Synthetic presenting condition'))
 assert.deepEqual(client.insurance.authorizationPreparation.map(r=>[r.note_id,r.plan_id]),[[c.note.id,c.plan.id]],'biller receives the signed preparation choices without the clinical chart')
 assert.equal(client.insurance.authorizationRequests[0].status,'prepared')
 await h.cmd(command+'decide',{...c.approval,...request},c.biller.cookie,409)
 const submission={...request,channel:'payer_portal',submittedOn:c.today,reference:'synthetic-balm-4',attest:true}
 await h.cmd(command+'submit',{...submission,sha256:'wrong'},c.biller.cookie,409)
 for(const cookie of [c.reception.cookie,c.priya.cookie])await h.cmd(command+'submit',submission,cookie,403)
 await h.cmd(command+'submit',submission,c.biller.cookie,409)
 await h.cmd('note_release.approve',{...request,sha256:'wrong',attest:true},h.owner,409)
 await approveAuthorizationRelease(h,request,c.patient.id)
 await h.cmd(command+'submit',submission,c.biller.cookie,409)
 const received=await h.send('/api/balm/insurance/authorization-request/'+request.id,undefined,c.biller.cookie)
 assert.equal(received.status,200);assert.equal(received.text,original.text)
 await h.cmd(command+'submit',{...submission,attest:false},c.biller.cookie,400)
 await h.cmd(command+'submit',{...submission,submittedOn:'2999-01-01'},c.biller.cookie,400)
 await h.cmd(command+'submit',submission,c.biller.cookie)
 await h.cmd(command+'submit',submission,c.biller.cookie,409)
 assert.equal((await file()).insurance.authorizationRequests[0].status,'submitted')
 await h.cmd(command+'decide',{...c.approval,...request,sha256:'wrong'},c.biller.cookie,409)
 await h.cmd(command+'decide',{...c.approval,...request,attest:false},c.biller.cookie,400)
 await h.cmd(command+'decide',{...c.approval,...request,decidedOn:'2000-01-01'},c.biller.cookie,409)
 await h.cmd(command+'decide',{...c.approval,...request,decidedOn:'2999-01-01'},c.biller.cookie,409)
 const replies=await Promise.all([1,2].map(()=>h.send('/api/balm/command',{name:command+'decide',input:{...c.approval,...request}},c.biller.cookie)))
 assert.deepEqual(replies.map(r=>r.status).sort(),[200,409])
 const result=replies.find(r=>r.status===200).value.result
 const after=await file(),metadata=after.insurance.authorizationRequests.find(r=>r.id===request.id),authorization=after.insurance.authorizations.find(a=>a.id===result.authorizationId)
 assert.equal(metadata.authorization_id,authorization.id)
 assert.equal(metadata.status,'approved');assert.equal(metadata.decided_by,'priorbiller@clinic.example')
 assert.deepEqual([metadata.channel,metadata.submitted_on,metadata.submission_reference,metadata.submitted_by,metadata.decided_on,metadata.decision_reference,metadata.reason],['payer_portal',c.today,'synthetic-balm-4','priorbiller@clinic.example',c.today,c.approval.reference,c.approval.reason])
 assert.deepEqual([authorization.number,authorization.starts_on,authorization.ends_on,authorization.visits,JSON.parse(authorization.cpt_scope),authorization.booking_action],[c.approval.number,c.approval.startsOn,c.approval.endsOn,2,['97161'],'block'])
 assert.equal(authorization.policy_id,c.policy.id);assert.equal(authorization.episodeId,c.referral.episodeId)
 assert.equal(authorization.used_visits,1);assert.equal(authorization.remaining_visits,1)
 assert.ok((await h.state()).dailyClose.authorizations.some(a=>a.clientId===c.patient.id&&a.kind==='low_authorization'))
 const cases=(await h.send('/api/balm/cases',undefined,h.owner)).value.cases
 const history=cases.find(r=>r.referral.id===c.referral.id).authorizationRequests[0]
 assert.deepEqual([history.authorization_id,history.status,history.submitted_on,history.submission_reference,history.decision_reference,history.reason],[authorization.id,'approved',c.today,'synthetic-balm-4',c.approval.reference,c.approval.reason])
 await h.cmd('note.addendum',{id:c.note.id,body:'Synthetic later clinical addendum',signature:'Priya Shah',attest:true},c.priya.cookie)
 assert.equal((await h.send('/api/balm/insurance/authorization-request/'+request.id,undefined,h.owner)).text,original.text,'later clinical additions cannot rewrite submitted packet')
 await h.cmd('client.erase',{id:c.patient.id},h.owner,409)
 const audit=[];let auditBefore=''
 do{const page=(await h.send('/api/balm/clients/'+c.patient.id+(auditBefore?'?auditBefore='+auditBefore:''),undefined,h.owner)).value;audit.push(...page.audit);auditBefore=page.auditPage.older}while(auditBefore)
 for(const action of ['insurance.authorization_request_prepared','insurance.authorization_submission_recorded','insurance.authorization_decision_recorded','insurance.authorization_packet_downloaded','insurance.authorization_request_read','insurance.authorization_requests_read','insurance.authorization_preparation_choices_read','note_release.reviewed','note_release.approved','note_release.downloaded'])assert.ok(audit.some(a=>a.action===action),action+' audited')
 await h.cmd('note_release.revoke',{id:request.id})
 assert.equal((await h.send('/api/balm/insurance/authorization-request/'+request.id,undefined,c.biller.cookie)).status,403)
 const denied=await h.cmd(command+'prepare',c.input)
 await h.cmd(command+'submit',{...submission,...denied},h.owner,409)
 assert.equal((await h.send('/api/balm/insurance/authorization-request/'+denied.id,undefined,h.owner)).status,200)
 await h.cmd(command+'submit',{...submission,...denied},h.owner)
 await h.cmd(command+'decide',{...denied,decision:'denied',decidedOn:c.today,reference:'synthetic-balm-7',reason:'Payer requested further clinical support',attest:true},h.owner)
 assert.equal((await file()).insurance.authorizations.length,1,'denial creates no authorization')
 const raced=await h.cmd(command+'prepare',c.input)
 await h.send('/api/balm/insurance/authorization-request/'+raced.id,undefined,h.owner)
 await h.cmd(command+'submit',{...submission,...raced})
 const race=await Promise.all(['approved','denied'].map(decision=>h.send('/api/balm/command',{name:command+'decide',input:{...c.approval,...raced,decision}},h.owner)))
 assert.deepEqual(race.map(r=>r.status).sort(),[200,409],'approval and denial compete for one decision')
 const racedFile=await file(),racedRecord=racedFile.insurance.authorizationRequests.find(r=>r.id===raced.id)
 assert.equal(racedFile.insurance.authorizations.length,racedRecord.status==='approved'?2:1,'only the winning approval creates allowance')
 assert.equal(racedFile.insurance.authorizationRequests.filter(r=>r.id===raced.id&&r.decision).length,1)
 assert.equal(h.outboundRequests.filter(r=>!r.origin.includes('resend')).length,0,'manual request flow makes no payer call')
 assert.equal(h.mail.filter(m=>m.attachments?.length).length,0,'no packet is mailed')
 return {...c,request,denied,authorization,original:original.text}
}
