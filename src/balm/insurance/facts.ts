import {claimCoding} from './coding'
import { audit, commit, insist, one, rows, type Actor, type Data } from '../domain/model'
import { hostDateAt } from '../availability/timezone'
import { policyFor } from './access'
import { cobFacts } from './cob-stages'
import { claimAuthorization, claimAuthorizations } from './claim-authorization'
import { medicareSpending } from './medicare'
import { applyMedicareServices } from './medicare-claim'
import type { ClaimSnapshot } from './types'

export { billedLines, signedCharges } from './authorization-accounting'
import { billedLines, signedCharges, authorizationCoversCodes } from './authorization-accounting'

const nameParts=(name:string)=>{const parts=name.trim().split(/\s+/);return {first:parts.slice(0,-1).join(' '),last:parts.at(-1)??''}}
export async function claimFacts(db:D1Database,who:Actor,input:Data):Promise<ClaimSnapshot> {
  const policy=await policyFor(db,who,input.policyId)
  const visit=await one(db,`SELECT a.*,COALESCE((SELECT episode_id FROM bm_episode_records WHERE record_kind='visit' AND record_id=a.id),'') AS episodeId,p.name AS practitioner_name,p.npi,p.profession,p.version AS staff_version,c.version AS client_version,c.first_name,c.last_name,c.date_of_birth,s.time_zone,s.clinic_name
    FROM bm_appointments a JOIN bm_staff p ON p.id=a.practitioner_id JOIN bm_clients c ON c.id=a.client_id JOIN bm_settings s ON s.id=1 WHERE a.id=? AND a.client_id=?`,input.appointmentId,policy.client_id)
  insist(visit,'appointment_not_found',404)
  insist(who.role==='owner'||who.staffRole==='reception'||who.staffId===visit.practitioner_id,'appointment_not_found',404)
  // Billing sees only signed charge facts, never body/sections/intake answers.
  const {signed,charges}=await signedCharges(db,visit.id)
  await commit(db,who,[audit(db,who,'insurance.signed_charges_read',visit.client_id,visit.id)])
  const billed=billedLines(charges,policy.unit_method,policy.fixed_unit_minutes)
  const [codes,fees,invoice,settings,enrollment,auths]=await Promise.all([
    rows(db,'SELECT * FROM bm_visit_codes WHERE appointment_id=? ORDER BY kind,position',visit.id),
    rows(db,'SELECT code,cents FROM bm_payer_fees WHERE payer_id=?',policy.payer_id),
    one(db,"SELECT * FROM bm_invoices WHERE appointment_id=? AND status='approved'",visit.id),
    one(db,'SELECT * FROM bm_insurance_settings WHERE id=1'),
    one(db,'SELECT * FROM bm_payer_enrollments WHERE payer_id=? AND practitioner_id=?',policy.payer_id,visit.practitioner_id),
    claimAuthorizations(db,policy.client_id)
  ])
  insist(invoice,'approve_the_visit_invoice_before_preparing_a_claim',409)
  const serviceDate=hostDateAt(new Date(visit.start_at),visit.time_zone),year=Number(serviceDate.slice(0,4))
  const group=input.therapyGroup??(/\bOT\b|occupational/i.test(visit.profession)?'ot':'pt_slp')
  insist(group==='ot'||group==='pt_slp','invalid_therapy_group')
  const diag=codes.filter(c=>c.kind==='icd10').map(c=>c.code as string)
  const modifier=group==='ot'?'GO':/speech|SLP/i.test(visit.profession)?'GN':'GP'
  const lines=billed.filter(l=>l.units>0).map(l=>{
    const saved=codes.find(c=>c.kind==='cpt'&&c.code===l.code),fee=fees.find(f=>f.code===l.code)
    const mods=new Set<string>(String(saved?.modifiers??'').split(/\s+/).filter(Boolean)); mods.add(modifier)
    return {code:l.code,minutes:l.minutes,units:l.units,modifiers:[...mods],amountCents:fee?fee.cents*l.units:0,allowedCents:fee?fee.cents*l.units:0,diagnosisPointers:l.diagnosisCodes?.length?l.diagnosisCodes.map(code=>diag.indexOf(code)+1):diag.length?[1]:[]}
  })
  const total=lines.reduce((sum,l)=>sum+l.amountCents,0)
  const spending=await medicareSpending(db,policy.client_id,year,group,visit.id),config=spending.external,annual=spending.annual
  const estimatedAllowed=lines.reduce((sum,l)=>sum+(fees.find(f=>f.code===l.code)?.cents??0)*l.units,0)
  const threshold=annual?.threshold_cents??null,used=spending.usedCents
  const required=!!policy.medicare&&threshold!==null&&used+estimatedAllowed>threshold
  const auth=claimAuthorization(auths,policy.id,serviceDate,visit.practitioner_id,input.authorizationCorrection,visit.episodeId)
  const payerRule=await one(db,'SELECT supervisor_billing,supervision_minimum,supervision_billable,supervision_rule_recorded FROM bm_payers WHERE id=?',policy.payer_id)
  const reviewed=await rows(db,`SELECT s.supervisor_id,s.author_kind,s.author_discipline,r.supervision_given FROM bm_note_submissions s JOIN bm_note_reviews r ON r.submission_id=s.id AND r.decision='cosigned' JOIN bm_notes n ON n.id=s.note_id AND n.signed_revision=s.revision WHERE n.appointment_id=?`,visit.id)
  const independent=await rows(db,`SELECT a.supervisor_id,'assistant' AS author_kind,a.author_discipline,COALESCE(s.supervision_given,'') AS supervision_given FROM bm_assistant_signed_notes a JOIN bm_notes n ON n.id=a.note_id LEFT JOIN bm_assistant_supervision s ON s.note_id=n.id WHERE n.appointment_id=?`,visit.id)
  reviewed.push(...independent)
  const supervisors=[...new Set(reviewed.map(r=>r.supervisor_id))]
  insist(supervisors.length<=1,'choose_one_rendering_supervisor_for_the_visit',409)
  const supervisionErrors:string[]=[]
  const rank:Record<string,number>={in_room:0,on_site:1,general:2}
  if(reviewed.length && !payerRule?.supervision_rule_recorded) supervisionErrors.push('Record the payer supervision rule in Clinic before claiming this supervised visit.')
  if(reviewed.length && !payerRule?.supervision_billable) supervisionErrors.push('The recorded payer rule does not allow billing this supervised visit.')
  for(const review of reviewed) {
    if(!['assistant','student','fellow'].includes(review.author_kind) || !review.author_discipline || !(review.supervision_given in rank)) supervisionErrors.push('This co-signature has no complete supervision record; review the visit before claiming.')
    else if(rank[review.supervision_given]>rank[payerRule!.supervision_minimum]) supervisionErrors.push('The supervision given does not meet the recorded payer minimum.')
    if(policy.medicare && review.author_kind==='student' && review.supervision_given!=='in_room') supervisionErrors.push('Medicare student care requires the supervising therapist in the room; this visit cannot be claimed.')
  }
  // An owner rule cannot enroll Medicare assistants or students as therapists.
  const mustBillSupervisor=!!policy.medicare && reviewed.some(r=>['assistant','student'].includes(r.author_kind))
  if(mustBillSupervisor && !payerRule?.supervisor_billing) supervisionErrors.push('Medicare assistant and student visits must bill under the supervising therapist.')
  const billSupervisor=!!payerRule?.supervisor_billing || mustBillSupervisor
  const renderingStaff=supervisors.length && billSupervisor ? await one(db,'SELECT * FROM bm_staff WHERE id=? AND active=1 AND erased_at IS NULL',supervisors[0]) : null
  insist(!supervisors.length || !billSupervisor || renderingStaff,'active_rendering_supervisor_required',409)
  const renderingEnrollment=renderingStaff ? await one(db,'SELECT * FROM bm_payer_enrollments WHERE payer_id=? AND practitioner_id=?',policy.payer_id,renderingStaff.id) : enrollment
  const rendering=nameParts(renderingStaff?.name ?? visit.practitioner_name)
  const value:ClaimSnapshot & {estimatedAllowedCents:number;policyCovers:boolean;authorizationExhausted:boolean;basis:Data}={
    ...(reviewed.length ? {supervisionErrors} : {}),
    patient:{first:visit.first_name,last:visit.last_name,dob:visit.date_of_birth??'',sex:policy.patient_sex},
    subscriber:{first:policy.subscriber_first,last:policy.subscriber_last,dob:policy.subscriber_dob,sex:policy.subscriber_sex,relationship:policy.relationship,memberId:policy.member_id,group:policy.group_number},
    address:{street:policy.address,city:policy.city,state:policy.state,postal:policy.postal_code},
    payer:{id:policy.payer_id,name:policy.payer_name,code:policy.payer_code,receiver:policy.receiver_id,medicare:!!policy.medicare,unitMethod:policy.fixed_unit_minutes != null ? 'fixed' : policy.unit_method,...(policy.fixed_unit_minutes != null ? {fixedUnitMinutes:policy.fixed_unit_minutes} : {})},
    billing:{name:visit.clinic_name,npi:settings?.billing_npi??'',taxId:settings?.tax_id??'',address:settings?.address??'',city:settings?.city??'',state:settings?.state??'',postal:settings?.postal_code??'',sender:settings?.sender_id??'',contact:settings?.contact_name??'',phone:settings?.contact_phone??'',production:!!settings?.production},
    rendering:{...rendering,npi:renderingStaff?.npi ?? visit.npi,taxonomy:renderingEnrollment?.taxonomy??'',enrolled:!!renderingEnrollment?.active},
    referring:input.referringNpi||input.referringLast?{first:String(input.referringFirst??''),last:String(input.referringLast??''),npi:String(input.referringNpi??'')}:null,
    authorization:auth?.number??null,serviceDate,diagnoses:diag,lines,signedNotes:signed.map(n=>({id:n.id,digest:n.signed_sha256,revision:n.signed_revision})),
    ...(policy.fixed_unit_minutes != null ? {belowThresholdCodes:billed.filter(l=>l.timed&&l.units===0).map(l=>l.code)} : {}),
    invoiceId:invoice.id,invoiceCents:invoice.amount_cents,attended:visit.status==='attended',requiresReferral:!!policy.requires_referral,
    kx:{required,thresholdCents:threshold,usedCents:used,projectedCents:used+estimatedAllowed,group,year,reviewCents:annual?.review_cents??null,targetedReview:!!policy.medicare&&annual!==null&&used+estimatedAllowed>annual.review_cents,source:annual?.source??'',externalUsedCents:config?.external_used_cents??0},medicalNecessity:'',frequency:'1',originalControl:'',estimatedAllowedCents:estimatedAllowed,
    basis:{assistantSupervisionCount:independent.filter(r=>r.supervision_given).length,...(renderingStaff ? {renderingStaffId:renderingStaff.id,renderingStaffVersion:renderingStaff.version} : {}),...(input.authorizationCorrection?{authorizationCorrection:input.authorizationCorrection}:{}),policyVersion:policy.version,payerVersion:policy.payer_version,appointmentVersion:visit.version,staffVersion:visit.staff_version,clientVersion:visit.client_version,billingVersion:settings?.version??null,medicareVersion:config?.version??null,medicareSettingsVersion:annual?.version??null,priorClaimsVersion:spending.previous.reduce((sum,c)=>sum+c.version,0),expensesVersion:spending.previous.reduce((sum,c)=>sum+(c.expense_version??0),0),codes:JSON.stringify(codes.map(c=>[c.kind,c.position,c.code,c.modifiers,c.units])),signed:JSON.stringify(signed.map(n=>[n.id,n.signed_sha256]))},
    policyCovers:policy.starts_on<=serviceDate&&(!policy.ends_on||policy.ends_on>=serviceDate),authorizationExhausted:!!auth&&auth.used_allowance>auth.allowance_total,authorizationNotCovered:!!auth&&!authorizationCoversCodes(auth,billed.filter(l=>l.units>0).map(l=>l.code))
  }
  const attestations=await rows(db,`SELECT r.clinical FROM bm_notes n JOIN bm_note_revisions r ON r.note_id=n.id AND r.number=n.signed_revision WHERE n.appointment_id=? AND n.signed_at IS NOT NULL ORDER BY n.id`,visit.id)
  value.distinctServices=attestations.flatMap(r=>JSON.parse(r.clinical??'{}').distinctServices??[])
  value.cob=await cobFacts(db,policy,invoice)
  applyMedicareServices(value)
  value.coding=await claimCoding(db,value)
  return value
}
