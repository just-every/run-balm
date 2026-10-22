import {audit,commit,guard,human,id,insist,need,now,one,rows,sha256,stmt,text,type Actor,type Data} from './model'
import {clientVisible} from './clients'
import {pdf,type Block} from '../payments/pdf'
import {biller} from './role-access'

const allowed=(who:Actor)=>{human(who);insist(who.role==='owner'||biller(who),'payer_note_release_refused',403)}
async function snapshot(db:D1Database,clientId:string,ids:string[],payerId:string,purpose:string,reference:string){
 const patient=await one(db,'SELECT first_name,last_name FROM bm_clients WHERE id=? AND erased_at IS NULL',clientId)
 const payer=await one(db,'SELECT name FROM bm_payers WHERE id=?',payerId)
 insist(patient&&payer,'patient_or_payer_not_found',404)
 const notes=[]
 for(const key of ids){
  const visit=await one(db,'SELECT id,start_at FROM bm_appointments WHERE id=? AND client_id=?',key,clientId)
  insist(visit,'appointment_not_found',404)
  const signed=await rows(db,`SELECT n.id,n.template,n.signer_name,n.signer_credentials,n.signed_at,n.signed_sha256,r.body,r.sections FROM bm_notes n JOIN bm_note_revisions r ON r.note_id=n.id AND r.number=n.signed_revision WHERE n.appointment_id=? AND n.client_id=? AND n.signed_at IS NOT NULL ORDER BY n.id`,key,clientId)
  insist(signed.length,'sign_the_selected_visit_notes_before_release',409)
  for(const note of signed){
   note.addenda=await rows(db,'SELECT body,signer_name,signer_credentials,written_at,sha256 FROM bm_note_addenda WHERE note_id=? ORDER BY written_at,id',note.id)
   note.authorSignatures=await rows(db,`SELECT s.author_name,s.author_credentials,s.submitted_at,s.sha256,r.supervision_given FROM bm_note_submissions s JOIN bm_note_reviews r ON r.submission_id=s.id AND r.decision='cosigned' WHERE s.note_id=? ORDER BY s.revision`,note.id)
   notes.push({...note,visitAt:visit.start_at})
  }
 }
 return {patient:patient.first_name+' '+patient.last_name,payer:payer.name,purpose,reference,notes}
}
function document(payload:Data){
 const blocks:Block[]=[{kind:'facts',rows:[['Patient',payload.patient],['Requested by payer',payload.payer],['Purpose',payload.purpose],['Payer request reference',payload.reference]]}]
 for(const n of payload.notes){
  blocks.push({kind:'heading',text:n.visitAt+' · '+(n.template||'Treatment note')},{kind:'notes',lines:n.sections?JSON.parse(n.sections).flatMap((s:Data)=>[s.label,s.text]):[n.body]},{kind:'notes',lines:['Signed by '+n.signer_name+', '+n.signer_credentials+' at '+n.signed_at,'Signature digest '+n.signed_sha256,...n.authorSignatures.map((s:Data)=>'Author '+s.author_name+', '+s.author_credentials+' at '+s.submitted_at+' · '+s.sha256),...n.addenda.flatMap((a:Data)=>['Addendum by '+a.signer_name+' at '+a.written_at,a.body])]})
 }
 return pdf({header:'Clinical records for payer request',title:'Approved note release',blocks})
}
export async function releaseCommand(db:D1Database,who:Actor,name:string,input:Data){
 allowed(who)
 if(name==='note_release.prepare'){
  const client=await clientVisible(db,who,input.clientId),payerId=text(input.payerId,'payer',100),purpose=text(input.purpose,'purpose',30),reference=text(input.reference,'payer_request_reference',160)
  insist(['records_request','appeal'].includes(purpose),'record_the_payer_request_purpose')
  const ids=[...new Set(Array.isArray(input.appointmentIds)?input.appointmentIds:Object.keys(input).filter(k=>k.startsWith('release_visit_')&&input[k]==='on').map(k=>k.slice(14)))].map(v=>text(v,'visit',100)).sort()
  insist(ids.length>0&&ids.length<=20,'choose_one_to_twenty_visits')
  insist(await one(db,'SELECT 1 FROM bm_policies WHERE client_id=? AND payer_id=?',client.id,payerId),'payer_has_no_recorded_patient_policy',409)
  const payload=await snapshot(db,client.id,ids,payerId,purpose,reference),bytes=document(payload),digest=await sha256(JSON.stringify(payload)),key=id()
  await commit(db,who,[stmt(db,'INSERT INTO bm_note_releases(id,client_id,payer_id,purpose,reference,appointment_ids,payload,pdf,sha256,prepared_at,prepared_by) VALUES(?,?,?,?,?,?,?,?,?,?,?)',key,client.id,payerId,purpose,reference,JSON.stringify(ids),JSON.stringify(payload),bytes,digest,now(),who.email),audit(db,who,'note_release.prepared',client.id,key)])
  return {id:key,sha256:digest}
 }
 need(who,'owner')
 const row=await one(db,'SELECT * FROM bm_note_releases WHERE id=?',text(input.id,'release',100));insist(row,'release_not_found',404)
 if(name==='note_release.revoke'){
  await commit(db,who,[stmt(db,'INSERT INTO bm_note_release_revocations(release_id,revoked_at,revoked_by) VALUES(?,?,?)',row.id,now(),who.email),audit(db,who,'note_release.revoked',row.client_id,row.id)])
  return {revoked:true}
 }
 insist(name==='note_release.approve','unknown_command',404)
 insist(input.attest===true||input.attest==='on','confirm_the_exact_minimum_necessary_records')
 insist(input.sha256===row.sha256,'review_the_exact_release_digest',409)
 const epoch=(await one(db,'SELECT version FROM bm_retention_epoch WHERE id=1'))!.version
 const current=await snapshot(db,row.client_id,JSON.parse(row.appointment_ids),row.payer_id,row.purpose,row.reference)
 insist(await sha256(JSON.stringify(current))===row.sha256,'notes_changed_prepare_a_new_release',409)
 const at=now(),expiresAt=new Date(Date.now()+7*86400000).toISOString()
 await commit(db,who,[guard(db,'EXISTS(SELECT 1 FROM bm_retention_epoch WHERE id=1 AND version=?)',epoch),guard(db,"EXISTS(SELECT 1 FROM bm_audit WHERE subject_id=? AND actor_email=? AND action='note_release.reviewed')",row.id,who.email),guard(db,'NOT EXISTS(SELECT 1 FROM bm_note_release_revocations WHERE release_id=?)',row.id),stmt(db,'INSERT INTO bm_note_release_approvals(release_id,sha256,approved_at,approved_by,expires_at) VALUES(?,?,?,?,?)',row.id,row.sha256,at,who.email,expiresAt),audit(db,who,'note_release.approved',row.client_id,row.id)])
 return {approved:true,expiresAt}
}
export async function releasesFor(db:D1Database,who:Actor,clientId:string){
 if(who.role!=='owner'&&!biller(who))return null
 const list=await rows(db,`SELECT r.id,r.payer_id,r.purpose,r.reference,r.sha256,r.prepared_at,r.prepared_by,a.approved_at,a.expires_at,v.revoked_at FROM bm_note_releases r LEFT JOIN bm_note_release_approvals a ON a.release_id=r.id LEFT JOIN bm_note_release_revocations v ON v.release_id=r.id WHERE r.client_id=? ORDER BY r.prepared_at DESC,r.id`,clientId)
 return list
}
export async function releasePdf(db:D1Database,who:Actor,key:string){
 allowed(who)
 const row=await one(db,`SELECT r.*,a.approved_at,a.expires_at,v.revoked_at FROM bm_note_releases r LEFT JOIN bm_note_release_approvals a ON a.release_id=r.id LEFT JOIN bm_note_release_revocations v ON v.release_id=r.id WHERE r.id=?`,key)
 insist(row,'release_not_found',404)
 const approved=!!row.approved_at&&!row.revoked_at&&Date.parse(row.expires_at)>Date.now()
 insist(who.role==='owner'||approved,'owner_approval_required_for_note_release',403)
 await commit(db,who,[...(who.role==='owner'?[]:[guard(db,"EXISTS(SELECT 1 FROM bm_note_release_approvals WHERE release_id=? AND expires_at>?) AND NOT EXISTS(SELECT 1 FROM bm_note_release_revocations WHERE release_id=?)",key,now(),key)]),audit(db,who,who.role==='owner'?'note_release.reviewed':'note_release.downloaded',row.client_id,row.id)])
 return new Uint8Array(row.pdf)
}
