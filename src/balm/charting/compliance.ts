import { bill } from './cpt'
import { parseDollars } from '../payments/ledger'
import { hostDateAt } from '../availability/timezone'
import { medicareSpending } from '../insurance/medicare'
import { audit, commit, guard, human, insist, integer, need, one, practitionerId, rows, stmt, text, type Actor, type Data } from '../domain/model'
import { template } from './templates'
import { dollars } from '../domain/invoices'

export const documentationElements = { totalTreatmentMinutes: 'Total treatment minutes', totalTimedMinutes: 'Total timed minutes', subjective: 'Subjective', objective: 'Objective measures and interventions', assessment: 'Assessment', goals: 'Goals', plan: 'Plan' }
export type Documentation = { totalTreatmentMinutes: number | null; totalTimedMinutes: number | null; assistantInvolved: boolean; supervisorId: string | null }
export type DocumentationAlert = { kind: string; message: string; blocking?: boolean }
export function documentationInput(input: Data): Documentation {
  const minutes = (key: string) => input[key] === undefined || input[key] === '' || input[key] === null ? null : integer(input[key], key, 0, 1440)
  const totalTreatmentMinutes = minutes('totalTreatmentMinutes'), totalTimedMinutes = minutes('totalTimedMinutes')
  insist(totalTreatmentMinutes === null || totalTimedMinutes === null || totalTreatmentMinutes >= totalTimedMinutes, 'treatment_minutes_cannot_be_less_than_timed_minutes')
  return { totalTreatmentMinutes, totalTimedMinutes, assistantInvolved: input.assistantInvolved === true || input.assistantInvolved === 'on', supervisorId: input.supervisorId ? text(input.supervisorId, 'supervisor', 100) : null }
}
export async function saveDocumentationSettings(db: D1Database, who: Actor, input: Data) {
  need(who, 'owner'); human(who)
  const lateDays = integer(input.lateDays, 'plan_signature_days', 1, 90), kxNearCents = input.kxNearCents === undefined ? parseDollars(input.kxNear, 'kx_warning') : integer(input.kxNearCents, 'kx_warning_cents', 0, 1_000_000)
  await commit(db, who, [stmt(db, 'UPDATE bm_documentation_settings SET late_days=?,kx_near_cents=?,version=version+1 WHERE id=1', lateDays, kxNearCents), audit(db, who, 'documentation.settings_saved', null)])
  return { saved: true }
}
export async function savePayerDocumentation(db: D1Database, who: Actor, input: Data) {
  need(who, 'owner'); human(who)
  const payerId = text(input.payerId, 'payer', 100)
  insist(await one(db, 'SELECT 1 FROM bm_payers WHERE id=?', payerId), 'payer_not_found', 404)
  const required = Object.keys(documentationElements).filter(key => Array.isArray(input.required) ? input.required.includes(key) : input['require_' + key] === 'on')
  await commit(db, who, [stmt(db, 'INSERT INTO bm_payer_documentation(payer_id,required,version) VALUES(?,?,1) ON CONFLICT(payer_id) DO UPDATE SET required=excluded.required,version=bm_payer_documentation.version+1', payerId, JSON.stringify(required)), audit(db, who, 'documentation.payer_requirements_saved', null, payerId)])
  return { saved: true }
}
export async function documentationSettings(db: D1Database) {
  return { settings: await one(db, 'SELECT * FROM bm_documentation_settings WHERE id=1'), payers: await rows(db, "SELECT p.id,p.name,COALESCE(d.required,'[]') AS required FROM bm_payers p LEFT JOIN bm_payer_documentation d ON d.payer_id=p.id ORDER BY p.name") }
}

