import assert from 'node:assert/strict'
import {clinic} from './clinic.mjs'

export const eligibilityPolicy=(clientId,payerId,memberId,extra={})=>({clientId,payerId,memberId,relationship:'18',patientSex:'F',address:'200 Oak St',city:'Austin',state:'TX',postalCode:'78701',startsOn:'2020-01-01',endsOn:'2099-12-31',...extra})
export async function eligibilityCohortFixture(h) {
 await h.finishSetup()
 const {service,practitioners:[priya]}=await clinic(h)
 await h.cmd('settings.save',{clinicName:'Synthetic Therapy',timeZone:'America/New_York',taxId:'12-3456789',address:'100 Main St'})
 await h.cmd('insurance.settings.save',{billingNpi:'1234567893',taxId:'123456789',address:'100 Main St',city:'Austin',state:'TX',postalCode:'78701',senderId:'BALMTEST',contactName:'Synthetic Clinic',contactPhone:'5125550100'})
 const payer=await h.cmd('insurance.payer.save',{name:'Synthetic Health',payerId:'60054',receiverId:'SYNTHETIC',unitMethod:'cms'})
 const patients=[],policies=[],visits=[]
 for(let i=0;i<4;i++) {
  const patient=await h.cmd('client.save',{firstName:'Synthetic',lastName:'Cohort '+i,dateOfBirth:'1988-04-02'})
  patients.push(patient)
  const input=eligibilityPolicy(patient.id,payer.id,'synthetic-balm-'+(301+i),{planName:'Recorded original plan'})
  const policy=await h.cmd('insurance.policy.save',input);policies.push({...policy,input})
  if(i<3)visits.push(await h.cmd('appointment.book',{clientId:patient.id,practitionerId:priya.id,serviceId:service.id,date:'2030-03-11',time:`${String(9+i).padStart(2,'0')}:00`}))
 }
 // Two visits under one policy still produce one inquiry for that civil date.
 visits.push(await h.cmd('appointment.book',{clientId:patients[0].id,practitionerId:priya.id,serviceId:service.id,date:'2030-03-11',time:'12:00'}))
 return {service,priya,payer,patients,policies,visits}
}
export async function cohortAnswer(h,requestId,member,code='1',extra=[]) {
 const exported=await h.send('/api/balm/insurance/270/'+requestId,undefined,h.owner)
 assert.equal(exported.status,200,exported.text)
 const trace=exported.text.match(/TRN\*1\*([^*~]+)/)[1]
 const segments=['ST*271*0001*005010X279A1',`TRN*2*${trace}*BALMTEST`,'NM1*PR*2*SYNTHETIC HEALTH*****PI*60054',`NM1*IL*1*COHORT*SYNTHETIC****MI*${member.toUpperCase()}`,`EB*${code}*IND*30`,...extra]
 return segments.join('~')+`~SE*${segments.length+1}*0001~`
}
export async function eligibilityCohortJourney(h) {
 const c=await eligibilityCohortFixture(h),input={kind:'next_business_day',asOfDate:'2030-03-08'}
 await h.cmd('appointment.book',{clientId:c.patients[3].id,practitionerId:c.priya.id,serviceId:c.service.id,date:'2030-03-10',time:'23:00'})
 const localNight=await h.cmd('appointment.book',{clientId:c.patients[0].id,practitionerId:c.priya.id,serviceId:c.service.id,date:'2030-03-11',time:'23:00'})
 const localVisit=(await h.state()).appointments.find(a=>a.id===localNight.appointmentId)
 assert.equal(localVisit.start_at,'2030-03-12T03:00:00.000Z','DST clinic-local date includes a visit on the following UTC date')
 const preview=()=>h.cmd('insurance.eligibility.cohort.preview',input)
 let p=await preview()
 assert.equal(p.serviceDate,'2030-03-11');assert.equal(p.timeZone,'America/New_York')
 assert.equal(p.members.length,3);assert.equal(p.members.find(m=>m.policyId===c.policies[0].id).visits.length,3)
 const reception=await h.staff('CohortReception','reception'),biller=await h.staff('CohortBiller','biller')
 for(const cookie of [reception.cookie,biller.cookie,c.priya.cookie]) {
  await h.cmd('insurance.eligibility.cohort.preview',input,cookie,403)
  await h.cmd('insurance.eligibility.cohort.prepare',{...input,digest:p.digest},cookie,403)
  assert.equal((await h.state(cookie)).insurance.eligibilityCohorts,null)
 }
 const agent=await h.cmd('agent.create',{label:'Synthetic cohort assistant'})
 const refused=await h.send('/api/balm/command',{name:'insurance.eligibility.cohort.prepare',input:{...input,digest:p.digest}},'',{authorization:'Bearer '+agent.token})
 assert.ok([401,403].includes(refused.status))
 // Review becomes stale after a cancellation; no request may be created from it.
 await h.cmd('appointment.cancel',{id:c.visits[1].appointmentId,reason:'Synthetic change',confirm:'on'})
 await h.cmd('insurance.eligibility.cohort.prepare',{...input,digest:p.digest},h.owner,409)
 p=await preview();assert.equal(p.members.length,2)
 await h.cmd('appointment.move',{id:c.visits[2].appointmentId,date:'2030-03-12',time:'11:00'})
 await h.cmd('insurance.eligibility.cohort.prepare',{...input,digest:p.digest},h.owner,409)
 p=await preview();assert.deepEqual(p.members.map(m=>m.policyId),[c.policies[0].id])
 // Policy revision after review refuses before any preparation.
 await h.cmd('insurance.policy.save',{...c.policies[0].input,id:c.policies[0].id,groupNumber:'synthetic-balm-310'})
 await h.cmd('insurance.eligibility.cohort.prepare',{...input,digest:p.digest},h.owner,409)
 assert.equal((await h.send('/api/balm/clients/'+c.patients[0].id,undefined,h.owner)).value.insurance.eligibility.length,0)
 p=await preview()
 const attempts=await Promise.all([1,2].map(()=>h.send('/api/balm/command',{name:'insurance.eligibility.cohort.prepare',input:{...input,digest:p.digest}},h.owner)))
 assert.ok(attempts.every(r=>[200,409].includes(r.status)),JSON.stringify(attempts))
 const batch=attempts.find(r=>r.status===200).value.result
 let state=await h.state(),stored=state.insurance.eligibilityCohorts.batches.find(b=>b.id===batch.id)
 assert.equal(stored.items.length,1);assert.equal(stored.items[0].status,'prepared')
 const first=stored.items[0].eligibility_id
 assert.equal((await h.cmd('insurance.eligibility.cohort.prepare',{...input,digest:p.digest})).id,batch.id)
 // Holiday and month boundaries, including a monthly cohort with no visits.
 const beforeHoliday=await h.cmd('insurance.eligibility.cohort.preview',{kind:'monthly',asOfDate:'2030-04-20'})
 assert.equal(beforeHoliday.serviceDate,'2030-04-01')
 await h.cmd('holiday.save',{date:'2030-04-01',name:'Synthetic recorded holiday'})
 await h.cmd('insurance.eligibility.cohort.prepare',{kind:'monthly',asOfDate:'2030-04-20',digest:beforeHoliday.digest},h.owner,409)
 const next={kind:'next_business_day',asOfDate:'2030-03-29'},monthly={kind:'monthly',asOfDate:'2030-04-20'}
 for(const value of [next,monthly])assert.equal((await h.cmd('insurance.eligibility.cohort.preview',value)).serviceDate,'2030-04-02')
 const aprilFirst=await h.cmd('appointment.book',{clientId:c.patients[0].id,practitionerId:c.priya.id,serviceId:c.service.id,date:'2030-04-02',time:'09:00'})
 const aprilSecond=await h.cmd('appointment.book',{clientId:c.patients[1].id,practitionerId:c.priya.id,serviceId:c.service.id,date:'2030-04-02',time:'10:00'})
 const n=await h.cmd('insurance.eligibility.cohort.preview',next),nb=await h.cmd('insurance.eligibility.cohort.prepare',{...next,digest:n.digest})
 const m=await h.cmd('insurance.eligibility.cohort.preview',monthly)
 assert.equal(m.members.length,4)
 const expired=await h.cmd('insurance.policy.save',eligibilityPolicy(c.patients[3].id,c.payer.id,'synthetic-balm-320',{startsOn:'2020-01-01',endsOn:'2030-03-31',priority:2}))
 const future=await h.cmd('insurance.policy.save',eligibilityPolicy(c.patients[3].id,c.payer.id,'synthetic-balm-321',{startsOn:'2030-05-01',priority:3}))
 const freshMonth=await h.cmd('insurance.eligibility.cohort.preview',monthly)
 assert.ok(!freshMonth.members.some(p=>[expired.id,future.id].includes(p.policyId)))
 m.digest=freshMonth.digest
 const mb=await h.cmd('insurance.eligibility.cohort.prepare',{...monthly,digest:m.digest})
 assert.equal(mb.requests.find(r=>r.policyId===c.policies[0].id).id,nb.requests.find(r=>r.policyId===c.policies[0].id).id,'overlapping cohorts reuse the same policy and date inquiry')
 const december=await h.cmd('insurance.eligibility.cohort.preview',{kind:'next_business_day',asOfDate:'2027-12-31'})
 assert.equal(december.serviceDate,'2028-01-03')
 const stale=mb.requests.find(r=>r.policyId===c.policies[3].id)
 const staleAnswer=await cohortAnswer(h,stale.id,c.policies[3].input.memberId)
 await h.cmd('insurance.policy.save',{...c.policies[3].input,id:c.policies[3].id,planName:'Explicitly changed by owner'})
 await h.cmd('insurance.eligibility.import',{id:stale.id,x12:staleAnswer},h.owner,409)
 // Mismatched trace, member and payer refuse and preserve the prepared request.
 const answer=await cohortAnswer(h,first,c.policies[0].input.memberId,'6')
 for(const x12 of [answer.replace(/TRN\*2\*[^*]+/,'TRN*2*WRONG'),answer.replace('SYNTHETIC-BALM-301','WRONG'),answer.replace('PI*60054','PI*99999')])await h.cmd('insurance.eligibility.import',{id:first,x12},h.owner,400)
 assert.equal((await h.state()).insurance.eligibilityCohorts.batches.find(b=>b.id===batch.id).items[0].status,'exported')
 const imported=await h.cmd('insurance.eligibility.import',{id:first,x12:answer})
 assert.equal(imported.status,'inactive')
 assert.equal((await h.cmd('insurance.eligibility.import',{id:first,x12:answer})).duplicate,true)
 for(const [index,code,extras,status] of [[1,'R',[],'changed'],[2,'1',['EB*F*IND*AE***29***VS*0'],'exhausted']]) {
  const request=mb.requests.find(r=>r.policyId===c.policies[index].id)
  const x12=await cohortAnswer(h,request.id,c.policies[index].input.memberId,code,extras)
  assert.equal((await h.cmd('insurance.eligibility.import',{id:request.id,x12})).status,status)
 }
 state=await h.state()
 assert.deepEqual(new Set(state.dailyClose.eligibility.map(i=>i.id)),new Set([c.visits[0].appointmentId,c.visits[3].appointmentId,localNight.appointmentId,aprilFirst.appointmentId,aprilSecond.appointmentId,c.visits[2].appointmentId]))
 assert.ok(!state.dailyClose.eligibility.some(i=>i.id===c.visits[1].appointmentId),'cancelled visit has no coverage task')
 assert.deepEqual(state.dailyClose.eligibility.map(i=>i.kind).sort(),['eligibility_changed','eligibility_exhausted','eligibility_inactive','eligibility_inactive','eligibility_inactive','eligibility_inactive'].sort())
 for(const [index,expected] of [[0,'inactive'],[1,'changed'],[2,'exhausted']]) {
  const file=(await h.send('/api/balm/clients/'+c.patients[index].id,undefined,h.owner)).value
  const policy=file.insurance.policies.find(p=>p.id===c.policies[index].id)
  assert.equal(policy.plan_name,'Recorded original plan');assert.equal(policy.payer_id,c.payer.id);assert.equal(policy.eligibility_status,expected)
 }
 const calendar=await h.send('/app?date=2030-03-11',undefined,h.owner)
 assert.match(calendar.text,/Coverage inactive/)
 assert.ok(!h.outboundRequests.some(r=>r.origin.includes('clearinghouse')),'cohort preparation and fixture import make no clearinghouse request')
 if(process.env.BALM_UI_SCREENSHOTS) {
  const {viewportProof}=await import('./viewport-proof.mjs')
  const browserRequest=mb.requests.find(r=>r.policyId===c.policies[0].id).id
  const browserAnswer=await cohortAnswer(h,browserRequest,c.policies[0].input.memberId,'6')
  await viewportProof(h,[{name:'INS-002-cohorts',path:'/app/insurance',cookie:h.owner,selector:'#eligibility-cohorts',open:'Prepare a cohort',interact:async({page,width})=>{
    if(width!==1440)return
    const panel=page.locator('#eligibility-cohorts')
    await panel.getByLabel('Cohort',{exact:true}).selectOption('monthly')
    await panel.getByLabel('Clinic date (monthly uses this month)').fill('2030-05-20')
    await panel.getByRole('button',{name:'Preview policies',exact:true}).click()
    await page.waitForURL('**/app/action?**')
    assert.match(await page.locator('#eligibility-cohort-preview').innerText(),/2030-05-01/)
    await page.getByRole('button',{name:'Prepare reviewed inquiries',exact:true}).click()
    await page.waitForLoadState('domcontentloaded')
    assert.match(await page.locator('#eligibility-cohorts').innerText(),/2030-05-01/)
   }},
   {name:'INS-002-results',path:'/app/insurance',cookie:h.owner,selector:'#eligibility-cohorts',openSelector:'#eligibility-cohorts details:has(#cohort-request-'+browserRequest+') > summary',interact:async({page,width})=>{
    if(width!==1440)return
    const request=page.locator('#cohort-request-'+browserRequest)
    await request.getByLabel('Matched 271 response').setInputFiles({name:'synthetic-balm-340.271',mimeType:'text/plain',buffer:Buffer.from(browserAnswer)})
    await request.getByRole('button',{name:'Import eligibility response',exact:true}).click()
    await page.waitForLoadState('domcontentloaded')
    const summary=page.locator('#eligibility-cohorts details:has(#cohort-request-'+browserRequest+') > summary')
    await summary.click()
    assert.match(await page.locator('#cohort-request-'+browserRequest).innerText(),/inactive/)
   }},
   {name:'INS-002-calendar',path:'/app?date=2030-03-11',cookie:h.owner,selector:'.cal-wrap',tooltips:['Previous day','Next day']},
   {name:'INS-002-daily-close',path:'/app',cookie:h.owner,selector:'#daily-close'}])
 }
 const session=await h.signIn(h.auth.OWNER_EMAIL)
 const device=(await h.send('/auth/security',undefined,session,{accept:'application/json'})).value.currentSessionId
 const beforeRevoke=await h.cmd('insurance.eligibility.cohort.preview',monthly,session)
 const beforeCount=(await h.db.prepare('SELECT COUNT(*) AS n FROM bm_eligibility').first()).n
 assert.equal((await h.send('/auth/security/revoke',{sessionId:device},h.owner)).status,200)
 await h.cmd('insurance.eligibility.cohort.prepare',{...monthly,digest:beforeRevoke.digest},session,401)
 await h.cmd('insurance.eligibility.import',{id:first,x12:answer},session,401)
 assert.equal((await h.db.prepare('SELECT COUNT(*) AS n FROM bm_eligibility').first()).n,beforeCount)
}

