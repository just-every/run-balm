import { assistantNote } from './role-access'
import { pendingSubmission, supervisorReadSql } from './supervision'
import { beginDraftRequest, type DraftRequest } from './draft-requests'
// Notes keep immutable revisions, as Willow keeps document versions
// (src/willow/documents.ts, just-every/run-willow @ 5b116db): every save of a
// draft adds a revision and never rewrites the earlier text. A note written from
// a discipline template keeps its sections and CPT minutes per revision; signing
// locks it (src/balm/domain/signing.ts) and later changes are addenda.
import { documentationAlerts, documentationInput, type Documentation } from '../charting/compliance'
import { cpt, type Charge } from '../charting/cpt'
import { parseIcd10 } from '../payments/codes'
import { payerBilling, primaryUnitMethod } from '../insurance/unit-method'
import { template, type Template } from '../charting/templates'
import { audit, commit, guard, human, id, insist, integer, now, one, optional, practitionerId, rows, stmt, text, type Actor, type Data } from './model'
import { clientVisible } from './clients'
import { noteAccess } from './care-team'
import { measuresOf } from './measures'

export type Written = { documentation: Documentation; sections: { id: string; label: string; text: string }[] | null; charges: Charge[]; body: string }

const clean = (value: unknown, field: string, max: number) => {
  if (value === undefined || value === null) return ''
  insist(typeof value === 'string' && value.length <= max && !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value), `invalid_${field}`)
  return value.replace(/\r\n/g, '\n').trim()
}

/** Charges as JSON [{code, minutes}] or the form's charge_code_N / charge_minutes_N rows. */
export function charges(input: Data): Charge[] {
  const raw: Data[] = Array.isArray(input.charges) ? input.charges
    : Array.from({ length: 8 }, (_, n) => ({ code: input[`charge_code_${n}`], minutes: input[`charge_minutes_${n}`], cmsTieChosen: input[`charge_cms_tie_${n}`], diagnosisCodes: input[`charge_diagnoses_${n}`] })).filter(c => c.code)
  insist(raw.length <= 12, 'too_many_cpt_codes')
  const list = raw.map(c => {
    const code = cpt(String(c?.code ?? '').trim())
    insist(code, 'unknown_cpt_code')
    const minutes = c.minutes === undefined || c.minutes === '' ? 0 : integer(c.minutes, 'cpt_minutes', 0, 480)
    if (code.timed) insist(minutes > 0, 'enter_minutes_for_each_timed_code')
    insist([undefined, null, '', false, true, 'on'].includes(c.cmsTieChosen), 'invalid_cms_tie_choice')
    const selected = c.cmsTieChosen === true || c.cmsTieChosen === 'on'
    insist(!selected || code.timed, 'cms_tie_choice_requires_a_timed_code')
    insist(c.diagnosisCodes == null || typeof c.diagnosisCodes === 'string' || Array.isArray(c.diagnosisCodes) && c.diagnosisCodes.every((d: unknown) => typeof d === 'string'), 'invalid_diagnosis_selection')
    const diagnosisCodes = parseIcd10(Array.isArray(c.diagnosisCodes) ? c.diagnosisCodes.join(',') : c.diagnosisCodes)
    insist(diagnosisCodes.length <= 4, 'select_at_most_four_diagnoses_per_cpt_code')
    return { code: code.code, minutes, ...(selected ? { cmsTieChosen: true as const } : {}), ...(diagnosisCodes.length ? { diagnosisCodes } : {}) }
  })
  insist(new Set(list.map(c => c.code)).size === list.length, 'cpt_code_listed_twice')
  return list
}

