import {audit,commit,day,guard,id,insist,now,one,rows,sha256,stmt,text,type Actor,type Data} from '../domain/model'
import {biller} from '../domain/role-access'
import {noteTemplate} from '../charting/template-catalog'
import {pdf,type Block} from '../payments/pdf'
import {insuranceActor,clientGuard} from './access'
import {authorizationWrite} from './setup'

const allowed=(who:Actor)=>insist(who.role==='owner'||biller(who),'authorization_request_requires_owner_or_biller',403)
const filing=(kind:string,column:string)=>`COALESCE((SELECT episode_id FROM bm_episode_records WHERE record_kind='${kind}' AND record_id=${column}),'')`
const requestGuard=(db:D1Database,r:Data)=>guard(db,`EXISTS(SELECT 1 FROM bm_referrals f JOIN bm_policies p ON p.id=f.policy_id JOIN bm_clients c ON c.id=f.client_id WHERE f.id=? AND f.client_id=? AND f.policy_id=? AND COALESCE(f.episode_id,'')=? AND c.erased_at IS NULL AND p.payer_id=? AND p.member_id=?)`,r.referral_id,r.client_id,r.policy_id,r.episode_id??'',JSON.parse(r.payload).payerId,JSON.parse(r.payload).member)

async function requestFor(db:D1Database,who:Actor,key:unknown){
 const r=await one(db,'SELECT * FROM bm_authorization_requests WHERE id=?',text(key,'request',100))
 insist(r,'authorization_request_not_found',404)
 await commit(db,who,[clientGuard(db,who,r.client_id),audit(db,who,'insurance.authorization_request_read',r.client_id,r.id)])
 return r
}

function packet(payload:Data){
 const n=payload.evaluation,p=payload.plan
 const blocks:Block[]=[{kind:'facts',rows:[['Patient',payload.patient],['Payer',payload.payer],['Member',payload.member],['Referral',payload.referralId],['Prepared by',payload.preparedBy]]},
 {kind:'heading',text:'Signed evaluation'},
 {kind:'notes',lines:[...(n.sections?JSON.parse(n.sections).flatMap((s:Data)=>[s.label,s.text]):[n.body]),'Signed by '+n.signer_name+' at '+n.signed_at,'Signature digest '+n.signed_sha256,...payload.addenda.flatMap((a:Data)=>['Addendum '+a.written_at+' by '+a.signer_name,a.body])]},
 {kind:'heading',text:'Signed plan of care'},
 {kind:'notes',lines:[p.content.diagnoses,p.content.shortTermGoals,p.content.longTermGoals,p.content.interventions,'Frequency '+p.content.frequencyPerWeek+' per week for '+p.content.durationWeeks+' weeks, starting '+p.content.startDate,'Therapist '+p.therapist_name+', '+p.therapist_credentials+' signed '+p.created_at,'Plan digest '+p.content_sha256,...(p.certified_at?['Physician '+p.certifier_name+' certified '+p.certified_at]:['Physician certification pending'])]},
 {kind:'heading',text:'Outcome scores from the signed evaluation'},
 {kind:'notes',lines:payload.scores.map((m:Data)=>m.name+': '+m.value+' '+m.unit)}]
 return pdf({header:'Prior authorization request',title:'Prepared records for payer portal',blocks})
}

/** Clinical packets use the existing owner review boundary. Billers record external
 * work and decisions without gaining a new clinical read or outbound send door. */
