import type {Bindings} from '../../auth.server'
import {audit,commit,guard,id,insist,now,one,rows,sha256,stmt} from '../domain/model'
import {smsBlock,smsSender,usMobile} from '../sms'
import {takeEmailRate} from '../public-rates'
import {patientActor,portalCookie,portalToken} from './auth'

export const smsNotice='If one patient file matches that mobile number and texting is configured, a sign-in code will arrive. It expires in five minutes.'
const hash=(env:Bindings,key:string,code:string)=>sha256(env.SESSION_SECRET+':portal-sms:'+key+':'+code)
export async function requestSmsCode(env:Bindings,request:Request,phoneInput:unknown){
 const key=id(),notice={sms:{id:key},notice:smsNotice}
 const phone=usMobile(phoneInput)
 if(!phone||!await takeEmailRate(env,'portal','sms:'+phone,'signin')||smsBlock(env))return notice
 const patients=await rows(env.DB,'SELECT id,version FROM bm_clients WHERE phone=? AND erased_at IS NULL LIMIT 2',phone)
 if(patients.length!==1)return notice
 const patient=patients[0],code=String(crypto.getRandomValues(new Uint32Array(1))[0]%1000000).padStart(6,'0'),at=now()
 await commit(env.DB,null,[guard(env.DB,'EXISTS(SELECT 1 FROM bm_clients WHERE id=? AND version=? AND phone=? AND erased_at IS NULL) AND (SELECT COUNT(*) FROM bm_clients WHERE phone=? AND erased_at IS NULL)=1',patient.id,patient.version,phone,phone),
  stmt(env.DB,'UPDATE bm_portal_sms_codes SET revoked_at=? WHERE client_id=? AND used_at IS NULL AND revoked_at IS NULL',at,patient.id),
  stmt(env.DB,'INSERT INTO bm_portal_sms_codes(id,client_id,client_version,code_hash,created_at,expires_at) VALUES(?,?,?,?,?,?)',key,patient.id,patient.version,await hash(env,key,code),at,new Date(Date.now()+5*60000).toISOString())])
 try{await smsSender(env)!.send({to:phone,body:`Your private portal sign-in code is ${code}. It expires in five minutes. Do not share this code. If you did not request it, ignore this text.`})}
 catch{await stmt(env.DB,'UPDATE bm_portal_sms_codes SET revoked_at=? WHERE id=?',now(),key).run()}
 return notice
}
export async function consumeSmsCode(env:Bindings,request:Request,input:Record<string,unknown>){
 insist(!smsBlock(env),'sms_sign_in_unavailable',409)
 const key=String(input.id??''),code=String(input.code??'')
 insist(/^[\w-]{36}$/.test(key)&&/^\d{6}$/.test(code),'code_not_available',410)
 const candidate=await one(env.DB,`SELECT s.*,c.email,c.phone FROM bm_portal_sms_codes s JOIN bm_clients c ON c.id=s.client_id WHERE s.id=? AND s.used_at IS NULL AND s.revoked_at IS NULL AND s.expires_at>? AND s.attempts<5
 AND c.erased_at IS NULL AND c.version=s.client_version AND c.phone IS NOT NULL AND (SELECT COUNT(*) FROM bm_clients x WHERE x.phone=c.phone AND x.erased_at IS NULL)=1`,key,now())
 insist(candidate,'code_not_available',410)
 insist(await takeEmailRate(env,'portal','sms:'+candidate.phone,'confirm'),'code_not_available',429)
 const matches=await hash(env,key,code)===candidate.code_hash
 if(!matches){await stmt(env.DB,'UPDATE bm_portal_sms_codes SET attempts=attempts+1 WHERE id=? AND used_at IS NULL AND revoked_at IS NULL AND attempts<5',key).run();insist(false,'code_not_available',410)}
 const value=portalToken(),sid=id(),at=now()
 await commit(env.DB,null,[guard(env.DB,'EXISTS(SELECT 1 FROM bm_clients WHERE id=? AND version=? AND phone=? AND erased_at IS NULL) AND (SELECT COUNT(*) FROM bm_clients WHERE phone=? AND erased_at IS NULL)=1',candidate.client_id,candidate.client_version,candidate.phone,candidate.phone),
  stmt(env.DB,'UPDATE bm_portal_sms_codes SET used_at=? WHERE id=? AND attempts<5 AND used_at IS NULL AND revoked_at IS NULL AND expires_at>?',at,key,at),guard(env.DB,'changes()=1'),
  stmt(env.DB,'INSERT INTO bm_portal_sessions(id,token_hash,client_id,client_version,email,created_at,expires_at,method,phone) VALUES(?,?,?,?,?,?,?,?,?)',sid,await sha256(value),candidate.client_id,candidate.client_version,candidate.email??'',at,new Date(Date.now()+8*3600000).toISOString(),'sms',candidate.phone),audit(env.DB,patientActor,'portal.sms_signed_in',candidate.client_id,sid)])
 return {cookie:portalCookie(request,value,8*3600)}
}
