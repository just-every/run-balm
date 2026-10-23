import { biller } from '../domain/role-access'
import { audit, commit, guard, insist, now, one, rows, stmt, text, type Actor, type Data } from '../domain/model'
import { insuranceActor, clientGuard, insuranceClient, yes } from './access'
import { payerAuthority } from './manual-payers'
import { preparePaper, submitPaper } from './cob-paper'

async function cobActor(db:D1Database,initial:Actor) {
 const who=await insuranceActor(db,initial,true)
 insist(who.role==='owner'||biller(who),'COB_requires_biller_or_owner',403)
 return who
}
export async function cobState(db:D1Database,initial:Actor,clientId?:string) {
 const who=await cobActor(db,initial)
 const stages=await rows(db,`SELECT s.*,i.client_id,i.appointment_id,q.service_date,p.payer_id,y.name AS payer,c.first_name||' '||c.last_name AS patient,
  d.decided_by,d.decided_at,d.reason AS patient_decision,
  (SELECT a.detail FROM bm_cob_adjudications a WHERE a.invoice_id=s.invoice_id AND a.policy_id=s.policy_id ORDER BY a.recorded_at DESC,a.rowid DESC LIMIT 1) AS adjudication
  FROM bm_cob_stages s JOIN bm_invoices i ON i.id=s.invoice_id JOIN bm_clients c ON c.id=i.client_id JOIN bm_policies p ON p.id=s.policy_id JOIN bm_payers y ON y.id=p.payer_id
  LEFT JOIN bm_claims q ON q.id=COALESCE(s.claim_id,s.source_claim_id) LEFT JOIN bm_cob_patient_decisions d ON d.invoice_id=i.id
  WHERE c.erased_at IS NULL ${clientId?'AND i.client_id=?':''} ORDER BY s.updated_at DESC,s.invoice_id,s.priority`,...(clientId?[clientId]:[]))
 const packets=await rows(db,`SELECT p.id,p.claim_id,p.sha256,p.created_at,p.submitted_at,p.reference,c.client_id FROM bm_cob_paper_packets p JOIN bm_claims c ON c.id=p.claim_id ${clientId?'WHERE c.client_id=?':''} ORDER BY p.created_at DESC`,...(clientId?[clientId]:[]))
 const clients=[...new Set(stages.map(s=>s.client_id))]
 if(clients.length)await commit(db,who,[payerAuthority(db,who),...clients.flatMap(key=>[clientGuard(db,who,key),audit(db,who,'insurance.cob_read',key)])])
 return {stages:stages.map(s=>({...s,adjudication:s.adjudication?JSON.parse(s.adjudication):null})),packets,wait:await one(db,'SELECT wait_days,source FROM bm_cob_wait_settings WHERE id=1')}
}
export async function cobCommand(db:D1Database,initial:Actor,name:string,input:Data) {
 const who=await cobActor(db,initial)
 if(name==='insurance.cob.read')return cobState(db,who,input.clientId)
 if(name==='insurance.cob.paper.prepare')return preparePaper(db,who,input)
 if(name==='insurance.cob.paper.submit')return submitPaper(db,who,input)
 insist(who.role==='owner','only_owner_decides_patient_billing_wait',403)
 if(name==='insurance.cob.wait.save') {
  const days=Number(input.waitDays),source=text(input.source,'payer_contract_or_owner_policy_source',1000)
  insist(Number.isInteger(days)&&days>=1&&days<=730,'COB_wait_must_be_1_to_730_days')
  await commit(db,who,[guard(db,"?='owner'",who.role),stmt(db,'INSERT INTO bm_cob_wait_settings(id,wait_days,source,recorded_by,recorded_at) VALUES(1,?,?,?,?) ON CONFLICT(id) DO UPDATE SET wait_days=excluded.wait_days,source=excluded.source,recorded_by=excluded.recorded_by,recorded_at=excluded.recorded_at',days,source,who.email,now()),audit(db,who,'insurance.cob_wait_configured')])
  return {waitDays:days,source}
 }
 if(name==='insurance.cob.patient.decide') {
  const invoice=await one(db,"SELECT * FROM bm_invoices WHERE id=? AND status='approved'",text(input.invoiceId,'invoice',100)),wait=await one(db,'SELECT * FROM bm_cob_wait_settings WHERE id=1')
  insist(invoice,'approved_invoice_not_found',404);await insuranceClient(db,who,invoice.client_id)
  insist(wait&&yes(input.attest),'configure_sourced_wait_and_confirm_explicit_patient_billing_decision',409)
  const reason=text(input.reason,'decision_reason',1000),at=now()
  const condition="EXISTS(SELECT 1 FROM bm_invoice_insurance_hold WHERE invoice_id=?) AND (SELECT julianday(?)-julianday(MAX(updated_at)) FROM bm_cob_stages WHERE invoice_id=?)>=?"
  insist(await one(db,'SELECT 1 WHERE '+condition,invoice.id,at,invoice.id,wait.wait_days),'COB_configured_wait_has_not_elapsed',409)
  await commit(db,who,[guard(db,"?='owner'",who.role),clientGuard(db,who,invoice.client_id),guard(db,condition,invoice.id,at,invoice.id,wait.wait_days),guard(db,'EXISTS(SELECT 1 FROM bm_cob_wait_settings WHERE id=1 AND wait_days=? AND source=?)',wait.wait_days,wait.source),stmt(db,'INSERT INTO bm_cob_patient_decisions(invoice_id,reason,decided_by,decided_at,wait_days,source) VALUES(?,?,?,?,?,?)',invoice.id,reason,who.email,at,wait.wait_days,wait.source),audit(db,who,'insurance.cob_patient_billing_decided',invoice.client_id,invoice.id)])
  return {invoiceId:invoice.id,status:'patient_billing_authorized',decidedBy:who.email}
 }
 insist(false,'unknown_COB_command',404)
}
