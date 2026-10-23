import { guard, insist, one, rows, stmt, type Data } from '../domain/model'
import type { ClaimSnapshot } from './types'
import type { CobPrior } from './cob-types'

export async function stageSetup(db:D1Database,claim:Data,snapshot:Pick<ClaimSnapshot,'invoiceId'|'serviceDate'>) {
 const policies=await rows(db,"SELECT id,priority FROM bm_policies WHERE client_id=? AND starts_on<=? AND (ends_on='' OR ends_on IS NULL OR ends_on>=?) ORDER BY priority",claim.client_id,snapshot.serviceDate,snapshot.serviceDate)
 insist(new Set(policies.map(p=>p.priority)).size===policies.length,'resolve_duplicate_COB_policy_priorities')
 return policies.flatMap(p=>[stmt(db,"INSERT INTO bm_cob_stages(invoice_id,policy_id,priority,state,updated_at) VALUES(?,?,?,'waiting',?) ON CONFLICT(invoice_id,policy_id) DO NOTHING",snapshot.invoiceId,p.id,p.priority,new Date().toISOString())])
}
export async function cobFacts(db:D1Database,policy:Data,invoice:Data) {
 if(policy.priority===1)return undefined
 const stages=await rows(db,`SELECT s.*,a.id AS adjudication_id,a.detail FROM bm_cob_stages s LEFT JOIN bm_cob_adjudications a ON a.invoice_id=s.invoice_id AND a.policy_id=s.policy_id AND a.id=(SELECT z.id FROM bm_cob_adjudications z WHERE z.invoice_id=s.invoice_id AND z.policy_id=s.policy_id ORDER BY z.recorded_at DESC,z.rowid DESC LIMIT 1) WHERE s.invoice_id=? AND s.priority<? ORDER BY s.priority`,invoice.id,policy.priority)
 insist(stages.length===policy.priority-1&&stages.every(s=>s.state==='adjudicated'&&s.adjudication_id),'prior_payers_must_adjudicate_before_preparing_next_claim',409)
 const prior=stages.map(s=>JSON.parse(s.detail) as CobPrior)
 insist(prior.every(p=>p.lines.length&&p.lines.every(l=>l.code&&l.adjudicatedOn&&l.units!==null)),'record_each_prior_EOB_line_units_and_adjudication_date_before_next_claim',409)
 return {priority:policy.priority,prior,primaryUnits:prior[0].lines.map(l=>({code:l.code,units:l.units!}))}
}
export async function stageForClaim(db:D1Database,claim:Data) {
 return one(db,'SELECT * FROM bm_cob_stages WHERE invoice_id=? AND policy_id=?',claim.invoice_id,claim.policy_id)
}
export async function crossoverTarget(db:D1Database,claim:Data,carrier:{name:string;code:string}|undefined) {
 if(!carrier)return null
 const current=await stageForClaim(db,claim)
 const next=await one(db,`SELECT s.*,y.name,y.payer_id FROM bm_cob_stages s JOIN bm_policies p ON p.id=s.policy_id JOIN bm_payers y ON y.id=p.payer_id WHERE s.invoice_id=? AND s.priority=?`,claim.invoice_id,Number(current?.priority??1)+1)
 insist(next&&next.state==='waiting'&&!next.claim_id,'crossover_must_name_next_unclaimed_policy',409)
 insist(carrier.code?carrier.code===next.payer_id:carrier.name.trim().toUpperCase()===String(next.name).trim().toUpperCase(),'crossover_carrier_does_not_match_next_policy')
 return next
}
export function adjudicationStatements(db:D1Database,claim:Data,prior:CobPrior,key:string,at:string,denied:boolean,crossover:Data|null) {
 const list=[stmt(db,'INSERT INTO bm_cob_adjudications(id,invoice_id,policy_id,claim_id,source_kind,source_id,payer_control,paid_cents,detail,recorded_at) VALUES(?,?,?,?,?,?,?,?,?,?)',key,claim.invoice_id,claim.policy_id,claim.id,prior.sourceKind,prior.sourceId,prior.payerControl,prior.paidCents,JSON.stringify(prior),at),
 stmt(db,"UPDATE bm_cob_stages SET state=?,updated_at=?,version=version+1 WHERE invoice_id=? AND policy_id=? AND state<>'adjudicated'",denied?'denied':'adjudicated',at,claim.invoice_id,claim.policy_id),guard(db,'changes()=1')]
 if(crossover)list.push(stmt(db,"UPDATE bm_cob_stages SET state='crossover',source_claim_id=?,updated_at=?,version=version+1 WHERE invoice_id=? AND policy_id=? AND state='waiting' AND claim_id IS NULL",claim.id,at,claim.invoice_id,crossover.policy_id),guard(db,'changes()=1'))
 return list
}
