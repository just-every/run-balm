// Plan of care: goals, frequency and duration from the evaluation, signed by the
// therapist and sent to the referring physician, who certifies it from a private
// link without an account. The link is stored only as its SHA-256 and expires;
// the plan's content is fixed once sent (migrations/core/0017_balm_charting.sql).
import { audit, commit, day, email, guard, human, insist, integer, now, one, practitionerId, rows, sha256, stmt, text, type Actor, type Data } from './model'
import { clientVisible } from './clients'
import { hostDateAt } from '../availability/timezone'
import { episodeChoice, episodeIndex } from '../episodes'
import { documentReader, documentScope } from '../chart-history/documents'
import { attachment } from '../messages/attachments'

const currentPlan = 'NOT EXISTS(SELECT 1 FROM bm_plan_replacements WHERE predecessor_id=p.id)'
const authorFence = (db: D1Database, who: Actor) => guard(db, "EXISTS(SELECT 1 FROM bm_staff WHERE id=? AND role='practitioner' AND active=1 AND erased_at IS NULL AND version=?)", practitionerId(who) ?? '', who.staffVersion ?? -1)
const alive = (db: D1Database, clientId: string) => guard(db, 'EXISTS(SELECT 1 FROM bm_clients WHERE id=? AND erased_at IS NULL)', clientId)
const sendRecord = (db: D1Database, planId: string, clientId: string, name: string, address: string, at: string, by: string) =>
  stmt(db, "INSERT INTO bm_plan_sends(id,plan_id,client_id,channel,recipient_name,recipient_address,sent_at,sent_by) VALUES(?,?,?,'link',?,?,?,?)", crypto.randomUUID(), planId, clientId, name, address, at, by)
const LINK_DAYS = 30
const addDays = (date: string, days: number) => new Date(Date.parse(date + 'T00:00:00Z') + days * 86400_000).toISOString().slice(0, 10)
const token = () => btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(32)))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
const same = (a: string, b: string) => a.trim().replace(/\s+/g, ' ').toLowerCase() === b.trim().replace(/\s+/g, ' ').toLowerCase()

/** Medicare certifies a plan for its duration, at most 90 days from the start of care. */
export const certifiedThrough = (startDate: string, durationWeeks: number) => addDays(startDate, Math.min(durationWeeks * 7, 90) - 1)

