import { audit, commit, guard, id, insist, now, one, sha256, stmt, text, type Actor, type Data } from '../domain/model'
import { claimFor } from './access'
import { parseX12 } from './x12'

export async function importAcknowledgment(db:D1Database,who:Actor,input:Data) {
  const payerId=text(input.payerId,'payer',100),parsed=parseX12(input.x12,'277'),hash=await sha256(parsed.body)
  const duplicate=await one(db,'SELECT id FROM bm_insurance_imports WHERE sha256=?',hash)
  if(duplicate)return {id:duplicate.id,duplicate:true}
  const bht=parsed.segments.find(s=>s[0]==='BHT'),trace=bht?.[3]||parsed.segments.find(s=>s[0]==='TRN')?.[2]
  insist(trace,'acknowledgment_control_missing')
  const payer=await one(db,'SELECT payer_id FROM bm_payers WHERE id=?',payerId);insist(payer,'payer_not_found',404)
  const sender=parsed.segments.find(s=>s[0]==='NM1'&&s[1]==='PR')
  insist(sender?.[8]==='PI'&&sender[9]===payer.payer_id,'acknowledgment_payer_does_not_match')
  const entries:{claimId:string;statuses:{category:string;status:string;entity:string}[];control:string}[]=[]
  let current:typeof entries[number]|null=null,patientLoop=false
  for(const s of parsed.segments) {
    if(s[0]==='HL'){patientLoop=['PT','22','23'].includes(s[3]);current=null}
    if(s[0]==='TRN'&&patientLoop){current={claimId:s[2],statuses:[],control:''};entries.push(current)}
    if(s[0]==='STC'&&current)for(const value of [s[1],s[10],s[11]].filter(Boolean)) {const [category,status,entity]=value.split(parsed.component);current.statuses.push({category,status,entity:entity??''})}
    if(s[0]==='REF'&&current&&s[1]==='1K')current.control=s[2]
  }
  insist(entries.length>0&&new Set(entries.map(e=>e.claimId)).size===entries.length,'acknowledgment_requires_distinct_claim_statuses')
  const key=id(),at=now(),statements:D1PreparedStatement[]=[stmt(db,"INSERT INTO bm_insurance_imports(id,kind,sha256,trace,payer_id,imported_by,imported_at) VALUES(?,'277CA',?,?,?,?,?)",key,hash,trace,payerId,who.email,at)]
  const outcomes=[]
  for(const entry of entries) {
    const claim=await claimFor(db,who,entry.claimId),policy=await one(db,'SELECT payer_id FROM bm_policies WHERE id=?',claim.policy_id)
    insist(policy?.payer_id===payerId,'acknowledgment_claim_payer_does_not_match')
    insist(['batched','exported','submitted','accepted','rejected'].includes(claim.status),'acknowledgment_claim_state_invalid',409)
    insist(entry.statuses.length>0,'acknowledgment_claim_has_no_status')
    const rejected=entry.statuses.some(s=>/^A[3-8]$/.test(s.category)),accepted=entry.statuses.some(s=>s.category==='A2')
    insist(rejected||accepted||entry.statuses.every(s=>s.category==='A1'),'unsupported_acknowledgment_status')
    const status=rejected?'rejected':accepted?'accepted':'submitted'
    const errors=rejected?entry.statuses.filter(s=>/^A[3-8]$/.test(s.category)).map(s=>({code:'payer_'+s.category+'_'+s.status,field:s.entity||'claim',message:`Payer acknowledgment ${s.category}:${s.status}${s.entity?':'+s.entity:''}. Correct the named field and resubmit.`})):[]
    statements.push(stmt(db,'UPDATE bm_claims SET status=?,errors=?,payer_control=CASE WHEN ?<>\'\' THEN ? ELSE payer_control END,updated_at=?,version=version+1 WHERE id=? AND version=?',status,JSON.stringify(errors),entry.control,entry.control,at,claim.id,claim.version),guard(db,'changes()=1'),stmt(db,'INSERT INTO bm_claim_events(id,claim_id,kind,detail,created_at) VALUES(?,?,?,?,?)',id(),claim.id,'277CA',JSON.stringify(entry),at),audit(db,who,'insurance.acknowledgment_imported',claim.client_id,claim.id))
    outcomes.push({id:claim.id,status,errors})
  }
  await commit(db,who,statements)
  return {id:key,claims:outcomes,duplicate:false}
}
