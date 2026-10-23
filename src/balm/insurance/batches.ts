import { codeBatch, batchCodeGuards } from './batch-coding'
import { audit, commit, guard, id, insist, now, one, rows, sha256, stmt, text, type Actor, type Data } from '../domain/model'
import { refreshClaimFacts } from './claims'
import { claimFactGuards } from './fences'
import { claimFor } from './access'
import { adapterStatus, insuranceAdapter } from './adapter'
import { professionalBatch } from './professional'
import { applyMedicareServices, combineMedicareLines } from './medicare-claim'
import { scrubClaim } from './scrub'
import type { ClaimSnapshot, InsuranceEnv } from './types'

export async function prepareBatch(db:D1Database,who:Actor,input:Data) {
  insist(Array.isArray(input.claimIds)&&input.claimIds.length>0&&input.claimIds.length<=100&&new Set(input.claimIds).size===input.claimIds.length,'choose_one_to_100_different_claims')
  const claims:(Data & {facts:ClaimSnapshot})[]=[],incurredInBatch=new Map<string,number>()
  for(const key of input.claimIds) {
    const claim=await claimFor(db,who,key),facts=JSON.parse(claim.snapshot) as ClaimSnapshot
    if(facts.injury)insist(who.role==='owner','injury_case_requires_owner',403)
    const fresh=await refreshClaimFacts(db,who,claim)
    insist(JSON.stringify(fresh)===JSON.stringify(facts),'claim_facts_changed_scrub_and_review_before_batching',409)
    if(facts.payer.medicare) {
      const groupKey=`${claim.client_id}:${facts.kx.year}:${facts.kx.group}`,extra=incurredInBatch.get(groupKey)??0
      facts.kx.usedCents+=extra;facts.kx.projectedCents+=extra
      if(facts.kx.thresholdCents!==null&&facts.kx.projectedCents>facts.kx.thresholdCents) {
        facts.kx.required=true
        facts.lines=combineMedicareLines(facts.lines);applyMedicareServices(facts,facts.medicareServices)
        insist(!facts.lines.some(l=>(facts.medicareServices?.[l.code]?.coverage??'covered')==='covered')||facts.medicalNecessity.trim(),'kx_medical_necessity_required_for_this_batch',409)
      }
      facts.kx.targetedReview=facts.kx.reviewCents!==null&&facts.kx.reviewCents!==undefined&&facts.kx.projectedCents>facts.kx.reviewCents
      incurredInBatch.set(groupKey,extra+((facts as any).estimatedAllowedCents??0))
    }
    const errors=scrubClaim(facts)
    insist(claim.status==='ready'&&!errors.length,'fix_claim_scrubber_errors_before_batching',409)
    const policy=await one(db,'SELECT priority FROM bm_policies WHERE id=?',claim.policy_id)
    insist(policy?.priority===1||facts.cob,'prior_adjudication_required_for_next_payer',409)
    claims.push({...claim,facts})
  }
  insist(new Set(claims.map(c=>c.appointment_id)).size===claims.length,'a_batch_cannot_bill_the_same_visit_twice',409)
  await codeBatch(db,claims)
  const payer=claims[0].facts.payer.id
  insist(claims.every(c=>c.facts.payer.id===payer&&JSON.stringify(c.facts.billing)===JSON.stringify(claims[0].facts.billing)),'batch_requires_one_payer_and_billing_identity')
  const key=id(),body=professionalBatch(claims.map(c=>({id:c.id,snapshot:c.facts})),key),hash=await sha256(body),at=now()
  await commit(db,who,[stmt(db,"INSERT INTO bm_claim_batches(id,payer_id,body,sha256,status,created_by,created_at) VALUES(?,?,?,?,'prepared',?,?)",key,payer,body,hash,who.email,at),
    ...claims.flatMap(c=>claimFactGuards(db,c,c.facts)),
    ...claims.flatMap(c=>[stmt(db,"UPDATE bm_claims SET status='batched',snapshot=?,updated_at=?,version=version+1 WHERE id=? AND version=? AND status='ready'",JSON.stringify(c.facts),at,c.id,c.version),guard(db,'changes()=1'),stmt(db,'INSERT INTO bm_claim_batch_items(batch_id,claim_id) VALUES(?,?)',key,c.id),audit(db,who,'insurance.claim_batched',c.client_id,c.id)])])
  return {id:key,status:'prepared',claims:claims.map(c=>c.id),sha256:hash}
}
export async function submitBatch(env:InsuranceEnv,who:Actor,input:Data) {
  const db=env.DB,batch=await one(db,'SELECT * FROM bm_claim_batches WHERE id=?',text(input.id,'batch',100));insist(batch,'insurance_batch_not_found',404)
  const injury=await one(db,"SELECT 1 FROM bm_claim_batch_items b JOIN bm_claims c ON c.id=b.claim_id WHERE b.batch_id=? AND json_type(c.snapshot,'$.injury') IS NOT NULL",batch.id)
  insist(!injury,'injury_report_transport_not_configured_no_claim_sent',409)
  const status=adapterStatus(env);if(!status.available)return {status:'unavailable',reason:status.reason}
  insist(['prepared','exported'].includes(batch.status),'batch_already_submitted_or_outcome_uncertain',409)
  const claims=await rows(db,'SELECT c.id,c.client_id,c.status FROM bm_claims c JOIN bm_claim_batch_items b ON b.claim_id=c.id WHERE b.batch_id=?',batch.id)
  insist(claims.length && claims.every(c=>['batched','exported'].includes(c.status)),'payer_response_already_received_do_not_submit_again',409)
  const coding=await batchCodeGuards(db,batch.id)
  await commit(db,who,[...coding,...claims.map(c=>guard(db,"EXISTS(SELECT 1 FROM bm_claims WHERE id=? AND status IN ('batched','exported'))",c.id)),stmt(db,"UPDATE bm_claim_batches SET status='sending',version=version+1 WHERE id=? AND version=?",batch.id,batch.version),guard(db,'changes()=1'),...claims.map(c=>audit(db,who,'insurance.submission_started',c.client_id,c.id))])
  let result
  try{result=await insuranceAdapter(env).submit({kind:'837P',id:batch.id,body:batch.body,sha256:batch.sha256})}
  catch(error){await commit(db,who,[stmt(db,"UPDATE bm_claim_batches SET status='uncertain',version=version+1 WHERE id=? AND status='sending'",batch.id),...claims.map(c=>audit(db,who,'insurance.submission_uncertain',c.client_id,c.id))]);throw error}
  insist(result.status==='submitted','insurance_adapter_unavailable',409)
  await commit(db,who,[stmt(db,"UPDATE bm_claim_batches SET status='submitted',reference=?,version=version+1 WHERE id=? AND status='sending'",result.reference,batch.id),guard(db,'changes()=1'),...claims.flatMap(c=>[stmt(db,"UPDATE bm_cob_stages SET state='sent',updated_at=?,version=version+1 WHERE claim_id=? AND state='unsent'",now(),c.id),stmt(db,"UPDATE bm_claims SET status='submitted',updated_at=?,version=version+1 WHERE id=? AND status IN ('batched','exported')",now(),c.id),audit(db,who,'insurance.claim_submitted',c.client_id,c.id)])])
  return {id:batch.id,...result}
}
