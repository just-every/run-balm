import assert from 'node:assert/strict'
import {clinic,pastVisit} from './clinic.mjs'
import {mriReport} from './chart-document-fixtures.mjs'

export const signedPlanBytes=mriReport('Synthetic signed plan of care','Synthetic Physician, MD. Written signature 2000-01-01. Matched by the treating clinician.')
export const scanInput=(plan,patient,episodeId='none')=>({id:plan.id,clientId:patient.id,planSha256:plan.sha256,episodeId,name:'Synthetic Physician',credentials:'MD',npi:'1234567893',signatureDate:'2000-01-01',certificationDate:'2000-01-02',attest:true,attachmentName:'synthetic-balm-signed-plan.pdf',attachment:'data:application/pdf;base64,'+signedPlanBytes.toString('base64')})
export async function planVersionFixture(h,existing={}){
 const c=existing.priya?existing:await clinic(h)
 const priya=existing.priya??c.practitioners[0],service=c.service
 await h.cmd('staff.save',{id:priya.id,name:'Priya Shah',email:priya.email,role:'practitioner',credentials:'PT',active:true})
 const patient=existing.patient??await h.cmd('client.save',{firstName:'Synthetic',lastName:'Plan patient',dateOfBirth:'1980-01-01'})
 const visit=existing.visit??await pastVisit(h,patient.id,priya,service.id)
 const episode=existing.episode??await h.cmd('episode.open',{clientId:patient.id,title:'Synthetic knee recovery',start:'direct_access'})
 const input={clientId:patient.id,episodeId:episode.id,diagnoses:'M25.561',shortTermGoals:'Walk ten minutes comfortably',longTermGoals:'Resume community walking',frequencyPerWeek:2,durationWeeks:6,interventions:'Graded therapeutic exercise',startDate:existing.startDate??'2000-01-01',physicianName:'Synthetic Physician',physicianEmail:['synthetic-balm-physician','example.test'].join('@'),signature:'Priya Shah',credentials:'PT',attest:true}
 const file=async(cookie=priya.cookie)=>(await h.send('/api/balm/clients/'+patient.id,undefined,cookie)).value
 const initial=await h.cmd('plan.send',input,priya.cookie)
 const first=(await file()).plans.find(p=>p.id===initial.id)
 return {priya,service,patient,visit,episode,input,initial,first,file}
}
export async function planVersionJourney(h){
 await h.finishSetup()
 const c=await planVersionFixture(h),{priya,patient,episode,input,initial,file}=c
 const reception=await h.staff('SyntheticDesk','reception'),other=await h.staff('SyntheticOther','practitioner')
 const wrongPatient=await h.cmd('client.save',{firstName:'Different',lastName:'Patient'})
 const wrongEpisode=await h.cmd('episode.open',{clientId:patient.id,title:'Different episode',start:'direct_access'})
 const resend=await h.cmd('plan.resend',{id:initial.id},priya.cookie)
 assert.equal((await h.send('/plan/'+initial.token)).status,404)
 const old=await h.db.prepare('SELECT * FROM bm_plans_of_care WHERE id=?').bind(initial.id).first()
 const prior=(await file()).plans.find(p=>p.id===initial.id)
 assert.equal(prior.sends.length,2)
 const replacementInput={...input,predecessorId:initial.id,predecessorSha256:prior.sha256,shortTermGoals:'Walk twenty minutes comfortably'}
 await h.cmd('plan.send',{...replacementInput,attest:false},priya.cookie,400)
 await h.cmd('plan.send',{...replacementInput,signature:'Different clinician'},priya.cookie,400)
 await h.cmd('plan.send',{...replacementInput,episodeId:wrongEpisode.id},priya.cookie,409)
 await h.cmd('plan.send',replacementInput,reception.cookie,403)
 const replacement=await h.cmd('plan.send',replacementInput,priya.cookie)
 assert.deepEqual(await h.db.prepare('SELECT * FROM bm_plans_of_care WHERE id=?').bind(initial.id).first(),old,'replacement preserves predecessor bytes and signature state')
 assert.equal((await h.send('/plan/'+resend.token)).status,404,'superseded open link reveals no plan')
 assert.equal((await h.form('/plan/'+resend.token,{name:'Synthetic Physician',credentials:'MD',attest:'on'})).status,404)
 await h.cmd('plan.resend',{id:initial.id},priya.cookie,404)
 await h.cmd('plan.send',replacementInput,priya.cookie,409)
 let current=(await file()).plans.find(p=>p.id===replacement.id)
 assert.equal(current.predecessorId,initial.id)
 assert.equal((await file()).plans.find(p=>p.id===initial.id).supersededBy,replacement.id)
 assert.deepEqual((await file()).plans.find(p=>p.id===initial.id).sends,prior.sends,'predecessor sends remain immutable')
 const scan=scanInput(current,patient,episode.id)
 for(const [changes,status] of [[{clientId:wrongPatient.id},404],[{episodeId:wrongEpisode.id},409],[{planSha256:'synthetic-balm-wrong-digest'},409],[{attest:false},400],[{signatureDate:'2099-01-01'},400]])await h.cmd('plan.certification.file',{...scan,...changes},priya.cookie,status)
 for(const cookie of [reception.cookie,other.cookie])await h.cmd('plan.certification.file',scan,cookie,cookie===reception.cookie?403:404)
 const key=await h.cmd('agent.create',{label:'Synthetic chart assistant'})
 assert.equal((await h.send('/api/balm/agent/command',{name:'plan.certification.file',input:scan},'',{authorization:'Bearer '+key.token})).status,403)
 const before=(await h.db.prepare('SELECT count(*) n FROM bm_chart_documents').first()).n
 const race=await Promise.all([0,1].map(()=>h.send('/api/balm/command',{name:'plan.certification.file',input:scan},priya.cookie)))
 assert.deepEqual(race.map(r=>r.status).sort(),[200,409],'one copy wins concurrent certification')
 assert.equal((await h.db.prepare('SELECT count(*) n FROM bm_chart_documents').first()).n,before+1,'refused filings leave no orphan original')
 const receipt=race.find(r=>r.status===200).value.result
 current=(await file()).plans.find(p=>p.id===replacement.id)
 assert.equal(current.status,'certified')
 assert.deepEqual([current.certifierName,current.certifierCredentials,current.certifierNpi],['Synthetic Physician','MD','1234567893'])
 assert.deepEqual(current.certification,{documentId:receipt.documentId,signatureDate:'2000-01-01',certificationDate:'2000-01-02',filedAt:receipt.filedAt,filedBy:priya.email})
 await h.cmd('plan.certification.file',scan,priya.cookie,409)
 assert.equal((await h.form('/plan/'+replacement.token,{name:'Synthetic Physician',credentials:'MD',attest:'on'})).status,409,'scan certification closes the live signing door')
 const history=await h.send('/api/balm/clients/'+patient.id+'/history?historyType=signed_plan&historyEpisode='+episode.id+'&historyText=Synthetic%20Physician',undefined,priya.cookie)
 assert.deepEqual(history.value.entries.map(r=>[r.id,r.planId,r.episodeId]),[[receipt.documentId,replacement.id,episode.id]])
 assert.equal((await h.send('/api/balm/clients/'+patient.id+'/history?historyType=signed_plan&historyEpisode='+wrongEpisode.id,undefined,priya.cookie)).value.total,0)
 assert.equal((await h.send('/api/balm/clients/'+patient.id+'/history?historyType=signed_plan',undefined,reception.cookie)).status,403)
 const original=await h.mf.dispatchFetch(h.origin+'/api/balm/chart-documents/'+receipt.documentId,{headers:{cookie:priya.cookie}})
 assert.equal(original.status,200);assert.deepEqual(Buffer.from(await original.arrayBuffer()),signedPlanBytes)
 for(const cookie of [reception.cookie,other.cookie,''])assert.notEqual((await h.send('/api/balm/chart-documents/'+receipt.documentId,undefined,cookie)).status,200)
 for(const kind of ['plan','document'])await h.cmd('episode.assign',{kind,recordId:kind==='plan'?replacement.id:receipt.documentId,episodeId:wrongEpisode.id},h.owner,409)
 const signedSnapshot=await h.db.prepare('SELECT * FROM bm_plans_of_care WHERE id=?').bind(replacement.id).first()
 const latest=await h.cmd('plan.send',{...input,predecessorId:replacement.id,predecessorSha256:current.sha256,longTermGoals:'Resume independent outdoor walking'},priya.cookie)
 assert.deepEqual(await h.db.prepare('SELECT * FROM bm_plans_of_care WHERE id=?').bind(replacement.id).first(),signedSnapshot,'replacing a certified plan preserves its certification and original')
 assert.equal((await h.form('/plan/'+latest.token,{name:'Synthetic Physician',credentials:'MD',attest:'on'})).status,303)
 const latestPlan=(await file()).plans.find(p=>p.id===latest.id)
 await h.cmd('plan.certification.file',scanInput(latestPlan,patient,episode.id),priya.cookie,409,'link certification refuses a second scan')
 const closedPlan=await h.cmd('plan.send',{...input,episodeId:wrongEpisode.id},priya.cookie)
 await h.cmd('episode.close',{id:wrongEpisode.id,reason:'Treatment completed before return of the original'},priya.cookie)
 const closedVersion=(await file()).plans.find(p=>p.id===closedPlan.id)
 const closedReceipt=await h.cmd('plan.certification.file',scanInput(closedVersion,patient,wrongEpisode.id),priya.cookie)
 const closedHistory=await h.send('/api/balm/clients/'+patient.id+'/history?historyType=signed_plan&historyEpisode='+wrongEpisode.id,undefined,priya.cookie)
 assert.deepEqual(closedHistory.value.entries.map(r=>r.id),[closedReceipt.documentId],'a returned original retains its closed episode without reopening it')
 const audit=(await h.db.prepare('SELECT action,subject_id FROM bm_audit WHERE client_id=?').bind(patient.id).all()).results
 for(const action of ['plan.replaced','plan.scan_certified','chart.history_searched','chart.document_read','chart.document_downloaded'])assert.ok(audit.some(a=>a.action===action),action)
 await h.cmd('staff.save',{id:priya.id,name:'Priya Shah',email:priya.email,role:'practitioner',credentials:'PT',active:false})
 const sends=(await h.db.prepare('SELECT count(*) n FROM bm_plan_sends').first()).n
 await h.cmd('plan.send',{...input,predecessorId:latest.id,predecessorSha256:latestPlan.sha256},priya.cookie,403)
 await h.cmd('plan.certification.file',scan,priya.cookie,403)
 assert.equal((await h.db.prepare('SELECT count(*) n FROM bm_plan_sends').first()).n,sends,'revoked staff cannot create or send records')
}
