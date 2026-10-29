import {validNpi} from '../payments/codes'
import {audit,commit,day,guard,id,insist,now,one,stmt,text,type Actor,type Data} from '../domain/model'
import {policyFor,yes} from './access'
import {hostDateAt} from '../availability/timezone'
import type {ClaimSnapshot} from './types'

export type InstitutionalFacts = {
 attending:{first:string;last:string;npi:string}; settingsId:string; visitFactsId:string; billType:'741'; patientStatus:'01';
 mappings:{code:string;revenueCode:string}[]; planSpanCode:string;
 occurrences:{code:string;date:string}[]; source:string; enrollmentReference:string; visitSource:string;
 plan:{id:string;version:number;sha256:string;startDate:string;throughDate:string}
}
const code=(value:unknown,field:string)=>{const result=text(value,field,2).toUpperCase();insist(/^[A-Z0-9]{2}$/.test(result),'invalid_'+field);return result}
function list(value:unknown,field:string):Data[]{
 if(typeof value==='string'){try{value=JSON.parse(value)}catch{insist(false,'invalid_'+field)}}
 insist(Array.isArray(value)&&value.length>0&&value.length<=8,'invalid_'+field)
 return value as Data[]
}
export async function institutionalSettings(db:D1Database){
 return one(db,'SELECT * FROM bm_institutional_settings ORDER BY rowid DESC LIMIT 1')
}
export async function saveInstitutionalSettings(db:D1Database,who:Actor,input:Data){
 insist(who.role==='owner','institutional_configuration_requires_owner',403)
 insist(yes(input.attest),'confirm_recorded_institutional_instructions')
 insist(input.billType==='741','only_original_outpatient_rehabilitation_bill_type_741_is_supported')
 const mappings=list(input.revenueMappings,'revenue_mappings').map(m=>{
  const c=text(m.code,'procedure',5),r=text(m.revenueCode,'revenue_code',4)
  insist(/^(?:\d{4}[\dA-Z]|[A-Z]\d{4})$/.test(c)&&/^0[1-9]\d{2}$/.test(r),'invalid_institutional_revenue_mapping')
  return {code:c,revenueCode:r}
 }).sort((a,b)=>a.code.localeCompare(b.code))
 insist(new Set(mappings.map(m=>m.code)).size===mappings.length,'duplicate_institutional_procedure_mapping')
 const key=id(),source=text(input.source,'institutional_instruction_source',2000),reference=text(input.enrollmentReference,'recorded_enrollment_reference',500)
 await commit(db,who,[stmt(db,'INSERT INTO bm_institutional_settings(id,bill_type,revenue_mappings,plan_span_code,source,enrollment_reference,active,created_by,created_at) VALUES(?,?,?,?,?,?,?,?,?)',key,'741',JSON.stringify(mappings),code(input.planSpanCode,'plan_occurrence_span_code'),source,reference,yes(input.active)?1:0,who.email,now()),audit(db,who,'insurance.institutional_settings_recorded',null,key)])
 return {id:key,authority:'recorded_facts_only',transport:'unavailable'}
}
export async function saveInstitutionalVisit(db:D1Database,who:Actor,input:Data){
 insist(who.role==='owner','institutional_visit_facts_require_owner',403)
 insist(yes(input.attest),'confirm_recorded_institutional_instructions')
 const policy=await policyFor(db,who,input.policyId)
 const visit=await one(db,'SELECT a.*,s.time_zone FROM bm_appointments a JOIN bm_settings s ON s.id=1 WHERE a.id=? AND a.client_id=?',text(input.appointmentId,'visit',100),policy.client_id)
 insist(visit,'appointment_not_found',404)
 insist(policy.medicare&&policy.priority===1&&policy.relationship==='18','institutional_original_primary_self_medicare_only',409)
 const date=hostDateAt(new Date(visit.start_at),visit.time_zone)
 const occurrences=list(input.occurrences,'occurrence_dates').map(o=>({code:code(o.code,'occurrence_code'),date:day(o.date,'occurrence_date')}))
 insist(occurrences.every(o=>o.date<=date),'occurrence_date_after_service')
 insist(new Set(occurrences.map(o=>o.code)).size===occurrences.length,'duplicate_occurrence_code')
 insist(input.patientStatus==='01','only_outpatient_discharge_home_status_01_is_supported')
 const plan=await one(db,'SELECT * FROM bm_plans_of_care WHERE id=? AND client_id=? AND author_id=?',text(input.planId,'signed_plan',100),policy.client_id,visit.practitioner_id)
 insist(plan&&plan.status==='certified'&&plan.therapist_name&&plan.content_sha256,'certified_signed_plan_required',409)
 const period=JSON.parse(plan.content)
 insist(period.startDate<=date&&period.certifiedThrough>=date,'signed_plan_period_does_not_cover_visit',409)
 const attending={first:text(input.attendingFirst,'attending_first',60),last:text(input.attendingLast,'attending_last',60),npi:text(input.attendingNpi,'attending_npi',10)}
 insist(validNpi(attending.npi),'invalid_attending_npi')
 const key=id()
 await commit(db,who,[guard(db,'EXISTS(SELECT 1 FROM bm_clients WHERE id=? AND erased_at IS NULL)',policy.client_id),guard(db,'EXISTS(SELECT 1 FROM bm_appointments WHERE id=? AND version=?)',visit.id,visit.version),guard(db,'EXISTS(SELECT 1 FROM bm_policies WHERE id=? AND version=?)',policy.id,policy.version),guard(db,'EXISTS(SELECT 1 FROM bm_plans_of_care WHERE id=? AND version=?)',plan.id,plan.version),
 stmt(db,'INSERT INTO bm_institutional_visits(id,client_id,appointment_id,policy_id,plan_id,attending_first,attending_last,attending_npi,patient_status,occurrences,source,created_by,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)',key,policy.client_id,visit.id,policy.id,plan.id,attending.first,attending.last,attending.npi,'01',JSON.stringify(occurrences),text(input.source,'occurrence_instruction_source',2000),who.email,now()),audit(db,who,'insurance.institutional_visit_recorded',policy.client_id,key)])
 return {id:key}
}
/** Only billing dates and opaque clinical provenance enter a claim, never plan text. */
export async function institutionalFacts(db:D1Database,s:ClaimSnapshot,visitId:string,policyId:string):Promise<InstitutionalFacts>{
 const settings=await institutionalSettings(db),v=await one(db,'SELECT * FROM bm_institutional_visits WHERE appointment_id=? AND policy_id=? ORDER BY rowid DESC LIMIT 1',visitId,policyId)
 insist(settings?.active,'record_active_rehab_agency_instructions_in_settings',409)
 insist(v,'record_institutional_visit_facts_before_preparing',409)
 const policy=await one(db,'SELECT * FROM bm_policies WHERE id=?',policyId)
 insist(s.payer.medicare&&policy?.priority===1&&s.subscriber.relationship==='18'&&!s.cob&&!s.injury,'institutional_original_primary_self_medicare_only',409)
 const plan=await one(db,`SELECT p.* FROM bm_plans_of_care p JOIN bm_appointments a ON a.id=? LEFT JOIN bm_episode_records pe ON pe.record_kind='plan' AND pe.record_id=p.id LEFT JOIN bm_episode_records ve ON ve.record_kind='visit' AND ve.record_id=a.id WHERE p.id=? AND p.client_id=a.client_id AND p.author_id=a.practitioner_id AND COALESCE(pe.episode_id,'')=COALESCE(ve.episode_id,'')`,visitId,v.plan_id)
 insist(plan?.status==='certified'&&plan.therapist_name&&plan.content_sha256&&s.requirements?.plan?.id===plan.id,'current_certified_signed_plan_required',409)
 const period=JSON.parse(plan.content),mappings=JSON.parse(settings.revenue_mappings) as InstitutionalFacts['mappings'],occurrences=JSON.parse(v.occurrences) as InstitutionalFacts['occurrences']
 insist(period.startDate<=s.serviceDate&&period.certifiedThrough>=s.serviceDate,'signed_plan_period_does_not_cover_visit',409)
 insist(occurrences.every(o=>o.date<=s.serviceDate&&o.date>=s.patient.dob),'occurrence_date_outside_patient_service_period',409)
 insist(s.lines.every(l=>mappings.some(m=>m.code===l.code)),'record_revenue_mapping_for_every_signed_procedure',409)
 return {attending:{first:v.attending_first,last:v.attending_last,npi:v.attending_npi},settingsId:settings.id,visitFactsId:v.id,billType:'741',patientStatus:'01',mappings,planSpanCode:settings.plan_span_code,occurrences,source:settings.source,enrollmentReference:settings.enrollment_reference,visitSource:v.source,plan:{id:plan.id,version:plan.version,sha256:plan.content_sha256,startDate:period.startDate,throughDate:period.certifiedThrough}}
}
export function institutionalGuards(db:D1Database,s:ClaimSnapshot,visitId:string,policyId:string){
 const i=s.institutional;if(!i)return []
 return [guard(db,'(SELECT id FROM bm_institutional_settings ORDER BY rowid DESC LIMIT 1)=?',i.settingsId),guard(db,'(SELECT id FROM bm_institutional_visits WHERE appointment_id=? AND policy_id=? ORDER BY rowid DESC LIMIT 1)=?',visitId,policyId,i.visitFactsId),guard(db,"EXISTS(SELECT 1 FROM bm_plans_of_care WHERE id=? AND version=? AND content_sha256=? AND status='certified')",i.plan.id,i.plan.version,i.plan.sha256)]
}
