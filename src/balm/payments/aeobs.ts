import {audit,commit,guard,human,id,insist,now,one,rows,sha256,stmt,text,day,type Actor,type Data} from '../domain/model'
import {clientVisible} from '../domain/clients'
import {attachment} from '../messages/attachments'

const owner=(who:Actor)=>{human(who);insist(who.role==='owner','only_the_owner_records_payer_estimates',403)}
const attest=(input:Data)=>insist(input.attest===true||input.attest==='on','confirm_the_payer_original_and_patient_match')
async function policyFor(db:D1Database,clientId:string,policyId:string){
 const policy=await one(db,'SELECT p.id,p.version,p.member_id,p.payer_id,y.name AS payer FROM bm_policies p JOIN bm_payers y ON y.id=p.payer_id WHERE p.id=? AND p.client_id=?',policyId,clientId)
 insist(policy,'patient_policy_not_found',404)
 return policy
}
const basis=(source:Data)=>({snapshot:JSON.parse(source.snapshot),reference:source.source_reference,sourceDate:source.source_date,matchEvidence:source.match_evidence,fileHash:source.file_sha256})

/** An imported payer original, not a benefit calculation or payer submission. */
async function prepare(db:D1Database,who:Actor,input:Data){
 owner(who);attest(input)
 const client=await clientVisible(db,who,input.clientId),policy=await policyFor(db,client.id,text(input.policyId,'patient_policy',100))
 const file=await attachment(input);insist(file&&file.mime==='application/pdf','upload_the_payer_original_pdf')
 const source={snapshot:JSON.stringify({clientId:client.id,clientVersion:client.version,patient:client.first_name+' '+client.last_name,dateOfBirth:client.date_of_birth,policyId:policy.id,policyVersion:policy.version,payerId:policy.payer_id,payer:policy.payer,memberId:policy.member_id}),source_reference:text(input.sourceReference,'payer_reference',200),source_date:day(input.sourceDate,'payer_estimate_date'),match_evidence:text(input.matchEvidence,'how_the_patient_and_policy_were_matched',500),file_sha256:file.digest}
 insist(source.source_date<=new Date().toISOString().slice(0,10),'payer_estimate_date_is_in_the_future')
 const key=id(),digest=await sha256(JSON.stringify(basis(source)))
 await commit(db,who,[guard(db,'EXISTS(SELECT 1 FROM bm_clients WHERE id=? AND version=? AND erased_at IS NULL)',client.id,client.version),guard(db,'EXISTS(SELECT 1 FROM bm_policies WHERE id=? AND client_id=? AND version=?)',policy.id,client.id,policy.version),
  stmt(db,'INSERT INTO bm_aeob_sources(id,client_id,policy_id,snapshot,source_reference,source_date,match_evidence,filename,content_base64,file_sha256,sha256,prepared_at,prepared_by) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)',key,client.id,policy.id,source.snapshot,source.source_reference,source.source_date,source.match_evidence,file.filename,file.content,file.digest,digest,now(),who.email),audit(db,who,'aeob.prepared',client.id,key)])
 return {id:key,sha256:digest,payer:policy.payer,sourceReference:source.source_reference}
}
async function issue(db:D1Database,who:Actor,input:Data){
 owner(who);attest(input)
 const source=await one(db,'SELECT * FROM bm_aeob_sources WHERE id=?',text(input.id,'payer_estimate',100));insist(source,'payer_estimate_not_found',404)
 insist(input.sha256===source.sha256&&await sha256(JSON.stringify(basis(source)))===source.sha256,'review_the_exact_payer_original',409)
 const consent=text(input.portalConsent,'patient_requested_portal_copy_evidence',500),snapshot=JSON.parse(source.snapshot)
 await commit(db,who,[guard(db,'EXISTS(SELECT 1 FROM bm_clients WHERE id=? AND version=? AND erased_at IS NULL)',source.client_id,snapshot.clientVersion),guard(db,'EXISTS(SELECT 1 FROM bm_policies WHERE id=? AND client_id=? AND version=?)',source.policy_id,source.client_id,snapshot.policyVersion),
  guard(db,"EXISTS(SELECT 1 FROM bm_audit WHERE subject_id=? AND action='aeob.original_reviewed' AND actor_email=?)",source.id,who.email),
  stmt(db,'INSERT INTO bm_aeob_issues(source_id,sha256,portal_consent,issued_at,issued_by) VALUES(?,?,?,?,?)',source.id,source.sha256,consent,now(),who.email),audit(db,who,'aeob.issued',source.client_id,source.id)])
 return {id:source.id,issued:true}
}
export async function aeobCommand(db:D1Database,who:Actor,name:string,input:Data){
 if(name==='estimate.aeob.prepare')return prepare(db,who,input)
 if(name==='estimate.aeob.issue')return issue(db,who,input)
 insist(false,'unknown_command',404)
}
export async function aeobsFor(db:D1Database,clientId:string,publishedOnly=false){
 const records=await rows(db,`SELECT s.id,s.source_reference,s.source_date,s.snapshot,s.match_evidence,s.filename,s.sha256,s.prepared_at,i.issued_at FROM bm_aeob_sources s LEFT JOIN bm_aeob_issues i ON i.source_id=s.id WHERE s.client_id=? ${publishedOnly?'AND i.source_id IS NOT NULL':''} ORDER BY s.prepared_at DESC,s.id`,clientId)
 return records.map(row=>({...row,snapshot:JSON.parse(row.snapshot)}))
}
export async function aeobOriginal(db:D1Database,clientId:string,key:string,publishedOnly=false){
 const source=await one(db,`SELECT s.* FROM bm_aeob_sources s WHERE s.id=? AND s.client_id=? ${publishedOnly?'AND EXISTS(SELECT 1 FROM bm_aeob_issues i WHERE i.source_id=s.id)':''}`,key,clientId)
 insist(source,'payer_estimate_not_found',404)
 insist(await sha256(source.content_base64)===source.file_sha256,'payer_original_integrity_error',409)
 return {bytes:Uint8Array.from(atob(source.content_base64),c=>c.charCodeAt(0)),name:'payer-estimate-'+source.id+'.pdf'}
}
