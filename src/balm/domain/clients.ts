import { patientSmsZone } from '../sms/quiet-hours'
import type { Bindings } from '../../auth.server'
import { patientCreationFence } from './hosting'
import { templateCatalog } from '../charting/template-catalog'
import { supervisorReadSql, supervisionPlans } from './supervision'
import { phoneNumber } from './us-clinic'
// Client-file access adapted from Satchel's matter membership (src/satchel/matters.ts,
// just-every/run-satchel @ 2d460e4): the owner and reception see every file, a
// practitioner sees a file only through their own appointments. Every file read
// writes its audit rows in the same batch that returns nothing to the caller first.
// @ts-ignore The pinned Base module is JavaScript without declarations.
import { createPortability } from '@runeditrun/rer/modules/portability'
import archivePolicy from '../archive-policy.mjs'
import { intakeFor } from './intake'
import { notesFor } from './notes'
import { episodeIndex } from '../episodes'
import { referralsFor } from '../referrals'
import { changesInEpisode, episodeSummaries, seriesByEpisode } from '../episodes/summary'
import { authorizationsFor } from '../insurance/authorization'
import { careTeamOnly, noteAccess } from './care-team'
import { plansFor } from './plans'
import { invoicesFor } from './invoices'
import { audit, commit, day, email, guard, human, id, insist, integer, need, now, one, optional, practitionerId, rows, sha256, stmt, text, type Actor, type Data } from './model'

export const clientIdentity = (first: string, last: string, dob: string | null) => sha256(`client:${first.trim().toLowerCase()}|${last.trim().toLowerCase()}|${dob ?? ''}`)

export async function clientVisible(db: D1Database, who: Actor, key: unknown) {
  const client = await one(db, 'SELECT * FROM bm_clients WHERE id=? AND erased_at IS NULL', text(key, 'client', 100))
  const own = practitionerId(who)
  const sees = client && (who.role === 'owner' || who.role === 'agent' || who.staffRole === 'reception'
    || (own && await one(db, 'SELECT 1 FROM bm_appointments WHERE client_id=? AND practitioner_id=?', client.id, own)))
  insist(sees, 'client_not_found', 404)
  return client!
}

/** The file as a chart reader reaches it: the usual scope, or CHART-013 care-team access alone. */
export async function chartClient(db: D1Database, who: Actor, key: unknown) {
  try { return await clientVisible(db, who, key) } catch (error) {
    const client = await one(db, 'SELECT * FROM bm_clients WHERE id=? AND erased_at IS NULL', text(key, 'client', 100))
    if (client && (await careTeamOnly(db, who, client.id as string) || await one(db,'SELECT 1 FROM bm_notes n WHERE n.client_id=? AND '+supervisorReadSql('n'),client.id,practitionerId(who) ?? ''))) return client
    throw error
  }
}

export async function listClients(db: D1Database, who: Actor) {
  const own = practitionerId(who)
  if (who.role === 'owner' || who.staffRole === 'reception') return rows(db, 'SELECT id,first_name,last_name,date_of_birth,created_via FROM bm_clients WHERE erased_at IS NULL ORDER BY last_name,first_name')
  return rows(db, 'SELECT id,first_name,last_name,date_of_birth,created_via FROM bm_clients c WHERE erased_at IS NULL AND EXISTS(SELECT 1 FROM bm_appointments a WHERE a.client_id=c.id AND a.practitioner_id=?) ORDER BY last_name,first_name', own ?? '')
}

