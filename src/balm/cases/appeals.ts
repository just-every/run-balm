import type { Bindings } from '../../auth.server'
import {audit,commit,guard,human,id,insist,now,one,rows,sha256,stmt,text,type Actor,type Data} from '../domain/model'
import {biller} from '../domain/role-access'
import {releaseCommand} from '../domain/payer-note-releases'
import {claimFor} from '../insurance/access'

export const appealAuthority=(who:Actor)=>{human(who);insist(who.role==='owner'||biller(who),'appeal_billing_authority_required',403)}
export async function appealsFor(db:D1Database,who:Actor,referral:Data){
 if(who.role!=='owner'&&!biller(who))return []
 const packets=await rows(db,"SELECT * FROM bm_case_steps WHERE referral_id=? AND kind='denial.appeal' ORDER BY approved_at,id",referral.id)
 const out=[]
 for(const r of packets){const result=JSON.parse(r.result),paid=await one(db,'SELECT COALESCE(SUM(paid_cents),0) AS cents FROM bm_cob_adjudications WHERE claim_id=?',result.claimId);out.push({...r,result,citations:JSON.parse(r.citations),resolution:Number(paid?.cents)>Number(result.paymentBaseline)?'resolved':'awaiting_payment'})}
 return out
}
export async function appealCommand(env:Bindings,who:Actor,name:string,input:Data){
 appealAuthority(who)
 const db=env.DB
 if(name==='case.appeal.prepare'){
  const claim=await claimFor(db,who,text(input.claimId,'claim',100))
  insist(claim.status==='denied'||claim.status==='partial','appeal_requires_posted_denial',409)
  const referral=await one(db,'SELECT * FROM bm_referrals WHERE id=? AND client_id=? AND policy_id=?',text(input.caseId,'case',100),claim.client_id,claim.policy_id)
  insist(referral,'case_not_found',404)
  const policy=await one(db,'SELECT * FROM bm_policies WHERE id=?',claim.policy_id)
  const auth=await one(db,'SELECT * FROM bm_authorizations WHERE id=? AND policy_id=?',text(input.authorizationId,'authorization',100),claim.policy_id)
  insist(auth&&auth.starts_on<=claim.service_date&&auth.ends_on>=claim.service_date,'choose_authorization_covering_denied_visit',409)
  const note=await one(db,'SELECT * FROM bm_notes WHERE appointment_id=? AND signed_at IS NOT NULL',claim.appointment_id)
  insist(note,'sign_the_visit_note_before_appeal',409)
  const event=await one(db,"SELECT id,detail FROM bm_claim_events WHERE claim_id=? AND kind='835' ORDER BY created_at DESC,rowid DESC LIMIT 1",claim.id)
  insist(event,'appeal_requires_posted_denial',409)
  const release=await releaseCommand(db,who,'note_release.prepare',{clientId:claim.client_id,payerId:policy!.payer_id,purpose:'appeal',reference:claim.id,appointmentIds:[claim.appointment_id]})
  const wording=`Appeal for claim ${claim.id}, payer control ${claim.payer_control}. The payer reported ${JSON.parse(claim.errors).map((e:Data)=>e.message).join(' ')} Authorization ${auth.number} covers the service on ${claim.service_date}. Please reconsider using the attached signed note and recorded authorization.`
  const citations=[{kind:'claim',href:`/app/clients/${claim.client_id}#claim-${claim.id}`,label:`Claim ${claim.id}`},{kind:'era',href:`/app/clients/${claim.client_id}#claim-${claim.id}`,label:`835 adjudication ${event.id}`},{kind:'note',href:`/app/clients/${claim.client_id}#note-${note.id}`,label:'Signed treatment note'},{kind:'authorization',href:`/app/clients/${claim.client_id}#authorization-${auth.id}`,label:`Authorization ${auth.number}`}]
  const paid=await one(db,'SELECT COALESCE(SUM(paid_cents),0) AS cents FROM bm_cob_adjudications WHERE claim_id=?',claim.id)
  const result={paymentBaseline:Number(paid?.cents),claimId:claim.id,eventId:event.id,releaseId:release.id,releaseDigest:release.sha256,authorization:auth,adjudication:JSON.parse(event.detail),delivery:'not_sent'}
  const digest=await sha256(JSON.stringify({wording,citations,result})),key=id()
  await commit(db,who,[guard(db,"EXISTS(SELECT 1 FROM bm_claims WHERE id=? AND version=? AND status IN ('denied','partial'))",claim.id,claim.version),stmt(db,"INSERT INTO bm_case_steps(id,referral_id,step_key,kind,title,digest,citations,wording,approved_by,approved_role,approved_at,status,result) VALUES(?,?,?,'denial.appeal','Denial appeal',?,?,?,?,?,?,'sending',?)",key,referral.id,'denial.appeal:'+key,digest,JSON.stringify(citations),wording,who.email,who.role,now(),JSON.stringify(result)),audit(db,who,'case.appeal_prepared',claim.client_id,key)])
  return {id:key,digest,...result}
 }
 const packet=await one(db,"SELECT * FROM bm_case_steps WHERE id=? AND kind='denial.appeal'",text(input.id,'appeal',100));insist(packet,'appeal_not_found',404)
 insist(name==='case.appeal.approve','unknown_command',404)
 insist(input.digest===packet.digest,'review_the_exact_appeal_digest',409)
 insist(packet.status==='sending','appeal_already_approved',409)
 const result=JSON.parse(packet.result),claim=await claimFor(db,who,result.claimId)
 insist(['denied','partial'].includes(claim.status),'appeal_requires_posted_denial',409)
 const condition=`EXISTS(SELECT 1 FROM bm_note_release_approvals a WHERE a.release_id=? AND a.sha256=? AND a.expires_at>?) AND NOT EXISTS(SELECT 1 FROM bm_note_release_revocations WHERE release_id=?) AND EXISTS(SELECT 1 FROM bm_audit WHERE subject_id=? AND actor_email=? AND action=?)`
 const values=[result.releaseId,result.releaseDigest,now(),result.releaseId,result.releaseId,who.email,who.role==='owner'?'note_release.reviewed':'note_release.downloaded']
 insist(await one(db,'SELECT 1 WHERE '+condition,...values),'download_current_approved_appeal_evidence_first',403)
 await commit(db,who,[guard(db,condition,...values),guard(db,"EXISTS(SELECT 1 FROM bm_claims WHERE id=? AND version=? AND status IN ('denied','partial'))",claim.id,claim.version),stmt(db,"UPDATE bm_case_steps SET status='done',approved_by=?,approved_role=?,approved_at=? WHERE id=? AND status='sending'",who.email,who.role,now(),packet.id),guard(db,'changes()=1'),audit(db,who,'case.appeal_approved',claim.client_id,packet.id)])
 return {id:packet.id,status:'approved_not_sent'}
}
