// Answers bind to the exact immutable form version they answered, as Pencil
// binds a response to its flow revision (src/core/features/responses/service.ts,
// just-every/run-pencil @ 5469766). A token is a one-use bearer link.
import { chosenFormSql,prepareInstruments,outcomeQuestions,outcomeScores } from '../intake/outcomes'
import { approvalStatements } from './approvals'
import { intakeRecordStatements, type IntakeMetadata } from '../intake/records'
import { intakePayers } from '../intake/coverage'
import { pendingPolicies } from '../intake/policies'
import { audit, commit, guard, human, id, insist, need, now, one, practitionerId, rows, sha256, stmt, text, type Actor, type Data } from './model'

export type Question = { id: string; label: string; type: 'short' | 'long' | 'yes' | 'date' | 'number'; required: boolean; min?:number; max?:number }

export function questions(value: unknown): Question[] {
  let list = value
  if (typeof list === 'string') { try { list = JSON.parse(list) } catch { insist(false, 'invalid_questions') } }
  insist(Array.isArray(list) && list.length >= 1 && list.length <= 40, 'invalid_questions')
  const seen = new Set<string>()
  return list.map((q: Data) => {
    const key = text(q?.id, 'question_id', 40)
    insist(/^[a-z][a-z0-9_]*$/.test(key) && !seen.has(key), 'invalid_question_id'); seen.add(key)
    insist(['short', 'long', 'yes', 'date'].includes(q.type), 'invalid_question_type')
    return { id: key, label: text(q.label, 'question_label', 300), type: q.type, required: q.required === true }
  })
}
export async function currentForm(db: D1Database, serviceId?:unknown) {
  const form = (await one(db, serviceId ? 'SELECT * FROM bm_intake_forms WHERE id='+chosenFormSql('?') : "SELECT * FROM bm_intake_forms WHERE service_id IS NULL AND discipline='' ORDER BY number DESC LIMIT 1", ...(serviceId?[serviceId]:[])))!
  return { ...form, instruments:JSON.parse(form.instruments as string), questions: JSON.parse(form.questions as string) as Question[] } as Data & { questions: Question[] }
}

async function byToken(db: D1Database, token: unknown) {
  insist(typeof token === 'string' && /^[A-Za-z0-9_-]{20,64}$/.test(token), 'intake_link_not_found', 404)
  const row = await one(db, `SELECT a.*,c.first_name,s.name AS service_name,p.name AS practitioner_name,st.time_zone,st.clinic_name
    FROM bm_appointments a JOIN bm_clients c ON c.id=a.client_id JOIN bm_services s ON s.id=a.service_id JOIN bm_staff p ON p.id=a.practitioner_id, bm_settings st
    WHERE a.intake_token_hash=?`, await sha256(token))
  insist(row && row.status === 'booked' && Date.parse(row.end_at as string) > Date.now(), 'intake_link_not_found', 404)
  return row
}
/** Public: what the link holder sees. Clinical answers are never echoed back. */
export async function intakeView(db: D1Database, token: unknown) {
  const appointment = await byToken(db, token)
  const submitted = await one(db, 'SELECT submitted_at FROM bm_intake_responses WHERE appointment_id=?', appointment.id)
  return { appointment, submittedAt: submitted?.submitted_at ?? null, form: submitted ? null : await currentForm(db,appointment.service_id), policies: await pendingPolicies(db, appointment.client_id), insurance: await intakePayers(db) }
}

export async function submitIntake(db: D1Database, token: unknown, input: Data, metadata: IntakeMetadata = {}) {
  const appointment = await byToken(db, token)
  insist(!await one(db, 'SELECT 1 FROM bm_intake_responses WHERE appointment_id=?', appointment.id), 'intake_already_received', 409)
  const form = await currentForm(db,appointment.service_id)
  insist(input.formId === form.id, 'intake_form_changed_reload', 409)
  const answers: Record<string, string | boolean> = {}
  for (const q of form.questions) {
    const raw = input['q_' + q.id]
    if (q.type === 'yes') {
      const yes = raw === true || raw === 'yes' || raw === 'on'
      insist(yes || !q.required, `answer_required_${q.id}`)
      answers[q.id] = yes
      continue
    }
    const value = typeof raw === 'string' ? raw.trim() : ''
    insist(value || !q.required, `answer_required_${q.id}`)
    insist(value.length <= (q.type === 'long' ? 5000 : 300), `answer_too_long_${q.id}`)
    if (q.type === 'date' && value) insist(/^\d{4}-\d\d-\d\d$/.test(value), `invalid_date_${q.id}`)
    if (q.type==='number' && value) insist(/^\d{1,2}$/.test(value) && Number(value)>=q.min! && Number(value)<=q.max!,`outcome_answer_out_of_range_${q.id}`)
    if (value) answers[q.id] = value
  }
  const scores=outcomeScores(form.instruments,answers)
  const responseId = id(), at = now()
  const records = await intakeRecordStatements(db, appointment, form, answers, responseId, input, metadata, at)
  await commit(db, null, [
    guard(db, "NOT EXISTS(SELECT 1 FROM bm_intake_responses WHERE appointment_id=?) AND EXISTS(SELECT 1 FROM bm_appointments WHERE id=? AND status='booked' AND end_at>?)", appointment.id, appointment.id, at),
    guard(db, 'EXISTS(SELECT 1 FROM bm_appointments a WHERE a.id=? AND '+chosenFormSql('a.service_id')+'=?)', appointment.id,form.id),
    stmt(db, 'INSERT INTO bm_intake_responses(id,appointment_id,client_id,form_id,answers,submitted_at,scores) VALUES(?,?,?,?,?,?,?)', responseId, appointment.id, appointment.client_id, form.id, JSON.stringify(answers), at,JSON.stringify(scores)),
    ...records,
    audit(db, { email: 'intake link holder', role: 'client' }, 'intake.submitted', appointment.client_id as string, responseId, `form v${form.number}`),
  ])
  return { id: responseId }
}