export async function authorizationRequestCommand(db:D1Database,initial:Actor,name:string,input:Data){
 const who=await insuranceActor(db,initial,true);allowed(who)
 if(name==='insurance.authorization_request.prepare'){
  insist(who.role==='owner','owner_prepares_clinical_authorization_packet',403)
  const epoch=(await one(db,'SELECT version FROM bm_retention_epoch WHERE id=1'))!.version
  const referral=await one(db,`SELECT f.*,p.member_id,p.payer_id,p.version AS policy_version,y.name AS payer,c.first_name,c.last_name FROM bm_referrals f JOIN bm_policies p ON p.id=f.policy_id JOIN bm_payers y ON y.id=p.payer_id JOIN bm_clients c ON c.id=f.client_id WHERE f.id=? AND c.erased_at IS NULL`,text(input.referralId,'referral',100))
  insist(referral,'insured_referral_not_found',404)
  const note=await one(db,`SELECT n.*,r.body,r.sections,CASE WHEN n.appointment_id IS NULL THEN ${filing('note','n.id')} ELSE ${filing('visit','n.appointment_id')} END AS episode FROM bm_notes n JOIN bm_note_revisions r ON r.note_id=n.id AND r.number=n.signed_revision WHERE n.id=? AND n.client_id=? AND n.signed_at IS NOT NULL`,text(input.noteId,'evaluation',100),referral.client_id)
  insist(note&&noteTemplate(note)?.kind==='evaluation','signed_evaluation_required',409)
  insist(note.episode===(referral.episode_id??''),'evaluation_must_belong_to_referral_episode',409)
  const plan=await one(db,`SELECT p.*,${filing('plan','p.id')} AS episode FROM bm_plans_of_care p WHERE p.id=? AND p.client_id=? AND p.note_id=? AND p.author_id=?`,text(input.planId,'plan',100),referral.client_id,note.id,note.author_id)
  insist(plan&&plan.episode===note.episode,'signed_evaluation_plan_required',409)
  const scores=await rows(db,"SELECT name,value,unit FROM bm_measures WHERE note_id=? AND kind='score' ORDER BY recorded_at,id",note.id)
  insist(scores.length,'record_outcome_scores_in_the_evaluation_before_signing',409)
  const addenda=await rows(db,'SELECT body,signer_name,written_at,sha256 FROM bm_note_addenda WHERE note_id=? ORDER BY written_at,id',note.id)
  const at=now(),key=id()
  const payload:Data={patient:referral.first_name+' '+referral.last_name,payer:referral.payer,payerId:referral.payer_id,member:referral.member_id,referralId:referral.id,preparedBy:who.email,evaluation:note,plan:{...plan,content:JSON.parse(plan.content)},scores,addenda}
  // Store no physician sign-in token or other private link in the packet snapshot.
  delete payload.plan.sign_token_hash;delete payload.plan.sign_token_expires_at
  const serialized=JSON.stringify(payload),digest=await sha256(serialized)
  await commit(db,who,[clientGuard(db,who,referral.client_id),guard(db,'EXISTS(SELECT 1 FROM bm_retention_epoch WHERE id=1 AND version=?)',epoch),
   guard(db,'EXISTS(SELECT 1 FROM bm_referrals WHERE id=? AND version=?)',referral.id,referral.version),
   guard(db,'EXISTS(SELECT 1 FROM bm_policies WHERE id=? AND version=?)',referral.policy_id,referral.policy_version),
   stmt(db,'INSERT INTO bm_authorization_requests(id,client_id,referral_id,policy_id,episode_id,note_id,plan_id,payload,pdf,sha256,prepared_at,prepared_by) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)',key,referral.client_id,referral.id,referral.policy_id,referral.episode_id,note.id,plan.id,serialized,packet(payload),digest,at,who.email),
   audit(db,who,'insurance.authorization_request_prepared',referral.client_id,key)])
  return {id:key,sha256:digest,status:'prepared'}
 }
 const r=await requestFor(db,who,input.id)
 insist(input.sha256===r.sha256,'review_the_exact_authorization_request',409)
 insist(input.attest===true||input.attest==='on','confirm_the_recorded_external_work')
 const at=now()
 if(name==='insurance.authorization_request.submit'){
  const channel=text(input.channel,'submission_channel',30);insist(['availity','payer_portal'].includes(channel),'use_availity_or_the_payer_portal')
  const submittedOn=day(input.submittedOn,'submitted_on'),reference=text(input.reference,'submission_reference',160)
  insist(submittedOn<=at.slice(0,10),'submission_cannot_be_in_the_future')
  await commit(db,who,[requestGuard(db,r),guard(db,'NOT EXISTS(SELECT 1 FROM bm_authorization_submissions WHERE request_id=?)',r.id),stmt(db,'INSERT INTO bm_authorization_submissions(request_id,channel,submitted_on,reference,recorded_at,recorded_by) VALUES(?,?,?,?,?,?)',r.id,channel,submittedOn,reference,at,who.email),audit(db,who,'insurance.authorization_submission_recorded',r.client_id,r.id)])
  return {id:r.id,status:'submitted'}
 }
 insist(name==='insurance.authorization_request.decide','unknown_insurance_command',404)
 const submission=await one(db,'SELECT * FROM bm_authorization_submissions WHERE request_id=?',r.id)
 insist(submission,'record_submission_before_the_decision',409)
 const decision=text(input.decision,'decision',20);insist(['approved','denied'].includes(decision),'invalid_authorization_decision')
 const decidedOn=day(input.decidedOn,'decided_on'),reference=text(input.reference,'decision_reference',160),reason=text(input.reason,'decision_reason',1000)
 insist(decidedOn>=submission.submitted_on&&decidedOn<=at.slice(0,10),'invalid_decision_date',409)
 const write=decision==='approved'?await authorizationWrite(db,who,{...input,id:undefined,policyId:r.policy_id,episodeId:r.episode_id??''}):null
 await commit(db,who,[requestGuard(db,r),guard(db,'NOT EXISTS(SELECT 1 FROM bm_authorization_decisions WHERE request_id=?)',r.id),
  ...(r.episode_id?[guard(db,'EXISTS(SELECT 1 FROM bm_episodes WHERE id=? AND closed_at IS NULL)',r.episode_id)]:[guard(db,'NOT EXISTS(SELECT 1 FROM bm_episodes WHERE client_id=? AND closed_at IS NULL)',r.client_id)]),
  ...(write?.statements??[]),stmt(db,'INSERT INTO bm_authorization_decisions(request_id,decision,decided_on,reference,reason,authorization_id,recorded_at,recorded_by) VALUES(?,?,?,?,?,?,?,?)',r.id,decision,decidedOn,reference,reason,write?.id??null,at,who.email),audit(db,who,'insurance.authorization_decision_recorded',r.client_id,r.id)])
 return {id:r.id,status:decision,authorizationId:write?.id??null}
}