/** Selected ICD-10 codes are identities, not mutable list positions. */
export async function diagnosisGuards(db: D1Database, appointmentId: unknown, list: Charge[]) {
  const selected = [...new Set(list.flatMap(c => c.diagnosisCodes ?? []))]
  if (!selected.length) return []
  insist(appointmentId, 'select_diagnoses_on_a_visit_note')
  const available = await rows(db, "SELECT code FROM bm_visit_codes WHERE appointment_id=? AND kind='icd10'", appointmentId)
  insist(selected.every(code => available.some(d => d.code === code)), 'selected_diagnosis_missing_from_visit')
  return selected.map(code => guard(db, "EXISTS(SELECT 1 FROM bm_visit_codes WHERE appointment_id=? AND kind='icd10' AND code=?)", appointmentId, code))
}

/** A template's sections from JSON {sections: {id: text}} or the form's section_<id> fields. */
export function written(input: Data, t: Template | undefined): Written {
  const documentation = documentationInput(input)
  const list = charges(input)
  const timed = list.filter(c => cpt(c.code)?.timed).reduce((sum,c) => sum+c.minutes,0)
  insist(documentation.totalTimedMinutes === null || documentation.totalTimedMinutes >= timed, 'total_timed_minutes_must_include_all_timed_interventions')
  insist(documentation.totalTreatmentMinutes === null || documentation.totalTreatmentMinutes >= timed, 'total_treatment_minutes_must_include_all_timed_interventions')
  if (!t) return { documentation, sections: null, charges: charges(input), body: text(input.body, 'note', 20_000) }
  const given = input.sections && typeof input.sections === 'object' ? input.sections : {}
  const sections = t.sections.map(s => ({ id: s.id, label: s.label, text: clean(given[s.id] ?? input['section_' + s.id], s.id, 8000) }))
  return { documentation, sections, charges: charges(input), body: sections.filter(s => s.text).map(s => `${s.label}\n${s.text}`).join('\n\n') }
}

export async function ownAppointment(db: D1Database, who: Actor, clientId: string, appointmentId: unknown) {
  if (!appointmentId) return null
  const appointment = await one(db, 'SELECT a.id,s.note_template FROM bm_appointments a JOIN bm_services s ON s.id=a.service_id WHERE a.id=? AND a.client_id=? AND a.practitioner_id=?', text(appointmentId, 'appointment', 100), clientId, practitionerId(who) ?? '')
  insist(appointment, 'appointment_not_found', 404)
  return appointment
}

/** Starts a note from the visit's template (or the one chosen), as a draft. */
export async function createNote(db: D1Database, who: Actor, input: Data, draftedBy: 'author' | 'scribe' = 'author', scribeNote = '', request: DraftRequest | null = null) {
  human(who)
  const author = practitionerId(who)
  insist(author, 'only_practitioners_write_notes', 403)
  const client = await clientVisible(db, who, input.clientId)
  const appointment = await ownAppointment(db, who, client.id as string, input.appointmentId)
  const key = input.template ? text(input.template, 'template', 40) : input.body === undefined ? appointment?.note_template : ''
  const t = key ? template(key) : undefined
  insist(!key || t, 'unknown_template')
  const starter = appointment ? await one(db, `SELECT n.id FROM bm_notes n WHERE n.appointment_id=? AND n.author_id=? AND n.signed_at IS NULL
    AND (SELECT MAX(number) FROM bm_note_revisions WHERE note_id=n.id)=0`, appointment.id, author) : null
  const content = written(input, t), noteId = (starter?.id as string) ?? id()
  assistantNote(who, t?.key, content.charges)
  const diagnoses = await diagnosisGuards(db, appointment?.id, content.charges)
  await commit(db, who, [
    ...diagnoses,
    // A practitioner writes only for a client they are booked with.
    guard(db, 'EXISTS(SELECT 1 FROM bm_appointments WHERE client_id=? AND practitioner_id=?)', client.id, author),
    ...(starter ? [
      guard(db, 'NOT EXISTS(SELECT 1 FROM bm_note_revisions WHERE note_id=? AND number>0)', noteId),
      stmt(db, 'UPDATE bm_notes SET template=? WHERE id=? AND signed_at IS NULL', t?.key ?? '', noteId),
    ] : [stmt(db, 'INSERT INTO bm_notes(id,client_id,appointment_id,author_id,created_at,template) VALUES(?,?,?,?,?,?)', noteId, client.id, appointment?.id ?? null, author, now(), t?.key ?? '')]),
    stmt(db, 'INSERT INTO bm_note_revisions(note_id,number,body,reason,written_at,sections,charges,drafted_by,documentation) VALUES(?,1,?,?,?,?,?,?,?)', noteId, content.body, draftedBy === 'scribe' ? 'Drafted by the scribe' + (scribeNote ? ': ' + scribeNote : '') : '', now(),
      content.sections && JSON.stringify(content.sections), JSON.stringify(content.charges), draftedBy, JSON.stringify(content.documentation)),
    audit(db, who, draftedBy === 'scribe' ? 'note.scribe_drafted' : 'note.written', client.id as string, noteId, t?.key ?? 'free text'),
    ...(request?.statements({ id: noteId, revision: 1, template: t?.key ?? '' }) ?? []),
  ])
  return { id: noteId, revision: 1, template: t?.key ?? '' }
}