export async function saveClient(db: D1Database, who: Actor, input: Data, env?: Bindings) {
  need(who, 'owner', 'reception'); human(who)
  const previous = input.id ? await clientVisible(db, who, input.id) : null
  const values = { first: text(input.firstName, 'first_name', 80), last: text(input.lastName, 'last_name', 80),
    dob: input.dateOfBirth ? day(input.dateOfBirth, 'date_of_birth') : null, email: input.email ? email(input.email) : null, phone: phoneNumber(input.phone), smsZone: input.smsTimeZone === undefined ? previous?.sms_time_zone ?? null : patientSmsZone(input.smsTimeZone) }
  const clientId = previous?.id as string ?? id()
  const identity = await clientIdentity(values.first, values.last, values.dob)
  await commit(db, who, [
    ...(previous ? [] : [await patientCreationFence(db,env)]),
    ...(previous ? [guard(db, 'EXISTS(SELECT 1 FROM bm_clients WHERE id=? AND version=?)', clientId, input.version === undefined ? previous.version : integer(input.version, 'version', 1, Number.MAX_SAFE_INTEGER))]
      : [guard(db, 'NOT EXISTS(SELECT 1 FROM bm_erasure_journal WHERE identity_hash=?)', identity)]),
    stmt(db, `INSERT INTO bm_clients(id,first_name,last_name,date_of_birth,email,phone,sms_time_zone,created_at,created_via) VALUES(?,?,?,?,?,?,?,?,'staff')
      ON CONFLICT(id) DO UPDATE SET first_name=excluded.first_name,last_name=excluded.last_name,date_of_birth=excluded.date_of_birth,email=excluded.email,phone=excluded.phone,sms_time_zone=excluded.sms_time_zone,version=bm_clients.version+1`,
    clientId, values.first, values.last, values.dob, values.email, values.phone, values.smsZone, now()),
    audit(db, who, previous ? 'client.updated' : 'client.created', clientId, clientId),
  ])
  return { id: clientId }
}

/** Rows on one page of a file's access audit, newest first. */
export const AUDIT_PAGE_SIZE = 50

/** Presentation only: consecutive reads by one actor form an expandable entry.
 * Writes, actor changes and a five-minute idle gap always start a new entry.
 * The underlying append-only rows and their ordinary JSON pagination stay intact. */
async function auditEntries(db: D1Database, clientId: string, before: number | null) {
  const list = await rows(db, `WITH access AS (
    SELECT sequence,at,actor_email,actor_role,action,subject_id,detail,
      CASE WHEN action IN ('file.viewed','portal.viewed','agent.context') OR action LIKE '%.read' OR action LIKE '%\\_read' ESCAPE '\\' THEN 1 ELSE 0 END AS is_read
    FROM bm_audit WHERE client_id=?${before ? ' AND sequence<?' : ''}
  ), previous AS (
    SELECT *,LAG(at) OVER w AS previous_at,LAG(actor_email) OVER w AS previous_email,
      LAG(actor_role) OVER w AS previous_role,LAG(is_read) OVER w AS previous_read
    FROM access WINDOW w AS (ORDER BY sequence)
  ), boundaries AS (
    SELECT *,CASE WHEN is_read=1 AND previous_read=1 AND actor_email=previous_email AND actor_role=previous_role
      AND (julianday(at)-julianday(previous_at))*86400 BETWEEN 0 AND 300 THEN 0 ELSE 1 END AS starts_entry FROM previous
  ), grouped AS (
    SELECT *,SUM(starts_entry) OVER (ORDER BY sequence) AS entry_id FROM boundaries
  ) SELECT MAX(sequence) AS sequence,MIN(sequence) AS first_sequence,MAX(at) AS at,MIN(at) AS first_at,
      actor_email,actor_role,COUNT(*) AS record_count,
      json_group_array(json_object('sequence',sequence,'at',at,'action',action,'subject_id',subject_id,'detail',detail)) AS records
    FROM grouped GROUP BY entry_id ORDER BY sequence DESC LIMIT ?`, clientId, ...(before ? [before] : []), AUDIT_PAGE_SIZE + 1)
  return { entries: list.slice(0, AUDIT_PAGE_SIZE).map(a => ({ ...a, records: JSON.parse(a.records) })),
    page: { before, older: list.length > AUDIT_PAGE_SIZE ? list[AUDIT_PAGE_SIZE - 1].first_sequence : null, size: AUDIT_PAGE_SIZE } }
}

