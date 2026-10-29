import assert from 'node:assert/strict'
import {createHash} from 'node:crypto'
import {clinic,pastVisit,visitDate} from './clinic.mjs'

export const institutionalInstructions={billType:'741',revenueMappings:[{code:'97110',revenueCode:'0420'},{code:'97140',revenueCode:'0420'}],planSpanCode:'74',enrollmentReference:'synthetic-balm-301 owner-recorded agency enrollment',source:'synthetic-balm-302 synthetic payer guide; structural test only',active:true,attest:true}
export async function institutionalFixture(h,{historical=false}={}){
 await h.finishSetup()
 const {service,practitioners:[priya]}=await clinic(h)
 await h.cmd('staff.save',{id:priya.id,name:'Priya Shah',email:priya.email,role:'practitioner',credentials:'PT',active:true})
 await h.cmd('pay.npi.save',{staffId:priya.id,npi:'1234567893'})
 await h.cmd('insurance.settings.save',{billingNpi:'1234567893',taxId:'123456789',address:'100 Synthetic St',city:'Austin',state:'TX',postalCode:'78701',senderId:'SYNTHETICBALM',contactName:'Synthetic Billing',contactPhone:'5125550100'})
 const payerInput={name:'Synthetic Medicare',payerId:'SYNTHETICMC',receiverId:'SYNTHETICMC',medicare:true,unitMethod:'cms',fees:[{code:'97110',cents:3500},{code:'97140',cents:2500}]}
 const payer=await h.cmd('insurance.payer.save',payerInput)
 await h.cmd('insurance.enrollment.save',{payerId:payer.id,practitionerId:priya.id,taxonomy:'225100000X',active:true})
 const patient=await h.cmd('client.save',{firstName:'Synthetic',lastName:'Institutional',dateOfBirth:'1950-01-01'})
 const policyInput={clientId:patient.id,payerId:payer.id,memberId:'synthetic-balm-303',relationship:'18',patientSex:'F',address:'200 Synthetic St',city:'Austin',state:'TX',postalCode:'78701',startsOn:'1980-01-01',endsOn:'2099-12-31'}
 const policy=await h.cmd('insurance.policy.save',policyInput)
 const appointmentId=await pastVisit(h,patient.id,priya,service.id)
 if(historical)await h.db.prepare('UPDATE bm_appointments SET start_at=?,end_at=? WHERE id=?').bind('1990-01-02T02:00:00Z','1990-01-02T02:45:00Z',appointmentId).run()
 const serviceDate=await visitDate(h,appointmentId),year=Number(serviceDate.slice(0,4))
 // Historical custody uses the supported minimum year only for unrelated annual settings.
 if(year>=2000)await h.cmd('insurance.medicare.settings.save',{year,therapyGroup:'pt_slp',thresholdCents:250000,reviewCents:300000,publishedOn:year+'-01-01',source:'synthetic-balm-304 synthetic annual settings'})
 await h.cmd('appointment.attend',{id:appointmentId})
 const note=await h.cmd('note.write',{clientId:patient.id,appointmentId,body:'Synthetic signed treatment original',charges:[{code:'97110',minutes:23},{code:'97140',minutes:15}]},priya.cookie)
 await h.cmd('note.sign',{id:note.id,revision:1,signature:'Priya Shah',attest:true},priya.cookie)
 await h.cmd('pay.codes.save',{appointmentId,icd10:'M25.561'})
 const invoice=await h.cmd('invoice.prepare',{appointmentId});await h.cmd('invoice.approve',{id:invoice.id})
 const planInput={clientId:patient.id,noteId:note.id,diagnoses:'M25.561',shortTermGoals:'Synthetic walking goal',longTermGoals:'Synthetic mobility goal',frequencyPerWeek:2,durationWeeks:6,interventions:'Synthetic strengthening',startDate:new Date(Date.parse(serviceDate+'T00:00:00Z')-7*86400000).toISOString().slice(0,10),physicianName:'Synthetic Physician',physicianEmail:['synthetic-balm-305','example.test'].join('@'),signature:'Priya Shah',credentials:'PT',attest:true}
 const plan=await h.cmd('plan.send',planInput,priya.cookie)
 const signed=await h.form('/plan/'+plan.token,{name:'Synthetic Physician',credentials:'MD',npi:'1234567893',attest:'on'})
 assert.equal(signed.status,303)
 const planRecord=(await h.send('/api/balm/clients/'+patient.id,undefined,h.owner)).value.plans.find(p=>p.id===plan.id)
 const visitInput={appointmentId,policyId:policy.id,planId:plan.id,attendingFirst:'Synthetic',attendingLast:'Physician',attendingNpi:'1234567893',patientStatus:'01',occurrences:[{code:'29',date:serviceDate}],source:'synthetic-balm-306 synthetic occurrence instruction',attest:true}
 const input={appointmentId,policyId:policy.id,claimFormat:'837I'}
 const file=async(cookie=h.owner)=>(await h.send('/api/balm/clients/'+patient.id,undefined,cookie)).value
 return {service,priya,payer,payerInput,patient,policy,policyInput,appointmentId,serviceDate,note,invoice,plan,planInput,planRecord,visitInput,input,file}
}
export function inspectInstitutionalFile(body,c,claimId){
 assert.equal(body.slice(0,3),'ISA');assert.equal(body[105],'~','ISA has the fixed-width envelope length')
 const segments=body.trim().split('~').filter(Boolean).map(s=>s.split('*')),find=name=>segments.find(s=>s[0]===name),all=name=>segments.filter(s=>s[0]===name)
 assert.equal(find('ISA')[15],'T','structural exports never assert production qualification')
 assert.equal(find('IEA')[2],find('ISA')[13]);assert.equal(find('IEA')[1],'1')
 assert.equal(find('GS')[1],'HC');assert.equal(find('GS')[8],'005010X223A2');assert.equal(find('GE')[2],find('GS')[6]);assert.equal(find('GE')[1],'1')
 assert.deepEqual(find('ST'),['ST','837','0001','005010X223A2'])
 const start=segments.findIndex(s=>s[0]==='ST'),end=segments.findIndex(s=>s[0]==='SE')
 assert.equal(Number(find('SE')[1]),end-start+1);assert.equal(find('SE')[2],find('ST')[2])
 assert.deepEqual(all('HL'),[['HL','1','','20','1'],['HL','2','1','22','0']])
 assert.ok(all('NM1').some(s=>s[1]==='IL'&&s[3]==='INSTITUTIONAL'&&s[4]==='SYNTHETIC'&&s[9]==='SYNTHETIC-BALM-303'))
 assert.ok(all('NM1').some(s=>s[1]==='85'&&s[9]==='1234567893'))
 assert.ok(all('NM1').some(s=>s[1]==='PR'&&s[9]==='SYNTHETICMC'))
 assert.ok(all('NM1').some(s=>s[1]==='71'&&s[3]==='PHYSICIAN'&&s[4]==='SYNTHETIC'&&s[9]==='1234567893'))
 assert.ok(all('NM1').some(s=>s[1]==='82'&&s[3]==='SHAH'&&s[9]==='1234567893'))
 const clm=find('CLM');assert.equal(clm[1],claimId);assert.equal(clm[2],'95.00');assert.equal(clm[5],'74:A:1')
 assert.deepEqual(find('CL1'),['CL1','','','01'])
 assert.deepEqual(all('SV2'),[['SV2','0420','HC:97110:GP','70.00','UN','2'],['SV2','0420','HC:97140:GP','25.00','UN','1']])
 assert.equal(all('SV1').length,0)
 const day=c.serviceDate.replaceAll('-',''),startDay=c.planInput.startDate.replaceAll('-',''),through=new Date(Date.parse(c.planInput.startDate+'T00:00:00Z')+41*86400000).toISOString().slice(0,10).replaceAll('-','')
 assert.ok(all('DTP').some(s=>s[1]==='434'&&s[2]==='RD8'&&s[3]===day+'-'+day))
 assert.deepEqual(all('DTP').filter(s=>s[1]==='472').map(s=>s.slice(2)),[['D8',day],['D8',day]])
 assert.ok(all('HI').some(s=>s[1]==='ABK:M25561'))
 assert.ok(all('HI').some(s=>s[1]==='BH:29:D8:'+day))
 assert.ok(all('HI').some(s=>s[1]==='BI:74:RD8:'+startDay+'-'+through))
 assert.deepEqual(all('LX'),[['LX','1'],['LX','2']]);assert.equal(new Set(all('REF').filter(s=>s[1]==='6R').map(s=>s[2])).size,2)
 return createHash('sha256').update(body).digest('hex')
}
export async function institutionalJourney(h){
 const c=await institutionalFixture(h),biller=await h.staff('InstitutionalBiller','biller'),reception=await h.staff('InstitutionalDesk','reception')
 const originalLedger=(await c.file()).billing.ledger
 await h.cmd('insurance.claim.prepare',c.input,h.owner,409)
 await h.cmd('insurance.institutional.settings',{...institutionalInstructions,billType:'751'},h.owner,400)
 await h.cmd('insurance.institutional.settings',{...institutionalInstructions,revenueMappings:[{code:'97110',revenueCode:'420'}]},h.owner,400)
 for(const cookie of [biller.cookie,reception.cookie,c.priya.cookie]){
  await h.cmd('insurance.institutional.settings',institutionalInstructions,cookie,403)
  await h.cmd('insurance.institutional.visit',c.visitInput,cookie,403)
 }
 const settingsForm={...institutionalInstructions,attest:'on',active:'on',revenueLines:'97110 0420\n97140 0420'};delete settingsForm.revenueMappings
 assert.equal((await h.form('/app/action?name=insurance.institutional.settings&returnTo=%2Fapp%2Fclinic',settingsForm,h.owner)).status,303)
 await h.cmd('insurance.claim.prepare',c.input,h.owner,409)
 await h.cmd('insurance.institutional.visit',{...c.visitInput,occurrences:[{code:'29',date:'2099-01-01'}]},h.owner,400)
 const other=await h.cmd('client.save',{firstName:'Synthetic',lastName:'Other',dateOfBirth:'1950-01-01'})
 const otherPolicy=await h.cmd('insurance.policy.save',{...c.policyInput,clientId:other.id,memberId:'synthetic-balm-307'})
 await h.cmd('insurance.institutional.visit',{...c.visitInput,policyId:otherPolicy.id},h.owner,404)
 await h.cmd('insurance.institutional.visit',{...c.visitInput,attendingNpi:'0000000000'},h.owner,400)
 const visitForm={...c.visitInput,attest:'on',occurrenceLines:'29 '+c.serviceDate};delete visitForm.occurrences
 assert.equal((await h.form('/app/action?name=insurance.institutional.visit&returnTo='+encodeURIComponent('/app/clients/'+c.patient.id),visitForm,h.owner)).status,303)
 await h.cmd('insurance.claim.prepare',{...c.input,policyId:otherPolicy.id},h.owner,404)
 const claim=await h.cmd('insurance.claim.prepare',c.input,biller.cookie);assert.equal(claim.status,'ready');assert.equal(claim.amountCents,9500)
 assert.equal(claim.snapshot.institutional.plan.sha256,c.planRecord.sha256)
 assert.ok(!JSON.stringify(claim.snapshot.institutional).includes('Synthetic walking goal'))
 await h.cmd('insurance.claim.prepare',{...c.input,claimFormat:'837P'},h.owner,409)
 await h.cmd('insurance.claim.correct',{id:claim.id,claimFormat:'837P'},h.owner,409)
 // Changes are reviewed on the existing claim; originals cannot be silently rebuilt in a batch.
 await h.cmd('insurance.institutional.settings',{...institutionalInstructions,revenueMappings:[{code:'97110',revenueCode:'0430'}]})
 await h.cmd('insurance.batch.prepare',{claimIds:[claim.id]},h.owner,409)
 await h.cmd('insurance.institutional.settings',{...institutionalInstructions,active:false})
 await h.cmd('insurance.batch.prepare',{claimIds:[claim.id]},h.owner,409)
 await h.cmd('insurance.institutional.settings',institutionalInstructions)
 await h.cmd('insurance.claim.scrub',{id:claim.id})
 await h.cmd('insurance.policy.save',{...c.policyInput,id:c.policy.id,memberId:'synthetic-balm-308'})
 await h.cmd('insurance.batch.prepare',{claimIds:[claim.id]},h.owner,409)
 await h.cmd('insurance.policy.save',{...c.policyInput,id:c.policy.id})
 await h.cmd('insurance.claim.scrub',{id:claim.id})
 const replacementPlan=await h.cmd('plan.send',c.planInput,c.priya.cookie)
 // The newer current plan is uncertified; batching and scrubbing refuse it.
 await h.cmd('insurance.batch.prepare',{claimIds:[claim.id]},h.owner,409)
 assert.equal((await h.form('/plan/'+replacementPlan.token,{name:'Synthetic Physician',credentials:'MD',attest:'on'})).status,303)
 c.visitInput.planId=replacementPlan.id
 await h.cmd('insurance.institutional.visit',c.visitInput)
 await h.cmd('insurance.batch.prepare',{claimIds:[claim.id]},h.owner,409)
 await h.cmd('insurance.claim.scrub',{id:claim.id})
 // A different visit on the same policy can still use its established professional flow.
 const secondVisit=await pastVisit(h,c.patient.id,c.priya,c.service.id,h.owner,4)
 await h.cmd('appointment.attend',{id:secondVisit})
 const secondNote=await h.cmd('note.write',{clientId:c.patient.id,appointmentId:secondVisit,body:'Synthetic second signed visit',charges:[{code:'97110',minutes:23},{code:'97140',minutes:15}]},c.priya.cookie)
 await h.cmd('note.sign',{id:secondNote.id,revision:1,signature:'Priya Shah',attest:true},c.priya.cookie)
 await h.cmd('pay.codes.save',{appointmentId:secondVisit,icd10:'M25.561'})
 const secondInvoice=await h.cmd('invoice.prepare',{appointmentId:secondVisit});await h.cmd('invoice.approve',{id:secondInvoice.id})
 const professional=await h.cmd('insurance.claim.prepare',{appointmentId:secondVisit,policyId:c.policy.id})
 await h.cmd('insurance.institutional.visit',{...c.visitInput,appointmentId:secondVisit,occurrences:[{code:'29',date:await visitDate(h,secondVisit)}]})
 await h.cmd('insurance.claim.prepare',{appointmentId:secondVisit,policyId:c.policy.id,claimFormat:'837I'},h.owner,409)
 await h.cmd('insurance.claim.correct',{id:professional.id,claimFormat:'837I'},h.owner,409)
 await h.cmd('insurance.batch.prepare',{claimIds:[claim.id,professional.id]},h.owner,409)
 await h.cmd('insurance.claim.scrub',{id:claim.id})
 const beforeExport=(await c.file()).billing.ledger,outboundCount=h.outboundRequests.length
 const races=await Promise.all([1,2].map(()=>h.send('/api/balm/command',{name:'insurance.batch.prepare',input:{claimIds:[claim.id]}},biller.cookie)))
 assert.deepEqual(races.map(r=>r.status).sort(),[200,409])
 const batch=races.find(r=>r.status===200).value.result
 await h.cmd('insurance.batch.prepare',{claimIds:[claim.id]},biller.cookie,409)
 const url='/api/balm/insurance/837I/'+batch.id
 for(const cookie of ['',c.priya.cookie])assert.ok([401,403].includes((await h.send(url,undefined,cookie)).status))
 assert.equal((await h.send('/api/balm/insurance/837P/'+batch.id,undefined,biller.cookie)).status,404)
 const downloaded=await h.send(url,undefined,biller.cookie);assert.equal(downloaded.status,200);assert.match(downloaded.headers.get('content-disposition'),/\.837i\.x12/)
 assert.equal(inspectInstitutionalFile(downloaded.text,c,claim.id),batch.sha256)
 assert.equal((await h.send(url,undefined,biller.cookie)).text,downloaded.text,'repeated downloads preserve the stored envelope and bytes')
 assert.equal((await h.cmd('insurance.batch.submit',{id:batch.id},h.owner,409)).code,'institutional_submission_not_configured_no_claim_sent')
 assert.equal(h.outboundRequests.length,outboundCount,'preparation and export call no provider')
 assert.deepEqual((await c.file()).billing.ledger,beforeExport,'export and refused submission make no monetary change')
 assert.equal(beforeExport.paymentsCents,originalLedger.paymentsCents)
 assert.ok((await h.state()).dailyClose.claims.some(q=>q.id===claim.id&&q.kind==='unsent_claim'&&/Institutional claim exported; not sent/.test(q.label)))
 const ui=await h.send('/app/insurance',undefined,h.owner);assert.match(ui.text,/Download 837I claim file/);assert.match(ui.text,/Institutional test export/)
 const file=await c.file();assert.equal(file.insurance.claims.find(q=>q.id===claim.id).status,'exported');assert.ok(file.audit.some(a=>a.action==='insurance.837_exported'))
 await h.cmd('staff.save',{id:biller.id,name:'InstitutionalBiller',email:(await h.state()).staff.find(s=>s.id===biller.id).email,role:'biller',active:false})
 assert.equal((await h.send(url,undefined,biller.cookie)).status,403)
 await h.cmd('insurance.batch.prepare',{claimIds:[professional.id]},biller.cookie,403)
 const key=await h.cmd('agent.create',{label:'Synthetic institutional preparation'})
 assert.equal((await h.send('/api/balm/agent/command',{name:'insurance.claim.prepare',input:c.input},'',{authorization:'Bearer '+key.token})).status,403)
 // Later owner-recorded instructions do not rewrite an existing original.
 await h.cmd('insurance.institutional.settings',{...institutionalInstructions,active:false})
 assert.equal((await h.send(url,undefined,h.owner)).text,downloaded.text)
 if(process.env.BALM_UI_SCREENSHOTS){
  const {viewportProof}=await import('./viewport-proof.mjs')
  await viewportProof(h,[{name:'INS-011-settings',path:'/app/clinic',cookie:h.owner,selector:'#rehab-agency',openSelector:'#institutional-settings > summary'},
  {name:'INS-011-visit-facts',path:'/app/clients/'+c.patient.id,cookie:h.owner,selector:'#institutional-visit',openSelector:'#institutional-visit > summary'},
  {name:'INS-011-claim-download',path:'/app/insurance',cookie:h.owner,selector:'#batches',interact:async({page,width})=>{if(width===1440){const link=page.getByRole('link',{name:'Download 837I claim file'});assert.equal(await link.getAttribute('href'),url);const download=await page.request.get(h.origin+url);assert.equal(await download.text(),downloaded.text)}}}])
 }
 return {...c,claim,batch,body:downloaded.text,url}
}


export async function exportedInstitutionalFixture(h){
 const c=await institutionalFixture(h)
 await h.cmd('insurance.institutional.settings',institutionalInstructions)
 await h.cmd('insurance.institutional.visit',c.visitInput)
 const claim=await h.cmd('insurance.claim.prepare',c.input);assert.equal(claim.status,'ready')
 const batch=await h.cmd('insurance.batch.prepare',{claimIds:[claim.id]})
 const url='/api/balm/insurance/837I/'+batch.id,downloaded=await h.send(url,undefined,h.owner)
 assert.equal(downloaded.status,200);assert.equal(inspectInstitutionalFile(downloaded.text,c,claim.id),batch.sha256)
 return {...c,claim,batch,url,body:downloaded.text}
}
