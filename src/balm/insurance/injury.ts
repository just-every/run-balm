import {audit,commit,email,guard,id,insist,now,one,rows,stmt,text,type Actor,type Data} from '../domain/model'
import {insuranceActor,policyFor,clientGuard} from './access'
import {element} from './x12'
export async function injuryCommand(db:D1Database,initial:Actor,name:string,input:Data){
 const who=await insuranceActor(db,initial,true);insist(who.role==='owner','injury_case_requires_owner',403)
 if(name==='insurance.injury.save'){
  const policy=await policyFor(db,who,input.policyId),kind=text(input.kind,'case_kind',30)
  insist(['workers_comp','auto_no_fault','personal_injury'].includes(kind),'invalid_injury_case_kind')
  const key=id(),claimNumber=text(input.claimNumber,'carrier_claim_number',50);element(claimNumber)
  await commit(db,who,[clientGuard(db,who,policy.client_id),guard(db,'EXISTS(SELECT 1 FROM bm_policies WHERE id=? AND client_id=? AND version=?)',policy.id,policy.client_id,policy.version),
   stmt(db,`INSERT INTO bm_injury_cases(id,client_id,policy_id,kind,claim_number,adjuster,adjuster_email,employer_attorney,billing_requirements,authorization_requirements,report_requirements,source,created_by,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,key,policy.client_id,policy.id,kind,claimNumber,text(input.adjuster,'adjuster',150),email(input.adjusterEmail,'adjuster_email'),text(input.employerAttorney,'employer_or_attorney',200),text(input.billingRequirements,'billing_requirements',2000),text(input.authorizationRequirements,'authorization_requirements',2000),text(input.reportRequirements,'report_requirements',2000),text(input.source,'carrier_instruction_source',1000),who.email,now()),audit(db,who,'insurance.injury_case_recorded',policy.client_id,key)])
  return {id:key,clientId:policy.client_id}
 }
 insist(name==='insurance.injury.attach','unknown_injury_command',404)
 const injury=await one(db,'SELECT * FROM bm_injury_cases WHERE id=?',text(input.id,'injury_case',100));insist(injury,'injury_case_not_found',404)
 const visit=await one(db,'SELECT id FROM bm_appointments WHERE id=? AND client_id=?',text(input.appointmentId,'appointment',100),injury.client_id)
 const report=await one(db,"SELECT id,sha256 FROM bm_chart_documents WHERE id=? AND client_id=? AND mime='application/pdf'",text(input.documentId,'progress_report',100),injury.client_id)
 insist(visit&&report,'injury_visit_and_report_must_belong_to_case_patient',409)
 insist(input.attest===true||input.attest==='on','confirm_carrier_report_requirements_and_original')
 const control=text(input.attachmentControl,'attachment_control',50);element(control)
 await commit(db,who,[clientGuard(db,who,injury.client_id),guard(db,'EXISTS(SELECT 1 FROM bm_appointments WHERE id=? AND client_id=?)',visit.id,injury.client_id),guard(db,'EXISTS(SELECT 1 FROM bm_chart_documents WHERE id=? AND client_id=? AND sha256=?)',report.id,injury.client_id,report.sha256),stmt(db,'INSERT INTO bm_injury_visits(appointment_id,case_id,document_id,attachment_control,approved_by,approved_at) VALUES(?,?,?,?,?,?)',visit.id,injury.id,report.id,control,who.email,now()),audit(db,who,'insurance.injury_report_linked',injury.client_id,injury.id)])
 return {id:injury.id,appointmentId:visit.id,documentId:report.id,transport:'unavailable',reason:'A BAA-backed carrier attachment channel is not configured; no report or claim has been sent.'}
}
export async function injuryFacts(db:D1Database,appointmentId:string,policyId:string){
 const row=await one(db,`SELECT c.id,c.policy_id,c.kind,c.claim_number,v.document_id,v.attachment_control,d.sha256 FROM bm_injury_visits v JOIN bm_injury_cases c ON c.id=v.case_id JOIN bm_chart_documents d ON d.id=v.document_id WHERE v.appointment_id=?`,appointmentId)
 if(!row)return undefined
 insist(row.policy_id===policyId,'injury_case_carrier_does_not_match_policy',409)
 return {caseId:row.id,kind:row.kind,claimNumber:row.claim_number,documentId:row.document_id,documentSha256:row.sha256,attachmentControl:row.attachment_control}
}
export async function injuryState(db:D1Database,who:Actor){
 if(who.role!=='owner')return null
 const cases=await rows(db,`SELECT c.*,p.first_name||' '||p.last_name AS patient,y.name AS payer FROM bm_injury_cases c JOIN bm_clients p ON p.id=c.client_id JOIN bm_policies o ON o.id=c.policy_id JOIN bm_payers y ON y.id=o.payer_id WHERE p.erased_at IS NULL ORDER BY c.created_at,c.id`)
 await commit(db,who,cases.flatMap(c=>[clientGuard(db,who,c.client_id),audit(db,who,'insurance.injury_cases_read',c.client_id,c.id)]))
 return cases
}
