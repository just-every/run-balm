import { bill, cpt, type Charge } from '../charting/cpt'
import { audit, commit, insist, one, rows, type Actor, type Data } from '../domain/model'
import { hostDateAt } from '../availability/timezone'
import { policyFor } from './access'
import { authorizationsFor } from './authorization'
import type { ClaimSnapshot } from './types'

const nameParts=(name:string)=>{const parts=name.trim().split(/\s+/);return {first:parts.slice(0,-1).join(' '),last:parts.at(-1)??''}}
export async function claimFacts(db:D1Database,who:Actor,input:Data):Promise<ClaimSnapshot> {
  const policy=await policyFor(db,who,input.policyId)
  const visit=await one(db,`SELECT a.*,p.name AS practitioner_name,p.npi,p.profession,p.version AS staff_version,c.version AS client_version,c.first_name,c.last_name,c.date_of_birth,s.time_zone,s.clinic_name
    FROM bm_appointments a JOIN bm_staff p ON p.id=a.practitioner_id JOIN bm_clients c ON c.id=a.client_id JOIN bm_settings s ON s.id=1 WHERE a.id=? AND a.client_id=?`,input.appointmentId,policy.client_id)
  insist(visit,'appointment_not_found',404)
  insist(who.role==='owner'||who.staffRole==='reception'||who.staffId===visit.practitioner_id,'appointment_not_found',404)
  const signed=await rows(db,`SELECT n.id,n.signed_sha256,n.signed_revision,r.charges FROM bm_notes n JOIN bm_note_revisions r ON r.note_id=n.id AND r.number=n.signed_revision WHERE n.appointment_id=? AND n.signed_at IS NOT NULL ORDER BY n.id`,visit.id)
  // Billing sees only signed charge facts, never body/sections/intake answers.
  await commit(db,who,[audit(db,who,'insurance.signed_charges_read',visit.client_id,visit.id)])
  const minutes=new Map<string,number>()
  for(const r of signed) for(const charge of JSON.parse(r.charges??'[]') as Charge[]) {
    insist(cpt(charge.code)&&Number.isInteger(charge.minutes)&&charge.minutes>=0,'invalid_signed_charge')
    minutes.set(charge.code,(minutes.get(charge.code)??0)+charge.minutes)
  }
  const charges=[...minutes].map(([code,minutes])=>({code,minutes}))
  const billed=policy.unit_method==='ama'?charges.map(c=>({...cpt(c.code)!,minutes:c.minutes,units:cpt(c.code)!.timed?Math.floor((c.minutes+7)/15):1})):bill(charges).lines
  const [codes,fees,invoice,settings,enrollment,auths]=await Promise.all([
    rows(db,'SELECT * FROM bm_visit_codes WHERE appointment_id=? ORDER BY kind,position',visit.id),
    rows(db,'SELECT code,cents FROM bm_payer_fees WHERE payer_id=?',policy.payer_id),
    one(db,"SELECT * FROM bm_invoices WHERE appointment_id=? AND status='approved'",visit.id),
    one(db,'SELECT * FROM bm_insurance_settings WHERE id=1'),
    one(db,'SELECT * FROM bm_payer_enrollments WHERE payer_id=? AND practitioner_id=?',policy.payer_id,visit.practitioner_id),
    authorizationsFor(db,policy.client_id)
  ])
  insist(invoice,'approve_the_visit_invoice_before_preparing_a_claim',409)
  const serviceDate=hostDateAt(new Date(visit.start_at),visit.time_zone),year=Number(serviceDate.slice(0,4))
  const group=input.therapyGroup??(/\bOT\b|occupational/i.test(visit.profession)?'ot':'pt_slp')
  insist(group==='ot'||group==='pt_slp','invalid_therapy_group')
  const diag=codes.filter(c=>c.kind==='icd10').map(c=>c.code as string)
  const modifier=group==='ot'?'GO':/speech|SLP/i.test(visit.profession)?'GN':'GP'
  const amounts=input.lineAmountsCents
  insist(amounts===undefined||(Array.isArray(amounts)&&amounts.length===billed.filter(l=>l.units>0).length&&amounts.every(n=>Number.isSafeInteger(n)&&n>0&&n<=10_000_000)),'invalid_claim_line_amounts')
  const lines=billed.filter(l=>l.units>0).map((l,i)=>{
    const saved=codes.find(c=>c.kind==='cpt'&&c.code===l.code),fee=fees.find(f=>f.code===l.code)
    const mods=new Set<string>(String(saved?.modifiers??'').split(/\s+/).filter(Boolean)); mods.add(modifier)
    return {code:l.code,minutes:l.minutes,units:l.units,modifiers:[...mods],amountCents:amounts?.[i]??(fee?fee.cents*l.units:0),diagnosisPointers:diag.length?[1]:[]}
  })
  const total=lines.reduce((sum,l)=>sum+l.amountCents,0)
  const config=await one(db,'SELECT * FROM bm_medicare_years WHERE client_id=? AND year=? AND therapy_group=?',policy.client_id,year,group)
  // Posted allowed expense is paid + patient responsibility. Before an ERA,
  // only an explicitly maintained payer fee schedule estimates incurred expense.
  const previous=await rows(db,`SELECT c.snapshot,c.amount_cents,c.version,r.paid_cents,r.pr_cents FROM bm_claims c JOIN bm_policies p ON p.id=c.policy_id JOIN bm_payers y ON y.id=p.payer_id
    LEFT JOIN bm_remittance_claims r ON r.claim_id=c.id WHERE c.client_id=? AND y.medicare=1 AND c.therapy_group=? AND substr(c.service_date,1,4)=? AND c.appointment_id<>? AND c.status IN ('batched','exported','submitted','accepted','paid','partial','denied')`,policy.client_id,group,String(year),visit.id)
  const local=previous.reduce((sum,c)=>sum+(c.paid_cents!==null?c.paid_cents+c.pr_cents:(JSON.parse(c.snapshot).estimatedAllowedCents??0)),0)
  const estimatedAllowed=lines.reduce((sum,l)=>sum+(fees.find(f=>f.code===l.code)?.cents??0)*l.units,0)
  const threshold=config?.threshold_cents??(year===2026?248000:null),used=(config?.external_used_cents??0)+local
  const required=!!policy.medicare && threshold!==null && used+estimatedAllowed>threshold
  if(required) for(const l of lines)if(!l.modifiers.includes('KX'))l.modifiers.push('KX')
  const auth=auths.filter(a=>a.policy_id===policy.id&&a.starts_on<=serviceDate&&a.ends_on>=serviceDate&&(!a.practitioner_id||a.practitioner_id===visit.practitioner_id)).sort((a,b)=>b.starts_on.localeCompare(a.starts_on)||b.id.localeCompare(a.id))[0]
  const rendering=nameParts(visit.practitioner_name)
  const value:ClaimSnapshot & {estimatedAllowedCents:number;policyCovers:boolean;authorizationExhausted:boolean;basis:Data}={
    patient:{first:visit.first_name,last:visit.last_name,dob:visit.date_of_birth??'',sex:policy.patient_sex},
    subscriber:{first:policy.subscriber_first,last:policy.subscriber_last,dob:policy.subscriber_dob,sex:policy.subscriber_sex,relationship:policy.relationship,memberId:policy.member_id,group:policy.group_number},
    address:{street:policy.address,city:policy.city,state:policy.state,postal:policy.postal_code},
    payer:{id:policy.payer_id,name:policy.payer_name,code:policy.payer_code,receiver:policy.receiver_id,medicare:!!policy.medicare,unitMethod:policy.unit_method},
    billing:{name:visit.clinic_name,npi:settings?.billing_npi??'',taxId:settings?.tax_id??'',address:settings?.address??'',city:settings?.city??'',state:settings?.state??'',postal:settings?.postal_code??'',sender:settings?.sender_id??'',contact:settings?.contact_name??'',phone:settings?.contact_phone??'',production:!!settings?.production},
    rendering:{...rendering,npi:visit.npi,taxonomy:enrollment?.taxonomy??'',enrolled:!!enrollment?.active},
    referring:input.referringNpi||input.referringLast?{first:String(input.referringFirst??''),last:String(input.referringLast??''),npi:String(input.referringNpi??'')}:null,
    authorization:auth?.number??null,serviceDate,diagnoses:diag,lines,signedNotes:signed.map(n=>({id:n.id,digest:n.signed_sha256,revision:n.signed_revision})),
    invoiceId:invoice.id,invoiceCents:invoice.amount_cents,attended:visit.status==='attended',requiresReferral:!!policy.requires_referral,
    kx:{required,thresholdCents:threshold,usedCents:used,projectedCents:used+estimatedAllowed,group,year},medicalNecessity:'',frequency:'1',originalControl:'',estimatedAllowedCents:estimatedAllowed,
    basis:{policyVersion:policy.version,payerVersion:policy.payer_version,appointmentVersion:visit.version,staffVersion:visit.staff_version,clientVersion:visit.client_version,billingVersion:settings?.version??null,medicareVersion:config?.version??null,priorClaimsVersion:previous.reduce((sum,c)=>sum+c.version,0),codes:JSON.stringify(codes.map(c=>[c.kind,c.position,c.code,c.modifiers,c.units])),signed:JSON.stringify(signed.map(n=>[n.id,n.signed_sha256]))},
    policyCovers:policy.starts_on<=serviceDate&&(!policy.ends_on||policy.ends_on>=serviceDate),authorizationExhausted:!!auth&&auth.used_visits>auth.visits
  }
  return value
}