export async function authorizationRequestsFor(db:D1Database,who:Actor,clientId:string){
 if(who.role!=='owner'&&!biller(who))return null
 const requests=await rows(db,`SELECT r.id,r.client_id,r.referral_id,r.policy_id,r.episode_id,r.note_id,r.plan_id,r.sha256,r.prepared_at,r.prepared_by,s.channel,s.submitted_on,s.reference AS submission_reference,s.recorded_by AS submitted_by,d.decision,d.decided_on,d.reference AS decision_reference,d.reason,d.authorization_id,d.recorded_by AS decided_by FROM bm_authorization_requests r LEFT JOIN bm_authorization_submissions s ON s.request_id=r.id LEFT JOIN bm_authorization_decisions d ON d.request_id=r.id WHERE r.client_id=? ORDER BY r.prepared_at DESC,r.id`,clientId)
 if(requests.length)await commit(db,who,[clientGuard(db,who,clientId),audit(db,who,'insurance.authorization_requests_read',clientId)])
 return requests.map((r):Data=>({...r,status:r.decision??(r.submitted_on?'submitted':'prepared')}))
}
export async function authorizationRequestPdf(db:D1Database,who:Actor,key:string){
 insist(who.role==='owner','owner_reviews_clinical_authorization_packet',403)
 const r=await requestFor(db,who,key)
 await commit(db,who,[clientGuard(db,who,r.client_id),audit(db,who,'insurance.authorization_packet_downloaded',r.client_id,r.id)])
 return {filename:'authorization-request-'+r.id+'.pdf',contentType:'application/pdf',body:new Uint8Array(r.pdf)}
}
