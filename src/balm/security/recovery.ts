import {sha256,stmt,rows} from '../domain/model'
import {base32} from './authenticator'
import {h} from '../ui/shared'

export const recoveryDigest=(salt:string,code:string)=>sha256('balm-recovery:'+salt+':'+code)

/** Return plaintext once to this request; persist only salted digests. */
export async function recoverySet(db:D1Database,operatorId:string){
 const salt=base32(crypto.getRandomValues(new Uint8Array(16)))
 const recoveryCodes=Array.from({length:10},()=>base32(crypto.getRandomValues(new Uint8Array(16))))
 const statements=await Promise.all(recoveryCodes.map(async code=>stmt(db,'INSERT INTO bm_staff_recovery(operator_id,code_hash) VALUES(?,?)',operatorId,await recoveryDigest(salt,code))))
 return {salt,recoveryCodes,statements}
}

/** Keep every recovery use visible on the signed-in security screen, including
 * the next email/OIDC sign-in, without sending a message or exposing credentials. */
export async function recoveryNotices(db:D1Database,operatorId:string){
 const events=await rows(db,"SELECT at FROM bm_audit WHERE action='session.recovery_used' AND subject_id=? ORDER BY at DESC,sequence DESC",operatorId)
 if(!events.length)return ''
 return '<section role="status" aria-label="Recovery code use"><h2>Recovery code used</h2>'+events.map(event=>'<p>A one-use recovery code was used on '+h(new Intl.DateTimeFormat('en-US',{timeZone:'UTC',dateStyle:'medium',timeStyle:'short'}).format(new Date(event.at)))+' UTC. If this was not you, secure your email and authenticator and ask the owner to sign out unfamiliar devices.</p>').join('')+'</section>'
}
