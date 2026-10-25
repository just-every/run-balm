import {audit,commit,id,insist,now,rows,sha256,stmt,type Actor,type Data} from '../domain/model'
import {portalExercisesFor} from '../portal/programs'
import {clientAuthority} from '../messages/access'
import {outcomeEpisode} from './outcomes-access'

/** Deterministic source brief; only the clinician turns observations into clinical assertions. */
export async function prepareOutcomeBrief(db:D1Database,who:Actor,input:Data){
 const live=await outcomeEpisode(db,who,input.episodeId)
 const records=await rows(db,`SELECT r.id AS request_id,r.due_at,r.form_id,z.id AS response_id,z.scores,z.checkin,z.submitted_at,f.number AS form_number
 FROM bm_outcome_requests r LEFT JOIN bm_outcome_responses z ON z.request_id=r.id LEFT JOIN bm_intake_forms f ON f.id=r.form_id
 WHERE r.episode_id=? ORDER BY r.due_at,r.id`,live.episode.id)
 const schedules=await rows(db,'SELECT exercise_ids,created_at FROM bm_outcome_schedules WHERE episode_id=?',live.episode.id)
 insist(schedules.length,'outcome_schedule_not_found',404)
 const chosen=new Set<string>(schedules.flatMap(s=>JSON.parse(s.exercise_ids)))
 const exercises=(await portalExercisesFor(db,live.who,live.client.id)).filter(e=>chosen.has(e.id))
 const responses:Data[]=records.filter(r=>r.response_id).map(r=>({...r,scores:JSON.parse(r.scores),checkin:JSON.parse(r.checkin)}))
 const missing=records.filter(r=>!r.response_id)
 const citations=records.map(r=>({kind:r.response_id?'response':'request',id:r.response_id??r.request_id,href:`/app/clients/${live.client.id}#outcome-${r.request_id}`,label:r.response_id?`Patient response ${r.submitted_at}; form version ${r.form_number??'home check-in'}`:`Unanswered request due ${r.due_at}`}))
 citations.push(...exercises.map(e=>({kind:'exercise',id:e.id,href:`/app/clients/${live.client.id}#exercises`,label:`Patient exercise log: ${e.title}`})))
 const scoreLines=responses.flatMap(r=>r.scores.map((s:Data)=>`${s.name}: ${s.score} ${s.unit} (${r.submitted_at}; form v${r.form_number}; scoring v${s.scoringVersion}).`))
 const changes:Data[]=[]
 const groups=new Map<string,Data[]>()
 for(const response of responses)for(const score of response.scores){
  const key=response.form_id+':'+score.kind
  groups.set(key,[...groups.get(key)??[],{...score,formId:response.form_id,responseId:response.response_id}])
 }
 for(const series of groups.values()){
  if(series.length>1){const first=series[0],last=series[series.length-1];changes.push({kind:last.kind,formId:last.formId,from:first.score,to:last.score,change:Math.round((last.score-first.score)*100)/100,unit:last.unit,firstResponseId:first.responseId,lastResponseId:last.responseId})}
 }
 const zone=(await rows(db,'SELECT time_zone FROM bm_settings WHERE id=1'))[0].time_zone as string
 const calendar=new Intl.DateTimeFormat('en-CA',{timeZone:zone,year:'numeric',month:'2-digit',day:'2-digit'})
 const adherence=exercises.map(e=>{
  const starts=schedules.filter(s=>JSON.parse(s.exercise_ids).includes(e.id)).map(s=>s.created_at as string).sort()[0]
  const sinceDay=calendar.format(new Date(starts)),sessions=e.sessions.filter(s=>s.day>=sinceDay)
  return {exerciseId:e.id,title:e.title,loggedSessions:sessions.length,sinceDay,days:sessions.map(s=>s.day),frequency:e.frequency,sourceNoteId:e.sourceNoteId}
 })
 const checkins=responses.filter(r=>r.checkin.planned).map(r=>({responseId:r.response_id,submittedAt:r.submitted_at,...r.checkin}))
 const openQuestions=[...missing.map(r=>`The request due ${r.due_at} has no response. Ask about barriers; no clinical conclusion is inferred.`),...checkins.filter(r=>r.question).map(r=>`Patient question (${r.submittedAt}): ${r.question}`)]
 if(!responses.length)openQuestions.push('No outcome scores have been received for this episode.')
 if(adherence.length)openQuestions.push('Exercise logs show recorded sessions only. Confirm actual completion and barriers with the patient.')
 const body=[`Episode: ${live.episode.title}`,...scoreLines,...changes.map(c=>`${c.kind} observed score change: ${c.change} ${c.unit}.`),...adherence.map(e=>`${e.title}: ${e.loggedSessions} logged daily sessions from ${e.sinceDay}; assigned frequency ${e.frequency}.`),...checkins.map(c=>`Patient reported ${c.adherence} of ${c.planned} planned home sessions (${c.submittedAt}).`),'Open questions:',...openQuestions,'Clinician review required. This brief makes no diagnosis or treatment recommendation.'].join('\n')
 const payload={episodeId:live.episode.id,body,scores:responses.map(r=>({responseId:r.response_id,formId:r.form_id,formVersion:r.form_number,scores:r.scores})),changes,adherence,checkins,openQuestions,citations}
 const key=id(),digest=await sha256(JSON.stringify(payload))
 await commit(db,live.who,[clientAuthority(db,live.who,live.client.id),stmt(db,'INSERT INTO bm_outcome_briefs(id,client_id,episode_id,payload,sha256,prepared_by,prepared_at) VALUES(?,?,?,?,?,?,?)',key,live.client.id,live.episode.id,JSON.stringify(payload),digest,live.who.email,now()),audit(db,live.who,'outcome.brief_prepared',live.client.id,key),audit(db,live.who,'outcome.clinical_read',live.client.id,live.episode.id)])
 return {id:key,sha256:digest,...payload}
}
