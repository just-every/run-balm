import { guard, id, one, rows, stmt, type Data } from '../domain/model'
import { adjudicationStatements, stageForClaim } from './cob-stages'
import type { CobPrior } from './cob-types'
import type { ClaimSnapshot } from './types'

export async function manualCob(db:D1Database,claim:Data,batch:Data,payments:Data[],takeback:number,at:string,open:number) {
 const stage=await stageForClaim(db,claim),statements:D1PreparedStatement[]=[]
 if(!stage)return {statements,reducing:payments.reduce((t,l)=>t+l.paid_cents+l.adjustment_cents,0)}
 if(takeback){statements.push(stmt(db,"UPDATE bm_cob_stages SET state='reopened',updated_at=?,version=version+1 WHERE invoice_id=? AND policy_id=?",at,claim.invoice_id,claim.policy_id));return {statements,reducing:0}}
 const paid=payments.reduce((t,l)=>t+l.paid_cents,0),pr=payments.reduce((t,l)=>t+l.pr_cents,0),denied=payments.some(l=>l.adjudication==='denied')
 let reduction=payments.reduce((t,l)=>t+l.adjustment_cents,0)
 if(stage.priority>1){
  reduction=denied?0:Math.max(0,open-paid-pr)
  let left=reduction
  for(const l of payments){const amount=Math.min(left,l.adjustment_cents);left-=amount;statements.push(stmt(db,'INSERT INTO bm_cob_manual_reductions(line_id,amount_cents) VALUES(?,?)',l.id,amount))}
 }
 const all=await rows(db,`SELECT l.* FROM bm_payer_payment_lines l JOIN bm_payer_payment_batches b ON b.id=l.batch_id WHERE l.claim_id=? AND l.kind='payment' AND (b.status='closed' OR b.id=?) ORDER BY l.created_at,l.id`,claim.id,batch.id)
 const complete=all.reduce((t,l)=>t+l.billed_cents,0)===claim.amount_cents
 if(complete){
  const facts=JSON.parse(claim.snapshot) as ClaimSnapshot
  const prior:CobPrior={policyId:claim.policy_id,priority:stage.priority,payer:facts.payer,subscriber:facts.subscriber,paidCents:all.reduce((t,l)=>t+l.paid_cents,0),payerControl:all.map(l=>l.payer_control).filter(Boolean).at(-1)??'',sourceKind:'paper_eob',sourceId:batch.id,
   adjustments:[],lines:all.map(l=>({code:l.procedure_code,modifiers:JSON.parse(l.procedure_modifiers),units:l.paid_units,chargeCents:l.billed_cents,paidCents:l.paid_cents,adjudicatedOn:l.adjudicated_on,adjustments:JSON.parse(l.adjustments)}))}
  const priorRow=await one(db,'SELECT id FROM bm_cob_adjudications WHERE invoice_id=? AND policy_id=?',claim.invoice_id,claim.policy_id)
  if(!priorRow)statements.push(...adjudicationStatements(db,claim,prior,id(),at,denied,null))
 }else statements.push(stmt(db,"UPDATE bm_cob_stages SET state='sent',updated_at=?,version=version+1 WHERE invoice_id=? AND policy_id=?",at,claim.invoice_id,claim.policy_id))
 return {statements,reducing:paid+reduction}
}
