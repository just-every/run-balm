import { type Data } from '../domain/model'
import { validateCoding, type CodingInput } from './edits'
/** Add this immutable context to AGENT-003's clinician-only review facts and
 * digest. Findings remain clinical questions; this never changes a claim. */
export async function templateCodeContext(db:D1Database,input:CodingInput) {
  const result=await validateCoding(db,input)
  return {rules:result.releases.map((r:Data)=>({id:`codes.${r.kind}.${r.id}`,title:`${r.kind} ${r.version}`,source:r.source_page,rule:`Effective ${r.effective_on}; next scheduled ${r.next_due_on}; SHA-256 ${r.sha256}.`})),issues:result.issues,proposals:result.proposals,epoch:result.epoch}
}
