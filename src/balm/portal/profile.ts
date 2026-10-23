import {audit,commit,email,id,insist,now,one,rows,stmt,type Actor,type Data} from '../domain/model'
import {phoneNumber} from '../domain/us-clinic'
import {insuranceFields} from '../intake/records'
import {guardianActor} from './guardians'
import {portalGuard,type Patient} from './auth'

export const patientProfile=async(db:D1Database,patient:Patient)=>({
 contact:await one(db,'SELECT email,phone FROM bm_clients WHERE id=? AND erased_at IS NULL',patient.clientId),
 changes:(await rows(db,'SELECT id,kind,payload,submitted_at,reviewed_at FROM bm_portal_profile_changes WHERE client_id=? ORDER BY submitted_at DESC,id',patient.clientId)).map(r=>({...r,payload:JSON.parse(r.payload)})),
})
export async function submitProfile(db:D1Database,patient:Patient,name:string,input:Data){
 insist(input.confirm===true||input.confirm==='on','confirm_these_details_are_correct')
 const kind=name==='profile.contact'?'contact':'insurance'
 insist(['profile.contact','profile.insurance'].includes(name),'unknown_command',404)
 const payload=kind==='contact'?{email:input.email?email(input.email):null,phone:phoneNumber(input.phone)}:insuranceFields(input)
 insist(kind!=='contact'||('email' in payload&&payload.email)||('phone' in payload&&payload.phone),'enter_contact_details')
 const key=id()
 await commit(db,null,[portalGuard(db,patient),stmt(db,'INSERT INTO bm_portal_profile_changes(id,client_id,kind,payload,submitted_at,submitted_by) VALUES(?,?,?,?,?,?)',key,patient.clientId,kind,JSON.stringify(payload),now(),patient.guardianEmail?'guardian:'+patient.sessionId:'patient:'+patient.sessionId),audit(db,guardianActor(patient),'portal.'+kind+'_update_submitted',patient.clientId,key)])
 return {id:key}
}
export async function profileForStaff(db:D1Database,who:Actor,clientId:string){
 if(who.role!=='owner'&&who.staffRole!=='reception')return null
 const list=await rows(db,'SELECT id,kind,payload,submitted_at,reviewed_at FROM bm_portal_profile_changes WHERE client_id=? ORDER BY submitted_at DESC,id',clientId)
 await commit(db,who,[audit(db,who,'portal.profile_updates_read',clientId)])
 return list.map(r=>({...r,payload:JSON.parse(r.payload)}))
}
