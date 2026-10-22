import {one,rows,type Data} from '../domain/model'
import {h,field,hidden} from '../ui/shared'
import {recoveryNotices} from './recovery'
// @ts-expect-error The shared auth frame has no TypeScript declarations.
import {pageResponse} from '../../modules/operator-auth/page.mjs'
import type {Bindings} from '../../auth.server'
const sid=(session:Data)=>String(session.id)

export async function securitySettings(env:Bindings,session:Data){
 const policy=await one(env.DB,'SELECT * FROM bm_staff_security_policy WHERE id=1')
 const owner=session.operator.role==='owner'
 const sessions=await rows(env.DB,`SELECT s.id,o.email,s.kind,s.created_at,s.expires_at,p.last_seen_at,p.device,p.verified_at FROM oa_sessions s JOIN oa_operators o ON o.id=s.operator_id LEFT JOIN bm_staff_session_proofs p ON p.session_id=s.id WHERE s.revoked_at IS NULL AND s.expires_at>? AND o.status='active' AND s.operator_version=o.version AND (?=1 OR s.operator_id=?) ORDER BY s.created_at DESC,s.id`,Date.now(),owner?1:0,session.operator.id)
 return {timeZone:(await one(env.DB,'SELECT time_zone FROM bm_settings WHERE id=1'))?.time_zone||'UTC',owner,policy,sessions,currentSessionId:sid(session),enrolled:!!await one(env.DB,'SELECT 1 FROM bm_staff_factors WHERE operator_id=?',session.operator.id)}
}
export function codeForm(action:string,button='Verify second step',label='Authenticator or one-use recovery code'){return `<form method="post" action="/auth/security/${action}">${field('code',label,'','text','required maxlength="80" autocomplete="one-time-code"')}<button>${h(button)}</button></form>`}
export async function securityScreen(auth:Data,env:Bindings,session:Data,notice='',extra=''){
 const data=await securitySettings(env,session),proof=await one(env.DB,'SELECT 1 FROM bm_staff_session_proofs WHERE session_id=?',sid(session))
 let content=await recoveryNotices(env.DB,session.operator.id)
 content+=notice?`<p role="status">${h(notice)}</p>`:''
 content+=extra||(proof?'<p>Your second step is complete on this device.</p>':data.enrolled?'<p>Enter your authenticator code to open clinic records. Email-link sign-in alone does not open patient information.</p>'+codeForm('verify'):'<p>Set up an authenticator before opening clinic records. Each staff member uses their own authenticator.</p><form method="post" action="/auth/security/enroll"><button>Set up authenticator</button></form>')
 if(proof){
  content+='<h2>Sessions and devices</h2>'+data.sessions.map(s=>`<p>${h(s.email)} · ${h(s.device??'Second step not completed')} · ${h(s.kind)}${s.id===data.currentSessionId?' · this device':''}<br>Last activity: ${h(s.last_seen_at?new Intl.DateTimeFormat('en-US',{timeZone:data.timeZone,dateStyle:'medium',timeStyle:'short'}).format(new Date(s.last_seen_at)):'Not verified')}</p>${data.owner?`<form method="post" action="/auth/security/revoke">${hidden('sessionId',s.id)}<button class="secondary">Sign out this device</button></form>`:''}`).join('')
  if(data.owner)content+=`<h2>Clinic session policy</h2><p>Every staff role that reads patient information must complete a second step. This cannot be disabled. Requiring it clinic-wide also covers other invited accounts.</p><form method="post" action="/auth/security/policy"><label class="check"><input name="requireAll" type="checkbox" value="on" ${data.policy?.require_all?'checked':''}>Require a second step for every account</label>${field('idleMinutes','Idle timeout in minutes',data.policy?.idle_minutes,'number','required min="1" max="120"')}<button>Save session policy</button></form>`
  if(!extra)content+='<h2>Recovery codes</h2><p>Generate ten new one-use codes with a fresh authenticator code. This invalidates every code in the previous set.</p>'+codeForm('recoveries','Generate new recovery codes','Fresh authenticator code')
  content+='<p><a href="/app">Open Balm</a></p>'
 }
 content+='<p>If you lose your authenticator and all recovery codes, you cannot open patient information. Email sign-in and the owner cannot bypass the second step.</p>'
 content+='<form method="post" action="/auth/signout"><button class="secondary">Sign out</button></form>'
 return pageResponse({branding:auth.presentation,title:'Staff security · Balm',heading:'Staff security',content,referrer:'strict-origin'})
}
