import { hostDateAt } from '../availability/timezone'
import { clientVisible } from '../domain/clients'
import { audit,commit,day,guard,human,id,insist,integer,need,now,one,rows,sha256,stmt,text,type Actor,type Data } from '../domain/model'
import { addBusinessDays,businessDistance } from './estimate-days'
import { pdf } from './pdf'
import { dollars } from '../domain/invoices'

const owner=(who:Actor)=>{human(who);insist(who.role==='owner','only_the_owner_issues_estimates',403)}
const attested=(input:Data)=>insist(input.attest===true||input.attest==='on','confirm_the_estimate')
export async function requestEstimate(db:D1Database,who:Actor,input:Data){
 owner(who);attested(input)
 const client=await clientVisible(db,who,input.clientId),kind=text(input.coverageKind,'coverage_kind',20)
 insist(['uninsured','self_pay'].includes(kind),'record_uninsured_or_patient_elected_self_pay')
 const attestation=text(input.coverageAttestation,'coverage_attestation',500),at=now()
 const clinic=(await one(db,'SELECT time_zone FROM bm_settings WHERE id=1'))!,today=hostDateAt(new Date(at),clinic.time_zone)
 const visit=input.appointmentId?await one(db,"SELECT id,start_at,created_at FROM bm_appointments WHERE id=? AND client_id=? AND status<>'cancelled'",text(input.appointmentId,'visit',100),client.id):null
 insist(!input.appointmentId||visit,'appointment_not_found',404)
 const booked=visit?hostDateAt(new Date(visit.created_at),clinic.time_zone):today
 const lead=visit?businessDistance(booked,hostDateAt(new Date(visit.start_at),clinic.time_zone)):null
 // A late office request cannot reset the original booking's deadline.
 const dueOn=visit?addBusinessDays(booked,lead!>=10?3:lead!>=3?1:0):addBusinessDays(today,3),key=id()
 await commit(db,who,[guard(db,'EXISTS(SELECT 1 FROM bm_clients WHERE id=? AND erased_at IS NULL)',client.id),
 stmt(db,'INSERT INTO bm_estimate_requests(id,client_id,appointment_id,coverage_kind,coverage_attestation,requested_at,due_on,created_by) VALUES(?,?,?,?,?,?,?,?)',key,client.id,visit?.id??null,kind,attestation,at,dueOn,who.email),audit(db,who,'estimate.requested',client.id,key)])
 return {id:key,dueOn,leadBusinessDays:lead}
}
async function facts(db:D1Database,request:Data,input:Data){
 const client=(await one(db,'SELECT id,first_name,last_name,date_of_birth,version FROM bm_clients WHERE id=? AND erased_at IS NULL',request.client_id))!
 insist(client,'client_not_found',404)
 const clinic=(await one(db,'SELECT clinic_name,address,abn,practice_npi,version FROM bm_settings WHERE id=1'))!
 const plan=input.planId?await one(db,'SELECT id,content,content_sha256,client_id FROM bm_plans_of_care WHERE id=? AND client_id=?',text(input.planId,'plan',100),client.id):null
 insist(!input.planId||plan,'plan_not_found',404)
 const planContent=plan?JSON.parse(plan.content):null
 const from=day(input.fromOn??planContent?.startDate,'estimate_from'),through=day(input.throughOn,'estimate_through')
 insist(from<=through && Date.parse(through)-Date.parse(from)<=366*86400000,'estimate_date_range_invalid')
 const given=Array.isArray(input.lines)?input.lines:[]
 insist(given.length>0 && given.length<=40,'enter_the_expected_care_services')
 const lines=[],versions=[]
 for(const item of given){
  const service=await one(db,'SELECT * FROM bm_services WHERE id=? AND active=1',text(item?.serviceId,'service',100));insist(service,'service_not_found',404)
  const quantity=integer(item.quantity,'expected_visits',1,365)
  const code=item.code?text(item.code,'billing_code',10):'';insist(!code||/^[A-Z0-9]{4,10}$/.test(code),'invalid_billing_code')
  lines.push({serviceId:service.id,name:service.name,code,quantity,unitCents:service.price_cents,totalCents:service.price_cents*quantity})
  versions.push({id:service.id,version:service.version})
 }
 const visits=lines.reduce((sum,line)=>sum+line.quantity,0)
 if(planContent)insist(visits===Number(planContent.frequencyPerWeek)*Number(planContent.durationWeeks),'estimate_visits_must_match_the_plan_of_care')
 const total=lines.reduce((sum,line)=>sum+line.totalCents,0);insist(Number.isSafeInteger(total)&&total<=1_000_000_000,'estimate_total_too_large')
 const payload={requestId:request.id,coverageKind:request.coverage_kind,requestedAt:request.requested_at,dueOn:request.due_on,client:{id:client.id,name:client.first_name+' '+client.last_name,dob:client.date_of_birth},clinic:{name:clinic.clinic_name,address:clinic.address,taxId:clinic.abn,npi:clinic.practice_npi},planId:plan?.id??null,anticipatedPlan:!plan,fromOn:from,throughOn:through,lines,totalCents:total}
 return {payload,basis:{clientVersion:client.version,clinicVersion:clinic.version,services:versions,planDigest:plan?.content_sha256??null}}
}
export async function prepareEstimate(db:D1Database,who:Actor,input:Data){
 owner(who);attested(input)
 const request=await one(db,'SELECT * FROM bm_estimate_requests WHERE id=?',text(input.requestId,'estimate_request',100));insist(request,'estimate_request_not_found',404)
 insist(!await one(db,'SELECT 1 FROM bm_estimates WHERE request_id=?',request.id),'estimate_already_issued',409)
 const value=await facts(db,request,input),digest=await sha256(JSON.stringify(value)),key=id()
 await commit(db,who,[stmt(db,'INSERT INTO bm_estimate_drafts(id,request_id,payload,basis,sha256,prepared_at,prepared_by) VALUES(?,?,?,?,?,?,?)',key,request.id,JSON.stringify(value.payload),JSON.stringify(value.basis),digest,now(),who.email),audit(db,who,'estimate.prepared',request.client_id,key)])
 return {id:key,sha256:digest,...value.payload}
}
function document(value:Data,key:string,at:string){
 return pdf({header:value.clinic.name,title:'Good Faith Estimate',blocks:[{kind:'facts',rows:[['Estimate',key],['Patient',value.client.name],['Date of birth',value.client.dob??'Not recorded'],['Provider',value.clinic.name],['Provider NPI',value.clinic.npi||'Not yet assigned'],['Tax ID',value.clinic.taxId],['Provider address',value.clinic.address],['Requested',value.requestedAt.slice(0,10)],['Issued',at.slice(0,10)],['Due by',value.dueOn],['Expected care dates',value.fromOn+' through '+value.throughOn],['Coverage',value.coverageKind==='self_pay'?'Patient elected self-pay':'Uninsured'],['Care plan',value.planId?'Recorded plan of care':'Anticipated course confirmed by the clinic']]},
 {kind:'table',columns:[{label:'Expected service',width:4},{label:'Code',width:1},{label:'Visits',width:1,right:true},{label:'Each',width:1.5,right:true},{label:'Expected charge',width:2,right:true}],rows:value.lines.map((l:Data)=>[l.name,l.code||'TBD',String(l.quantity),dollars(l.unitCents),dollars(l.totalCents)]),totals:[['Total expected charges',dollars(value.totalCents)]]},
 {kind:'notes',lines:['This is an estimate of expected charges, not a contract or a requirement to receive care. Actual care may differ. This estimate covers this practice only; other providers or facilities give their own estimates. Unexpected services may be billed separately. No other provider services are included in this estimate.',
 'You may ask for a corrected or updated estimate. Keep a copy of this estimate. If billed charges from this provider are at least $400 above its estimate, you may be eligible for the federal patient-provider dispute resolution process. Start that process within 120 calendar days of the date on the initial bill. Starting a dispute does not affect the quality of care you receive.',
 'For information, visit www.cms.gov/nosurprises/consumers or call 1-800-985-3059. A federal dispute process may charge an administrative fee. Contact the clinic first if a bill differs from this estimate.']}]})
}
export async function issueEstimate(db:D1Database,who:Actor,input:Data){
 owner(who);attested(input)
 const draft=await one(db,'SELECT * FROM bm_estimate_drafts WHERE id=?',text(input.id,'estimate_draft',100));insist(draft,'estimate_draft_not_found',404)
 insist(input.sha256===draft.sha256,'review_the_exact_estimate_digest',409)
 const payload=JSON.parse(draft.payload),basis=JSON.parse(draft.basis),request=(await one(db,'SELECT * FROM bm_estimate_requests WHERE id=?',draft.request_id))!
 const current=await facts(db,request,payload)
 insist(await sha256(JSON.stringify(current))===draft.sha256,'estimate_facts_changed_prepare_again',409)
 const key=id(),at=now(),bytes=document(payload,key,at)
 await commit(db,who,[guard(db,'EXISTS(SELECT 1 FROM bm_clients WHERE id=? AND version=? AND erased_at IS NULL)',request.client_id,basis.clientVersion),guard(db,'EXISTS(SELECT 1 FROM bm_settings WHERE id=1 AND version=?)',basis.clinicVersion),
 ...basis.services.map((s:Data)=>guard(db,'EXISTS(SELECT 1 FROM bm_services WHERE id=? AND version=? AND active=1)',s.id,s.version)),
 ...(payload.planId?[guard(db,'EXISTS(SELECT 1 FROM bm_plans_of_care WHERE id=? AND content_sha256=?)',payload.planId,basis.planDigest)]:[]),
 stmt(db,'INSERT INTO bm_estimates(id,request_id,draft_id,client_id,from_on,through_on,total_cents,payload,sha256,pdf,issued_at,issued_by) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)',key,request.id,draft.id,request.client_id,payload.fromOn,payload.throughOn,payload.totalCents,JSON.stringify(payload),[...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(b=>b.toString(16).padStart(2,'0')).join(''),bytes,at,who.email),audit(db,who,'estimate.issued',request.client_id,key,'Published to the patient portal; no email sent')])
 return {id:key,issuedAt:at,dueOn:request.due_on,totalCents:payload.totalCents}
}
export async function estimatesFor(db:D1Database,clientId:string){
 const estimates=await rows(db,'SELECT id,request_id,from_on,through_on,total_cents,sha256,issued_at FROM bm_estimates WHERE client_id=? ORDER BY issued_at DESC,id',clientId)
 for(const e of estimates){
  // Invoice service dates use the same clinic-local calendar as the estimate.
  const visits=await rows(db,`SELECT i.amount_cents,a.start_at FROM bm_invoices i JOIN bm_appointments a ON a.id=i.appointment_id WHERE i.client_id=? AND i.status='approved'`,clientId)
  const zone=(await one(db,'SELECT time_zone FROM bm_settings WHERE id=1'))!.time_zone
  e.billedCents=visits.filter(v=>{const d=hostDateAt(new Date(v.start_at),zone);return d>=e.from_on&&d<=e.through_on}).reduce((sum,v)=>sum+Number(v.amount_cents),0)
  e.overByCents=Math.max(0,Number(e.billedCents)-Number(e.total_cents));e.disputeFlag=e.overByCents>=40000
 }
 return estimates
}
export async function estimateFile(db:D1Database,who:Actor,clientId:string){
 if(who.role!=='owner'&&who.staffRole!=='reception')return null
 const issued=await estimatesFor(db,clientId),requests=await rows(db,'SELECT r.*,e.id AS issued_id FROM bm_estimate_requests r LEFT JOIN bm_estimates e ON e.request_id=r.id WHERE r.client_id=? ORDER BY r.requested_at DESC',clientId)
 const drafts=who.role==='owner'?(await rows(db,'SELECT d.* FROM bm_estimate_drafts d JOIN bm_estimate_requests r ON r.id=d.request_id WHERE r.client_id=?',clientId)).map(d=>({...d,payload:JSON.parse(d.payload)})):[]
 if(requests.length||issued.length||drafts.length)await commit(db,who,[audit(db,who,'estimate.file_read',clientId)])
 return {issued,requests,drafts}
}
export async function estimateOriginal(db:D1Database,clientId:string,key:string){
 const row=await one(db,'SELECT pdf,sha256 FROM bm_estimates WHERE id=? AND client_id=?',key,clientId);insist(row,'estimate_not_found',404)
 return {bytes:new Uint8Array(row.pdf),name:'good-faith-estimate-'+key+'.pdf'}
}
export async function estimateCommand(db:D1Database,who:Actor,name:string,input:Data){
 if(name==='estimate.request')return requestEstimate(db,who,input)
 if(name==='estimate.prepare'){if(!Array.isArray(input.lines))input.lines=Array.from({length:6},(_,i)=>({serviceId:input['estimate_service_'+i],quantity:input['estimate_quantity_'+i],code:input['estimate_code_'+i]})).filter(l=>l.serviceId);return prepareEstimate(db,who,input)}
 if(name==='estimate.issue')return issueEstimate(db,who,input)
 insist(false,'unknown_command',404)
}