export async function writeNote(db: D1Database, who: Actor, input: Data) {
  human(who)
  insist(practitionerId(who), 'only_practitioners_write_notes', 403)
  const request = await beginDraftRequest(db, who, 'note.write', input)
  if (request?.replay) return request.replay
  try { return await createNote(db, who, input, 'author', '', request) }
  catch (error) { if (request) return request.afterConflict(error); throw error }
}

/** Saves a new revision of the author's unsigned note. */
export async function amendNote(db: D1Database, who: Actor, input: Data) {
  human(who)
  const note = await one(db, 'SELECT * FROM bm_notes WHERE id=?', text(input.id, 'id', 100))
  insist(note && note.author_id === practitionerId(who), 'note_not_found', 404)
  const request = await beginDraftRequest(db, who, 'note.amend', input)
  if (request?.replay) return request.replay
  try {
    insist(!note.signed_at, 'note_signed_add_an_addendum', 409)
    insist(!await pendingSubmission(db,note.id),'note_waiting_for_supervisor',409)
    const latest = (await one<{ n: number }>(db, 'SELECT MAX(number) AS n FROM bm_note_revisions WHERE note_id=?', note.id))!.n
    insist(input.revision === undefined || Number(input.revision) === latest, 'note_changed_reload', 409)
    const content = written(input, template(note.template))
    assistantNote(who, note.template, content.charges)
    const diagnoses = await diagnosisGuards(db, note.appointment_id, content.charges)
    await commit(db, who, [
      ...diagnoses,
      stmt(db, 'INSERT INTO bm_note_revisions(note_id,number,body,reason,written_at,sections,charges,documentation) VALUES(?,?,?,?,?,?,?,?)', note.id, latest + 1, content.body,
        optional(input.reason, 'amendment_reason', 300) ?? '', now(), content.sections && JSON.stringify(content.sections), JSON.stringify(content.charges), JSON.stringify(content.documentation)),
      audit(db, who, 'note.amended', note.client_id as string, note.id as string, `revision ${latest + 1}`),
      ...(request?.statements({ id: note.id as string, revision: latest + 1 }) ?? []),
    ])
    return { id: note.id, revision: latest + 1 }
  } catch (error) { if (request) return request.afterConflict(error); throw error }
}

const parse = (value: unknown) => typeof value === 'string' ? JSON.parse(value) : null

/** Notes this actor may read: the owner, a care-team grant or open break glass read all
 * (CHART-013); otherwise a practitioner reads only their own. */
