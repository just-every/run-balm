import { supervised } from './role-access'
import { audit, commit, guard, human, id, insist, now, one, practitionerId, rows, stmt, text, type Actor, type Data } from './model'

export const pendingSql = `SELECT s.* FROM bm_note_submissions s WHERE s.note_id=? AND NOT EXISTS(SELECT 1 FROM bm_note_reviews r WHERE r.submission_id=s.id)`
export async function pendingSubmission(db:D1Database,noteId:unknown) { return one(db,pendingSql,noteId) }
export const licensedSql = `EXISTS(SELECT 1 FROM bm_staff s LEFT JOIN bm_staff_access a ON a.staff_id=s.id WHERE s.id=? AND s.role='practitioner' AND s.active=1 AND s.erased_at IS NULL AND COALESCE(a.kind,s.role) IN ('practitioner','supervisor'))`
export async function supervisorFor(db:D1Database,who:Actor) {
 insist(supervised(who) && who.supervisorId,'named_supervisor_required',403)
 insist(await one(db,'SELECT 1 WHERE '+licensedSql,who.supervisorId),'active_licensed_supervisor_required',409)
 return who.supervisorId!
}
export async function coSignQueue(db:D1Database,who:Actor) {
 if(!practitionerId(who)||supervised(who)) return []
 const queue=await rows(db,`SELECT s.id,s.note_id,s.revision,s.submitted_at,n.client_id,p.name AS author,c.first_name||' '||c.last_name AS client
 FROM bm_note_submissions s JOIN bm_notes n ON n.id=s.note_id JOIN bm_staff p ON p.id=n.author_id JOIN bm_clients c ON c.id=n.client_id
 WHERE s.supervisor_id=? AND n.signed_at IS NULL AND NOT EXISTS(SELECT 1 FROM bm_note_reviews r WHERE r.submission_id=s.id) ORDER BY s.submitted_at,s.id`,practitionerId(who))
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