/** A clinician sees these facts before signing. No note text enters the daily close. */
export async function documentationAlerts(db: D1Database, visitId: string, revision?: Data, noteTemplate?: unknown): Promise<DocumentationAlert[]> {
  const visit = await one(db, 'SELECT a.*,p.profession,s.time_zone FROM bm_appointments a JOIN bm_staff p ON p.id=a.practitioner_id JOIN bm_settings s ON s.id=1 WHERE a.id=?', visitId)
  if (!visit || visit.status === 'cancelled' || visit.status === 'no_show') return []
  const date = hostDateAt(new Date(visit.start_at), visit.time_zone), config = (await one(db, 'SELECT * FROM bm_documentation_settings WHERE id=1'))!
  const policies = await rows(db, `SELECT y.id,y.name,y.medicare,COALESCE(d.required,'[]') AS required FROM bm_policies p JOIN bm_payers y ON y.id=p.payer_id LEFT JOIN bm_payer_documentation d ON d.payer_id=y.id WHERE p.client_id=? AND p.starts_on<=? AND (p.ends_on IS NULL OR p.ends_on>=?)`, visit.client_id, date, date)
  const alerts: DocumentationAlert[] = []
  const plan = await one(db, 'SELECT * FROM bm_plans_of_care WHERE client_id=? AND author_id=? AND json_extract(content,\'$.startDate\')<=? ORDER BY json_extract(content,\'$.startDate\') DESC,created_at DESC LIMIT 1', visit.client_id, visit.practitioner_id, date)
  if (!plan) alerts.push({ kind: 'plan', message: 'No certified plan of care covers this visit.' })
  else {
    const content = JSON.parse(plan.content)
    if (content.certifiedThrough < date) alerts.push({ kind: 'plan', message: `Plan of care expired on ${content.certifiedThrough}; recertification is needed.` })
    if (plan.status !== 'certified') {
      const treatments = await rows(db, "SELECT start_at FROM bm_appointments WHERE client_id=? AND practitioner_id=? AND status='attended' AND start_at<=? ORDER BY start_at", visit.client_id, visit.practitioner_id, visit.start_at)
      const start = treatments.map(a => hostDateAt(new Date(a.start_at), visit.time_zone)).find(d => d >= content.startDate) ?? content.startDate
      const elapsed = Math.floor((Date.parse(date) - Date.parse(start)) / 86400_000)
      alerts.push({ kind: 'plan', message: elapsed >= config.late_days ? `Plan of care certification is late (${elapsed} days since first treatment; clinic deadline ${config.late_days} days).` : 'Plan of care is not certified by the referring physician.' })
    }
  }
  if (policies.some(p => p.medicare)) {
    const progress = await one(db, `SELECT a.start_at,n.template FROM bm_notes n JOIN bm_appointments a ON a.id=n.appointment_id WHERE n.client_id=? AND a.practitioner_id=? AND n.signed_at IS NOT NULL AND (n.template LIKE '%.progress' OR n.template LIKE '%.evaluation') AND a.start_at<=? ORDER BY a.start_at DESC LIMIT 1`, visit.client_id, visit.practitioner_id, visit.start_at)
    const treatmentDays = await rows(db, "SELECT start_at FROM bm_appointments WHERE client_id=? AND practitioner_id=? AND status='attended' AND start_at<=?", visit.client_id, visit.practitioner_id, visit.start_at)
    const reportDate = progress ? hostDateAt(new Date(progress.start_at), visit.time_zone) : null
    const days = new Set(treatmentDays.map(a => hostDateAt(new Date(a.start_at), visit.time_zone)).filter(d => !reportDate || (progress?.template.endsWith('.evaluation') ? d >= reportDate : d > reportDate))).size
    if (days >= 10 && !['progress','evaluation'].includes(template(noteTemplate)?.kind ?? '')) alerts.push({ kind: 'progress', message: `Medicare progress report is due: ${days} treatment days in the reporting period.` })
    const group = /\bOT\b|occupational/i.test(visit.profession) ? 'ot' : 'pt_slp'
    const spending = await medicareSpending(db, visit.client_id, Number(date.slice(0, 4)), group, visitId)
    const fees = await rows(db, 'SELECT code,MAX(cents) AS cents FROM bm_payer_fees WHERE payer_id IN (SELECT p.payer_id FROM bm_policies p JOIN bm_payers y ON y.id=p.payer_id WHERE p.client_id=? AND y.medicare=1 AND p.starts_on<=? AND (p.ends_on IS NULL OR p.ends_on>=?)) GROUP BY code', visit.client_id, date, date)
    const visitEstimate = bill(revision?.charges ? JSON.parse(revision.charges) : []).lines.reduce((sum,line) => sum + line.units * (fees.find(f => f.code === line.code)?.cents ?? 0), 0)
    const projected = spending.usedCents + visitEstimate
    if (!spending.annual) alerts.push({ kind: 'kx', message: `Configure Medicare thresholds for ${date.slice(0, 4)} before billing.` })
    else if (projected + config.kx_near_cents >= spending.annual.threshold_cents) alerts.push({ kind: 'kx', message: `Medicare KX threshold ${projected >= spending.annual.threshold_cents ? 'reached' : 'near'}: ${dollars(projected)} recognized or estimated including this visit of ${dollars(spending.annual.threshold_cents)}. Review medical necessity before billing.` })
  }
  if (revision) {
    const doc: Documentation = revision.documentation ? JSON.parse(revision.documentation) : documentationInput({})
    const sections = revision.sections ? JSON.parse(revision.sections) : []
    for (const payer of policies) for (const key of JSON.parse(payer.required) as (keyof typeof documentationElements)[]) {
      const present = key === 'totalTreatmentMinutes' || key === 'totalTimedMinutes' ? doc[key] !== null && (key === 'totalTreatmentMinutes' ? doc[key]! > 0 : doc[key]! >= 0) : sections.some((s: Data) => s.id === key && String(s.text).trim())
      if (!present) alerts.push({ kind: 'required', blocking: true, message: `${payer.name} requires ${documentationElements[key]} before this note can be signed.` })
    }
    if (doc.assistantInvolved) {
      const supervisor = doc.supervisorId ? await one(db, "SELECT name FROM bm_staff WHERE id=? AND role='practitioner' AND active=1", doc.supervisorId) : null
      alerts.push({ kind: 'supervision', message: supervisor ? `Assistant treatment: ${supervisor.name} is the named supervisor. Confirm payer supervision requirements and CQ/CO units before billing.` : 'Assistant treatment needs a named active practitioner supervisor. Review supervision before signing.' })
    }
  }
  return alerts
}

