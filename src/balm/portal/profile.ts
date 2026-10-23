import {audit,commit,email,guard,human,id,insist,now,one,rows,sha256,stmt,type Actor,type Data} from '../domain/model'
import {policyRecord,policyStatement} from '../insurance/policy'
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
 await commit(db,null,[portalGuard(db,patient),stmt(db,'INSERT INTO bm_portal_profile_changes(id,client_id,kind,payload,submitted_at,submitted_by,base_version) VALUES(?,?,?,?,?,?,?)',key,patient.clientId,kind,JSON.stringify(payload),now(),patient.guardianEmail?'guardian:'+patient.sessionId:'patient:'+patient.sessionId,patient.clientVersion),audit(db,guardianActor(patient),'portal.'+kind+'_update_submitted',patient.clientId,key)])
 return {id:key}
}
export async function profileForStaff(db:D1Database,who:Actor,clientId:string){
 if(who.role!=='owner'&&who.staffRole!=='reception')return null
 const list=await rows(db,'SELECT id,kind,payload,submitted_at,reviewed_at FROM bm_portal_profile_changes WHERE client_id=? ORDER BY submitted_at DESC,id',clientId)
 await commit(db,who,[audit(db,who,'portal.profile_updates_read',clientId)])
 return Promise.all(list.map(async r=>({...r,sha256:await sha256(r.payload),payload:JSON.parse(r.payload)})))
}


export async function reviewProfile(db:D1Database,who:Actor,input:Data){
 human(who);insist(who.role==='owner','only_the_owner_applies_patient_updates',403)
 insist(input.verified===true||input.verified==='on','confirm_identity_and_updated_details_were_verified')
 const change=await one(db,'SELECT * FROM bm_portal_profile_changes WHERE id=? AND reviewed_at IS NULL',String(input.id??''))
 insist(change,'profile_update_not_found',404)
 insist(input.sha256===await sha256(change.payload),'profile_update_changed_refresh_and_review',409)
 const client=await one(db,'SELECT * FROM bm_clients WHERE id=? AND erased_at IS NULL',change.client_id)
 insist(client,'client_not_found',404)
 insist(client.version===change.base_version,'patient_changed_request_a_fresh_update',409)
 const payload=JSON.parse(change.payload),statements:D1PreparedStatement[]=[]
 if(change.kind==='contact'){
  const address=payload.email?email(payload.email):null,phone=phoneNumber(payload.phone)
  insist(!address||!await one(db,'SELECT id FROM bm_clients WHERE lower(email)=? AND id<>? AND erased_at IS NULL UNION ALL SELECT id FROM bm_guardian_grants WHERE email=? AND revoked_at IS NULL',address,client.id,address),'contact_address_is_already_used',409)
  statements.push(guard(db,'NOT EXISTS(SELECT 1 FROM bm_clients WHERE lower(email)=? AND id<>? AND erased_at IS NULL) AND NOT EXISTS(SELECT 1 FROM bm_guardian_grants WHERE email=? AND revoked_at IS NULL)',address??'',client.id,address??''),stmt(db,'UPDATE bm_clients SET email=?,phone=?,version=version+1 WHERE id=?',address,phone,client.id))
 }else{
  const policyId=input.policyId?String(input.policyId):id()
  const previous=input.policyId?await one(db,'SELECT * FROM bm_policies WHERE id=? AND client_id=?',policyId,client.id):null
  insist(!input.policyId||previous,'policy_not_found',404)
  const record=policyRecord(client,{...input,memberId:payload.memberId,groupNumber:payload.group},policyId)
  statements.push(guard(db,'EXISTS(SELECT 1 FROM bm_payers WHERE id=?)',record.payer_id))
  if(previous)statements.push(guard(db,'EXISTS(SELECT 1 FROM bm_policies WHERE id=? AND version=?)',policyId,previous.version))
  statements.push(policyStatement(db,record),audit(db,who,'insurance.policy_saved',client.id,policyId))
 }
 await commit(db,who,[guard(db,'EXISTS(SELECT 1 FROM bm_clients WHERE id=? AND version=? AND erased_at IS NULL)',client.id,change.base_version),guard(db,'EXISTS(SELECT 1 FROM bm_portal_profile_changes WHERE id=? AND reviewed_at IS NULL AND payload=?)',change.id,change.payload),
  ...statements,stmt(db,'UPDATE bm_portal_profile_changes SET reviewed_at=?,reviewed_by=? WHERE id=? AND reviewed_at IS NULL',now(),who.email,change.id),guard(db,'changes()=1'),audit(db,who,'portal.'+change.kind+'_update_applied',client.id,change.id)])
 return {id:change.id,applied:true}
}
