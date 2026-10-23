import {audit,commit,insist,one,stmt,type Data} from '../domain/model'
import {guardianActor} from './guardians'
import {portalGuard,type Patient} from './auth'

export async function patientLanguage(db:D1Database,patient:Patient){return (await one(db,'SELECT portal_language FROM bm_clients WHERE id=?',patient.clientId))?.portal_language==='es'?'es':'en'}
export async function chooseLanguage(db:D1Database,patient:Patient,input:Data){
 insist(input.language==='en'||input.language==='es','choose_English_or_Spanish')
 await commit(db,null,[portalGuard(db,patient),stmt(db,'UPDATE bm_clients SET portal_language=? WHERE id=?',input.language,patient.clientId),audit(db,guardianActor(patient),'portal.language_chosen',patient.clientId,null,input.language)])
 return {redirect:'/portal/home'}
}