/** A client's file; `auditBefore` (an audit sequence) opens an older page of its access audit. */
export async function clientFile(db: D1Database, who: Actor, key: unknown, auditBefore?: unknown) {
  const client = await chartClient(db, who, key)
  const own = practitionerId(who), all = who.role === 'owner' || who.staffRole === 'reception'
  const access = await noteAccess(db, who, client.id as string), teamOnly = who.role !== 'owner' && !!own && !await one(db,'SELECT 1 FROM bm_appointments WHERE client_id=? AND practitioner_id=?',client.id,own)
  const appointments = await rows(db, `SELECT a.id,a.start_at,a.end_at,a.status,a.patient_response,a.patient_response_at,a.booked_via,a.coverage_choice,a.practitioner_id,p.name AS practitioner,s.name AS service,s.id AS service_id,EXISTS(SELECT 1 FROM bm_package_assignments pa WHERE pa.appointment_id=a.id) AS package_assigned,s.note_template,s.cpt_defaults,
    (SELECT 1 FROM bm_intake_responses r WHERE r.appointment_id=a.id) AS intake_received,(SELECT json_group_array(json_object('other',o.other_appointment_id,'by',o.acknowledged_by,'at',o.acknowledged_at)) FROM bm_medicare_overlaps o WHERE o.appointment_id=a.id) AS medicare_overlaps,(SELECT 1 FROM bm_intake_responses o WHERE o.client_id=a.client_id) AS intake_on_file,
    EXISTS(SELECT 1 FROM bm_notes n JOIN bm_note_revisions r ON r.note_id=n.id AND r.number=n.signed_revision WHERE n.appointment_id=a.id AND n.signed_at IS NOT NULL AND json_array_length(COALESCE(r.charges,'[]'))>0) AS note_billed
    FROM bm_appointments a JOIN bm_staff p ON p.id=a.practitioner_id JOIN bm_services s ON s.id=a.service_id WHERE a.client_id=? ORDER BY a.start_at DESC`, client.id)
  const episodes = await episodeIndex(db, client.id as string)
  for (const a of appointments) { a.episodeId = episodes.of('visit', a.id as string); a.medicareOverlaps = JSON.parse(a.medicare_overlaps as string ?? '[]'); delete a.medicare_overlaps }
  const visibleAppointments = appointments.filter(a => all || a.practitioner_id === own)
  // CHART-013 care-team access alone reads notes (and, under break glass, chart documents), nothing else.
  const intake = teamOnly ? [] : (await intakeFor(db, who, client.id as string))?.filter(r => who.role === 'owner' || visibleAppointments.some(a => a.id === r.appointmentId)) ?? null
  const notes = await notesFor(db, who, client.id as string)
  // REF-003: a visit's notes (and their measures) follow the visit's episode.
  for (const n of notes ?? []) (n as Data).episodeId = n.appointmentId ? episodes.of('visit', n.appointmentId as string) : episodes.of('note', n.id as string)
  const governing = teamOnly && !access.all ? await supervisionPlans(db,who,client.id as string) : []
  const plans = teamOnly ? governing.length ? (await plansFor(db,who,client.id as string)).filter(p=>governing.includes(p.id as string)) : [] : await plansFor(db, who, client.id as string)
  for (const p of plans) (p as Data).episodeId = episodes.of('plan', p.id as string)
  const authorizations = teamOnly || who.role === 'agent' ? null : await authorizationsFor(db, client.id as string)
  const invoices = all ? await invoicesFor(db, client.id as string) : null
  const before = /^[1-9]\d{0,15}$/.test(String(auditBefore ?? '')) ? Number(auditBefore) : null
  const auditRows = who.role === 'owner' ? await rows(db, `SELECT sequence,at,actor_email,actor_role,action,subject_id,detail FROM bm_audit WHERE client_id=?${before ? ' AND sequence<?' : ''} ORDER BY sequence DESC LIMIT ?`, client.id, ...(before ? [before] : []), AUDIT_PAGE_SIZE + 1) : null
  const auditPage = auditRows ? { before, older: auditRows.length > AUDIT_PAGE_SIZE ? auditRows[AUDIT_PAGE_SIZE - 1].sequence : null, total: Number((await one(db, 'SELECT COUNT(*) AS n FROM bm_audit WHERE client_id=?', client.id))!.n), size: AUDIT_PAGE_SIZE } : null
  const groupedAudit = who.role === 'owner' ? await auditEntries(db, client.id as string, before) : null
  await commit(db, who, [
    audit(db, who, 'file.viewed', client.id as string, client.id as string, [intake ? `intake ${intake.length}` : 'no clinical intake', notes ? `notes ${notes.length}` : 'no notes', auditRows ? 'audit' : ''].filter(Boolean).join('; ')),
    ...(intake ?? []).map(r => audit(db, who, 'intake.read', client.id as string, r.id as string)),
    ...(notes ?? []).map(n => who.role === 'owner' || n.mine ? audit(db, who, 'note.read', client.id as string, n.id as string, `revisions ${n.revisions.length}`)
      : access.breakGlass ? audit(db, who, 'note.break_glass_read', client.id as string, n.id as string, `break glass: ${access.breakGlass.reason}`)
      : audit(db, who, 'note.read', client.id as string, n.id as string, `${n.supervisorRead ? 'named supervisor; submitted revisions' : 'care team grant; revisions'} ${n.revisions.length}`)),
    ...plans.filter(p => p.content).map(p => audit(db, who, 'plan.read', client.id as string, p.id as string)),
  ])
  // CHART-005: series and progress changes are built only from the notes this reader reaches.
  const measures = notes ? seriesByEpisode(notes) : null
  const measureChanges = notes && measures ? Object.fromEntries(notes.filter(n => ['progress','reevaluation','discharge'].includes(n.templateDefinition?.kind ?? '')).map(n => [n.id, changesInEpisode(measures, n)])) : null
  // CHART-013 care-team and emergency readers see only the episodes holding the notes (and, under break glass, documents) they read.
  const reached = teamOnly ? new Set([...(notes ?? []).map(n => (n as Data).episodeId as string),
    ...(access.breakGlass ? (await rows(db, 'SELECT id FROM bm_chart_documents WHERE client_id=?', client.id)).map(d => episodes.of('document', d.id as string)) : [])]) : null
  const episodeList = episodeSummaries(episodes, { appointments: visibleAppointments, plans, authorizations, measures }).filter(e => !reached || reached.has(e.id))
  const referrals = teamOnly || who.role === 'agent' ? null : await referralsFor(db, client.id as string, (await one(db, 'SELECT time_zone FROM bm_settings WHERE id=1'))!.time_zone as string)
  const supervisionOnly = teamOnly && !access.all
  // Note access alone names the patient; it carries none of their contact or demographic details.
  const visibleClient: Data = teamOnly ? {id:client.id,first_name:client.first_name,last_name:client.last_name} : { ...client }
  if (!all) delete visibleClient.copay_cents
  return { clinicalTemplates: notes ? await templateCatalog(db) : [], client: visibleClient, careAccess: { ...access, teamOnly, supervisionOnly },  appointments: visibleAppointments, episodes: supervisionOnly ? [] : episodeList, referrals, intake, notes, measures, measureChanges, plans, invoices, audit: auditRows?.slice(0, AUDIT_PAGE_SIZE) ?? null, auditPage,
    auditEntries: groupedAudit?.entries ?? null, auditEntriesPage: groupedAudit?.page ?? null }
}

