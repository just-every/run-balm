import type {Bindings} from '../../auth.server'
import {audit,commit,guard,id,insist,integer,now,one,rows,sha256,stmt,text,type Actor,type Data} from '../domain/model'
import {dispatchPatientMail} from '../mail/dispatch'
import {outcomeAuthority,outcomeClinician,outcomeEpisode} from './outcomes-access'
import {prepareOutcomeBrief} from './outcomes-brief'

const DAY=86400000
const yes=(v:unknown)=>v===true||v==='on'
async function enroll(db:D1Database,who:Actor,input:Data){
 const live=await outcomeEpisode(db,who,input.episodeId)
 insist(live.client.id===input.clientId,'episode_not_found',404)
 insist(!live.episode.closed_at,'episode_not_open',409)
 insist(yes(input.consent),'record_patient_outcome_opt_in')
 const consent=text(input.consentRecord,'consent_record',500)
 const formId=input.formId?text(input.formId,'form',100):null
 const form=formId?await one(db,'SELECT * FROM bm_intake_forms WHERE id=?',formId):null
 insist(!formId||form&&JSON.parse(form.instruments).length,'choose_a_published_outcome_form')
 const exerciseIds=Array.isArray(input.exerciseIds)?input.exerciseIds.map((v:unknown)=>text(v,'exercise',100)):typeof input.exerciseIds==='string'?input.exerciseIds.split(',').map((v:string)=>v.trim()).filter(Boolean):[]
 insist(exerciseIds.length<=30&&new Set(exerciseIds).size===exerciseIds.length,'invalid_exercise_selection')
 const checkins=yes(input.checkins)
 insist(formId||checkins,'choose_questionnaire_or_home_checkins')
 insist(!checkins||exerciseIds.length,'select_the_episode_home_program')
 const cadenceDays=integer(input.cadenceDays,'cadence_days',1,365),responseDays=integer(input.responseDays??1,'response_days',0,30),maxCycles=integer(input.maxCycles??12,'max_cycles',1,52)
 const at=now(),start=input.startAt?new Date(text(input.startAt,'first_due',40)).getTime():Date.now()
 insist(Number.isFinite(start),'invalid_first_due')
 const nextDue=new Date(start).toISOString(),key=id()
 await commit(db,live.who,[...outcomeAuthority(db,live.who,live.client.id,live.episode.id),
  ...exerciseIds.map((e:string)=>guard(db,'EXISTS(SELECT 1 FROM bm_home_exercises WHERE id=? AND client_id=? AND archived_at IS NULL)',e,live.client.id)),
  stmt(db,'INSERT INTO bm_outcome_schedules(id,client_id,episode_id,form_id,exercise_ids,checkins,cadence_days,response_days,max_cycles,next_due,consent_record,created_by,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)',key,live.client.id,live.episode.id,formId,JSON.stringify(exerciseIds),checkins?1:0,cadenceDays,responseDays,maxCycles,nextDue,consent,live.who.email,at),
  audit(db,live.who,'outcome.enrolled',live.client.id,key)])
 return {id:key,clientId:live.client.id}
}
async function scheduleFor(db:D1Database,who:Actor,key:unknown){
 const schedule=await one(db,'SELECT * FROM bm_outcome_schedules WHERE id=?',text(key,'schedule',100))
 insist(schedule,'outcome_schedule_not_found',404)
 return {...await outcomeEpisode(db,who,schedule.episode_id),schedule}
}
async function requestFor(db:D1Database,who:Actor,key:unknown){
 const request=await one(db,'SELECT * FROM bm_outcome_requests WHERE id=?',text(key,'request',100))
 insist(request,'outcome_request_not_found',404)
 return {...await scheduleFor(db,who,request.schedule_id),request}
}
async function prepare(db:D1Database,who:Actor,input:Data){
 const live=await scheduleFor(db,who,input.id),s=live.schedule
 insist(!s.stopped_at&&!live.episode.closed_at,'outcome_schedule_stopped',409)
 insist(s.next_due<=now(),'outcome_not_due',409)
 const existing=await one(db,'SELECT * FROM bm_outcome_requests WHERE schedule_id=? AND due_at=?',s.id,s.next_due)
 if(existing)return {id:existing.id}
 const count=await one(db,'SELECT COUNT(*) AS n FROM bm_outcome_requests WHERE schedule_id=?',s.id)
 insist(count!.n<s.max_cycles,'outcome_cadence_limit_reached',409)
 const key=id()
 await commit(db,live.who,[...outcomeAuthority(db,live.who,live.client.id,live.episode.id),
  guard(db,'EXISTS(SELECT 1 FROM bm_outcome_schedules WHERE id=? AND version=? AND stopped_at IS NULL AND next_due<=?)',s.id,s.version,now()),
  stmt(db,'INSERT INTO bm_outcome_requests(id,schedule_id,client_id,episode_id,form_id,due_at,created_at) VALUES(?,?,?,?,?,?,?)',key,s.id,live.client.id,live.episode.id,s.form_id,s.next_due,now()),audit(db,live.who,'outcome.prepared',live.client.id,key)])
 return {id:key}
}
export async function outcomeProposal(db:D1Database,request:Data,origin:string){
 const source=await one(db,`SELECT s.*,c.email,c.version AS client_version,e.closed_at FROM bm_outcome_schedules s JOIN bm_clients c ON c.id=s.client_id JOIN bm_episodes e ON e.id=s.episode_id WHERE s.id=? AND c.erased_at IS NULL`,request.schedule_id)
 insist(source,'outcome_request_not_found',404)
 const attempts=await rows(db,'SELECT * FROM bm_outcome_attempts WHERE request_id=? ORDER BY attempted_at,id',request.id)
 const answered=await one(db,'SELECT id FROM bm_outcome_responses WHERE request_id=?',request.id)
 const initial=attempts.find(a=>a.kind==='initial'),kind=initial?'followup':'initial'
 const due=initial?new Date(Date.parse(initial.attempted_at)+source.response_days*DAY).toISOString():request.due_at
 const blocked=source.stopped_at||source.closed_at?'Episode or cadence stopped':answered?'Response received':attempts.some(a=>a.kind==='followup')?'Follow-up limit reached':initial&&initial.state!=='accepted'?'Provider outcome needs human review; no resend':due>now()?'Response window is still open':!source.email?'Patient has no email address':null
 const payload={requestId:request.id,episodeId:request.episode_id,formId:request.form_id,kind,to:source.email,clientVersion:source.client_version,scheduleVersion:source.version,dueAt:due,
  subject:'A request from your clinic',message:'Your clinic has requested an update. Please sign in to your patient portal to respond. Contact the clinic to stop these requests.\n\n'+new URL('/portal',origin).href}
 return {...payload,digest:await sha256(JSON.stringify(payload)),blocked,attempts,source}
}
async function approve(env:Bindings,who:Actor,input:Data){
 const db=env.DB,live=await requestFor(db,who,input.id),p=await outcomeProposal(db,live.request,env.AUTH_ORIGIN)
 insist(!p.blocked,p.blocked??'outcome_send_blocked',409)
 insist(input.digest===p.digest,'outcome_changed_review_again',409)
 insist(yes(input.consent),'confirm_current_patient_opt_in')
 const consent=text(input.consentRecord,'current_consent_record',500),key=id(),at=now(),since=new Date(Date.now()-DAY).toISOString()
 await commit(db,live.who,[...outcomeAuthority(db,live.who,live.client.id,live.episode.id),
  guard(db,'EXISTS(SELECT 1 FROM bm_clients WHERE id=? AND version=? AND email=?)',live.client.id,p.clientVersion,p.to),
  guard(db,'EXISTS(SELECT 1 FROM bm_outcome_schedules WHERE id=? AND version=? AND stopped_at IS NULL)',live.schedule.id,p.scheduleVersion),
  guard(db,'NOT EXISTS(SELECT 1 FROM bm_outcome_responses WHERE request_id=?)',live.request.id),
  guard(db,`((SELECT COUNT(*) FROM bm_followup_attempts WHERE client_id=? AND attempted_at>?)+(SELECT COUNT(*) FROM bm_outcome_attempts WHERE client_id=? AND attempted_at>?))<(SELECT followup_contact_limit FROM bm_settings WHERE id=1)`,live.client.id,since,live.client.id,since),
  stmt(db,'INSERT INTO bm_outcome_attempts(id,request_id,client_id,kind,digest,recipient,attempted_at,approved_by,consent_record) VALUES(?,?,?,?,?,?,?,?,?)',key,live.request.id,live.client.id,p.kind,p.digest,p.to,at,live.who.email,consent),
  ...(p.kind==='initial'?[stmt(db,'UPDATE bm_outcome_schedules SET next_due=?,version=version+1 WHERE id=?',new Date(Date.now()+live.schedule.cadence_days*DAY).toISOString(),live.schedule.id)]:[]),
  audit(db,live.who,'outcome.send_approved',live.client.id,key,p.kind)])
 const result=await dispatchPatientMail(env,p.to,p.subject,p.message,{clientId:live.client.id,appointmentIds:[],kind:'reminder',deliveryId:key})
 await commit(db,null,[stmt(db,'UPDATE bm_outcome_attempts SET state=? WHERE id=? AND state=\'sending\'',result.state,key),audit(db,live.who,'outcome.send_'+result.state,live.client.id,key,p.kind)])
 return {id:key,state:result.state,kind:p.kind}
}
export async function outcomesFor(db:D1Database,who:Actor,clientId:string,origin:string){
 if(who.role!=='owner'&&who.staffRole!=='practitioner'||['assistant','student','fellow'].includes(who.staffKind??''))return null
 const live=await outcomeClinician(db,who,clientId)
 const schedules=await rows(db,'SELECT s.*,e.title AS episode_title,e.closed_at,f.title AS form_title FROM bm_outcome_schedules s JOIN bm_episodes e ON e.id=s.episode_id LEFT JOIN bm_intake_forms f ON f.id=s.form_id WHERE s.client_id=? ORDER BY s.created_at DESC',clientId)
 const requests=await rows(db,'SELECT r.*,z.id AS response_id,z.scores,z.checkin,z.submitted_at FROM bm_outcome_requests r LEFT JOIN bm_outcome_responses z ON z.request_id=r.id WHERE r.client_id=? ORDER BY r.due_at DESC',clientId)
 const proposals=await Promise.all(requests.map(async r=>({...r,proposal:await outcomeProposal(db,r,origin)})))
 const briefs=await rows(db,'SELECT * FROM bm_outcome_briefs WHERE client_id=? ORDER BY prepared_at DESC,id',clientId)
 await commit(db,live.who,[...outcomeAuthorityRead(db,live.who,clientId),audit(db,live.who,'outcome.clinical_read',clientId)])
 return {schedules,requests:proposals.map(({proposal,...r})=>({...r,proposal:(({source,...p})=>p)(proposal)})),briefs:briefs.map(b=>({...b,payload:JSON.parse(b.payload)})),forms:await rows(db,"SELECT id,title,number FROM bm_intake_forms WHERE instruments<>'[]' ORDER BY number DESC")}
}
function outcomeAuthorityRead(db:D1Database,who:Actor,clientId:string){return [guard(db,"EXISTS(SELECT 1 FROM bm_clients WHERE id=? AND erased_at IS NULL AND (?='owner' OR EXISTS(SELECT 1 FROM bm_appointments WHERE client_id=? AND practitioner_id=?)))",clientId,who.role,clientId,who.staffId??'')]}
export async function outcomeCommand(env:Bindings,who:Actor,name:string,input:Data){
 if(name==='outcome.enroll')return enroll(env.DB,who,input)
 if(name==='outcome.prepare')return prepare(env.DB,who,input)
 if(name==='outcome.approve')return approve(env,who,input)
 if(name==='outcome.brief')return prepareOutcomeBrief(env.DB,who,input)
 if(name==='outcome.read'){await outcomeClinician(env.DB,who,input.clientId);return outcomesFor(env.DB,who,input.clientId,env.AUTH_ORIGIN)}
 if(name==='outcome.stop'){
  const live=await scheduleFor(env.DB,who,input.id)
  await commit(env.DB,live.who,[...outcomeAuthorityRead(env.DB,live.who,live.client.id),stmt(env.DB,'UPDATE bm_outcome_schedules SET stopped_at=?,stopped_by=?,version=version+1 WHERE id=? AND stopped_at IS NULL',now(),live.who.email,live.schedule.id),guard(env.DB,'changes()=1'),audit(env.DB,live.who,'outcome.stopped',live.client.id,live.schedule.id)])
  return {stopped:true}
 }
 insist(false,'unknown_command',404)
}
