import {pdf,type Block} from '../payments/pdf'
import {day} from '../domain/model'
import {guardianActor} from './guardians'
import { clientVisible } from '../domain/clients'
import { actor, audit, commit, guard, human, id, insist, integer, now, optional, practitionerId, rows, stmt, text, type Actor, type Data } from '../domain/model'
import { clientAuthority } from '../messages/access'
import { patientActor, portalGuard, type Patient } from './auth'

async function clinician(db: D1Database, who: Actor, clientId: unknown) {
  human(who)
  const live = await actor(db, who.id)
  insist(live.role === 'owner' || !!practitionerId(live), 'home_exercises_are_clinical', 403)
  return { who: live, client: await clientVisible(db, live, clientId) }
}

/** Accept only bounded raster image data; SVG and arbitrary embedded documents are refused. */
function image(value: unknown) {
  const data = optional(value, 'exercise_image', 1_400_000)
  if (!data) return null
  const match = data.match(/^data:image\/(png|jpeg|webp);base64,([A-Za-z0-9+/]+={0,2})$/)
  insist(match, 'use_a_png_jpeg_or_webp_image')
  let bytes: string
  try { bytes = atob(match[2]) } catch { insist(false, 'invalid_exercise_image') }
  insist(bytes.length <= 1_048_576, 'exercise_image_must_be_under_1mb')
  const valid = match[1] === 'png' ? bytes.startsWith('\x89PNG\r\n\x1a\n') : match[1] === 'jpeg' ? bytes.startsWith('\xff\xd8\xff') : bytes.startsWith('RIFF') && bytes.slice(8, 12) === 'WEBP'
  insist(valid, 'invalid_exercise_image')
  return data
}
export interface Exercise {
  id: string; clientId: string; title: string; sets: number; reps: string; frequency: string; instructions: string
  image: string | null; assignedBy: string; assignedAt: string
  libraryId?:string|null;instructionsEs?:string|null;titleEs?:string|null;license?:string|null;source?:string|null
  sourceNoteId: string|null; holdSeconds:number; sessions:{day:string;pain:number|null}[]
  seenAt: string | null; doneAt: string | null; archivedAt: string | null; doneDates: string[]
}
async function exercises(db: D1Database, clientId: string, archived: boolean): Promise<Exercise[]> {
  const result = await rows<Omit<Exercise, 'doneDates'>>(db, `SELECT id,client_id AS clientId,title,sets,reps,frequency,instructions,image,library_id AS libraryId,instructions_es AS instructionsEs,title_es AS titleEs,exercise_license AS license,exercise_source AS source,source_note_id AS sourceNoteId,hold_seconds AS holdSeconds,
    assigned_by AS assignedBy,assigned_at AS assignedAt,seen_at AS seenAt,done_at AS doneAt,archived_at AS archivedAt
    FROM bm_home_exercises WHERE client_id=?${archived ? '' : ' AND archived_at IS NULL'} ORDER BY assigned_at DESC,id`, clientId)
  const done = await rows<{ exercise_id: string; day: string; pain:number|null }>(db, `SELECT d.exercise_id,d.day,d.pain FROM bm_home_exercise_done d
    JOIN bm_home_exercises e ON e.id=d.exercise_id WHERE e.client_id=? ORDER BY d.day`, clientId)
  return result.map(e => ({ ...e, sessions:done.filter(d=>d.exercise_id===e.id).map(d=>({day:d.day,pain:d.pain})), doneDates: done.filter(d => d.exercise_id === e.id).map(d => d.day) }))
}

/** The chart receives adherence only after clinical authority and its read audit commit. */
export async function portalExercisesFor(db: D1Database, who: Actor, clientId: string) {
  const live = await clinician(db, who, clientId)
  const list = await exercises(db, clientId, true)
  await commit(db, live.who, [clientAuthority(db, live.who, clientId), audit(db, live.who, 'exercise.adherence_read', clientId),
    ...list.map(e => audit(db, live.who, 'exercise.read', clientId, e.id)),
  ])
  return list
}

export async function assignExercise(db: D1Database, who: Actor, input: Data) {
  const live = await clinician(db, who, input.clientId), exerciseId = id()
  const title = text(input.title, 'exercise_title', 200), sets = integer(input.sets, 'sets', 1, 100)
  const reps = typeof input.reps === 'number' ? String(integer(input.reps, 'reps', 1, 10000)) : text(input.reps, 'reps', 100)
  const frequency = optional(input.frequency, 'frequency', 100) ?? 'Daily'
  const holdSeconds=integer(input.holdSeconds??0,'hold_seconds',0,600)
  const sourceNoteId=input.noteId?text(input.noteId,'source_note',100):null
  const source=sourceNoteId?await rows(db,"SELECT id FROM bm_notes WHERE id=? AND client_id=? AND (?='owner' OR author_id=?)",sourceNoteId,live.client.id,live.who.role,practitionerId(live.who)??''):[]
  insist(!sourceNoteId||source.length,'source_note_not_found',404)
  const instructions = text(input.instructions, 'exercise_instructions', 10000), contentImage = image(input.image)
  await commit(db, live.who, [clientAuthority(db, live.who, live.client.id),
    stmt(db, 'INSERT INTO bm_home_exercises(id,client_id,title,sets,reps,frequency,instructions,image,assigned_by,assigned_at,source_note_id,hold_seconds) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)',
      exerciseId, live.client.id, title, sets, reps, frequency, instructions, contentImage, live.who.email, now(),sourceNoteId,holdSeconds),
    audit(db, live.who, 'exercise.assigned', live.client.id, exerciseId),
  ])
  return { id: exerciseId, clientId: live.client.id }
}

