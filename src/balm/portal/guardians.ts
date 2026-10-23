import type {Bindings} from '../../auth.server'
import {audit,commit,email,guard,human,id,insist,now,one,rows,sha256,stmt,text,type Actor,type Data} from '../domain/model'
import {send} from '../mail-out'
import {takeEmailRate} from '../public-rates'
import {portalCookie,portalToken,portalNotice,type Patient} from './auth'

// Conservatively stop delegation at 18; the owner reviews legal authority and
// confidential-care restrictions for each child before granting any access.
const minor="c.date_of_birth IS NOT NULL AND date(c.date_of_birth,'+18 years')>date('now')"
const live=`g.revoked_at IS NULL AND c.erased_at IS NULL AND ${minor}`
export const guardianActor=(patient:Patient)=>patient.guardianEmail?{email:'guardian-portal:'+(patient.guardianGrantId??patient.sessionId),role:'guardian'}:{email:'patient-portal',role:'patient'}
export async function guardianGrants(db:D1Database,who:Actor,clientId:string){
 if(who.role!=='owner')return null
 const list=await rows(db,'SELECT id,email,name,relationship,granted_at,revoked_at FROM bm_guardian_grants WHERE client_id=? ORDER BY granted_at DESC,id',clientId)
 await commit(db,who,[audit(db,who,'guardian.grants_read',clientId)])
 return list
}
export async function guardianCommand(db:D1Database,who:Actor,name:string,input:Data){
 human(who);insist(who.role==='owner','only_the_owner_verifies_guardians',403)
 if(name==='guardian.revoke'){
  const key=text(input.id,'guardian_grant',100),grant=await one(db,'SELECT client_id FROM bm_guardian_grants WHERE id=?',key)
  insist(grant,'guardian_grant_not_found',404)
  await commit(db,who,[stmt(db,'UPDATE bm_guardian_grants SET revoked_at=? WHERE id=? AND revoked_at IS NULL',now(),key),audit(db,who,'guardian.revoked',grant.client_id,key)])
  return {revoked:true}
 }
 insist(name==='guardian.grant','unknown_command',404)
 insist(input.verified===true||input.verified==='on','confirm_guardian_authority_and_minor_confidentiality_review')
 const clientId=text(input.clientId,'client',100),address=email(input.email),key=id(),at=now()
 const client=await one(db,`SELECT c.id FROM bm_clients c WHERE c.id=? AND c.erased_at IS NULL AND ${minor}`,clientId)
 insist(client,'guardian_access_requires_a_minor_patient',409)
 // A shared patient address never becomes a delegated sign-in automatically.
 insist(!await one(db,'SELECT id FROM bm_clients WHERE lower(email)=? AND erased_at IS NULL',address),'guardian_email_must_be_separate_from_patient_sign_in',409)
 const relationship=text(input.relationship,'guardian_relationship',20)
 insist(['parent','guardian'].includes(relationship),'choose_parent_or_guardian')
 await commit(db,who,[guard(db,`EXISTS(SELECT 1 FROM bm_clients c WHERE c.id=? AND c.erased_at IS NULL AND ${minor})`,clientId),
  guard(db,'NOT EXISTS(SELECT 1 FROM bm_clients WHERE lower(email)=? AND erased_at IS NULL)',address),
  stmt(db,'INSERT INTO bm_guardian_grants(id,client_id,email,name,relationship,verification,granted_by,granted_at) VALUES(?,?,?,?,?,?,?,?)',key,clientId,address,text(input.name,'guardian_name',160),relationship,text(input.verification,'authority_verification',1000),who.email,at),audit(db,who,'guardian.granted',clientId,key)])
 return {id:key}
}
export async function requestGuardianLink(env:Bindings,request:Request,address:string):Promise<boolean>{
 const granted=await one(env.DB,`SELECT g.id FROM bm_guardian_grants g JOIN bm_clients c ON c.id=g.client_id WHERE g.email=? AND ${live} LIMIT 1`,address)
 if(!granted)return false
 if(await one(env.DB,'SELECT id FROM bm_clients WHERE lower(email)=? AND erased_at IS NULL',address))return true
 const value=portalToken(),key=id(),at=now()
 await commit(env.DB,null,[stmt(env.DB,'UPDATE bm_guardian_links SET revoked_at=? WHERE email=? AND used_at IS NULL AND revoked_at IS NULL',at,address),
  stmt(env.DB,'INSERT INTO bm_guardian_links(id,token_hash,email,created_at,expires_at) VALUES(?,?,?,?,?)',key,await sha256(value),address,at,new Date(Date.now()+15*60000).toISOString())])
 const result=await send(env,address,'Your private patient portal sign-in link',`Open your private patient portal sign-in link:\n${new URL('/portal/confirm?token='+value,env.AUTH_ORIGIN).href}\n\nThis link expires in 15 minutes and can be used once. If you did not request it, ignore this email.`)
 if(result!=='sent')await stmt(env.DB,'UPDATE bm_guardian_links SET revoked_at=? WHERE id=?',now(),key).run()
 return true
}
export async function consumeGuardianLink(env:Bindings,request:Request,token:string){
 const link=await one(env.DB,'SELECT * FROM bm_guardian_links WHERE token_hash=? AND used_at IS NULL AND revoked_at IS NULL AND expires_at>?',await sha256(token),now())
 if(!link)return null
 insist(await takeEmailRate(env,'portal',link.email,'confirm'),portalNotice,429)
 const first=await one(env.DB,`SELECT c.id,c.version,g.id AS grantId FROM bm_guardian_grants g JOIN bm_clients c ON c.id=g.client_id WHERE g.email=? AND ${live} ORDER BY c.id LIMIT 1`,link.email)
 insist(first,'portal_link_not_available',410)
 const value=portalToken(),key=id(),at=now()
 await commit(env.DB,null,[guard(env.DB,`EXISTS(SELECT 1 FROM bm_guardian_grants g JOIN bm_clients c ON c.id=g.client_id WHERE g.email=? AND c.id=? AND c.version=? AND ${live}) AND NOT EXISTS(SELECT 1 FROM bm_clients WHERE lower(email)=? AND erased_at IS NULL)`,link.email,first.id,first.version,link.email),
  stmt(env.DB,'UPDATE bm_guardian_links SET used_at=? WHERE id=? AND used_at IS NULL AND revoked_at IS NULL AND expires_at>?',at,link.id,at),guard(env.DB,'changes()=1'),
  stmt(env.DB,'INSERT INTO bm_guardian_sessions(id,token_hash,email,client_id,client_version,created_at,expires_at) VALUES(?,?,?,?,?,?,?)',key,await sha256(value),link.email,first.id,first.version,at,new Date(Date.now()+8*3600000).toISOString()),audit(env.DB,{email:'guardian-portal:'+first.grantId,role:'guardian'},'portal.signed_in',first.id,key)])
 return {cookie:portalCookie(request,value,8*3600)}
}
export async function guardianPatient(db:D1Database,token:string):Promise<Patient>{
 const row=await one(db,`SELECT s.id AS sessionId,s.client_id AS clientId,c.version AS clientVersion,s.email AS guardianEmail,g.id AS guardianGrantId,c.email,c.first_name AS firstName,c.last_name AS lastName,s.expires_at AS expiresAt
 FROM bm_guardian_sessions s JOIN bm_clients c ON c.id=s.client_id JOIN bm_guardian_grants g ON g.client_id=c.id AND g.email=s.email
 WHERE s.token_hash=? AND s.revoked_at IS NULL AND s.expires_at>? AND s.client_version=c.version AND ${live}
 AND NOT EXISTS(SELECT 1 FROM bm_clients x WHERE lower(x.email)=s.email AND x.erased_at IS NULL)`,await sha256(token),now())
 insist(row,'patient_sign_in_required',401)
 return row as Patient
}
export const guardianGuard=(db:D1Database,patient:Patient)=>guard(db,`EXISTS(SELECT 1 FROM bm_guardian_sessions s JOIN bm_clients c ON c.id=s.client_id JOIN bm_guardian_grants g ON g.client_id=c.id AND g.email=s.email
 WHERE s.id=? AND s.client_id=? AND s.client_version=? AND s.revoked_at IS NULL AND s.expires_at>? AND c.version=s.client_version AND ${live}
 AND NOT EXISTS(SELECT 1 FROM bm_clients x WHERE lower(x.email)=s.email AND x.erased_at IS NULL))`,patient.sessionId,patient.clientId,patient.clientVersion,now())