export async function sendPlan(db: D1Database, who: Actor, input: Data) {
  human(who)
  const author = practitionerId(who)
  insist(author, 'only_practitioners_write_plans_of_care', 403)
  const client = await clientVisible(db, who, input.clientId)
  const predecessorId = input.predecessorId ? text(input.predecessorId, 'predecessor', 100) : null
  const predecessor = predecessorId ? await one(db, `SELECT p.* FROM bm_plans_of_care p WHERE p.id=? AND p.client_id=? AND p.author_id=? AND ${currentPlan}`, predecessorId, client.id, author) : null
  if (predecessorId) insist(predecessor && input.predecessorSha256 === predecessor.content_sha256, 'current_plan_changed_review_again', 409)
  const index = await episodeIndex(db, client.id as string)
  const priorEpisode = predecessor ? index.of('plan', predecessor.id) : ''
  if (predecessor) insist(input.episodeId === (priorEpisode || 'none'), 'replacement_episode_must_match', 409)
  const staff = (await one(db, 'SELECT name,credentials FROM bm_staff WHERE id=?', author))!
  const clinic = (await one(db, 'SELECT clinic_name,address FROM bm_settings WHERE id=1'))!
  insist(input.attest === true || input.attest === 'on', 'confirm_you_reviewed_this_plan')
  insist(same(text(input.signature, 'signature', 160), staff.name as string), 'type_your_full_name_as_it_appears_on_your_staff_record')
  const credentials = String(input.credentials || staff.credentials || '').trim()
  insist(credentials, 'enter_your_credentials_to_sign')
  const noteId = input.noteId ? text(input.noteId, 'note', 100) : null
  if (noteId) insist(await one(db, 'SELECT 1 FROM bm_notes WHERE id=? AND client_id=? AND author_id=?', noteId, client.id, author), 'note_not_found', 404)
  const startDate = day(input.startDate, 'start_date'), durationWeeks = integer(input.durationWeeks, 'duration_weeks', 1, 52)
  const content = {
    clinic: { name: clinic.clinic_name, address: clinic.address }, patient: { name: `${client.first_name} ${client.last_name}`, dateOfBirth: client.date_of_birth },
    diagnoses: text(input.diagnoses, 'diagnoses', 2000), shortTermGoals: text(input.shortTermGoals, 'short_term_goals', 4000), longTermGoals: text(input.longTermGoals, 'long_term_goals', 4000),
    frequencyPerWeek: integer(input.frequencyPerWeek, 'frequency_per_week', 1, 7), durationWeeks, interventions: text(input.interventions, 'interventions', 2000),
    startDate, certifiedThrough: certifiedThrough(startDate, durationWeeks), therapist: { name: staff.name, credentials: text(credentials, 'credentials', 60) },
  }
  const physicianName = text(input.physicianName, 'physician_name', 160), physicianEmail = email(input.physicianEmail, 'physician_email')
  const link = token(), at = now(), planId = crypto.randomUUID(), serialized = JSON.stringify(content)
  // REF-003: a plan written from a visit's note joins that visit's open episode unless another is chosen.
  const visit = noteId ? (await one(db, "SELECT r.episode_id FROM bm_notes n JOIN bm_episode_records r ON r.record_kind='visit' AND r.record_id=n.appointment_id WHERE n.id=?", noteId))?.episode_id as string | undefined : undefined
  const filing = predecessor && !priorEpisode ? [] : await episodeChoice(db, who, client.id as string, 'plan', planId, predecessor ? priorEpisode : input.episodeId, visit)
  await commit(db, who, [authorFence(db, who), alive(db, client.id as string), ...filing,
    ...(predecessor ? [guard(db, `EXISTS(SELECT 1 FROM bm_plans_of_care p WHERE p.id=? AND p.version=? AND ${currentPlan})`, predecessor.id, predecessor.version),
      guard(db, "COALESCE((SELECT episode_id FROM bm_episode_records WHERE record_kind='plan' AND record_id=?),'')=?", predecessor.id, priorEpisode)] : []),
    guard(db, 'EXISTS(SELECT 1 FROM bm_appointments WHERE client_id=? AND practitioner_id=?)', client.id, author),
    stmt(db, `INSERT INTO bm_plans_of_care(id,client_id,author_id,note_id,content,content_sha256,therapist_name,therapist_credentials,created_at,physician_name,physician_email,sign_token_hash,sign_token_expires_at,sent_at,status)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,'sent')`, planId, client.id, author, noteId, serialized, await sha256(serialized), staff.name, content.therapist.credentials, at,
    physicianName, physicianEmail, await sha256(link), new Date(Date.now() + LINK_DAYS * 86400_000).toISOString(), at),
    ...(predecessor && !priorEpisode ? [stmt(db, "DELETE FROM bm_episode_records WHERE record_kind='plan' AND record_id=?", planId)] : []),
    ...(predecessor ? [stmt(db, 'INSERT INTO bm_plan_replacements(predecessor_id,successor_id,client_id,episode_id,replaced_at,replaced_by) VALUES(?,?,?,?,?,?)', predecessor.id, planId, client.id, priorEpisode || null, at, who.email), audit(db, who, 'plan.replaced', client.id as string, predecessor.id, planId)] : []),
    sendRecord(db, planId, client.id as string, physicianName, physicianEmail, at, who.email),
    audit(db, who, 'plan.sent', client.id as string, planId),
  ])
  return { id: planId, token: link, physicianName, physicianEmail }
}

/** A fresh link for an unsigned plan; the previous link stops working. */
export async function resendPlan(db: D1Database, who: Actor, input: Data) {
  human(who)
  const plan = await one(db, `SELECT p.* FROM bm_plans_of_care p WHERE p.id=? AND p.status='sent' AND ${currentPlan}`, text(input.id, 'id', 100))
  insist(plan && plan.author_id === practitionerId(who), 'unsigned_plan_not_found', 404)
  const link = token()
  const at = now()
  await commit(db, who, [authorFence(db, who), alive(db, plan.client_id), documentScope(db, who, plan.client_id),
    guard(db, `EXISTS(SELECT 1 FROM bm_plans_of_care p WHERE p.id=? AND ${currentPlan})`, plan.id),
    stmt(db, "UPDATE bm_plans_of_care SET sign_token_hash=?,sign_token_expires_at=?,sent_at=?,version=version+1 WHERE id=? AND status='sent' AND version=?", await sha256(link), new Date(Date.now() + LINK_DAYS * 86400_000).toISOString(), at, plan.id, plan.version),
    guard(db, 'changes()=1'),
    sendRecord(db, plan.id, plan.client_id, plan.physician_name, plan.physician_email, at, who.email),
    audit(db, who, 'plan.resent', plan.client_id as string, plan.id as string),
  ])
  return { id: plan.id, token: link, physicianName: plan.physician_name, physicianEmail: plan.physician_email }
}

