import {audit,commit,guard,id,insist,integer,now,one,rows,stmt,text,type Data} from '../domain/model'
import {portalGuard,type Patient} from '../portal/auth'
import {guardianActor} from '../portal/guardians'
import {outcomeQuestions,outcomeScores} from '../intake/outcomes'

export async function patientOutcomes(db:D1Database,patient:Patient){
 const list=await rows(db,`SELECT r.id,r.due_at,e.title AS episode_title,f.title AS form_title,f.instruments,s.checkins
 FROM bm_outcome_requests r JOIN bm_outcome_schedules s ON s.id=r.schedule_id JOIN bm_episodes e ON e.id=r.episode_id LEFT JOIN bm_intake_forms f ON f.id=r.form_id
 WHERE r.client_id=? AND s.stopped_at IS NULL AND e.closed_at IS NULL AND EXISTS(SELECT 1 FROM bm_outcome_attempts a WHERE a.request_id=r.id)
 AND NOT EXISTS(SELECT 1 FROM bm_outcome_responses z WHERE z.request_id=r.id) ORDER BY r.due_at`,patient.clientId)
 await commit(db,null,[portalGuard(db,patient),audit(db,guardianActor(patient),'outcome.requests_read',patient.clientId)])
 return list.map(({instruments,...r})=>({...r,questions:outcomeQuestions(JSON.parse(instruments??'[]'))}))
}
export async function respondOutcome(db:D1Database,patient:Patient,input:Data){
 const request=await one(db,`SELECT r.*,s.checkins,f.instruments FROM bm_outcome_requests r JOIN bm_outcome_schedules s ON s.id=r.schedule_id JOIN bm_episodes e ON e.id=r.episode_id LEFT JOIN bm_intake_forms f ON f.id=r.form_id
 WHERE r.id=? AND r.client_id=? AND s.stopped_at IS NULL AND e.closed_at IS NULL AND EXISTS(SELECT 1 FROM bm_outcome_attempts a WHERE a.request_id=r.id)`,text(input.id,'request',100),patient.clientId)
 insist(request,'outcome_request_not_found',404)
 const instruments=JSON.parse(request.instruments??'[]'),answers:Record<string,string|boolean>={}
 for(const q of outcomeQuestions(instruments)){
  const raw=input['q_'+q.id]
  if(raw===undefined||raw===''){insist(!q.required,'answer_required_'+q.id);continue}
  answers[q.id]=String(integer(raw,'outcome_answer',q.min,q.max))
 }
 const scores=outcomeScores(instruments,answers)
 const checkin=request.checkins?{adherence:integer(input.adherence,'home_sessions_completed',0,100),planned:integer(input.planned,'home_sessions_planned',1,100),question:typeof input.question==='string'?input.question.trim():''}:{}
 if(request.checkins){insist(checkin.adherence!<=checkin.planned!,'completed_sessions_exceed_planned');insist(checkin.question!.length<=2000,'question_too_long')}
 const key=id(),at=now()
 await commit(db,null,[portalGuard(db,patient),
  guard(db,'EXISTS(SELECT 1 FROM bm_outcome_schedules s JOIN bm_outcome_requests r ON r.schedule_id=s.id JOIN bm_episodes e ON e.id=r.episode_id WHERE r.id=? AND r.client_id=? AND s.stopped_at IS NULL AND e.closed_at IS NULL)',request.id,patient.clientId),
  stmt(db,'INSERT INTO bm_outcome_responses(id,request_id,client_id,answers,scores,checkin,submitted_at) VALUES(?,?,?,?,?,?,?)',key,request.id,patient.clientId,JSON.stringify(answers),JSON.stringify(scores),JSON.stringify(checkin),at),
  audit(db,guardianActor(patient),'outcome.responded',patient.clientId,key)])
 return {id:key,received:true}
}