/** Clinicians read a client's intake answers: the owner, or a practitioner who sees this client. */
export async function intakeFor(db: D1Database, who: Actor, clientId: string) {
  if (who.role !== 'owner' && !practitionerId(who)) return null
  const list = await rows(db, `SELECT r.*,f.number AS form_number,f.title AS form_title,f.questions,a.start_at,a.practitioner_id FROM bm_intake_responses r
    JOIN bm_intake_forms f ON f.id=r.form_id JOIN bm_appointments a ON a.id=r.appointment_id WHERE r.client_id=? ORDER BY r.submitted_at DESC`, clientId)
  return list.map(r => ({ id: r.id, appointmentId: r.appointment_id, submittedAt: r.submitted_at, formNumber: r.form_number, formTitle: r.form_title, startAt: r.start_at, questions: JSON.parse(r.questions), answers: JSON.parse(r.answers), scores:JSON.parse(r.scores) }))
}

export async function prepareForm(db: D1Database, who: Actor, input: Data) {
  need(who, 'owner', 'agent')
  const serviceId=input.serviceId?text(input.serviceId,'packet_service',100):null,discipline=input.discipline?text(input.discipline,'packet_discipline',20):''
  insist(['','pt','ot','slp','pediatric'].includes(discipline),'invalid_packet_discipline')
  if(serviceId)insist(await one(db,'SELECT 1 FROM bm_services WHERE id=? AND active=1',serviceId),'service_not_found',404)
  const instruments=await Promise.all(prepareInstruments(input.instruments).map(async item=>({...item,instrumentVersion:await sha256(JSON.stringify([item.kind,item.items]))})))
  const payload = { title: text(input.title, 'title', 120),serviceId,discipline,instruments, questions: [...questions(input.questions),...outcomeQuestions(instruments)] }
  insist(new Set(payload.questions.map(q=>q.id)).size===payload.questions.length,'duplicate_question_id')
  const draftId = id()
  await commit(db, who, [
    stmt(db, "INSERT INTO bm_drafts(id,type,status,payload,basis,prepared_by,prepared_role,prepared_at) VALUES(?,'intake','draft',?,?,?,?,?)", draftId, JSON.stringify(payload), String((await currentForm(db)).number), who.email, who.role, now()),
    audit(db, who, 'intake.prepared', null, draftId),
  ])
  return { id: draftId, ...payload }
}
export async function publishForm(db: D1Database, who: Actor, input: Data) {
  need(who, 'owner'); human(who)
  const draft = await one(db, "SELECT * FROM bm_drafts WHERE id=? AND type='intake'", text(input.id, 'id', 100))
  insist(draft, 'draft_not_found', 404)
  insist(draft.status === 'draft', 'already_decided', 409)
  const current = (await one(db,'SELECT MAX(number) AS number FROM bm_intake_forms'))!, payload = JSON.parse(draft.payload as string), formId = id()
  await commit(db, who, [
    stmt(db, 'INSERT INTO bm_intake_forms(id,number,title,questions,published_at,published_by,service_id,discipline,instruments) VALUES(?,?,?,?,?,?,?,?,?)', formId, Number(current.number) + 1, payload.title, JSON.stringify(payload.questions), now(), who.email,payload.serviceId??null,payload.discipline??'',JSON.stringify(payload.instruments??[])),
    ...await approvalStatements(db, who, 'intake', draft, draft.payload as string),
    audit(db, who, 'intake.published', null, formId, `v${Number(current.number) + 1} from ${draft.prepared_role}`),
  ])
  return { id: formId, number: Number(current.number) + 1 }
}

export async function preparePacket(db:D1Database,who:Actor,input:Data){
 need(who,'owner');human(who)
 const base=await one(db,'SELECT questions FROM bm_intake_forms WHERE id=?',text(input.baseFormId,'base_form',100));insist(base,'form_not_found',404)
 const instruments=Object.keys({lefs:1,oswestry:1,ndi:1,quickdash:1,psfs:1}).filter(kind=>typeof input['items_'+kind]==='string'&&input['items_'+kind].trim()).map(kind=>({kind,items:input['items_'+kind].split(/\r?\n/).map((label:string)=>label.trim()).filter(Boolean)}))
 const baseQuestions=JSON.parse(base.questions).filter((q:Question)=>!q.id.startsWith('out_'))
 return prepareForm(db,who,{...input,questions:baseQuestions,instruments})
}
