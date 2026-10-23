import {runoutState} from './runout'
import { batchCodeGuards } from './batch-coding'
import {cobState} from './cob'
import {biller} from '../domain/role-access'
import {manualPayerState} from './manual-payers'
import { audit, commit, guard, insist, now, one, practitionerId, rows, stmt, text, type Actor, type Data } from '../domain/model'
import { insuranceActor, insuranceClient, clientGuard, claimFor } from './access'
import { authorizationsFor, existingVisitWarnings } from './authorization'
import { adapterStatus } from './adapter'
import { medicarePosition } from './medicare'
import type { InsuranceEnv } from './types'

export function claimView(c:Data,who:Actor) {
  const s=JSON.parse(c.snapshot),clinical=who.role==='owner'||who.staffRole==='practitioner'
  if(!clinical){delete s.distinctServices;if(s.coding){delete s.coding.priorContext;s.coding.proposals=(s.coding.proposals??[]).map((p:Data)=>({code:p.code,modifier:p.modifier,version:p.version}))}delete s.medicalNecessity;for(const service of Object.values(s.medicareServices??{}) as Data[])delete service.assistantBasis}
  const errors=JSON.parse(c.errors)
  const result:Data={...c,snapshot:s,errors,reason:errors.map((e:Data)=>e.message).join(' '),codes:errors.map((e:Data)=>e.code),nextStep:['denied','partial'].includes(c.status)?'Review payer reasons, then correct and resubmit or draft an appeal.':c.status==='rejected'?'Correct the rejected fields and resubmit.':c.status==='draft'?'Fix scrubber errors before batching.':null}
  if(!clinical){delete result.medical_necessity;delete result.appeal}
  return result
}
export async function insuranceFile(db:D1Database,initial:Actor,clientId:string) {
  const who=await insuranceActor(db,initial),client=await insuranceClient(db,who,clientId)
  const clinical=who.role==='owner'||who.staffRole==='practitioner',own=practitionerId(who)
  const [policies,auths,eligibility,claims,medicare,visits]=await Promise.all([
    rows(db,'SELECT p.*,y.name AS payer_name,y.medicare,y.unit_method,y.fixed_unit_minutes FROM bm_policies p JOIN bm_payers y ON y.id=p.payer_id WHERE p.client_id=? ORDER BY p.priority,p.starts_on DESC',client.id),
    authorizationsFor(db,client.id),
    rows(db,'SELECT e.id,e.policy_id,e.service_date,e.status,e.benefits,e.created_at,e.checked_at FROM bm_eligibility e JOIN bm_policies p ON p.id=e.policy_id WHERE p.client_id=? ORDER BY e.created_at DESC',client.id),
    rows(db,`SELECT c.*,a.practitioner_id,(SELECT recognized_cents FROM bm_medicare_expenses WHERE claim_id=c.id) AS recognized_cents,(SELECT source FROM bm_medicare_expenses WHERE claim_id=c.id) AS expense_source,(COALESCE((SELECT r.paid_cents FROM bm_remittance_claims r WHERE r.claim_id=c.id),0)+COALESCE((SELECT SUM(CASE l.kind WHEN 'recoupment' THEN -l.amount_cents ELSE l.paid_cents END) FROM bm_payer_payment_lines l JOIN bm_payer_payment_batches b ON b.id=l.batch_id WHERE l.claim_id=c.id AND b.status='closed'),0)) AS payer_paid_cents,(COALESCE((SELECT r.pr_cents FROM bm_remittance_claims r WHERE r.claim_id=c.id),0)+COALESCE((SELECT SUM(l.pr_cents) FROM bm_payer_payment_lines l JOIN bm_payer_payment_batches b ON b.id=l.batch_id WHERE l.claim_id=c.id AND b.status='closed'),0)) AS patient_responsibility_cents FROM bm_claims c JOIN bm_appointments a ON a.id=c.appointment_id WHERE c.client_id=? AND (? OR a.practitioner_id=?) ORDER BY c.created_at DESC`,client.id,who.role==='owner'||who.staffRole==='reception'?1:0,own??''),
    rows(db,'SELECT * FROM bm_medicare_years WHERE client_id=? ORDER BY year DESC,therapy_group',client.id),
    rows(db,"SELECT a.id,a.start_at,a.practitioner_id FROM bm_appointments a WHERE a.client_id=? AND a.status='booked' AND (? OR a.practitioner_id=?) ORDER BY a.start_at",client.id,who.role==='owner'||who.staffRole==='reception'?1:0,own??'')
  ])
  await commit(db,who,[clientGuard(db,who,client.id),...claims.map(c=>guard(db,"EXISTS(SELECT 1 FROM bm_appointments WHERE id=? AND (? IN ('owner','reception') OR practitioner_id=?))",c.appointment_id,who.role,own??'')),audit(db,who,clinical?'insurance.clinical_file_read':'insurance.billing_file_read',client.id)])
  const existing = await existingVisitWarnings(db,client.id)
  const warnings = Object.fromEntries(visits.map(v => [v.id, existing[v.id] ?? []]))
  const positions=await Promise.all(medicare.map(async m=>({...m,...await medicarePosition(db,who,{clientId:client.id,year:m.year,therapyGroup:m.therapy_group}),source:m.source})))
  if (who.role !== 'owner' && who.staffRole !== 'reception') {
    for (const p of policies) delete p.copay_cents
    for (const e of eligibility) if (e.benefits) {
      const benefits = JSON.parse(e.benefits)
      benefits.benefits = (benefits.benefits ?? []).filter((b: Data) => b.information !== 'B')
      if (benefits.manual) benefits.manual.copayCents = null
      e.benefits = JSON.stringify(benefits)
    }
  }
  return {cob:who.role==='owner'||biller(who)?await cobState(db,initial,clientId):null,policies,authorizations:auths,eligibility:eligibility.map(e=>({...e,benefits:e.benefits?JSON.parse(e.benefits):null})),claims:claims.map(c=>claimView(c,who)),medicare:positions,warnings}
}
export async function insuranceState(env:InsuranceEnv,initial:Actor) {
  const who=await insuranceActor(env.DB,initial),db=env.DB,desk=who.role==='owner'||who.staffRole==='reception'
  const [settings,payers,fees,enrollments,practitioners,batches,claims,visits,medicareSettings,requirements]=await Promise.all([
    who.role==='owner'?one(db,'SELECT * FROM bm_insurance_settings WHERE id=1'):Promise.resolve(null),
    rows(db,'SELECT * FROM bm_payers ORDER BY name'),rows(db,'SELECT * FROM bm_payer_fees ORDER BY payer_id,code'),rows(db,'SELECT * FROM bm_payer_enrollments'),
    rows(db,"SELECT id,name,npi,profession FROM bm_staff WHERE role='practitioner' AND erased_at IS NULL"),
    desk?rows(db,`SELECT b.id,b.payer_id,b.status,b.reference,b.sha256,b.created_at,NOT EXISTS(SELECT 1 FROM bm_claim_batch_items x JOIN bm_claims c ON c.id=x.claim_id WHERE x.batch_id=b.id AND c.status NOT IN ('batched','exported')) AS can_submit FROM bm_claim_batches b ORDER BY b.created_at DESC LIMIT 100`):Promise.resolve([]),
    rows(db,`SELECT c.*,a.practitioner_id,(SELECT recognized_cents FROM bm_medicare_expenses WHERE claim_id=c.id) AS recognized_cents,(SELECT source FROM bm_medicare_expenses WHERE claim_id=c.id) AS expense_source,(COALESCE((SELECT r.paid_cents FROM bm_remittance_claims r WHERE r.claim_id=c.id),0)+COALESCE((SELECT SUM(CASE l.kind WHEN 'recoupment' THEN -l.amount_cents ELSE l.paid_cents END) FROM bm_payer_payment_lines l JOIN bm_payer_payment_batches b ON b.id=l.batch_id WHERE l.claim_id=c.id AND b.status='closed'),0)) AS payer_paid_cents,(COALESCE((SELECT r.pr_cents FROM bm_remittance_claims r WHERE r.claim_id=c.id),0)+COALESCE((SELECT SUM(l.pr_cents) FROM bm_payer_payment_lines l JOIN bm_payer_payment_batches b ON b.id=l.batch_id WHERE l.claim_id=c.id AND b.status='closed'),0)) AS patient_responsibility_cents FROM bm_claims c JOIN bm_appointments a ON a.id=c.appointment_id JOIN bm_clients p ON p.id=c.client_id WHERE p.erased_at IS NULL AND (? OR a.practitioner_id=?) AND c.status<>'corrected' ORDER BY c.updated_at DESC LIMIT 200`,desk?1:0,practitionerId(who)??''),
    rows(db,`SELECT a.id,a.client_id,a.practitioner_id,a.start_at FROM bm_appointments a JOIN bm_clients c ON c.id=a.client_id WHERE c.erased_at IS NULL AND a.status='booked' AND (? OR a.practitioner_id=?) AND a.start_at>=? AND a.start_at<? ORDER BY a.start_at`,desk?1:0,practitionerId(who)??'',now(),new Date(Date.now()+8*86400000).toISOString()),
    rows(db,'SELECT * FROM bm_medicare_settings ORDER BY year DESC,therapy_group'),
    who.role==='owner'?rows(db,'SELECT * FROM bm_payer_claim_requirements'):Promise.resolve([])
  ])
  const ids=new Set([...claims.map(c=>c.client_id),...visits.map(v=>v.client_id)])
  await commit(db,who,[...[...ids].flatMap(clientId=>[clientGuard(db,who,clientId),audit(db,who,'insurance.work_queue_read',clientId)]),...claims.map(c=>guard(db,"EXISTS(SELECT 1 FROM bm_appointments WHERE id=? AND (? IN ('owner','reception') OR practitioner_id=?))",c.appointment_id,who.role,practitionerId(who)??''))])
  const warnings:Record<string,unknown>={}
  for(const clientId of new Set(visits.map(v => v.client_id))) {
    const existing = await existingVisitWarnings(db, clientId)
    for(const v of visits.filter(v => v.client_id === clientId)) warnings[v.id] = existing[v.id] ?? []
  }
  const schedules=who.role==='owner'?await rows(db,'SELECT * FROM bm_billing_schedules ORDER BY effective_on DESC'):[]
  const licenses=who.role==='owner'?await rows(db,'SELECT * FROM bm_provider_licenses ORDER BY ends_on DESC'):[]
  return {runout:await runoutState(db,who),schedules,licenses,cob:who.role==='owner'||biller(who)?await cobState(db,initial):null,work:null,manualPayers:await manualPayerState(db,who),requirements,settings,payers:payers.map(p=>({...p,unit_method:p.fixed_unit_minutes != null ? 'fixed' : p.unit_method})),fees,enrollments,practitioners,batches,medicareSettings,adapter:adapterStatus(env),queue:claims.map(c=>claimView(c,who)),warnings}
}
export async function insuranceDownload(env:InsuranceEnv,initial:Actor,kind:string,key:string) {
  const who=await insuranceActor(env.DB,initial,kind!=='abn'),db=env.DB,id=text(key,'download',100)
  if(kind==='abn') {
    insist(who.role==='owner'||who.staffRole==='practitioner','abn_is_clinical',403)
    const abn=await one(db,'SELECT * FROM bm_medicare_abns WHERE id=?',id);insist(abn,'abn_not_found',404)
    const claim=await claimFor(db,who,abn.claim_id)
    await commit(db,who,[clientGuard(db,who,claim.client_id),guard(db,"EXISTS(SELECT 1 FROM bm_appointments WHERE id=? AND (?='owner' OR practitioner_id=?))",claim.appointment_id,who.role,who.staffId??''),audit(db,who,'insurance.abn_downloaded',claim.client_id,abn.id)])
    const binary=atob(String(abn.document).split(',')[1]),body=Uint8Array.from(binary,c=>c.charCodeAt(0)),extension=abn.mime==='application/pdf'?'pdf':abn.mime.split('/')[1]
    return {filename:`CMS-R-131-${id}.${extension}`,contentType:abn.mime as string,body}
  }
  if(kind==='270') {
    const e=await one(db,'SELECT e.*,p.client_id FROM bm_eligibility e JOIN bm_policies p ON p.id=e.policy_id WHERE e.id=?',id);insist(e,'eligibility_not_found',404)
    await insuranceClient(db,who,e.client_id)
    await commit(db,who,[stmt(db,"UPDATE bm_eligibility SET status='exported',version=version+1 WHERE id=? AND status='prepared'",id),audit(db,who,'insurance.270_exported',e.client_id,id)])
    return {filename:`eligibility-${id}.270.x12`,contentType:'application/EDI-X12',body:e.request as string}
  }
  insist(kind==='837P','insurance_download_kind_invalid',404)
  const batch=await one(db,'SELECT * FROM bm_claim_batches WHERE id=?',id);insist(batch,'insurance_batch_not_found',404)
  const claims=await rows(db,'SELECT c.id,c.client_id FROM bm_claims c JOIN bm_claim_batch_items b ON b.claim_id=c.id WHERE b.batch_id=?',id)
  const coding=await batchCodeGuards(db,id)
  await commit(db,who,[...coding,...claims.map(c=>guard(db,'EXISTS(SELECT 1 FROM bm_clients WHERE id=? AND erased_at IS NULL)',c.client_id)),stmt(db,"UPDATE bm_claim_batches SET status='exported',version=version+1 WHERE id=? AND status='prepared'",id),...claims.flatMap(c=>[stmt(db,"UPDATE bm_claims SET status='exported',version=version+1,updated_at=? WHERE id=? AND status='batched'",now(),c.id),audit(db,who,'insurance.837_exported',c.client_id,c.id)])])
  return {filename:`claims-${id}.837p.x12`,contentType:'application/EDI-X12',body:batch.body as string}
}