const physician = (plan: Data) => ({ email: plan.physician_email as string, role: 'referring physician' })

async function byToken(db: D1Database, link: string) {
  const plan = await one(db, `SELECT p.* FROM bm_plans_of_care p JOIN bm_clients c ON c.id=p.client_id WHERE p.sign_token_hash=? AND c.erased_at IS NULL AND ${currentPlan}`, await sha256(link))
  insist(plan, 'plan_not_found', 404)
  if (plan.status === 'sent') insist(Date.parse(plan.sign_token_expires_at as string) > Date.now(), 'plan_not_found', 404)
  return plan
}

/** What the physician's link shows; every opening is audited on the patient's file. */
export async function planView(db: D1Database, link: string) {
  const plan = await byToken(db, link)
  if (plan.status === 'sent') await commit(db, null, [alive(db, plan.client_id), guard(db, `EXISTS(SELECT 1 FROM bm_plans_of_care p WHERE p.id=? AND ${currentPlan})`, plan.id), audit(db, physician(plan), 'plan.opened', plan.client_id as string, plan.id as string)])
  const zone = (await one(db, 'SELECT time_zone FROM bm_settings WHERE id=1'))!.time_zone
  return { timeZone: zone, status: plan.status, physicianName: plan.physician_name, certifiedAt: plan.certified_at, certifierName: plan.certifier_name, content: plan.status === 'sent' ? JSON.parse(plan.content as string) : null }
}

export async function certifyPlan(db: D1Database, link: string, input: Data) {
  const plan = await byToken(db, link)
  insist(plan.status === 'sent', 'plan_already_signed', 409)
  insist(input.attest === 'on' || input.attest === true, 'confirm_the_certification')
  const npi = String(input.npi ?? '').trim()
  insist(!npi || /^\d{10}$/.test(npi), 'npi_is_10_digits')
  const at = now()
  await commit(db, null, [alive(db, plan.client_id),
    guard(db, `EXISTS(SELECT 1 FROM bm_plans_of_care p WHERE p.id=? AND p.sign_token_hash=? AND p.sign_token_expires_at>? AND ${currentPlan})`, plan.id, await sha256(link), at),
    stmt(db, "UPDATE bm_plans_of_care SET status='certified',certified_at=?,certifier_name=?,certifier_credentials=?,certifier_npi=?,version=version+1 WHERE id=? AND status='sent' AND version=?",
      at, text(input.name, 'name', 160), text(input.credentials, 'credentials', 40), npi || null, plan.id, plan.version),
    guard(db, 'changes()=1'),
    audit(db, physician(plan), 'plan.certified', plan.client_id as string, plan.id as string),
  ])
  return { id: plan.id, certifiedAt: at }
}

/** Plans on a file: content for the owner and the client's practitioners, status and dates for reception. */
export async function plansFor(db: D1Database, who: Actor, clientId: string) {
  const clinical = who.role === 'owner' || !!practitionerId(who)
  const sends = await rows(db, 'SELECT * FROM bm_plan_sends WHERE client_id=? ORDER BY sent_at,id', clientId)
  return (await rows(db, `SELECT p.*,r.successor_id,prior.predecessor_id,f.document_id,f.signature_date,f.certification_date,f.filed_at,f.filed_by
    FROM bm_plans_of_care p LEFT JOIN bm_plan_replacements r ON r.predecessor_id=p.id LEFT JOIN bm_plan_replacements prior ON prior.successor_id=p.id
    LEFT JOIN bm_plan_certifications f ON f.plan_id=p.id WHERE p.client_id=? ORDER BY p.created_at DESC,p.id`, clientId)).map(p => ({
    predecessorId: p.predecessor_id, supersededBy: p.successor_id, sends: sends.filter(s => s.plan_id === p.id),
    certification: clinical && p.document_id ? { documentId:p.document_id, signatureDate:p.signature_date, certificationDate:p.certification_date, filedAt:p.filed_at, filedBy:p.filed_by } : null,
    id: p.id, noteId: p.note_id, authorId: p.author_id, status: p.status, sentAt: p.sent_at, createdAt: p.created_at, physicianName: p.physician_name, physicianEmail: p.physician_email,
    certifiedAt: p.certified_at, certifierName: p.certifier_name, certifierCredentials: p.certifier_credentials, certifierNpi: p.certifier_npi,
    therapistName: p.therapist_name, therapistCredentials: p.therapist_credentials, mine: p.author_id === practitionerId(who), linkExpiresAt: p.sign_token_expires_at,
    content: clinical ? JSON.parse(p.content as string) : null, sha256: p.content_sha256,
  }))
}