export async function documentationClose(db: D1Database, who: Actor) {
  if (who.role === 'agent' || (who.role !== 'owner' && !practitionerId(who))) return []
  const visits = await rows(db, `SELECT a.id,a.client_id,a.start_at,c.first_name||' '||c.last_name AS client,p.name AS practitioner FROM bm_appointments a JOIN bm_clients c ON c.id=a.client_id JOIN bm_staff p ON p.id=a.practitioner_id WHERE a.status='attended' AND (?='owner' OR a.practitioner_id=?) ORDER BY a.start_at`, who.role, practitionerId(who) ?? '')
  const list = []
  for (const visit of visits) {
    const latest = await one(db, 'SELECT r.*,n.template,n.signed_at FROM bm_notes n JOIN bm_note_revisions r ON r.note_id=n.id WHERE n.appointment_id=? ORDER BY n.created_at DESC,r.number DESC LIMIT 1', visit.id)
    const alerts = await documentationAlerts(db, visit.id, latest ?? undefined, latest?.template)
    if (!latest?.signed_at) alerts.unshift({ kind: 'unsigned', message: latest ? 'Treatment note is not signed.' : 'Treatment note has not been written.' })
    if (alerts.length) list.push({ ...visit, alerts })
  }
  if (visits.length) await commit(db, who, [...new Set(visits.map(v => v.client_id))].map(clientId => audit(db, who, 'documentation.daily_close_read', clientId)))
  return list
}
