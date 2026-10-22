import {seal,unseal} from '../scribe/seal'
import {audit,commit,guard,insist,integer,one,rows,sha256,stmt,text,type Data} from '../domain/model'
import {actor} from '../domain/model'
import {h,field,hidden} from '../ui/shared'
// @ts-expect-error The shared auth frame has no TypeScript declarations.
import {pageResponse} from '../../modules/operator-auth/page.mjs'
import type {Bindings} from '../../auth.server'

const alphabet='ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'
const base32=(bytes:Uint8Array)=>{let n=0,bits=0,out='';for(const b of bytes){n=(n<<8)|b;bits+=8;while(bits>=5){bits-=5;out+=alphabet[(n>>>bits)&31]}}if(bits)out+=alphabet[(n<<(5-bits))&31];return out}
function decode(value:string){let n=0,bits=0,out:number[]=[];for(const c of value){const i=alphabet.indexOf(c);insist(i>=0,'invalid_authenticator_secret');n=(n<<5)|i;bits+=5;if(bits>=8){bits-=8;out.push((n>>>bits)&255)}}return new Uint8Array(out)}
async function totp(seed:string,step:number){
 const bytes=new Uint8Array(8);new DataView(bytes.buffer).setBigUint64(0,BigInt(step))
 const key=await crypto.subtle.importKey('raw',decode(seed),{name:'HMAC',hash:'SHA-1'},false,['sign'])
 const mac=new Uint8Array(await crypto.subtle.sign('HMAC',key,bytes)),offset=mac[19]&15
 return String((new DataView(mac.buffer).getUint32(offset)&0x7fffffff)%1000000).padStart(6,'0')
}
async function matchedStep(seed:string,code:string){
 if(!/^\d{6}$/.test(code))return null
 const current=Math.floor(Date.now()/30000)
 for(const step of [current,current-1,current+1])if(await totp(seed,step)===code)return step
 return null
}
const privateHeaders={'cache-control':'no-store','referrer-policy':'no-referrer','x-content-type-options':'nosniff','x-frame-options':'DENY'}
const json=(value:unknown,status=200)=>Response.json(value,{status,headers:privateHeaders})
const see=(location:string)=>new Response(null,{status:303,headers:{...privateHeaders,location}})
const isForm=(r:Request)=>(r.headers.get('content-type')??'').startsWith('application/x-www-form-urlencoded')
const purpose=(operatorId:string)=>'staff-authenticator:'+operatorId
const sid=(session:Data)=>String(session.id)
async function expireIdle(env:Bindings,session:Data){
 const proof=await one(env.DB,'SELECT * FROM bm_staff_session_proofs WHERE session_id=?',sid(session))
 const policy=(await one(env.DB,'SELECT * FROM bm_staff_security_policy WHERE id=1'))!
 if(proof&&proof.last_seen_at+policy.idle_minutes*60000<=Date.now()){
  await env.DB.batch([stmt(env.DB,'UPDATE oa_sessions SET revoked_at=? WHERE id=? AND revoked_at IS NULL',Date.now(),sid(session)),audit(env.DB,{email:session.operator.email,role:session.operator.role},'session.idle_expired',null,sid(session))])
  insist(false,'session_idle_expired',401)
 }
 return proof
}
/** Every known staff job reads PHI, including names on a location schedule. */
export async function requireSecondStep(env:Bindings,request:Request,session:Data){
 const proof=await expireIdle(env,session),policy=(await one(env.DB,'SELECT * FROM bm_staff_security_policy WHERE id=1'))!
 const staff=await one(env.DB,'SELECT 1 FROM bm_staff WHERE lower(email)=lower(?) AND active=1 AND erased_at IS NULL',session.operator.email)
 if(['owner','admin'].includes(session.operator.role)||staff||policy.require_all){
  insist(proof&&proof.operator_id===session.operator.id,'second_step_required',401)
  await env.DB.prepare('UPDATE bm_staff_session_proofs SET last_seen_at=? WHERE session_id=?').bind(Date.now(),sid(session)).run()
 }
}
async function reserveAttempt(env:Bindings,session:Data){
 const window=Math.floor(Date.now()/300000),key=session.operator.id
 const result=await env.DB.prepare(`INSERT INTO bm_staff_factor_attempts(operator_id,window,count) VALUES(?,?,1)
 ON CONFLICT(operator_id) DO UPDATE SET window=excluded.window,count=CASE WHEN window=excluded.window THEN count+1 ELSE 1 END RETURNING count`).bind(key,window).first<Data>()
 insist(result&&result.count<=5,'second_step_rate_limited',429)
}
async function proofStatements(env:Bindings,request:Request,session:Data){
 const at=Date.now(),device=(request.headers.get('user-agent')??'Unlabelled device').replace(/[\u0000-\u001f\u007f]/g,'').slice(0,160)
 return [guard(env.DB,"EXISTS(SELECT 1 FROM oa_sessions WHERE id=? AND operator_id=? AND revoked_at IS NULL AND expires_at>?)",sid(session),session.operator.id,at),
 stmt(env.DB,'INSERT INTO bm_staff_session_proofs(session_id,operator_id,verified_at,last_seen_at,device) VALUES(?,?,?,?,?) ON CONFLICT(session_id) DO UPDATE SET verified_at=excluded.verified_at,last_seen_at=excluded.last_seen_at,device=excluded.device',sid(session),session.operator.id,at,at,device),audit(env.DB,{email:session.operator.email,role:session.operator.role},'session.second_step_verified',null,sid(session))]
}
async function enroll(env:Bindings,session:Data){
 insist(!await one(env.DB,'SELECT 1 FROM bm_staff_factors WHERE operator_id=?',session.operator.id),'authenticator_already_registered',409)
 const secret=base32(crypto.getRandomValues(new Uint8Array(20)))
 await env.DB.prepare('INSERT INTO bm_staff_factor_pending(session_id,operator_id,sealed_seed,expires_at) VALUES(?,?,?,?) ON CONFLICT(session_id) DO UPDATE SET sealed_seed=excluded.sealed_seed,expires_at=excluded.expires_at').bind(sid(session),session.operator.id,await seal(env.SESSION_SECRET,purpose(session.operator.id),secret),Date.now()+600000).run()
 return {secret,uri:'otpauth://totp/'+encodeURIComponent('Balm:'+session.operator.email)+'?'+new URLSearchParams({secret,issuer:'Balm',algorithm:'SHA1',digits:'6',period:'30'})}
}
async function activate(env:Bindings,request:Request,session:Data,input:Data){
 await reserveAttempt(env,session)
 const pending=await one(env.DB,'SELECT * FROM bm_staff_factor_pending WHERE session_id=? AND operator_id=? AND expires_at>?',sid(session),session.operator.id,Date.now())
 insist(pending,'start_authenticator_setup_again',409)
 const secret=await unseal(env.SESSION_SECRET,purpose(session.operator.id),pending.sealed_seed)
 insist(secret,'authenticator_unavailable',409)
 const step=await matchedStep(secret,String(input.code??''));insist(step!==null,'second_step_refused',401)
 const recoveryCodes=Array.from({length:10},()=>base32(crypto.getRandomValues(new Uint8Array(16))))
 await env.DB.batch([
  guard(env.DB,'EXISTS(SELECT 1 FROM bm_staff_factor_pending WHERE session_id=? AND sealed_seed=? AND expires_at>?)',sid(session),pending.sealed_seed,Date.now()),
  stmt(env.DB,'INSERT INTO bm_staff_factors(operator_id,sealed_seed,last_step,created_at) VALUES(?,?,?,?)',session.operator.id,pending.sealed_seed,step,Date.now()),
  ...await Promise.all(recoveryCodes.map(async code=>stmt(env.DB,'INSERT INTO bm_staff_recovery(operator_id,code_hash) VALUES(?,?)',session.operator.id,await sha256('balm-recovery:'+session.operator.id+':'+code)))),
  ...await proofStatements(env,request,session),stmt(env.DB,'DELETE FROM bm_staff_factor_pending WHERE operator_id=?',session.operator.id),stmt(env.DB,'DELETE FROM bm_assert')
 ])
 return {verified:true,recoveryCodes}
}
async function verify(env:Bindings,request:Request,session:Data,input:Data){
 await expireIdle(env,session);await reserveAttempt(env,session)
 const factor=await one(env.DB,'SELECT * FROM bm_staff_factors WHERE operator_id=?',session.operator.id)
 insist(factor,'set_up_an_authenticator_first',409)
 const seed=await unseal(env.SESSION_SECRET,purpose(session.operator.id),factor.sealed_seed);insist(seed,'authenticator_unavailable',409)
 const code=String(input.code??'').replace(/\s/g,''),step=await matchedStep(seed,code)
 const digest=await sha256('balm-recovery:'+session.operator.id+':'+code)
 const recovery=await one(env.DB,'SELECT 1 FROM bm_staff_recovery WHERE operator_id=? AND code_hash=? AND used_at IS NULL',session.operator.id,digest)
 insist(step!==null&&step>factor.last_step||recovery,'second_step_refused',401)
 await env.DB.batch([
  ...(recovery?[stmt(env.DB,'UPDATE bm_staff_recovery SET used_at=? WHERE operator_id=? AND code_hash=? AND used_at IS NULL',Date.now(),session.operator.id,digest)]:[stmt(env.DB,'UPDATE bm_staff_factors SET last_step=? WHERE operator_id=? AND last_step<?',step,session.operator.id,step)]),guard(env.DB,'changes()=1'),
  ...await proofStatements(env,request,session),stmt(env.DB,'DELETE FROM bm_assert')
 ])
 return {verified:true}
}
async function settings(env:Bindings,session:Data){
 const policy=await one(env.DB,'SELECT * FROM bm_staff_security_policy WHERE id=1')
 const owner=session.operator.role==='owner'
 const sessions=await rows(env.DB,`SELECT s.id,o.email,s.kind,s.created_at,s.expires_at,p.last_seen_at,p.device,p.verified_at FROM oa_sessions s JOIN oa_operators o ON o.id=s.operator_id LEFT JOIN bm_staff_session_proofs p ON p.session_id=s.id WHERE s.revoked_at IS NULL AND s.expires_at>? AND o.status='active' AND s.operator_version=o.version AND (?=1 OR s.operator_id=?) ORDER BY s.created_at DESC,s.id`,Date.now(),owner?1:0,session.operator.id)
 return {timeZone:(await one(env.DB,'SELECT time_zone FROM bm_settings WHERE id=1'))?.time_zone||'UTC',owner,policy,sessions,currentSessionId:sid(session),enrolled:!!await one(env.DB,'SELECT 1 FROM bm_staff_factors WHERE operator_id=?',session.operator.id)}
}
function codeForm(action:string){return `<form method="post" action="/auth/security/${action}">${field('code','Authenticator or one-use recovery code','','text','required maxlength="80" autocomplete="one-time-code"')}<button>Verify second step</button></form>`}
async function screen(auth:Data,env:Bindings,session:Data,notice='',extra=''){
 const data=await settings(env,session),proof=await one(env.DB,'SELECT 1 FROM bm_staff_session_proofs WHERE session_id=?',sid(session))
 let content=notice?`<p role="status">${h(notice)}</p>`:''
 content+=extra||(proof?'<p>Your second step is complete on this device.</p>':data.enrolled?'<p>Enter your authenticator code to open clinic records. Email-link sign-in alone does not open patient information.</p>'+codeForm('verify'):'<p>Set up an authenticator before opening clinic records. Each staff member uses their own authenticator.</p><form method="post" action="/auth/security/enroll"><button>Set up authenticator</button></form>')
 if(proof){
  content+='<h2>Sessions and devices</h2>'+data.sessions.map(s=>`<p>${h(s.email)} · ${h(s.device??'Second step not completed')} · ${h(s.kind)}${s.id===data.currentSessionId?' · this device':''}<br>Last activity: ${h(s.last_seen_at?new Intl.DateTimeFormat('en-US',{timeZone:data.timeZone,dateStyle:'medium',timeStyle:'short'}).format(new Date(s.last_seen_at)):'Not verified')}</p>${data.owner?`<form method="post" action="/auth/security/revoke">${hidden('sessionId',s.id)}<button class="secondary">Sign out this device</button></form>`:''}`).join('')
  if(data.owner)content+=`<h2>Clinic session policy</h2><p>Every staff role that reads patient information must complete a second step. This cannot be disabled. Requiring it clinic-wide also covers other invited accounts.</p><form method="post" action="/auth/security/policy"><label class="check"><input name="requireAll" type="checkbox" value="on" ${data.policy?.require_all?'checked':''}>Require a second step for every account</label>${field('idleMinutes','Idle timeout in minutes',data.policy?.idle_minutes,'number','required min="1" max="120"')}<button>Save session policy</button></form>`
  content+='<p><a href="/app">Open Balm</a></p>'
 }
 content+='<form method="post" action="/auth/signout"><button class="secondary">Sign out</button></form>'
 return pageResponse({branding:auth.presentation,title:'Staff security · Balm',heading:'Staff security',content})
}
/** Uses the established native identity; never trusts a claimed email or role in an MFA form. */
export async function securityResponse(request:Request,env:Bindings,createAuth:()=>Data):Promise<Response|null>{
 let currentSession:Data|null=null,auth:Data|null=null
 const path=new URL(request.url).pathname,owns=path==='/auth/security'||path.startsWith('/auth/security/')
 const publicAuth=new Set(['/auth/bootstrap','/auth/magic-link','/auth/confirm','/auth/signout','/auth/one-click','/auth/review-session','/auth/owner-signin'])
 const protectedPath=path==='/setup'||path==='/app'||path.startsWith('/app/')||(path.startsWith('/auth/')&&!owns&&!publicAuth.has(path)&&!path.startsWith('/auth/oidc/')&&!path.startsWith('/auth/dev/')&&!path.startsWith('/auth/local/')&&path!=='/auth/dependencies/setup')
 if(!owns&&!protectedPath)return null
 try{
  auth=createAuth()
  const session=await auth.getSession(request);currentSession=session
  if(!session)return owns?json({error:'sign_in_required'},401):null
  if(!owns){await requireSecondStep(env,request,session);return null}
  insist(new URL(request.url).origin===env.AUTH_ORIGIN,'invalid_origin',403)
  await expireIdle(env,session)
  if(request.method==='GET'){
   if(path==='/auth/security')return /application\/json/.test(request.headers.get('accept')??'')?(await requireSecondStep(env,request,session),json(await settings(env,session))):screen(auth,env,session)
   return json({error:'not_found'},404)
  }
  insist(request.method==='POST'&&request.headers.get('origin')===env.AUTH_ORIGIN&&request.headers.get('sec-fetch-site')!=='cross-site','invalid_origin',403)
  const raw=await request.text();insist(raw.length<=8192,'input_too_large',413)
  const input=isForm(request)?Object.fromEntries(new URLSearchParams(raw)):JSON.parse(raw)
  if(path==='/auth/security/enroll'){
   const result=await enroll(env,session)
   if(!isForm(request))return json(result)
   return screen(auth,env,session,'Add this secret to your authenticator, then verify a code.',`<p data-mfa-secret><code>${h(result.secret)}</code></p><p>Setup expires in ten minutes. Keep this secret private.</p>${codeForm('activate')}`)
  }
  if(path==='/auth/security/activate'){
   const result=await activate(env,request,session,input)
   return isForm(request)?screen(auth,env,session,'Save these one-use recovery codes privately. They are shown once.',`<div data-mfa-secret>${result.recoveryCodes.map(code=>'<p><code>'+h(code)+'</code></p>').join('')}</div>`):json(result)
  }
  if(path==='/auth/security/verify'){const result=await verify(env,request,session,input);return isForm(request)?see('/app'):json(result)}
  await requireSecondStep(env,request,session)
  insist(session.operator.role==='owner','only_the_owner_manages_sessions',403)
  const who={...await actor(env.DB,session.operator.id),sessionId:sid(session)}
  if(path==='/auth/security/policy'){
   const idle=integer(input.idleMinutes,'idle_minutes',1,120),requireAll=input.requireAll===true||input.requireAll==='on'
   await commit(env.DB,who,[stmt(env.DB,'UPDATE bm_staff_security_policy SET idle_minutes=?,require_all=? WHERE id=1',idle,requireAll?1:0),audit(env.DB,who,'session.policy_saved',null)])
  }else if(path==='/auth/security/revoke'){
   const key=text(input.sessionId,'session',100)
   await commit(env.DB,who,[stmt(env.DB,'UPDATE oa_sessions SET revoked_at=? WHERE id=? AND revoked_at IS NULL',Date.now(),key),audit(env.DB,who,'session.remotely_revoked',null,key)])
  }else return json({error:'not_found'},404)
  return isForm(request)?see('/auth/security'):json({saved:true})
 }catch(error){
  const e=error as {status?:number;code?:string},status=e.status??503,code=e.code??'staff_security_unavailable'
  if(!owns&&(path==='/app'||path.startsWith('/app/')||path==='/setup'))return see(code==='second_step_required'?'/auth/security':'/signin')
  if(owns&&[401,429].includes(status))await env.DB.batch([audit(env.DB,{email:'staff sign-in',role:'system'},'session.second_step_refused',null,null,code)])
  if(owns&&isForm(request)&&currentSession&&auth){
   const message=code==='second_step_rate_limited'?'Too many attempts. Wait five minutes before trying again.':code==='session_idle_expired'?'This device was idle too long. Sign in again with a new email link.':code==='second_step_refused'?'That code did not verify. Use a fresh authenticator code or an unused recovery code.':'The change could not be completed. Check your sign-in and try again.'
   return pageResponse({branding:auth.presentation,title:'Staff security · Balm',heading:'Check your sign-in',content:'<p role="alert">'+h(message)+'</p><p><a href="/auth/security">Back to staff security</a></p><p><a href="/signin">Sign in again</a></p>',status})
  }
  return json({error:code},status)
 }
}
