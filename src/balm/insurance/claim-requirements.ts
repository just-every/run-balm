import {audit,commit,guard,insist,one,rows,stmt,text,type Actor,type Data} from '../domain/model'
import {datePlus,hostDateAt} from '../availability/timezone'
import {yes} from './access'
import type {ClaimSnapshot,ScrubError} from './types'

export async function saveClaimRequirements(db:D1Database,who:Actor,input:Data){
 insist(who.role==='owner','only_the_owner_can_change_claim_requirements',403)
 const payer=text(input.payerId,'payer',100),source=text(input.source,'payer_requirement_source',2000)
 await commit(db,who,[guard(db,'EXISTS(SELECT 1 FROM bm_payers WHERE id=?)',payer),
  stmt(db,`INSERT INTO bm_payer_claim_requirements(payer_id,authorization,certification,filing,source) VALUES(?,?,?,?,?) ON CONFLICT(payer_id) DO UPDATE SET authorization=excluded.authorization,certification=excluded.certification,filing=excluded.filing,source=excluded.source,version=bm_payer_claim_requirements.version+1`,payer,yes(input.authorization)?1:0,yes(input.certification)?1:0,yes(input.filing)?1:0,source),
  stmt(db,'UPDATE bm_payers SET version=version+1 WHERE id=?',payer),audit(db,who,'insurance.claim_requirements_saved',null,payer)])
 return {saved:true}
}

/** Billing gets certification status and opaque references, never plan text.
 * Certification must cover the service and its explicitly filed episode. */
export async function claimRequirements(db:D1Database,s:ClaimSnapshot,clientId:string,visitId:string){
 const [rule,visit,settings,filingRules,decisions]=await Promise.all([
  one(db,'SELECT * FROM bm_payer_claim_requirements WHERE payer_id=?',s.payer.id),
  one(db,`SELECT a.practitioner_id,COALESCE(e.episode_id,'') AS episode_id FROM bm_appointments a LEFT JOIN bm_episode_records e ON e.record_kind='visit' AND e.record_id=a.id WHERE a.id=?`,visitId),
  one(db,'SELECT time_zone FROM bm_settings WHERE id=1'),
  rows(db,'SELECT * FROM bm_claim_filing_rules WHERE payer_id=? AND effective_from<=? AND (effective_to IS NULL OR effective_to>=?) ORDER BY effective_from DESC,rowid DESC',s.payer.id,s.serviceDate,s.serviceDate),
  rows(db,`SELECT e.detail FROM bm_claim_events e JOIN bm_claims c ON c.id=e.claim_id WHERE c.invoice_id=? AND c.policy_id IN (SELECT id FROM bm_policies WHERE payer_id=?) AND e.kind='filing_date' ORDER BY e.rowid DESC`,s.invoiceId,s.payer.id)
 ])
 const plan=await one(db,`SELECT p.id,p.version,p.status FROM bm_plans_of_care p LEFT JOIN bm_episode_records e ON e.record_kind='plan' AND e.record_id=p.id WHERE p.client_id=? AND p.author_id=? AND COALESCE(e.episode_id,'')=? AND json_extract(p.content,'$.startDate')<=? AND json_extract(p.content,'$.certifiedThrough')>=? ORDER BY json_extract(p.content,'$.startDate') DESC,p.created_at DESC,p.id DESC LIMIT 1`,clientId,visit!.practitioner_id,visit!.episode_id,s.serviceDate,s.serviceDate)
 const kind=s.frequency==='7'?'correction':'initial',filing=filingRules.find(r=>r.kind===kind)??null
 const anchor=filing?.basis==='service_date'?s.serviceDate:decisions.length?JSON.parse(decisions[0].detail).adjudicationOn:null
 const sourceGuards=requirementSources(s.payer.id,clientId,s.invoiceId)
 const sources=await Promise.all(sourceGuards.map(async q=>String((await one(db,q.sql,...q.values))!.fingerprint)))
 const authorization= s.authorization ? await one(db,`SELECT a.id FROM bm_authorizations a JOIN bm_policies p ON p.id=a.policy_id LEFT JOIN bm_episode_records e ON e.record_kind='authorization' AND e.record_id=a.id WHERE p.client_id=? AND p.payer_id=? AND a.number=? AND a.starts_on<=? AND a.ends_on>=? AND (a.practitioner_id IS NULL OR a.practitioner_id=?) AND COALESCE(e.episode_id,'')=? LIMIT 1`,clientId,s.payer.id,s.authorization,s.serviceDate,s.serviceDate,visit!.practitioner_id,visit!.episode_id):null
 return {rule,plan,filing,authorizationValid:!!authorization,sources,dueOn:filing&&anchor?datePlus(anchor,Number(filing.days)):null,timeZone:String(settings!.time_zone)}
}
export function requirementErrors(s:ClaimSnapshot):ScrubError[]{
 const r=s.requirements;if(!r)return []
 const errors:ScrubError[]=[],add=(code:string,field:string,message:string)=>errors.push({code,field,message})
 if(r.rule?.authorization&&(!s.authorization||!r.authorizationValid))add('authorization_required','authorization',`${s.payer.name} requires an authorization covering this visit. Record it in the patient’s coverage and authorizations. Source: ${r.rule.source}`)
 if(r.rule?.certification&&r.plan?.status!=='certified')add('plan_certification_required','certification',`${s.payer.name} requires a physician-certified plan covering this visit and episode. Open the patient’s plan of care and obtain certification. Source: ${r.rule.source}`)
 if(r.rule?.filing&&!r.filing)add('filing_rule_required','filing',`Record ${s.payer.name}’s dated ${s.frequency==='7'?'correction':'initial'} filing instruction in the claim work queue.`)
 if(r.filing&&!r.dueOn)add('filing_date_required','filing','Record the actual payer adjudication date in the claim work queue before calculating the filing deadline.')
 if(r.dueOn&&r.dueOn<hostDateAt(new Date(),r.timeZone))add('timely_filing_expired','filing',`${s.payer.name}’s filing deadline was ${r.dueOn}. Review the payer instruction and resolve filing with the payer before sending. Source: ${r.filing!.source}`)
 return errors
}