/** Only a client with no appointments, notes, intake, invoices, card payments, card on file or import history can be erased. */
export async function eraseClient(db: D1Database, who: Actor, input: Data) {
  need(who, 'owner'); human(who)
  const client = await clientVisible(db, who, input.id)
  const accountRecords = await one(db, 'SELECT 1 FROM bm_account_entries WHERE client_id=? UNION ALL SELECT 1 FROM bm_estimate_requests WHERE client_id=? LIMIT 1', client.id, client.id)
  insist(!accountRecords, 'clients_with_health_records_are_retained', 409)
  const unused = `NOT EXISTS(SELECT 1 FROM bm_policies WHERE client_id=?) AND NOT EXISTS(SELECT 1 FROM bm_appointments WHERE client_id=?) AND NOT EXISTS(SELECT 1 FROM bm_notes WHERE client_id=?) AND NOT EXISTS(SELECT 1 FROM bm_plans_of_care WHERE client_id=?)
    AND NOT EXISTS(SELECT 1 FROM bm_intake_responses WHERE client_id=?) AND NOT EXISTS(SELECT 1 FROM bm_invoices WHERE client_id=?)
    AND NOT EXISTS(SELECT 1 FROM bm_import_client_revisions WHERE client_id=?) AND NOT EXISTS(SELECT 1 FROM bm_waitlist WHERE client_id=?)
    AND NOT EXISTS(SELECT 1 FROM ik_provenance WHERE destination='balm:clients' AND target_id=?)
    AND NOT EXISTS(SELECT 1 FROM bm_card_payments WHERE client_id=?) AND NOT EXISTS(SELECT 1 FROM bm_cards WHERE client_id=? AND removed_at IS NULL) AND NOT EXISTS(SELECT 1 FROM bm_messages WHERE client_id=?) AND NOT EXISTS(SELECT 1 FROM bm_calls WHERE client_id=?)
    AND NOT EXISTS(SELECT 1 FROM bm_movein_records WHERE target_table='bm_clients' AND target_id=?) AND NOT EXISTS(SELECT 1 FROM bm_home_exercises WHERE client_id=?) AND NOT EXISTS(SELECT 1 FROM bm_disclosures WHERE client_id=?) AND NOT EXISTS(SELECT 1 FROM bm_client_alerts WHERE client_id=?) AND NOT EXISTS(SELECT 1 FROM bm_chart_documents WHERE client_id=?) AND NOT EXISTS(SELECT 1 FROM bm_followups WHERE client_id=?) AND NOT EXISTS(SELECT 1 FROM bm_payment_plans WHERE client_id=?) AND NOT EXISTS(SELECT 1 FROM bm_balance_reminders WHERE client_id=?) AND NOT EXISTS(SELECT 1 FROM bm_retention_holds WHERE client_id=?) AND NOT EXISTS(SELECT 1 FROM bm_episodes WHERE client_id=?)`
  const args = Array(23).fill(client.id)
  insist((await one<{ ok: number }>(db, `SELECT CASE WHEN (${unused}) THEN 1 ELSE 0 END AS ok`, ...args))?.ok === 1, 'clients_with_health_records_are_retained', 409)
  const portability = await createPortability({ db, policy: archivePolicy })
  const at = Date.now()
  await commit(db, who, [
    guard(db, unused, ...args),
    guard(db, 'NOT EXISTS(SELECT 1 FROM bm_account_entries WHERE client_id=?) AND NOT EXISTS(SELECT 1 FROM bm_estimate_requests WHERE client_id=?)', client.id, client.id),
    ...await portability.redactionStatements(), ...await portability.invalidateTransfersStatements(),
    stmt(db, 'INSERT INTO bm_erasure_journal(identity_hash,kind,erased_at) VALUES(?,?,?)', await clientIdentity(client.first_name as string, client.last_name as string, client.date_of_birth as string | null), 'client', at),
    stmt(db, "UPDATE bm_clients SET first_name='Erased',last_name='client',date_of_birth=NULL,email=NULL,phone=NULL,sms_time_zone=NULL,version=version+1,erased_at=? WHERE id=?", at, client.id),
    audit(db, who, 'client.erased', client.id as string, client.id as string),
  ])
  return { id: client.id, erased: true }
}
