import { audit, commit, day, guard, human, id, insist, integer, now, one, rows, sha256, stmt, text, type Actor, type Data } from '../domain/model'
import { clientVisible } from '../domain/clients'
import { requireScope } from '../portal/integrations'

function owner(who: Actor) { human(who); insist(who.role==='owner','only_the_owner_reviews_finance',403) }
export async function reconciliationCommand(db: D1Database,who: Actor,name: string,input: Data) {
  if(name==='finance.reconcile.prepare') {
    if(who.role==='agent')requireScope(who,'finance.reconcile.prepare');else owner(who)
    const month=text(input.month,'month',7)
    insist(/^\d{4}-(0[1-9]|1[0-2])$/.test(month),'invalid_month')
    const observations=await rows(db,'SELECT o.* FROM bm_finance_observations o JOIN bm_clients c ON c.id=o.client_id WHERE c.erased_at IS NULL AND substr(o.occurred_on,1,7)=? ORDER BY o.id',month)
    const findings: Data[]=[]
    for(const o of observations) {
      if(o.kind==='eft'){
        // A trace without its original ERA is unresolved, never a paid claim.
        const found=await one(db,"SELECT m.id FROM bm_insurance_imports m JOIN bm_remittance_claims r ON r.import_id=m.id JOIN bm_claims c ON c.id=r.claim_id WHERE m.kind='835' AND m.trace=? AND m.amount_cents=? AND c.client_id=?",o.source_reference,o.amount_cents,o.client_id)
        if(!found)findings.push({observation:o,kind:'missing_era',explanation:'Recorded EFT '+o.reference+' has no matching ERA trace and amount. Claims remain unchanged.',requestDraft:'Please provide the ERA for EFT trace '+o.source_reference+' and amount '+o.amount_cents+' cents.',citations:[o.id,o.reference,o.source_reference]})
      }else{
        const original=observations.find(x=>x.kind==='card'&&x.client_id===o.client_id&&x.source_reference===o.source_reference&&x.amount_cents===o.amount_cents&&x.id<o.id)
        if(original)findings.push({observation:o,kind:'possible_duplicate_card',explanation:'Two distinct settlement references cite the same patient, original charge and amount. Review the provider originals before any refund.',refundDraft:{amountCents:o.amount_cents,settlementReference:o.reference,originalCharge:o.source_reference,action:'Owner must verify and separately execute any refund in Stripe; nothing is refunded here.'},citations:[original.id,o.id,original.reference,o.reference,o.source_reference]})
      }
    }
    const statements: D1PreparedStatement[]=[]
    for(const finding of findings){
      const key=id(),payload=JSON.stringify({...finding,observation:undefined}),digest=await sha256(payload),o=finding.observation
      statements.push(stmt(db,`INSERT OR IGNORE INTO bm_finance_reviews(id,client_id,observation_id,kind,payload,sha256,prepared_by,prepared_at) VALUES(?,?,?,?,?,?,?,?)`,key,o.client_id,o.id,finding.kind,payload,digest,who.email,now()))
    }
    statements.push(...[...new Set(observations.map(o=>o.client_id))].map(clientId=>audit(db,who,'finance.reconciled',clientId,null,month)))
    await commit(db,who,statements)
    const result=await rows(db,'SELECT r.id,r.client_id,r.kind,r.payload,r.sha256,r.approved_by FROM bm_finance_reviews r JOIN bm_finance_observations o ON o.id=r.observation_id WHERE substr(o.occurred_on,1,7)=? ORDER BY r.id',month)
    return {month,findings:result.map(r=>({...r,payload:JSON.parse(r.payload)})),outbound:'No request sent and no refund executed.'}
  }
  owner(who)
  if(name==='finance.observation.record') {
    const client=await clientVisible(db,who,input.clientId),kind=text(input.kind,'observation_kind',10)
    insist(['eft','card'].includes(kind),'invalid_observation_kind')
    const key=id(),amount=integer(input.amountCents,'amount',1,100_000_000),date=day(input.occurredOn,'date')
    await commit(db,who,[stmt(db,'INSERT INTO bm_finance_observations(id,client_id,kind,amount_cents,occurred_on,reference,source_reference,evidence,recorded_by,recorded_at) VALUES(?,?,?,?,?,?,?,?,?,?)',key,client.id,kind,amount,date,text(input.reference,'settlement_reference',120),text(input.sourceReference,'original_trace_or_charge',120),text(input.evidence,'source_evidence',500),who.email,now()),audit(db,who,'finance.observation_recorded',client.id,key)])
    return {id:key}
  }
  insist(name==='finance.review.approve','unknown_command',404)
  insist(input.confirm===true,'confirm_preparation_only_no_outbound')
  const review=await one(db,'SELECT * FROM bm_finance_reviews WHERE id=?',text(input.id,'review',100))
  insist(review,'review_not_found',404)
  insist(input.sha256===review.sha256&&await sha256(review.payload)===review.sha256,'review_digest_changed',409)
  await commit(db,who,[stmt(db,'UPDATE bm_finance_reviews SET approved_by=?,approved_at=? WHERE id=? AND approved_at IS NULL',who.email,now(),review.id),guard(db,'changes()=1'),audit(db,who,'finance.preparation_approved',review.client_id,review.id,review.sha256)])
  return {approved:true,sha256:review.sha256,outbound:false,refunded:false}
}