/** A clinician explicitly matches a returned original to its patient, version and episode. */
export async function filePlanCertification(db: D1Database, who: Actor, input: Data) {
  human(who)
  insist(practitionerId(who), 'only_practitioners_file_certification', 403)
  const client = await clientVisible(db, who, input.clientId)
  await documentReader(db, who, client.id)
  const plan = await one(db, 'SELECT * FROM bm_plans_of_care WHERE id=? AND client_id=?', text(input.id, 'plan', 100), client.id)
  insist(plan, 'plan_not_found', 404)
  insist(plan.status === 'sent', 'plan_already_signed', 409)
  insist(input.planSha256 === plan.content_sha256, 'plan_changed_review_again', 409)
  const index = await episodeIndex(db, client.id), episodeId = index.of('plan', plan.id)
  insist(input.episodeId === (episodeId || 'none'), 'certification_episode_must_match', 409)
  insist(input.attest === true || input.attest === 'on', 'confirm_the_copy_matches_patient_plan_and_episode')
  const upload = await attachment(input)
  insist(upload, 'choose_a_signed_scan')
  const name = text(input.name, 'signer_name', 160), credentials = text(input.credentials, 'signer_credentials', 40)
  const npi = String(input.npi ?? '').trim()
  insist(!npi || /^\d{10}$/.test(npi), 'npi_is_10_digits')
  const signatureDate = day(input.signatureDate, 'written_signature_date'), certificationDate = day(input.certificationDate, 'certification_date'), at = now()
  const zone = (await one(db, 'SELECT time_zone FROM bm_settings WHERE id=1'))!.time_zone as string
  const today = hostDateAt(new Date(), zone)
  insist(signatureDate <= certificationDate && certificationDate <= today, 'certification_dates_out_of_order')
  await commit(db, who, [authorFence(db, who), alive(db, client.id), documentScope(db, who, client.id),
    guard(db, "COALESCE((SELECT episode_id FROM bm_episode_records WHERE record_kind='plan' AND record_id=?),'')=?", plan.id, episodeId),
    stmt(db, "UPDATE bm_plans_of_care SET status='certified',certified_at=?,certifier_name=?,certifier_credentials=?,certifier_npi=?,version=version+1 WHERE id=? AND status='sent' AND version=?", at, name, credentials, npi || null, plan.id, plan.version),
    guard(db, 'changes()=1'),
    stmt(db, `INSERT INTO bm_chart_documents(id,client_id,title,document_type,document_date,search_text,filename,mime,byte_length,content_base64,sha256,created_at,created_by)
      VALUES(?,?,'Signed plan of care','signed_plan',?,?,?,?,?,?,?,?,?)`, upload.id, client.id, signatureDate,
      `Signed plan of care. Plan version ${plan.id}. ${name}, ${credentials}${npi ? ', NPI ' + npi : ''}. Written signature ${signatureDate}. Certification ${certificationDate}.`, upload.filename, upload.mime, upload.byteLength, upload.content, upload.digest, at, who.email),
    stmt(db, "DELETE FROM bm_episode_records WHERE record_kind='document' AND record_id=?", upload.id),
    stmt(db, 'INSERT INTO bm_plan_certifications(plan_id,document_id,client_id,episode_id,signature_date,certification_date,filed_at,filed_by) VALUES(?,?,?,?,?,?,?,?)', plan.id, upload.id, client.id, episodeId || null, signatureDate, certificationDate, at, who.email),
    ...(episodeId ? [stmt(db, "INSERT INTO bm_episode_records(record_kind,record_id,client_id,episode_id,assigned_at,assigned_by) VALUES('document',?,?,?,?,?)", upload.id, client.id, episodeId, at, who.email)] : []),
    audit(db, who, 'plan.scan_certified', client.id, plan.id, upload.id), audit(db, who, 'chart.document_uploaded', client.id, upload.id),
  ])
  return { id:plan.id, documentId:upload.id, signatureDate, certificationDate, filedAt:at, filedBy:who.email }
}
