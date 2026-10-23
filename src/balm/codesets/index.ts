import { actor, human, insist, type Actor, type Data } from '../domain/model'
import { codeSetStatus, searchCodes, saveSynonym } from './catalog'
import { importLicensedCpt, updateCodes } from './load'
export { codeSetStatus, releaseAt, billableDiagnosis, searchCodes } from './catalog'
export { validateCoding, codingGuard, distinctServices, distinctModifiers, type CodingInput, type DistinctService } from './edits'
export { templateCodeContext } from './review'
export { sourcePages } from './sources'
export async function codeSetCommand(db:D1Database,initial:Actor,name:string,input:Data) {
  human(initial);const who={...await actor(db,initial.id),sessionId:initial.sessionId}
  if(name==='codes.update')return updateCodes(db,who,input)
  if(name==='codes.cpt.import')return importLicensedCpt(db,who,input)
  if(name==='codes.search')return searchCodes(db,who,input)
  if(name==='codes.synonym.save')return saveSynonym(db,who,input)
  if(name==='codes.status'){insist(who.role==='owner','role_cannot_do_this',403);return codeSetStatus(db)}
  insist(false,'unknown_code_set_command',404)
}
