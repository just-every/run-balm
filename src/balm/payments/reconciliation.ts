import { eftCommand, prepareEfts } from './eft-reconciliation'
import { payoutCommand, preparePayouts } from './payout-reconciliation'
import { audit, commit, day, guard, human, id, insist, integer, now, one, rows, sha256, stmt, text, type Actor, type Data } from '../domain/model'
import { clientVisible } from '../domain/clients'
import { requireScope } from '../portal/integrations'

function owner(who: Actor) { human(who); insist(who.role==='owner','only_the_owner_reviews_finance',403) }
export async function reconciliationCommand(db: D1Database,who: Actor,name: string,input: Data) {
  if(name.startsWith('finance.eft.')) return eftCommand(db,who,name,input)
  if(name.startsWith('finance.payout.')) return payoutCommand(db,who,name,input)
  if(name==='finance.reconcile.prepare') {
    if(who.role==='agent')requireScope(who,'finance.reconcile.prepare');else owner(who)
    const month=text(input.month,'month',7)
    insist(/^\d{4}-(0[1-9]|1[0-2])$/.test(month),'invalid_month')
    const observations=await rows(db,'SELECT o.* FROM bm_finance_observations o JOIN bm_clients c ON c.id=o.client_id WHERE c.erased_at IS NULL AND substr(o.occurred_on,1,7)=? ORDER BY o.id',month)
    const sources=await rows(db,'SELECT s.* FROM bm_finance_sources s JOIN bm_clients c ON c.id=s.client_id WHERE c.erased_at IS NULL AND substr(s.occurred_on,1,7)=? ORDER BY s.id',month)
    // Current-month rows are explained once; cited related originals can be from earlier periods.
    const references=JSON.stringify([...observations,...sources].map(s=>[s.client_id,s.source_reference]))
    const related=(table:string)=>rows(db,`SELECT s.* FROM ${table} s JOIN bm_clients c ON c.id=s.client_id
      WHERE c.erased_at IS NULL AND substr(s.occurred_on,1,7)<=? AND (s.client_id,s.source_reference) IN
      (SELECT json_extract(value,'$[0]'),json_extract(value,'$[1]') FROM json_each(?)) ORDER BY s.occurred_on,s.id`,month,references)
    const [allObservations,allSources]=await Promise.all([related('bm_finance_observations'),related('bm_finance_sources')])
    const matching: Data[]=[]
    const groups=new Map<string,Data[]>()
    for(const source of [...allObservations,...allSources]) {
      const key=JSON.stringify([source.client_id,source.source_reference])
      groups.set(key,[...(groups.get(key)??[]),source])
    }
    for(const group of groups.values()) {
      const sum=(kind:string)=>group.filter(x=>x.kind===kind).reduce((total,x)=>total+Number(x.amount_cents),0)
      const card=sum('card'),charge=sum('charge'),accounting=sum('accounting'),payout=sum('payout')
      const fees=group.filter(x=>x.kind==='payout').reduce((total,x)=>total+Number(x.fee_cents),0)
      const present=(kind:string)=>group.some(x=>x.kind===kind)
      for(const source of group.filter(s=>s.occurred_on.slice(0,7)===month)) {
        const gaps:string[]=[]
        if(present('eft')&&present('card'))gaps.push('Mixed EFT and card originals require owner review.')
        if(source.kind==='eft'||source.kind==='accounting'&&present('eft')&&!present('card')) {
          for(const eft of group.filter(x=>x.kind==='eft')) {
          const era=await one(db,"SELECT m.id FROM bm_insurance_imports m JOIN bm_remittance_claims r ON r.import_id=m.id JOIN bm_claims c ON c.id=r.claim_id WHERE m.kind='835' AND m.trace=? AND m.amount_cents=? AND c.client_id=?",eft.source_reference,eft.amount_cents,eft.client_id)
          if(!era)gaps.push('No ERA with the recorded trace, full deposit amount and patient association for '+eft.reference+'.')
          }
          if(!present('accounting'))gaps.push('No owner-recorded accounting original for this EFT trace.')
          else if(accounting!==sum('eft'))gaps.push('Recorded accounting differs from recorded EFT amounts by '+(sum('eft')-accounting)+' cents.')
        } else {
          if(!present('card'))gaps.push('No recorded card settlement for this original reference.')
          if(!present('charge'))gaps.push('No owner-recorded charge original.')
          else if(charge!==card)gaps.push('Recorded charge differs from recorded settlements by '+(card-charge)+' cents.')
          if(!present('payout'))gaps.push('No owner-recorded allocated payout original.')
          else if(payout+fees!==card)gaps.push('Recorded payout plus fees differs from recorded settlements by '+(card-payout-fees)+' cents.')
          if(!present('accounting'))gaps.push('No owner-recorded accounting original.')
          else if(accounting!==card)gaps.push('Recorded accounting differs from recorded settlements by '+(card-accounting)+' cents.')
        }
        matching.push({id:source.id,kind:source.kind,amountCents:source.amount_cents,feeCents:source.fee_cents??0,
          reference:source.reference,sourceReference:source.source_reference,clientId:source.client_id,
          status:gaps.length?'unmatched':'recorded_amounts_agree',explanations:gaps.length?gaps:['Owner-recorded amounts agree; no provider verification or execution authority.'],
          citations:group.map(x=>({id:x.id,reference:x.reference,evidence:x.evidence})),
          totals:{cardCents:card,chargeCents:charge,payoutCents:payout,feeCents:fees,accountingCents:accounting}})
      }
    }
    const findings: Data[]=[]
    for(const o of observations) {
      if(o.kind==='eft'){
        // A trace without its original ERA is unresolved, never a paid claim.
        const found=await one(db,"SELECT m.id FROM bm_insurance_imports m JOIN bm_remittance_claims r ON r.import_id=m.id JOIN bm_claims c ON c.id=r.claim_id WHERE m.kind='835' AND m.trace=? AND m.amount_cents=? AND c.client_id=?",o.source_reference,o.amount_cents,o.client_id)
        if(!found)findings.push({observation:o,kind:'missing_era',explanation:'Recorded EFT '+o.reference+' has no matching ERA trace and amount. Claims remain unchanged.',requestDraft:'Please provide the ERA for EFT trace '+o.source_reference+' and amount '+o.amount_cents+' cents.',citations:[o.id,o.reference,o.source_reference]})
      }else{
        const original=allObservations.find(x=>x.kind==='card'&&x.client_id===o.client_id&&x.source_reference===o.source_reference&&x.amount_cents===o.amount_cents&&(x.occurred_on<o.occurred_on||x.occurred_on===o.occurred_on&&x.id<o.id))
        if(original)findings.push({observation:o,kind:'possible_duplicate_card',explanation:'Two distinct settlement references cite the same patient, original charge and amount. Review the provider originals before any refund.',refundDraft:{amountCents:o.amount_cents,settlementReference:o.reference,originalCharge:o.source_reference,action:'Owner must verify and separately execute any refund in Stripe; nothing is refunded here.'},citations:[original.id,o.id,original.reference,o.reference,o.source_reference]})
      }
    }
    const statements: D1PreparedStatement[]=[]
    for(const finding of findings){
      const key=id(),payload=JSON.stringify({...finding,observation:undefined}),digest=await sha256(payload),o=finding.observation
      statements.push(stmt(db,`INSERT OR IGNORE INTO bm_finance_reviews(id,client_id,observation_id,kind,payload,sha256,prepared_by,prepared_at) VALUES(?,?,?,?,?,?,?,?)`,key,o.client_id,o.id,finding.kind,payload,digest,who.email,now()))
    }
    statements.push(...[...new Set([...observations,...sources].map(o=>o.client_id))].map(clientId=>audit(db,who,'finance.reconciled',clientId,null,month)))
    await commit(db,who,statements)
    const result=await rows(db,'SELECT r.id,r.client_id,r.kind,r.payload,r.sha256,r.approved_by FROM bm_finance_reviews r JOIN bm_finance_observations o ON o.id=r.observation_id WHERE substr(o.occurred_on,1,7)=? ORDER BY r.id',month)
    return {month,matching,payouts:await preparePayouts(db,who,month),efts:await prepareEfts(db,who,month),recordedOnly:true,findings:result.map(r=>({...r,payload:JSON.parse(r.payload)})),outbound:'No request sent and no refund executed.'}
  }
  owner(who)
  if(name==='finance.source.record') {
    const client=await clientVisible(db,who,input.clientId),kind=text(input.kind,'source_kind',10)
    insist(['charge','payout','accounting'].includes(kind),'invalid_source_kind')
    const amount=integer(input.amountCents,'amount',1,100_000_000),fee=integer(input.feeCents??0,'fee',0,100_000_000)
    insist(kind==='payout'||fee===0,'fees_only_apply_to_recorded_payouts')
    insist(input.confirm===true,'confirm_owner_reviewed_allocated_original')
    const key=id()
    await commit(db,who,[stmt(db,'INSERT INTO bm_finance_sources(id,client_id,kind,amount_cents,fee_cents,occurred_on,reference,source_reference,evidence,recorded_by,recorded_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)',key,client.id,kind,amount,fee,day(input.occurredOn,'date'),text(input.reference,'reference',120),text(input.sourceReference,'original_charge',120),text(input.evidence,'source_evidence',500),who.email,now()),audit(db,who,'finance.source_recorded',client.id,key)])
    return {id:key,recordedOnly:true}
  }
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
