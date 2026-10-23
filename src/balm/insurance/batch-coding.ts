import {claimRequirements,requirementErrors,requirementGuards} from './claim-requirements'
import { guard, insist, rows, type Data } from '../domain/model'
import { codingGuards } from '../codesets'
import { claimCoding } from './coding'
import type { ClaimSnapshot } from './types'
export type CodedClaim=Data&{facts:ClaimSnapshot}
export async function codeBatch(db:D1Database,claims:CodedClaim[]) {
 for(const c of claims){
  const peers=claims.filter(p=>p.id!==c.id&&p.client_id===c.client_id&&p.facts.serviceDate===c.facts.serviceDate&&p.facts.rendering.npi===c.facts.rendering.npi).map(p=>({invoiceId:p.facts.invoiceId,lines:p.facts.lines}))
  c.facts.coding=await claimCoding(db,c.facts,peers)
  const issues=c.facts.coding?.issues??[]
  insist(!issues.length,issues.map(i=>i.message).join(' '),409)
 }
}
/** Recheck code releases and the whole same-day batch before an irreversible
 * download/send. All guards run before any batch member changes state. */
export async function batchCodeGuards(db:D1Database,batchId:string) {
 const stored=await rows(db,'SELECT c.* FROM bm_claims c JOIN bm_claim_batch_items b ON b.claim_id=c.id WHERE b.batch_id=? ORDER BY c.id',batchId)
 const claims:CodedClaim[]=stored.map(c=>({...c,facts:JSON.parse(c.snapshot) as ClaimSnapshot}))
 await codeBatch(db,claims)
 for(const c of claims){
  const fresh=await claimRequirements(db,c.facts,c.client_id,c.appointment_id)
  const errors=requirementErrors({...c.facts,requirements:fresh})
  insist(!errors.length,errors.map(e=>e.message).join(' '),409)
  insist(!c.facts.requirements||JSON.stringify(fresh)===JSON.stringify(c.facts.requirements),'claim_requirements_changed_correct_and_review_the_claim_before_export_or_send',409)
 }
 return claims.flatMap(c=>[...requirementGuards(db,c.facts,c.client_id),guard(db,'EXISTS(SELECT 1 FROM bm_clients WHERE id=? AND erased_at IS NULL)',c.client_id),guard(db,'EXISTS(SELECT 1 FROM bm_claims WHERE id=? AND version=?)',c.id,c.version),...(c.facts.coding?codingGuards(db,c.facts.coding):[])])
}
