import { audit, commit, day, guard, id, insist, integer, now, one, stmt, text, type Actor, type Data } from '../domain/model'
import { parseDollars } from '../payments/ledger'
import { claimFor, clientGuard, yes } from './access'
import { scrubClaim } from './scrub'
import type { ClaimSnapshot, ClaimLine } from './types'

export type MedicareService = { coverage:'covered'|'medical_necessity_denial'|'statutory_exclusion'; abnId?:string; abnOption?:number; assistantUnits:number; assistantBasis:string }
export function combineMedicareLines(lines:ClaimLine[]) {
  const combined=new Map<string,ClaimLine>()
  for(const l of lines){const old=combined.get(l.code);if(old){old.units+=l.units;old.amountCents+=l.amountCents;old.allowedCents=(old.allowedCents??0)+(l.allowedCents??0)}else combined.set(l.code,{...l,modifiers:[...l.modifiers]})}
  return [...combined.values()]
}
const managed=new Set(['KX','GA','GZ','GY','GX','CQ','CO'])
/** The clinician identifies affected units after reviewing CMS's de minimis and
 * final-unit exceptions. Splitting preserves charge totals, including odd cents. */
export function applyMedicareServices(s:ClaimSnapshot,services:Record<string,MedicareService>={},medicalNecessity=s.medicalNecessity) {
  if(!s.payer.medicare)return s
  s.medicalNecessity=medicalNecessity;s.medicareServices=services
  const allowed=s.lines.reduce((t,l)=>t+((services[l.code]?.coverage??'covered')==='covered'?(l.allowedCents??0):0),0)
  ;(s as any).estimatedAllowedCents=allowed
  s.kx.projectedCents=s.kx.usedCents+allowed
  s.kx.required=s.kx.thresholdCents!==null&&s.kx.projectedCents>s.kx.thresholdCents
  s.kx.targetedReview=s.kx.reviewCents!=null&&s.kx.projectedCents>s.kx.reviewCents
  s.lines=s.lines.flatMap(line=>{
    const rule=services[line.code],coverage=rule?.coverage??'covered',modifiers=line.modifiers.filter(m=>!managed.has(m))
    if(coverage==='medical_necessity_denial')modifiers.push(rule?.abnId&&rule.abnOption===1?'GA':'GZ')
    if(coverage==='statutory_exclusion'){modifiers.push('GY');if(rule?.abnId)modifiers.push('GX')}
    if(coverage==='covered'&&s.kx.required&&medicalNecessity.trim())modifiers.push('KX')
    const units=rule?.assistantUnits??0,assistant=modifiers.includes('GO')?'CO':'CQ'
    if(!units)return [{...line,modifiers}]
    if(units>=line.units)return [{...line,modifiers:[...modifiers,assistant]}]
    const assistantCents=Math.round(line.amountCents*units/line.units),assistantAllowed=Math.round((line.allowedCents??0)*units/line.units)
    return [{...line,units:line.units-units,modifiers,amountCents:line.amountCents-assistantCents,allowedCents:(line.allowedCents??0)-assistantAllowed},{...line,units,modifiers:[...modifiers,assistant],amountCents:assistantCents,allowedCents:assistantAllowed}]
  })
  return s
}
export async function saveMedicareService(db:D1Database,who:Actor,input:Data) {
  const claim=await claimFor(db,who,input.id),visit=await one(db,'SELECT * FROM bm_appointments WHERE id=?',claim.appointment_id)
  insist(who.role==='owner'||who.staffRole==='practitioner'&&who.staffId===visit?.practitioner_id,'only_the_treating_clinician_can_attest',403)
  insist(['draft','ready'].includes(claim.status),'correct_the_claim_before_changing_medicare_services',409)
  const s=JSON.parse(claim.snapshot) as ClaimSnapshot;insist(s.payer.medicare,'claim_is_not_medicare')
  const code=text(input.code,'procedure',5),lines=s.lines.filter(l=>l.code===code);insist(lines.length,'claim_procedure_not_found')
  const units=lines.reduce((t,l)=>t+l.units,0),assistantUnits=integer(input.assistantUnits??0,'assistant_units',0,units)
  insist(!assistantUnits||!lines.some(l=>l.modifiers.includes('GN')),'speech_services_do_not_use_cq_co')
  const coverage=input.coverage??'covered';insist(['covered','medical_necessity_denial','statutory_exclusion'].includes(coverage),'invalid_coverage_determination')
  const service:MedicareService={coverage,assistantUnits,assistantBasis:assistantUnits?text(input.assistantBasis,'assistant_basis',2000):''}
  let abnStatement:D1PreparedStatement|null=null
  if(coverage!=='covered'&&input.noticeAction==='retain'){
    const previous=s.medicareServices?.[code];insist(previous?.abnId&&previous.coverage===coverage,'capture_an_abn_for_this_coverage_determination')
    service.abnId=previous.abnId;service.abnOption=previous.abnOption
  }
  if(coverage!=='covered'&&(yes(input.hasAbn)||input.noticeAction==='upload')) {
    const issued=day(input.issuedOn,'abn_issued_on'),signed=day(input.signedOn,'abn_signed_on'),option=integer(input.option,'abn_option',1,3)
    insist(issued<=signed&&signed<=s.serviceDate,'abn_must_be_signed_before_service')
    const document=text(input.abnDocument,'signed_cms_r_131',1_400_000),match=/^data:(application\/pdf|image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/]+={0,2})$/.exec(document)
    insist(match,'upload_the_signed_cms_r_131')
    let bytes:string;try{bytes=atob(match[2])}catch{insist(false,'invalid_signed_cms_r_131')}
    insist(bytes.length>0&&bytes.length<=1_000_000,'abn_document_too_large')
    insist(match[1]==='application/pdf'?bytes.startsWith('%PDF-'):match[1]==='image/png'?bytes.startsWith('\x89PNG\r\n\x1a\n'):match[1]==='image/jpeg'?bytes.startsWith('\xff\xd8\xff'):bytes.startsWith('RIFF')&&bytes.slice(8,12)==='WEBP','invalid_abn_document_format')
    const abnId=id(),record={form:'CMS-R-131',code,coverage,issuedOn:issued,signedOn:signed,option,beneficiary:text(input.beneficiary,'beneficiary_signature',200),notifier:text(input.notifier,'notifier',200),services:text(input.services,'abn_services',2000),reason:text(input.reason,'abn_reason',2000),estimatedCents:integer(input.estimatedCents??parseDollars(input.estimated,'abn_estimate'),'abn_estimate_cents',1)}
    service.abnId=abnId;service.abnOption=option
    abnStatement=stmt(db,'INSERT INTO bm_medicare_abns(id,claim_id,record,document,mime,created_by,created_at) VALUES(?,?,?,?,?,?,?)',abnId,claim.id,JSON.stringify(record),document,match[1],who.email,now())
  }
  const services={...s.medicareServices,[code]:service}
  // Recombine earlier assistant splits before applying the updated unit decision.
  s.lines=combineMedicareLines(s.lines);applyMedicareServices(s,services)
  const errors=scrubClaim(s),status=errors.length?'draft':'ready'
  await commit(db,who,[clientGuard(db,who,claim.client_id),guard(db,"EXISTS(SELECT 1 FROM bm_appointments WHERE id=? AND (?='owner' OR practitioner_id=?))",claim.appointment_id,who.role,who.staffId??''),...(abnStatement?[abnStatement]:[]),stmt(db,'UPDATE bm_claims SET snapshot=?,errors=?,status=?,version=version+1,updated_at=? WHERE id=? AND version=?',JSON.stringify(s),JSON.stringify(errors),status,now(),claim.id,claim.version),guard(db,'changes()=1'),audit(db,who,'insurance.medicare_service_attested',claim.client_id,claim.id)])
  return {id:claim.id,status,errors}
}
