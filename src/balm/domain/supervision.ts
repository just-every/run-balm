import { supervised } from './role-access'
import { audit, commit, guard, human, id, insist, integer, need, now, one, practitionerId, rows, stmt, text, type Actor, type Data } from './model'

export const pendingSql = `SELECT s.* FROM bm_note_submissions s WHERE s.note_id=? AND NOT EXISTS(SELECT 1 FROM bm_note_reviews r WHERE r.submission_id=s.id)`
export async function pendingSubmission(db:D1Database,noteId:unknown) { return one(db,pendingSql,noteId) }
export const licensedSql = `EXISTS(SELECT 1 FROM bm_staff s LEFT JOIN bm_staff_access a ON a.staff_id=s.id WHERE s.id=? AND s.role='practitioner' AND s.active=1 AND s.erased_at IS NULL AND COALESCE(a.kind,s.role) IN ('practitioner','supervisor') AND s.discipline<>'' AND s.discipline=(SELECT discipline FROM bm_staff WHERE id=?))`
export async function supervisorFor(db:D1Database,who:Actor) {
 insist(supervised(who) && who.supervisorId,'named_supervisor_required',403)
 insist(await one(db,'SELECT 1 WHERE '+licensedSql,who.supervisorId,who.staffId),'active_same_discipline_supervisor_required',409)
 return who.supervisorId!
}
export async function coSignQueue(db:D1Database,who:Actor) {
 if(!practitionerId(who)||supervised(who)) return []
 const queue=await rows(db,`SELECT s.id,s.note_id,s.revision,s.submitted_at,s.due_at,s.deadline_basis,n.client_id,p.name AS author,c.first_name||' '||c.last_name AS client
 FROM bm_note_submissions s JOIN bm_notes n ON n.id=s.note_id JOIN bm_staff p ON p.id=n.author_id JOIN bm_clients c ON c.id=n.client_id
 WHERE s.supervisor_id=? AND n.signed_at IS NULL AND NOT EXISTS(SELECT 1 FROM bm_note_reviews r WHERE r.submission_id=s.id) ORDER BY s.submitted_at,s.id`,practitionerId(who))
 for(const item of queue){item.overdue=!!item.due_at&&Date.parse(item.due_at)<Date.now();item.deadlineRule=JSON.parse(item.deadline_basis);delete item.deadline_basis}
 await commit(db,who,queue.map(s=>audit(db,who,'supervision.queue_read',s.client_id,s.note_id)))
 return queue
}
export async function returnNote(db:D1Database,who:Actor,input:Data) {
 human(who);insist(!supervised(who),'licensed_supervisor_required',403)
 const note=await one(db,'SELECT * FROM bm_notes WHERE id=?',text(input.id,'note',100)),pending=note?await pendingSubmission(db,note.id):null
 insist(note && !note.signed_at && pending && pending.supervisor_id===practitionerId(who),'supervision_not_found',404)
 const reason=text(input.reason,'return_reason',500)
 await commit(db,who,[stmt(db,"INSERT INTO bm_note_reviews(submission_id,decision,reason,reviewed_at,reviewed_by) VALUES(?,'returned',?,?,?)",pending.id,reason,now(),who.email),audit(db,who,'note.returned',note.client_id,note.id)])
 return {id:note.id,returned:true}
}

/** A returned draft grants no continuing chart access; care-team grants remain separate. */
export const supervisorReadSql=(noteAlias:string)=>`EXISTS(SELECT 1 FROM bm_note_submissions u LEFT JOIN bm_note_reviews v ON v.submission_id=u.id WHERE u.note_id=${noteAlias}.id AND u.supervisor_id=? AND (v.decision IS NULL OR v.decision='cosigned'))`

/** Owner-entered state rule; an unset rule is visible, never guessed from an address. */
export async function saveSupervisionDeadline(db:D1Database,who:Actor,input:Data){
 human(who);need(who,'owner')
 const staffId=text(input.staffId,'author',100),state=text(input.state,'state',2).toUpperCase(),hours=integer(input.hours,'deadline_hours',1,720),source=text(input.source,'state_rule_source',1000)
 insist(/^[A-Z]{2}$/.test(state),'record_the_state_abbreviation')
 await commit(db,who,[guard(db,"EXISTS(SELECT 1 FROM bm_staff_access WHERE staff_id=? AND kind IN ('assistant','student','fellow'))",staffId),
 stmt(db,'INSERT INTO bm_supervision_deadlines(staff_id,state,hours,source,recorded_at,recorded_by) VALUES(?,?,?,?,?,?) ON CONFLICT(staff_id) DO UPDATE SET state=excluded.state,hours=excluded.hours,source=excluded.source,recorded_at=excluded.recorded_at,recorded_by=excluded.recorded_by,version=bm_supervision_deadlines.version+1',staffId,state,hours,source,now(),who.email),audit(db,who,'supervision.deadline_saved',null,staffId)])
 return {saved:true}
}
export async function submissionContext(db:D1Database,note:Data,input:Data){
 const rule=await one(db,'SELECT * FROM bm_supervision_deadlines WHERE staff_id=?',note.author_id)
 const visit=note.appointment_id?await one(db,'SELECT end_at FROM bm_appointments WHERE id=?',note.appointment_id):null
 const dueAt=rule?new Date(Date.parse(visit?.end_at??note.created_at)+rule.hours*3600000).toISOString():null
 const plans=await rows(db,`SELECT p.id FROM bm_plans_of_care p WHERE p.client_id=?
 AND (NOT EXISTS(SELECT 1 FROM bm_episode_records WHERE record_kind='visit' AND record_id=?)
 OR EXISTS(SELECT 1 FROM bm_episode_records pr JOIN bm_episode_records vr ON vr.episode_id=pr.episode_id WHERE pr.record_kind='plan' AND pr.record_id=p.id AND vr.record_kind='visit' AND vr.record_id=?))`,note.client_id,note.appointment_id??'',note.appointment_id??'')
 const planId=input.planId?text(input.planId,'governing_plan',100):plans.length===1?plans[0].id:null
 insist(!planId||plans.some(p=>p.id===planId),'governing_plan_not_found',404)
 insist(planId||plans.length<=1,'choose_the_governing_plan_of_care',409)
 return {planId,dueAt,basis:JSON.stringify(rule??{})}
}
export async function supervisionPlans(db:D1Database,who:Actor,clientId:string){
 const list=await rows(db,`SELECT DISTINCT s.plan_id FROM bm_note_submissions s JOIN bm_notes n ON n.id=s.note_id
 LEFT JOIN bm_note_reviews r ON r.submission_id=s.id WHERE n.client_id=? AND s.supervisor_id=? AND s.plan_id IS NOT NULL AND (r.decision IS NULL OR r.decision='cosigned')`,clientId,practitionerId(who)??'')
 return list.map(p=>p.plan_id as string)
}
