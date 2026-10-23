import {claimRequirements} from './claim-requirements'
import {claimCoding} from './coding'
import { audit, commit, DomainError, guard, id, insist, now, one, stmt, text, type Actor, type Data } from '../domain/model'
import { claimFor } from './access'
import { stageSetup } from './cob-stages'
import { claimFacts } from './facts'
import { applyMedicareServices } from './medicare-claim'
import { claimFactGuards } from './fences'
import { authorizationCorrection } from './claim-authorization'
import { scrubClaim } from './scrub'
import type { ClaimSnapshot } from './types'

export async function prepareClaim(db:D1Database,who:Actor,input:Data,replaces?:Data) {
  const correction=replaces?authorizationCorrection({...replaces,errors:JSON.parse(replaces.errors),snapshot:JSON.parse(replaces.snapshot),
    ...(await one(db,"SELECT MAX(sequence) AS remittance_sequence FROM bm_audit WHERE client_id=? AND subject_id=? AND action='insurance.remittance_posted'",replaces.client_id,replaces.id))}):null
  const key=id(),facts=await claimFacts(db,who,{...input,authorizationCorrection:correction}),at=now()
  if(replaces){
    const prior=JSON.parse(replaces.snapshot) as ClaimSnapshot
    applyMedicareServices(facts,prior.medicareServices,prior.medicalNecessity)
    const payerControl=String(input.payerControl??replaces.payer_control??'')
    // Clearinghouse rejections have not reached adjudication: resend as original.
    const replacement=['denied','partial','paid','accepted'].includes(replaces.status)
    facts.frequency=replacement?'7':'1';facts.originalControl=replacement?payerControl:''
  }
  facts.coding=await claimCoding(db,facts)
  facts.requirements=await claimRequirements(db,facts,(await one(db,'SELECT client_id FROM bm_policies WHERE id=?',input.policyId))!.client_id,input.appointmentId)
  const errors=scrubClaim(facts),amount=facts.lines.reduce((t,l)=>t+l.amountCents,0)
  // Zero-priced incomplete claims still keep the approved invoice charge while
  // the scrubber names the missing line prices. No invented price is billed.
  const cents=amount||facts.invoiceCents
  if(cents<=0&&facts.belowThresholdCodes?.length)throw new DomainError(errors.filter(e=>e.code==='timed_code_below_threshold').map(e=>e.message).join(' '),400,{scrubErrors:errors})
  insist(cents>0,'claim_amount_must_be_positive')
  const policyClient=(await one(db,'SELECT client_id FROM bm_policies WHERE id=?',input.policyId))!.client_id
  const stages=await stageSetup(db,{client_id:policyClient},facts)
  await commit(db,who,[
    ...stages,
    ...claimFactGuards(db,{client_id:(await one(db,'SELECT client_id FROM bm_policies WHERE id=?',input.policyId))!.client_id,policy_id:input.policyId,appointment_id:input.appointmentId},facts),
    guard(db,"EXISTS(SELECT 1 FROM bm_invoices WHERE id=? AND status='approved' AND amount_cents=?)",facts.invoiceId,facts.invoiceCents),
    ...(replaces?[stmt(db,"UPDATE bm_claims SET status='corrected',updated_at=?,version=version+1 WHERE id=? AND version=?",at,replaces.id,replaces.version),guard(db,'changes()=1')]:[]),
    stmt(db,`INSERT INTO bm_claims(id,client_id,appointment_id,policy_id,invoice_id,replaces_id,payer_control,snapshot,errors,status,amount_cents,therapy_group,service_date,medical_necessity,created_by,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,key,(await one(db,'SELECT client_id FROM bm_policies WHERE id=?',input.policyId))!.client_id,input.appointmentId,input.policyId,facts.invoiceId,replaces?.id??null,replaces?.payer_control??'',JSON.stringify(facts),JSON.stringify(errors),errors.length?'draft':'ready',cents,facts.kx.group,facts.serviceDate,facts.medicalNecessity,who.email,at,at),
    stmt(db,"UPDATE bm_cob_stages SET claim_id=?,state='unsent',updated_at=?,version=version+1 WHERE invoice_id=? AND policy_id=? AND state<>'crossover'",key,at,facts.invoiceId,input.policyId),guard(db,'changes()=1'),
    audit(db,who,replaces?'insurance.claim_corrected':'insurance.claim_prepared',replaces?.client_id??(await one(db,'SELECT client_id FROM bm_policies WHERE id=?',input.policyId))!.client_id,key),
    ...(replaces?[stmt(db,'INSERT INTO bm_claim_events(id,claim_id,kind,detail,created_at) VALUES(?,?,?,?,?)',id(),replaces.id,'corrected',JSON.stringify({replacementId:key}),at)]:[])
  ])
  const visible=JSON.parse(JSON.stringify(facts));if(who.role!=='owner'&&who.staffRole!=='practitioner'){delete visible.distinctServices;if(visible.coding){delete visible.coding.priorContext;visible.coding.proposals=(visible.coding.proposals??[]).map((p:Data)=>({code:p.code,modifier:p.modifier,version:p.version}))}delete visible.medicalNecessity;for(const service of Object.values(visible.medicareServices??{}) as Data[])delete service.assistantBasis}
  return {id:key,status:errors.length?'draft':'ready',errors,proposals:visible.coding?.proposals??[],amountCents:cents,snapshot:visible}
}
export async function correctClaim(db:D1Database,who:Actor,input:Data) {
  const prior=await claimFor(db,who,input.id)
  insist(['draft','ready','rejected','denied','partial','accepted'].includes(prior.status),'claim_cannot_be_corrected_in_this_state',409)
  insist(!input.appointmentId||input.appointmentId===prior.appointment_id,'a_correction_cannot_change_the_visit');insist(!input.policyId||input.policyId===prior.policy_id,'a_correction_cannot_change_the_policy')
  const old=JSON.parse(prior.snapshot) as ClaimSnapshot
  return prepareClaim(db,who,{appointmentId:prior.appointment_id,policyId:prior.policy_id,therapyGroup:prior.therapy_group,referringFirst:old.referring?.first,referringLast:old.referring?.last,referringNpi:old.referring?.npi,...input},prior)
}
export async function scrubStoredClaim(db:D1Database,who:Actor,input:Data) {
  const claim=await claimFor(db,who,input.id)
  insist(['draft','ready'].includes(claim.status),'only_unbatched_claims_can_change',409)
  const snapshot=await refreshClaimFacts(db,who,claim),errors=scrubClaim(snapshot),status=errors.length?'draft':'ready'
  await commit(db,who,[...claimFactGuards(db,claim,snapshot),stmt(db,'UPDATE bm_claims SET snapshot=?,errors=?,status=?,updated_at=?,version=version+1 WHERE id=? AND version=?',JSON.stringify(snapshot),JSON.stringify(errors),status,now(),claim.id,claim.version),guard(db,'changes()=1'),audit(db,who,'insurance.claim_scrubbed',claim.client_id,claim.id)])
  return {id:claim.id,status,errors,proposals:(snapshot.coding?.proposals??[]).map(p=>who.role==='owner'||who.staffRole==='practitioner'?p:{code:p.code,modifier:p.modifier,version:p.version})}
}
export async function documentNecessity(db:D1Database,who:Actor,input:Data) {
  insist(who.role==='owner'||who.staffRole==='practitioner','medical_necessity_is_clinical',403)
  const claim=await claimFor(db,who,input.id),visit=await one(db,'SELECT practitioner_id FROM bm_appointments WHERE id=?',claim.appointment_id)
  insist(who.role==='owner'||visit?.practitioner_id===who.staffId,'only_the_treating_clinician_can_attest',403)
  insist(['draft','ready'].includes(claim.status),'correct_the_claim_before_changing_medical_necessity',409)
  const s=await refreshClaimFacts(db,who,claim);s.medicalNecessity=text(input.medicalNecessity,'medical_necessity',8000);for(const l of s.lines)if(s.kx.required&&(s.medicareServices?.[l.code]?.coverage??'covered')==='covered'&&!l.modifiers.includes('KX'))l.modifiers.push('KX')
  const errors=scrubClaim(s),status=errors.length?'draft':'ready'
  await commit(db,who,[...claimFactGuards(db,claim,s),guard(db,"EXISTS(SELECT 1 FROM bm_appointments WHERE id=? AND (?='owner' OR practitioner_id=?))",claim.appointment_id,who.role,who.staffId??''),stmt(db,'UPDATE bm_claims SET medical_necessity=?,snapshot=?,errors=?,status=?,updated_at=?,version=version+1 WHERE id=? AND version=?',s.medicalNecessity,JSON.stringify(s),JSON.stringify(errors),status,now(),claim.id,claim.version),guard(db,'changes()=1'),audit(db,who,'insurance.medical_necessity_attested',claim.client_id,claim.id)])
  return {id:claim.id,status,errors,proposals:s.coding?.proposals??[]}
}
export async function draftAppeal(db:D1Database,who:Actor,input:Data) {
  insist(who.role==='owner'||who.staffRole==='practitioner','appeal_clinical_content_is_private',403)
  const claim=await claimFor(db,who,input.id);insist(['denied','rejected','partial'].includes(claim.status),'claim_is_not_in_the_fix_queue',409)
  const s=JSON.parse(claim.snapshot) as ClaimSnapshot,reason=text(input.reason,'appeal_reason',8000)
  const draft=`Draft appeal — review and send outside Balm\n\nTo: ${s.payer.name}\nPatient: ${s.patient.first} ${s.patient.last}\nMember: ${s.subscriber.memberId}\nService date: ${s.serviceDate}\nClaim: ${claim.payer_control||claim.id}\n\nPlease reconsider this claim.\n${reason}\n\nProcedures: ${s.lines.map(l=>`${l.code} ${l.modifiers.join(' ')} (${l.units} units)`).join(', ')}\nDiagnoses: ${s.diagnoses.join(', ')}\n${s.medicalNecessity?`Medical necessity: ${s.medicalNecessity}\n`:''}\nPrepared for clinician review. Not sent.`
  await commit(db,who,[stmt(db,'UPDATE bm_claims SET appeal=?,updated_at=?,version=version+1 WHERE id=? AND version=?',draft,now(),claim.id,claim.version),guard(db,'changes()=1'),audit(db,who,'insurance.appeal_drafted',claim.client_id,claim.id)])
  return {id:claim.id,appeal:draft,status:'draft_not_sent'}
}

/** Refresh unsigned billing facts; the clinician's necessity statement is kept,
 * while changed coverage, signed charges, fee schedule and incurred expenses are rechecked. */
export async function refreshClaimFacts(db:D1Database,who:Actor,claim:Data) {
  const old=JSON.parse(claim.snapshot) as ClaimSnapshot
  const fresh=await claimFacts(db,who,{appointmentId:claim.appointment_id,policyId:claim.policy_id,therapyGroup:claim.therapy_group,referringFirst:old.referring?.first,referringLast:old.referring?.last,referringNpi:old.referring?.npi,authorizationCorrection:old.basis?.authorizationCorrection})
  applyMedicareServices(fresh,old.medicareServices,old.medicalNecessity);fresh.frequency=old.frequency;fresh.originalControl=old.originalControl
  fresh.requirements=await claimRequirements(db,fresh,claim.client_id,claim.appointment_id)
  return fresh
}