export async function archiveExercise(db: D1Database, who: Actor, input: Data) {
  const exerciseId = text(input.id, 'exercise', 100)
  const assignment = (await rows<{ client_id: string }>(db, 'SELECT client_id FROM bm_home_exercises WHERE id=?', exerciseId))[0]
  insist(assignment, 'exercise_not_found', 404)
  const live = await clinician(db, who, assignment.client_id)
  await commit(db, live.who, [clientAuthority(db, live.who, assignment.client_id),
    stmt(db, 'UPDATE bm_home_exercises SET archived_at=COALESCE(archived_at,?) WHERE id=?', now(), exerciseId),
    audit(db, live.who, 'exercise.archived', assignment.client_id, exerciseId),
  ])
  return { id: exerciseId, clientId: assignment.client_id, archived: true }
}

export async function patientExercises(db: D1Database, patient: Patient) {
  const list = await exercises(db, patient.clientId, false)
  await commit(db, null, [portalGuard(db, patient), audit(db, guardianActor(patient), 'exercise.program_read', patient.clientId),
    ...list.map(e => audit(db, guardianActor(patient), 'exercise.read', patient.clientId, e.id)),
  ])
  // Staff email addresses are not part of the patient view.
  return list.map(({ assignedBy, clientId, ...e }) => e)
}

/** A completion is one session per clinic-local day; repeat posts are idempotent. */
export async function exerciseProgress(db: D1Database, patient: Patient, input: Data, done: boolean) {
  const exerciseId = text(input.id, 'exercise', 100), at = now()
  const zone = (await rows<{ time_zone: string }>(db, 'SELECT time_zone FROM bm_settings WHERE id=1'))[0].time_zone
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date())
  const loggedDay=input.day?day(input.day,'session_day'):today
  insist(loggedDay<=today && loggedDay>=new Date(Date.now()-30*86400_000).toISOString().slice(0,10),'log_a_session_in_the_last_30_days')
  const pain=input.pain===undefined||input.pain===''?null:integer(input.pain,'pain',0,10)
  const available = (await rows(db, 'SELECT id FROM bm_home_exercises WHERE id=? AND client_id=? AND archived_at IS NULL', exerciseId, patient.clientId))[0]
  insist(available, 'exercise_not_found', 404)
  await commit(db, null, [portalGuard(db, patient),
    guard(db, 'EXISTS(SELECT 1 FROM bm_home_exercises WHERE id=? AND client_id=? AND archived_at IS NULL)', exerciseId, patient.clientId),
    stmt(db, `UPDATE bm_home_exercises SET seen_at=COALESCE(seen_at,?)${done ? ',done_at=?' : ''} WHERE id=?`, at, ...(done ? [at] : []), exerciseId),
    ...(done ? [stmt(db, 'INSERT INTO bm_home_exercise_done(exercise_id,day,done_at,pain) VALUES(?,?,?,?) ON CONFLICT(exercise_id,day) DO NOTHING', exerciseId, loggedDay, at,pain)] : []),
    audit(db, guardianActor(patient), done ? 'exercise.done' : 'exercise.seen', patient.clientId, exerciseId),
  ])
  return { id: exerciseId, seen: true, ...(done ? { done: true, day:loggedDay } : {}) }
}


export async function programPdf(db:D1Database,patient:Patient){
 const list=await exercises(db,patient.clientId,false)
 const clinic=(await rows(db,'SELECT clinic_name FROM bm_settings WHERE id=1'))[0]
 const spanish=(await rows(db,'SELECT portal_language FROM bm_clients WHERE id=?',patient.clientId))[0]?.portal_language==='es'
 await commit(db,null,[portalGuard(db,patient),audit(db,guardianActor(patient),'exercise.program_downloaded',patient.clientId)])
 return pdf({header:clinic.clinic_name,title:spanish?'Su programa de ejercicios en casa':'Your home exercise program',blocks:[
  {kind:'facts',rows:[['Patient',patient.firstName+' '+patient.lastName],['Prepared',now().slice(0,10)]]},
  {kind:'notes',lines:['Follow the dosage your clinician assigned. Stop and contact your clinician if symptoms worsen.']},
  ...list.flatMap((e):Block[]=>[{kind:'heading',text:spanish&&e.titleEs?e.titleEs:e.title},...(e.libraryId?.startsWith('balm-cc0-')&&e.image?.startsWith('data:image/svg+xml;base64,')?[{kind:'illustration' as const,svg:atob(e.image.split(',')[1])}]:[]),{kind:'notes',lines:[`${e.sets} sets · ${e.reps} reps · hold ${e.holdSeconds} seconds · ${e.frequency}`,spanish&&e.instructionsEs?e.instructionsEs:e.instructions,...(e.license?[e.license+' · '+e.source]:[])]}]),
 ]})
}
