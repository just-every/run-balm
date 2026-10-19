// Plan of care: goals, frequency and duration from the evaluation, signed by the
// therapist and sent to the referring physician, who certifies it from a private
// link without an account. The link is stored only as its SHA-256 and expires;
// the plan's content is fixed once sent (migrations/core/0017_balm_charting.sql).
import { audit, commit, day, email, guard, human, insist, integer, now, one, practitionerId, rows, sha256, stmt, text, type Actor, type Data } from './model'
import { clientVisible } from './clients'
import { episodeChoice } from '../episodes'

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
  const filing = await episodeChoice(db, who, client.id as string, 'plan', planId, input.episodeId, visit)
  await commit(db, who, [...filing,
    guard(db, 'EXISTS(SELECT 1 FROM bm_appointments WHERE client_id=? AND practitioner_id=?)', client.id, author),
    stmt(db, `INSERT INTO bm_plans_of_care(id,client_id,author_id,note_id,content,content_sha256,therapist_name,therapist_credentials,created_at,physician_name,physician_email,sign_token_hash,sign_token_expires_at,sent_at,status)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,'sent')`, planId, client.id, author, noteId, serialized, await sha256(serialized), staff.name, content.therapist.credentials, at,
    physicianName, physicianEmail, await sha256(link), new Date(Date.now() + LINK_DAYS * 86400_000).toISOString(), at),
    audit(db, who, 'plan.sent', client.id as string, planId),
  ])
  return { id: planId, token: link, physicianName, physicianEmail }
}

/** A fresh link for an unsigned plan; the previous link stops working. */
export async function resendPlan(db: D1Database, who: Actor, input: Data) {
  human(who)
  const plan = await one(db, "SELECT * FROM bm_plans_of_care WHERE id=? AND status='sent'", text(input.id, 'id', 100))
  insist(plan && plan.author_id === practitionerId(who), 'unsigned_plan_not_found', 404)
  const link = token()
  await commit(db, who, [
    stmt(db, "UPDATE bm_plans_of_care SET sign_token_hash=?,sign_token_expires_at=?,sent_at=?,version=version+1 WHERE id=? AND status='sent' AND version=?", await sha256(link), new Date(Date.now() + LINK_DAYS * 86400_000).toISOString(), now(), plan.id, plan.version),
    guard(db, 'EXISTS(SELECT 1 FROM bm_plans_of_care WHERE id=? AND version=?)', plan.id, Number(plan.version) + 1),
    audit(db, who, 'plan.resent', plan.client_id as string, plan.id as string),
  ])
  return { id: plan.id, token: link, physicianName: plan.physician_name, physicianEmail: plan.physician_email }
}

const physician = (plan: Data) => ({ email: plan.physician_email as string, role: 'referring physician' })

async function byToken(db: D1Database, link: string) {
  const plan = await one(db, 'SELECT * FROM bm_plans_of_care WHERE sign_token_hash=?', await sha256(link))
  insist(plan, 'plan_not_found', 404)
  if (plan.status === 'sent') insist(Date.parse(plan.sign_token_expires_at as string) > Date.now(), 'plan_not_found', 404)
  return plan
}

/** What the physician's link shows; every opening is audited on the patient's file. */
export async function planView(db: D1Database, link: string) {
  const plan = await byToken(db, link)
  if (plan.status === 'sent') await commit(db, null, [audit(db, physician(plan), 'plan.opened', plan.client_id as string, plan.id as string)])
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
  await commit(db, null, [
    stmt(db, "UPDATE bm_plans_of_care SET status='certified',certified_at=?,certifier_name=?,certifier_credentials=?,certifier_npi=?,version=version+1 WHERE id=? AND status='sent' AND version=?",
      at, text(input.name, 'name', 160), text(input.credentials, 'credentials', 40), npi || null, plan.id, plan.version),
    guard(db, "EXISTS(SELECT 1 FROM bm_plans_of_care WHERE id=? AND status='certified' AND certified_at=?)", plan.id, at),
    audit(db, physician(plan), 'plan.certified', plan.client_id as string, plan.id as string),
  ])
  return { id: plan.id, certifiedAt: at }
}

/** Plans on a file: content for the owner and the client's practitioners, status and dates for reception. */
export async function plansFor(db: D1Database, who: Actor, clientId: string) {
  const clinical = who.role === 'owner' || !!practitionerId(who)
  return (await rows(db, 'SELECT * FROM bm_plans_of_care WHERE client_id=? ORDER BY created_at DESC', clientId)).map(p => ({
    id: p.id, authorId: p.author_id, status: p.status, sentAt: p.sent_at, createdAt: p.created_at, physicianName: p.physician_name, physicianEmail: p.physician_email,
    certifiedAt: p.certified_at, certifierName: p.certifier_name, certifierCredentials: p.certifier_credentials, certifierNpi: p.certifier_npi,
    therapistName: p.therapist_name, therapistCredentials: p.therapist_credentials, mine: p.author_id === practitionerId(who), linkExpiresAt: p.sign_token_expires_at,
    content: clinical ? JSON.parse(p.content as string) : null, sha256: p.content_sha256,
  }))
}