/** Shared custody fixture: real preparation, export and matching import doors. */
export async function recordedCohort(h,patientId,asOfDate='1990-01-01') {
 await h.cmd('insurance.settings.save',{billingNpi:'1234567893',taxId:'123456789',address:'100 Main St',city:'Austin',state:'TX',postalCode:'78701',senderId:'BALMTEST',contactName:'Synthetic Clinic',contactPhone:'5125550100'})
 const payer=await h.cmd('insurance.payer.save',{name:'Synthetic custody payer',payerId:'SYNTHETICCUSTODY',receiverId:'SYNTHETIC',unitMethod:'cms'})
 const policy=await h.cmd('insurance.policy.save',eligibilityPolicy(patientId,payer.id,'synthetic-balm-330',{startsOn:'1980-01-01'}))
 const input={kind:'monthly',asOfDate},preview=await h.cmd('insurance.eligibility.cohort.preview',input)
 const batch=await h.cmd('insurance.eligibility.cohort.prepare',{...input,digest:preview.digest})
 const request=batch.requests.find(r=>r.policyId===policy.id)
 const x12=(await cohortAnswer(h,request.id,'synthetic-balm-330','6')).replace('PI*60054','PI*SYNTHETICCUSTODY')
 await h.cmd('insurance.eligibility.import',{id:request.id,x12})
 return {batchId:batch.id,requestId:request.id,policyId:policy.id,x12}
}
