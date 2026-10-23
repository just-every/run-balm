import {biller} from '../domain/role-access'
import {audit,commit,guard,id,insist,now,one,rows,stmt,text,type Actor,type Data} from '../domain/model'
import {claimFor,clientGuard,insuranceActor,yes} from './access'
import {attachment,attachmentResponse} from '../messages/attachments'
import {cents,manualLine} from './manual-payer-input'

export async function draftPayerBatch(db:D1Database,who:Actor,input:Data) {
 const payerId=text(input.payerId,'payer',100),reference=text(input.reference,'check_or_EFT_reference',150),depositOn=text(input.depositOn,'deposit_date',10)
 insist(/^\d{4}-\d{2}-\d{2}$/.test(depositOn)&&Number.isFinite(Date.parse(depositOn+'T12:00:00Z'))&&new Date(depositOn+'T12:00:00Z').toISOString().slice(0,10)===depositOn,'invalid_deposit_date')
 insist(await one(db,'SELECT id FROM bm_payers WHERE id=?',payerId),'payer_not_found',404)
 const key=id(),amount=cents(input.amountCents,'check_total')
 await commit(db,who,[stmt(db,'INSERT INTO bm_payer_payment_batches(id,payer_id,reference,deposit_on,amount_cents,created_by,created_at) VALUES(?,?,?,?,?,?,?)',key,payerId,reference,depositOn,amount,who.email,now()),audit(db,who,'insurance.payer_batch_prepared',null,key)])
 return {id:key,status:'draft'}
}
export async function payerBatch(db:D1Database,key:unknown,draft=true) {
 const batch=await one(db,'SELECT * FROM bm_payer_payment_batches WHERE id=?',text(key,'payer_batch',100))
 insist(batch,'payer_batch_not_found',404);if(draft)insist(batch.status==='draft','payer_batch_already_closed',409)
 return batch
}
export async function addPayerLine(db:D1Database,who:Actor,input:Data) {
 const batch=await payerBatch(db,input.batchId),line=manualLine(input),key=id()
 const claim=line.kind==='interest'?null:await claimFor(db,who,input.claimId)
 if(claim){const snapshot=JSON.parse(claim.snapshot);insist(snapshot.payer.id===batch.payer_id,'payer_does_not_match_claim');insist(!['draft','ready','corrected'].includes(claim.status),'claim_must_be_sent_or_exported',409)}
 const count=await one(db,'SELECT COUNT(*) AS n FROM bm_payer_payment_lines WHERE batch_id=?',batch.id);insist(count!.n<100,'payer_batch_maximum_100_lines')
 await commit(db,who,[...(claim?[clientGuard(db,who,claim.client_id)]:[]),
  stmt(db,"UPDATE bm_payer_payment_batches SET version=version+1 WHERE id=? AND status='draft' AND version=?",batch.id,batch.version),guard(db,'changes()=1'),
  stmt(db,`INSERT INTO bm_payer_payment_lines(id,batch_id,kind,claim_id,client_id,invoice_id,billed_cents,allowed_cents,paid_cents,adjustment_cents,pr_cents,amount_cents,adjudication,adjustments,remarks,payer_control,reason,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,key,batch.id,line.kind,claim?.id??null,claim?.client_id??null,claim?.invoice_id??null,line.billedCents??0,line.allowedCents??0,line.paidCents??0,line.adjustmentCents??0,line.prCents??0,line.amountCents??0,line.adjudication??'paid',JSON.stringify(line.adjustments??[]),JSON.stringify(line.remarks??[]),line.payerControl??'',line.reason,now()),
  audit(db,who,'insurance.payer_line_added',claim?.client_id??null,key)])
 return {id:key,batchId:batch.id}
}
export async function removePayerLine(db:D1Database,who:Actor,input:Data) {
 const batch=await payerBatch(db,input.batchId),line=await one(db,'SELECT * FROM bm_payer_payment_lines WHERE id=? AND batch_id=?',text(input.id,'line',100),batch.id)
 insist(line,'payer_line_not_found',404)
 // A draft scan attests to exactly the named patients. Removing a line withdraws
 // that scan, so its data can never become detached from patient custody.
 await commit(db,who,[stmt(db,"UPDATE bm_payer_payment_batches SET version=version+1 WHERE id=? AND status='draft' AND version=?",batch.id,batch.version),guard(db,'changes()=1'),stmt(db,'DELETE FROM bm_payer_eobs WHERE batch_id=?',batch.id),stmt(db,'DELETE FROM bm_payer_payment_lines WHERE id=?',line.id),audit(db,who,'insurance.payer_line_removed',line.client_id,line.id)])
 return {id:line.id,removed:true}
}
export async function attachPayerEob(db:D1Database,who:Actor,input:Data) {
 const batch=await payerBatch(db,input.batchId),upload=await attachment(input)
 insist(upload&&yes(input.attest),'attach_the_original_EOB_and_confirm_listed_patients')
 const lines=await rows(db,'SELECT DISTINCT client_id FROM bm_payer_payment_lines WHERE batch_id=? AND client_id IS NOT NULL',batch.id)
 insist(lines.length,'add_claim_lines_before_attaching_the_EOB')
 await commit(db,who,[...lines.map(l=>clientGuard(db,who,l.client_id)),stmt(db,"UPDATE bm_payer_payment_batches SET version=version+1 WHERE id=? AND status='draft' AND version=?",batch.id,batch.version),guard(db,'changes()=1'),
  stmt(db,'INSERT INTO bm_payer_eobs(batch_id,filename,mime,content_base64,sha256,uploaded_by,uploaded_at) VALUES(?,?,?,?,?,?,?) ON CONFLICT(batch_id) DO UPDATE SET filename=excluded.filename,mime=excluded.mime,content_base64=excluded.content_base64,sha256=excluded.sha256,uploaded_by=excluded.uploaded_by,uploaded_at=excluded.uploaded_at',batch.id,upload.filename,upload.mime,upload.content,upload.digest,who.email,now()),...lines.map(l=>audit(db,who,'insurance.payer_eob_attached',l.client_id,batch.id))])
 return {id:batch.id,sha256:upload.digest}
}
export async function manualPayerState(db:D1Database,who:Actor) {
 if(who.role!=='owner'&&!biller(who))return []
 const batches=await rows(db,`SELECT b.*,p.name AS payer,e.filename AS eob_filename FROM bm_payer_payment_batches b JOIN bm_payers p ON p.id=b.payer_id LEFT JOIN bm_payer_eobs e ON e.batch_id=b.id ORDER BY b.created_at DESC LIMIT 100`)
 for(const b of batches){
  b.lines=(await rows(db,`SELECT l.*,c.first_name||' '||c.last_name AS patient FROM bm_payer_payment_lines l LEFT JOIN bm_clients c ON c.id=l.client_id WHERE l.batch_id=? ORDER BY l.created_at,l.id`,b.id)).map(l=>({...l,adjustments:JSON.parse(l.adjustments),remarks:JSON.parse(l.remarks)}))
  b.postedCents=b.lines.reduce((t:number,l:Data)=>t+(l.kind==='payment'?l.paid_cents:l.kind==='interest'?l.amount_cents:-l.amount_cents),0)
 }
 const clients=[...new Set(batches.flatMap(b=>b.lines.map((l:Data)=>l.client_id)).filter(Boolean))] as string[]
 if(clients.length)await commit(db,who,clients.flatMap(key=>[clientGuard(db,who,key),audit(db,who,'insurance.payer_batches_read',key)]))
 return batches
}
export async function payerEobDownload(db:D1Database,initial:Actor,key:string) {
 const who=await insuranceActor(db,initial,true);insist(who.role==='owner'||biller(who),'payer_batches_require_biller_or_owner',403)
 const batch=await payerBatch(db,key,false),file=await one(db,'SELECT * FROM bm_payer_eobs WHERE batch_id=?',batch.id)
 insist(file,'payer_eob_unavailable_or_withdrawn',404)
 const clients=await rows(db,'SELECT DISTINCT client_id FROM bm_payer_payment_lines WHERE batch_id=? AND client_id IS NOT NULL',batch.id)
 await commit(db,who,clients.flatMap(c=>[clientGuard(db,who,c.client_id),audit(db,who,'insurance.payer_eob_downloaded',c.client_id,batch.id)]))
 return attachmentResponse({filename:file.filename,mime:file.mime,content:file.content_base64,digest:file.sha256})
}
