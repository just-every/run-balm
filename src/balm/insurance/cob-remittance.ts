import { insist, one, type Actor, type Data } from '../domain/model'
import { claimFor } from './access'
import { stageForClaim } from './cob-stages'
import type { ClaimSnapshot } from './types'
import type { CobPrior } from './cob-types'
import type { RemitClaim } from './remittance-parser'

export async function remitIdentity(db:D1Database,who:Actor,r:RemitClaim,payerId:string):Promise<{claim:Data;facts:ClaimSnapshot;crossover:boolean}> {
 const original=await claimFor(db,who,r.id),facts=JSON.parse(original.snapshot) as ClaimSnapshot
 if(facts.payer.id===payerId)return {claim:original,facts,crossover:false}
 const target=await one(db,`SELECT s.*,p.*,y.name AS payer_name,y.payer_id AS payer_code,y.receiver_id,y.medicare,y.unit_method FROM bm_cob_stages s JOIN bm_policies p ON p.id=s.policy_id JOIN bm_payers y ON y.id=p.payer_id WHERE s.invoice_id=? AND p.payer_id=? AND s.state='crossover' AND s.source_claim_id=?`,original.invoice_id,payerId,original.id)
 insist(target,'remittance_claim_payer_does_not_match')
 const payer={id:payerId,name:target.payer_name,code:target.payer_code,receiver:target.receiver_id,medicare:!!target.medicare,unitMethod:target.unit_method}
 const subscriber={first:target.subscriber_first,last:target.subscriber_last,dob:target.subscriber_dob,sex:target.subscriber_sex,relationship:target.relationship,memberId:target.member_id,group:target.group_number}
 return {claim:{...original,policy_id:target.policy_id},facts:{...facts,payer,subscriber},crossover:true}
}
export async function remitPrior(db:D1Database,claim:Data,facts:ClaimSnapshot,r:RemitClaim,sourceId:string):Promise<CobPrior> {
 const stage=await stageForClaim(db,claim)
 insist(stage,'COB_stage_missing_refresh_claim',409)
 return {policyId:claim.policy_id,priority:stage.priority,payer:facts.payer,subscriber:facts.subscriber,paidCents:r.paidCents,payerControl:r.control,lines:r.lines,
 adjustments:r.adjustments.filter(a=>a.line===null),sourceId,sourceKind:'835'}
}
