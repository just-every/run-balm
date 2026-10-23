import { priorServices, priorContextGuard, type PriorContext } from './same-day'
import { guard, insist, one, rows, type Actor, type Data } from '../domain/model'
import { billableDiagnosis, releaseAt } from './catalog'
import { normalizeCode } from './types'
export const distinctModifiers=['59','XE','XP','XS','XU'] as const
export type DistinctService = { code1:string; code2:string; modifier:typeof distinctModifiers[number]; reason:string; attested:true }
/** This value belongs in the exact clinician-authored note revision, covered by
 * its signature. Claim callers must supply attestations only from signed notes. */
export function distinctServices(who:Actor,input:unknown):DistinctService[] {
  if(input===undefined)return []
  insist(Array.isArray(input)&&input.length<=20,'invalid_distinct_service_attestations')
  if(!input.length)return []
  insist(who.role!=='agent'&&who.staffRole==='practitioner','a_clinician_must_attest_distinct_services',403)
  return input.map(a=>{
    insist(a&&a.attested===true&&typeof a.reason==='string'&&a.reason.trim().length>=8&&a.reason.length<=2000,'record_why_these_services_were_clinically_distinct')
    const code1=normalizeCode(a.code1),code2=normalizeCode(a.code2)
    insist(/^[A-Z0-9]{5}$/.test(code1)&&/^[A-Z0-9]{5}$/.test(code2)&&code1!==code2,'select_two_distinct_procedure_codes')
    insist(distinctModifiers.includes(a.modifier),'choose_59_xe_xp_xs_or_xu')
    return {code1,code2,modifier:a.modifier,reason:a.reason.trim(),attested:true}
  })
}
export type CodingLine={code:string;units:number;modifiers:string[]}
export type CodingInput={date:string;diagnoses:string[];lines:CodingLine[];attestations?:DistinctService[];clientId?:string;renderingNpi?:string;invoiceId?:string;batchPeers?:{invoiceId:string;lines:CodingLine[]}[]}
export type CodingIssue={code:string;field:string;message:string;releaseId?:string;version?:string;children?:Data[];source?:string}
export async function validateCoding(db:D1Database,input:CodingInput) {
  insist(Array.isArray(input.lines)&&input.lines.length>0&&input.lines.length<=100&&input.lines.every(l=>Number.isSafeInteger(l.units)&&l.units>0&&Array.isArray(l.modifiers)),'invalid_claim_coding_lines')
  insist(Array.isArray(input.diagnoses)&&input.diagnoses.length>0&&input.diagnoses.length<=12,'record_claim_diagnoses')
  const issues:CodingIssue[]=[],proposals:{code:string;modifier:string;reason:string;version:string}[]=[],releases:Data[]=[]
  const epoch=(await one(db,'SELECT version FROM bm_code_epoch WHERE id=1'))!.version as number
  for(const diagnosis of input.diagnoses){const result=await billableDiagnosis(db,diagnosis,input.date);if(result.release&&!releases.some(r=>r.id===result.release!.id))releases.push(result.release);if(!result.valid)issues.push({code:'diagnosis_not_billable',field:'diagnoses',message:result.reason!,children:result.children,releaseId:result.release?.id,version:result.release?.version,source:result.release?.source_page})}
  const [ptp,mue,cpt,hcpcs]=await Promise.all(['ptp','mue','cpt','hcpcs'].map(kind=>releaseAt(db,kind as 'ptp'|'mue'|'cpt'|'hcpcs',input.date)))
  const lines=input.lines.map(l=>({...l,code:normalizeCode(l.code)})),codes=[...new Set(lines.map(l=>l.code))]
  for(const [kind,release] of [['ptp',ptp],['mue',mue],['cpt',cpt],['hcpcs',hcpcs]] as const){if(release)releases.push(release);else if(kind!=='hcpcs'||codes.some(c=>/^[A-Z]\d{4}$/.test(c)))issues.push({code:'code_set_missing',field:'lines',message:`Load ${kind} for ${input.date} before submitting this claim.`})}
  for(const code of codes){
    const release=/^[A-Z]\d{4}$/.test(code)?hcpcs:cpt
    if(!release)continue
    const present=await one(db,'SELECT code FROM bm_code_items WHERE release_id=? AND code=? AND effective_on<=? AND (deleted_on IS NULL OR deleted_on>?)',release.id,code,input.date,input.date)
    if(!present)issues.push({code:'procedure_not_in_release',field:'lines',message:`${code} is absent or inactive in ${release.kind} ${release.version}.`,releaseId:release.id,version:release.version,source:release.source_page})
  }
  const json=JSON.stringify(codes)
  if(ptp){
    const pairs=await rows(db,`SELECT * FROM bm_code_items WHERE release_id=? AND code IN (SELECT value FROM json_each(?)) AND code2 IN (SELECT value FROM json_each(?)) AND effective_on<=? AND (deleted_on IS NULL OR deleted_on>?) AND modifier<>9`,ptp.id,json,json,input.date,input.date)
    for(const pair of pairs){
      const attestation=input.attestations?.find(a=>a.attested===true&&a.code1===pair.code&&a.code2===pair.code2&&a.reason.trim().length>=8&&distinctModifiers.includes(a.modifier))
      const code2=lines.filter(l=>l.code===pair.code2),applied=code2.some(l=>l.modifiers.some(m=>distinctModifiers.includes(m as DistinctService['modifier'])))
      if(pair.modifier===1&&attestation){
        proposals.push({code:pair.code2,modifier:attestation.modifier,reason:attestation.reason,version:ptp.version})
        if(code2.every(l=>l.modifiers.includes(attestation.modifier)))continue
      }
      issues.push({code:pair.modifier===0?'ncci_modifier_not_permitted':applied&&!attestation?'ncci_distinct_attestation_required':'ncci_ptp',field:'lines',message:`NCCI practitioner ${ptp.version}: ${pair.code} / ${pair.code2} is edited (${pair.effective_on}${pair.deleted_on?' to '+pair.deleted_on:''}). ${pair.modifier===0?'This edit does not allow a modifier.':attestation?'Review and apply the attested modifier to the second service.':'The clinician must document distinct services in the signed note before a 59 or X modifier is proposed.'}`,releaseId:ptp.id,version:ptp.version,source:ptp.source_page})
    }
  }
  let priorContext:PriorContext|undefined
  if(mue){
    // MAI 2/3 applies to the same beneficiary, rendering practitioner and date,
    // including already sent claims. MAI 1 applies to each submitted line.
    const prior: CodingLine[]=(input.batchPeers??[]).flatMap(p=>p.lines)
    if(input.clientId&&input.renderingNpi){const existing=await priorServices(db,{clientId:input.clientId,date:input.date,renderingNpi:input.renderingNpi,excludeInvoices:[...new Set([input.invoiceId??'',...(input.batchPeers??[]).map(p=>p.invoiceId)])].sort()});prior.push(...existing.lines);priorContext=existing.context}
    const edits=await rows(db,'SELECT * FROM bm_code_items WHERE release_id=? AND code IN (SELECT value FROM json_each(?))',mue.id,json)
    for(const edit of edits){
      const own=lines.filter(l=>l.code===edit.code),total=own.reduce((t,l)=>t+l.units,0)+prior.filter(l=>normalizeCode(l.code)===edit.code).reduce((t,l)=>t+l.units,0)
      const exceeds=edit.adjudication===1?own.some(l=>l.units>edit.max_units):total>edit.max_units
      if(exceeds)issues.push({code:'ncci_mue',field:'lines',message:`NCCI practitioner MUE ${mue.version}: ${edit.code} exceeds ${edit.max_units} units (${edit.adjudication===1?'per claim line':'for this patient, practitioner and service date'}; MAI ${edit.adjudication}). ${edit.adjudication===2?'This is an absolute date-of-service edit.':'Review the clinical documentation and applicable CMS review process; a modifier does not automatically clear this finding.'}`,releaseId:mue.id,version:mue.version,source:mue.source_page})
    }
  }
  return {issues,proposals,releases,epoch,...(priorContext?{priorContext}:{})}
}
/** Include this in the same batch as claim preparation/export/submission. A new
 * release during scrubbing requires rechecking instead of sending stale facts. */
export const codingGuards=(db:D1Database,result:{epoch:number;priorContext?:PriorContext})=>[guard(db,'(SELECT version FROM bm_code_epoch WHERE id=1)=?',result.epoch),...(result.priorContext?[priorContextGuard(db,result.priorContext)]:[])]
