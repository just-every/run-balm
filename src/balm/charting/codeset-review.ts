import { rows, type Data } from '../domain/model'
import { templateCodeContext } from '../codesets/review'
import { parseIcd10 } from '../payments/codes'
/** Clinician-only grounding for AGENT-003. No generated rationale or modifier
 * is accepted as an attestation; only the clinician's revision is supplied. */
export async function noteCodeContext(db:D1Database,note:Data,date:string,billed:Data[]) {
 const sections=JSON.parse(note.sections??'[]')??[]
 const diagnosisText=sections.filter((s:Data)=>s.id==='diagnosis').map((s:Data)=>s.text).join('\n')
 const matches=diagnosisText.match(/\b[A-TV-Z][0-9][0-9A-Z](?:\.[0-9A-Z]{1,4})?\b/g)??[]
 const visitCodes=await rows(db,"SELECT code FROM bm_visit_codes WHERE appointment_id=? AND kind='icd10' ORDER BY position",note.appointment_id)
 const diagnoses=[...new Set([...matches,...visitCodes.map(c=>String(c.code))])]
 if(!billed.length||!diagnoses.length)return {rules:[],issues:[{code:'code_review_incomplete',message:'Record procedure charges and specific ICD-10 diagnoses before code-edit review.'}],proposals:[]}
 const input={date,diagnoses:parseIcd10(diagnoses.join('\n')),lines:billed.filter(l=>l.units>0).map(l=>({code:l.code,units:l.units,modifiers:l.modifiers??[]})),attestations:JSON.parse(note.clinical??'{}').distinctServices??[]}
 if(!input.lines.length)return {rules:[],issues:[{code:'code_review_incomplete',message:'No billable units are supported by the recorded minutes.'}],proposals:[]}
 return {...await templateCodeContext(db,input),diagnoses:input.diagnoses,lines:input.lines,date}
}
