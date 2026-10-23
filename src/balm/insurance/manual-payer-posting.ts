import {audit,commit,guard,id,insist,now,one,rows,stmt,type Actor,type Data} from '../domain/model'
import {manualCob} from './cob-manual'
import {claimFor,clientGuard,yes} from './access'
import {adjustmentLabel,denialNextStep,remarkLabel} from './codes'
import {payerBatch,payerAuthority} from './manual-payers'

/** One atomic close: no money, claim, or report changes on a refused balance. */
export async function closePayerBatch(db:D1Database,who:Actor,input:Data) {
 const batch=await payerBatch(db,input.id),at=now()
 insist(yes(input.attest),'confirm_the_original_EOB_and_check_total')
 const lines=await rows(db,'SELECT * FROM bm_payer_payment_lines WHERE batch_id=? ORDER BY created_at,id',batch.id)
 insist(lines.some(l=>l.claim_id),'payer_batch_needs_claim_lines')
 insist(await one(db,'SELECT batch_id FROM bm_payer_eobs WHERE batch_id=?',batch.id),'attach_the_scanned_EOB_before_posting')
 const sum=(kind:string,field:string)=>lines.filter(l=>l.kind===kind).reduce((t,l)=>t+Number(l[field]),0)
 const paid=sum('payment','paid_cents'),interest=sum('interest','amount_cents'),recouped=sum('recoupment','amount_cents')
 insist(paid+interest-recouped===batch.amount_cents,'payer_batch_unbalanced_post_nothing',409)
 const statements:D1PreparedStatement[]=[stmt(db,"UPDATE bm_payer_payment_batches SET status='closed',closed_by=?,closed_at=?,paid_cents=?,interest_cents=?,recouped_cents=?,version=version+1 WHERE id=? AND status='draft' AND version=?",who.email,at,paid,interest,recouped,batch.id,batch.version),guard(db,'changes()=1')]
 for(const claimId of new Set(lines.filter(l=>l.claim_id).map(l=>l.claim_id))) {
  const claim=await claimFor(db,who,claimId),items=lines.filter(l=>l.claim_id===claimId),payments=items.filter(l=>l.kind==='payment'),takeback=items.filter(l=>l.kind==='recoupment').reduce((t,l)=>t+l.amount_cents,0)
  insist(JSON.parse(claim.snapshot).payer.id===batch.payer_id,'payer_does_not_match_claim')
  insist(!['draft','ready','corrected'].includes(claim.status),'claim_state_changed_refresh',409)
  insist(!takeback||!payments.length,'recoupment_must_name_a_different_claim_from_those_paid')
  const prior=await one(db,`SELECT COALESCE(SUM(amount_cents),0) AS cents FROM bm_invoice_payments WHERE invoice_id=? AND (instr(reference,?)=1 OR instr(reference,?)=1)`,claim.invoice_id,'era:'+batch.payer_id+':','payer:'+batch.payer_id+':')
  insist(takeback<=Number(prior!.cents),'recoupment_exceeds_payer_money_post_nothing',409)
  const open=await one(db,`SELECT i.amount_cents-(SELECT COALESCE(SUM(amount_cents),0) FROM bm_invoice_payments WHERE invoice_id=i.id)-(SELECT COALESCE(SUM(amount_cents),0) FROM bm_invoice_adjustments WHERE invoice_id=i.id) AS cents FROM bm_invoices i WHERE id=? AND status='approved'`,claim.invoice_id)
  const cob=await manualCob(db,claim,batch,payments,takeback,at,Number(open?.cents??0))
  const reducing=cob.reducing,billed=payments.reduce((t,l)=>t+l.billed_cents,0),pr=payments.reduce((t,l)=>t+l.pr_cents,0)
  insist(open&&reducing<=open.cents&&billed<=claim.amount_cents,'manual_payment_would_overpost_invoice_post_nothing',409)
  const adjustments=payments.flatMap(l=>JSON.parse(l.adjustments)),remarks=payments.flatMap(l=>JSON.parse(l.remarks))
  const denied=payments.some(l=>l.adjudication==='denied')
  const errors=adjustments.filter(a=>a.group!=='PR'&&!['45','253'].includes(a.reason)).map(a=>({code:'carc_'+a.reason,field:'claim',message:`${adjustmentLabel(a.group,a.reason)}. ${remarks.map(remarkLabel).join('; ')} ${denialNextStep(a.reason)}`}))
  const status=takeback?'accepted':denied?'denied':errors.length?'partial':Number(open!.cents)-reducing<=pr?'paid':'accepted'
  const control=payments.map(l=>l.payer_control).filter(Boolean).at(-1)||claim.payer_control
  statements.push(...cob.statements,clientGuard(db,who,claim.client_id),guard(db,`EXISTS(SELECT 1 FROM bm_invoices i WHERE i.id=? AND i.status='approved' AND i.amount_cents>=(SELECT COALESCE(SUM(amount_cents),0) FROM bm_invoice_payments WHERE invoice_id=i.id)+(SELECT COALESCE(SUM(amount_cents),0) FROM bm_invoice_adjustments WHERE invoice_id=i.id))`,claim.invoice_id),
   // The signed view includes this close inside this transaction. Net payer cash
   // must stay nonnegative even if two different takebacks race.
   guard(db,`(SELECT COALESCE(SUM(amount_cents),0) FROM bm_invoice_payments WHERE invoice_id=? AND (instr(reference,?)=1 OR instr(reference,?)=1))>=0`,claim.invoice_id,'era:'+batch.payer_id+':','payer:'+batch.payer_id+':'),
   stmt(db,'UPDATE bm_claims SET status=?,errors=?,payer_control=?,updated_at=?,version=version+1 WHERE id=? AND version=?',status,JSON.stringify(errors),control,at,claim.id,claim.version),guard(db,'changes()=1'),
   stmt(db,'INSERT INTO bm_claim_events(id,claim_id,kind,detail,created_at) VALUES(?,?,?,?,?)',id(),claim.id,'paper_eob',JSON.stringify({batchId:batch.id,lines:items.map(l=>({...l,adjustments:JSON.parse(l.adjustments),remarks:JSON.parse(l.remarks)}))}),at),audit(db,who,'insurance.remittance_posted',claim.client_id,claim.id))
 }
 await commit(db,who,[payerAuthority(db,who),...statements])
 return {id:batch.id,status:'closed',depositCents:paid+interest-recouped,paidCents:paid,interestCents:interest,recoupedCents:recouped}
}
