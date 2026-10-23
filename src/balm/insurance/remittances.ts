import {matchMigrated,runoutPosting} from './runout'
import { audit, commit, guard, id, insist, now, one, sha256, stmt, text, type Actor, type Data } from '../domain/model'
import { payerAuthority } from './manual-payers'
import { remitIdentity, remitPrior } from './cob-remittance'
import { adjudicationStatements, crossoverTarget, stageForClaim } from './cob-stages'
import { adjustmentLabel, remarkLabel, denialNextStep } from './codes'
import { parseRemittance } from './remittance-parser'
import type { ClaimSnapshot } from './types'

export async function importRemittance(db:D1Database,who:Actor,input:Data) {
  const payerId=text(input.payerId,'payer',100),parsed=parseRemittance(input.x12),hash=await sha256(parsed.body)
  const payer=await one(db,'SELECT payer_id FROM bm_payers WHERE id=?',payerId)
  insist(payer&&parsed.payerCodes.every(code=>code===payer.payer_id),'remittance_payer_does_not_match')
  const duplicate=await one(db,'SELECT id,payer_id FROM bm_insurance_imports WHERE sha256=?',hash)
  if(duplicate){insist(duplicate.payer_id===payerId,'remittance_payer_does_not_match');return {id:duplicate.id,duplicate:true}}
  insist(!await one(db,"SELECT id FROM bm_insurance_imports WHERE kind='835' AND payer_id=? AND trace=?",payerId,parsed.trace),'remittance_trace_already_imported_with_different_content',409)
  const key=id(),at=now(),statements:D1PreparedStatement[]=[payerAuthority(db,who),stmt(db,"INSERT INTO bm_insurance_imports(id,kind,sha256,trace,payer_id,amount_cents,imported_by,imported_at) VALUES(?,'835',?,?,?,?,?,?)",key,hash,parsed.trace,payerId,parsed.amountCents,who.email,at)]
  const outcomes=[]
  for(const r of parsed.claims) {
    if(!await one(db,'SELECT 1 FROM bm_claims WHERE id=?',r.id)){
      insist(who.role==='owner','unmatched_remittance_requires_owner_review',403)
      const migrated=await matchMigrated(db,payerId,r)
      if(migrated){const posting=runoutPosting(db,who,migrated,r,key);statements.push(...posting.statements);outcomes.push(posting.outcome)}
      else {const suspenseId=id();statements.push(stmt(db,'INSERT INTO bm_remittance_suspense(id,import_id,payer_id,patient_control,paid_cents,detail,reason,created_at) VALUES(?,?,?,?,?,?,?,?)',suspenseId,key,payerId,r.id,r.paidCents,JSON.stringify(r),'No unique migrated claim match; payment held in suspense',at),audit(db,who,'insurance.remittance_held_in_suspense',null,suspenseId));outcomes.push({id:suspenseId,suspense:true,paidCents:r.paidCents})}
      continue
    }
    const {claim,facts,crossover}=await remitIdentity(db,who,r,payerId)
    const stage=await stageForClaim(db,claim),forwarded=await crossoverTarget(db,claim,r.crossedTo)
    const prior=await remitPrior(db,claim,facts,r,key)
    insist(crossover||['batched','exported','submitted','accepted','rejected','denied'].includes(claim.status),'remittance_claim_state_invalid',409)
    insist(r.chargeCents===claim.amount_cents,'remittance_charge_does_not_match_claim')
    if(r.lines.length)for(const l of r.lines)insist(facts.lines.some(f=>f.code===l.code),'remittance_procedure_does_not_match_claim')
    const co=r.adjustments.filter(a=>a.group==='CO').reduce((sum,a)=>sum+a.amountCents,0)
    const denialAdjustments=r.adjustments.filter(a=>a.group==='CO'&&!['45','253'].includes(a.reason))
    const status=r.status==='4'?'denied':denialAdjustments.length?'partial':'paid'
    // An adjudication denial stays receivable for correction/appeal. Contractual
    // reductions on paid claims settle the invoice; PR remains for the patient.
    let writeoff=r.status==='4'?0:co
    const open=await one(db,`SELECT i.amount_cents-(SELECT COALESCE(SUM(amount_cents),0) FROM bm_invoice_payments WHERE invoice_id=i.id)-(SELECT COALESCE(SUM(amount_cents),0) FROM bm_invoice_adjustments WHERE invoice_id=i.id) AS cents FROM bm_invoices i WHERE i.id=? AND i.status='approved'`,claim.invoice_id)
    if(stage&&stage.priority>1&&open){
      writeoff=r.status==='4'?0:Math.min(co,Math.max(0,Number(open.cents)-r.paidCents-r.prCents))
      insist(status!=='paid'||Number(open.cents)-r.paidCents-writeoff===r.prCents,'secondary_EOB_does_not_reconcile_remaining_invoice_responsibility',409)
    }
    insist(stage?.priority!==1||!r.adjustments.some(a=>a.group==='OA'||a.group==='PI'),'primary_remittance_adjustment_group_not_supported')
    insist(open&&r.paidCents+writeoff<=open.cents,'remittance_would_overpost_invoice_import_nothing',409)
    const errors=status==='denied'||status==='partial'?r.adjustments.filter(a=>a.group==='CO').map(a=>({code:'carc_'+a.reason,field:'claim',message:`${adjustmentLabel(a.group,a.reason)}. ${r.remarks.map(remarkLabel).join('; ')} ${denialNextStep(a.reason)}`})):[]
    statements.push(
      ...adjudicationStatements(db,claim,prior,id(),at,status==='denied'||status==='partial',forwarded),
      ...(!crossover?[guard(db,'NOT EXISTS(SELECT 1 FROM bm_remittance_claims WHERE claim_id=?)',claim.id),
      stmt(db,'INSERT INTO bm_remittance_claims(import_id,claim_id,paid_cents,co_cents,pr_cents,payer_control,adjustments) VALUES(?,?,?,?,?,?,?)',key,claim.id,r.paidCents,co,r.prCents,r.control,JSON.stringify({adjustments:r.adjustments,remarks:r.remarks,lines:r.lines}))]:[]),
      ...(r.paidCents?[stmt(db,'INSERT INTO bm_payments(id,invoice_id,amount_cents,reference,recorded_by,recorded_at) VALUES(?,?,?,?,?,?)',id(),claim.invoice_id,r.paidCents,`era:${payerId}:${parsed.trace}:${claim.id}`,who.email,at)]:[]),
      ...(writeoff?[stmt(db,'INSERT INTO bm_insurance_adjustments(id,invoice_id,amount_cents,reason,remittance_id,recorded_by,recorded_at) VALUES(?,?,?,?,?,?,?)',id(),claim.invoice_id,writeoff,r.adjustments.filter(a=>a.group==='CO').map(a=>adjustmentLabel(a.group,a.reason)).join('; '),key,who.email,at)]:[]),
      guard(db,`(SELECT COALESCE(SUM(amount_cents),0) FROM bm_invoice_payments WHERE invoice_id=?)+(SELECT COALESCE(SUM(amount_cents),0) FROM bm_invoice_adjustments WHERE invoice_id=?)<=(SELECT amount_cents FROM bm_invoices WHERE id=? AND status='approved')`,claim.invoice_id,claim.invoice_id,claim.invoice_id),
      ...(!crossover?[stmt(db,'UPDATE bm_claims SET status=?,errors=?,payer_control=?,updated_at=?,version=version+1 WHERE id=? AND version=?',status,JSON.stringify(errors),r.control,at,claim.id,claim.version),guard(db,'changes()=1')]:[]),
      stmt(db,'INSERT INTO bm_claim_events(id,claim_id,kind,detail,created_at) VALUES(?,?,?,?,?)',id(),claim.id,'835',JSON.stringify(r),at),audit(db,who,'insurance.remittance_posted',claim.client_id,claim.id))
    outcomes.push({id:claim.id,policyId:claim.policy_id,crossover,forwardedTo:forwarded?.policy_id??null,status,paidCents:r.paidCents,adjustmentCents:writeoff,patientResponsibilityCents:r.prCents,errors})
  }
  statements.push(stmt(db,'INSERT INTO bm_runout_deposits(import_id,native_cents) VALUES(?,?)',key,outcomes.filter(o=>!('migrated' in o)&&!('suspense' in o)).reduce((sum,o)=>sum+o.paidCents,0)))
  await commit(db,who,statements)
  return {id:key,depositCents:parsed.amountCents,claims:outcomes,duplicate:false}
}