export async function notesFor(db: D1Database, who: Actor, clientId: string) {
  const author = practitionerId(who)
  if (who.role !== 'owner' && !author) return null
  const access = await noteAccess(db, who, clientId)
  const notes = await rows(db, `SELECT n.*,s.name AS author_name,COALESCE(v.start_at,n.created_at) AS visit_at FROM bm_notes n JOIN bm_staff s ON s.id=n.author_id LEFT JOIN bm_appointments v ON v.id=n.appointment_id WHERE n.client_id=? AND (?=1 OR n.author_id=? OR ${supervisorReadSql('n')}) ORDER BY n.created_at DESC`, clientId, access.all ? 1 : 0, author ?? '', author ?? '')
  if (!notes.length) return []
  const marks = notes.map(() => '?').join(',')
  const revisions = await rows(db, `SELECT * FROM bm_note_revisions WHERE note_id IN (${marks}) ORDER BY number DESC`, ...notes.map(n => n.id))
  const addenda = await rows(db, `SELECT * FROM bm_note_addenda WHERE note_id IN (${marks}) ORDER BY written_at`, ...notes.map(n => n.id))
  const measures = await measuresOf(db, notes.map(n => n.id as string))
  return Promise.all(notes.map(async n => {
    const reviewOnly = !access.all && n.author_id !== author
    const submitted = reviewOnly ? await rows(db,`SELECT s.revision FROM bm_note_submissions s LEFT JOIN bm_note_reviews r ON r.submission_id=s.id WHERE s.note_id=? AND s.supervisor_id=? AND (r.decision IS NULL OR r.decision='cosigned')`,n.id,author ?? '') : []
    const own = revisions.filter(r => r.note_id === n.id && (!reviewOnly || submitted.some(s=>s.revision===r.number))).map(r => ({ number: r.number, body: r.body, reason: r.reason, writtenAt: r.written_at, draftedBy: r.drafted_by, documentation: parse(r.documentation) ?? documentationInput({}), sections: parse(r.sections), charges: parse(r.charges) ?? [] }))
    const basis = await primaryUnitMethod(db, clientId, n.visit_at as string)
    const submissions = await rows(db,`SELECT s.*,r.decision,r.reason,r.supervision_given FROM bm_note_submissions s LEFT JOIN bm_note_reviews r ON r.submission_id=s.id WHERE s.note_id=? AND (? OR s.supervisor_id=?) ORDER BY s.submitted_at DESC`,n.id,reviewOnly?0:1,author ?? '')
    const pending = submissions.find(s=>!s.decision)
    return { supervisorRead:reviewOnly, submissions, pending, canCosign: !!pending && pending.supervisor_id===author, id: n.id, appointmentId: n.appointment_id, authorId: n.author_id, authorName: n.author_name, createdAt: n.created_at, visitAt: n.visit_at, mine: n.author_id === author,
      template: n.template, title: template(n.template)?.title ?? 'Treatment note', status: n.signed_at ? 'signed' : 'draft',
      signature: n.signed_at ? { name: n.signer_name, credentials: n.signer_credentials, signedAt: n.signed_at, revision: n.signed_revision, sha256: n.signed_sha256 } : null,
      documentationAlerts: !n.signed_at && n.appointment_id ? await documentationAlerts(db, n.appointment_id, revisions.find(r => r.note_id === n.id), n.template) : [],
      defensibility: parse((await one(db, 'SELECT result FROM bm_note_checks WHERE note_id=? AND (? OR revision=?) ORDER BY checked_at DESC,id DESC LIMIT 1', n.id,reviewOnly?0:1,own[0]?.number ?? -1))?.result),
      billing: { ...payerBilling(own[0]?.charges ?? [], basis.method, basis.fixedUnitMinutes), ...basis }, revisions: own, measures: measures.filter(m => m.note_id === n.id),
      addenda: addenda.filter(a => a.note_id === n.id && !reviewOnly).map(a => ({ id: a.id, body: a.body, writtenAt: a.written_at, name: a.signer_name, credentials: a.signer_credentials })) }
  }))
}