export async function guardianChildren(db:D1Database,patient:Patient){
 if(!patient.guardianEmail)return []
 const list=await rows(db,`SELECT c.id,c.first_name,c.last_name,g.id AS grantId FROM bm_guardian_grants g JOIN bm_clients c ON c.id=g.client_id WHERE g.email=? AND ${live} ORDER BY c.first_name,c.id`,patient.guardianEmail)
 await commit(db,null,[guardianGuard(db,patient),...list.map(c=>guard(db,`EXISTS(SELECT 1 FROM bm_guardian_grants g JOIN bm_clients c ON c.id=g.client_id WHERE g.id=? AND g.email=? AND ${live})`,c.grantId,patient.guardianEmail)),...list.map(c=>audit(db,guardianActor(patient),'guardian.children_read',c.id))])
 return list
}
export async function selectGuardianChild(db:D1Database,patient:Patient,input:Data){
 insist(patient.guardianEmail,'guardian_session_required',403)
 const clientId=text(input.id,'child',100),client=await one(db,`SELECT c.id,c.version,g.id AS grantId FROM bm_guardian_grants g JOIN bm_clients c ON c.id=g.client_id WHERE g.email=? AND c.id=? AND ${live}`,patient.guardianEmail,clientId)
 insist(client,'patient_not_in_your_guardian_portal',404)
 await commit(db,null,[guardianGuard(db,patient),guard(db,`EXISTS(SELECT 1 FROM bm_guardian_grants g JOIN bm_clients c ON c.id=g.client_id WHERE g.email=? AND c.id=? AND c.version=? AND ${live})`,patient.guardianEmail,clientId,client.version),
  stmt(db,'UPDATE bm_guardian_sessions SET client_id=?,client_version=? WHERE id=?',clientId,client.version,patient.sessionId),audit(db,guardianActor({...patient,guardianGrantId:client.grantId}),'guardian.child_selected',clientId)])
 return {redirect:'/portal/home'}
}