function requirementSources(payerId:string,clientId:string,invoiceId:string){
 return [
 {sql:"SELECT COALESCE(json_group_array(json_array(id,version,status)),'[]') AS fingerprint FROM (SELECT id,version,status FROM bm_plans_of_care WHERE client_id=? ORDER BY id)",values:[clientId]},
 {sql:"SELECT COALESCE(json_group_array(json_array(a.id,a.version)),'[]') AS fingerprint FROM (SELECT a.id,a.version FROM bm_authorizations a JOIN bm_policies p ON p.id=a.policy_id WHERE p.client_id=? AND p.payer_id=? ORDER BY a.id) a",values:[clientId,payerId]},
 {sql:"SELECT COALESCE(json_group_array(id),'[]') AS fingerprint FROM (SELECT id FROM bm_claim_filing_rules WHERE payer_id=? ORDER BY id)",values:[payerId]},
 {sql:"SELECT COALESCE(json_group_array(e.id),'[]') AS fingerprint FROM (SELECT e.id FROM bm_claim_events e JOIN bm_claims c ON c.id=e.claim_id WHERE c.invoice_id=? AND e.kind='filing_date' ORDER BY e.id) e",values:[invoiceId]}
 ]
}
export function requirementGuards(db:D1Database,s:ClaimSnapshot,clientId:string){
 if(!s.requirements)return []
 return [...requirementSources(s.payer.id,clientId,s.invoiceId).map((q,i)=>guard(db,`(${q.sql})=?`,...q.values,s.requirements!.sources[i])),s.requirements.rule?guard(db,'EXISTS(SELECT 1 FROM bm_payer_claim_requirements WHERE payer_id=? AND version=?)',s.payer.id,s.requirements.rule.version):guard(db,'NOT EXISTS(SELECT 1 FROM bm_payer_claim_requirements WHERE payer_id=?)',s.payer.id)]
}
