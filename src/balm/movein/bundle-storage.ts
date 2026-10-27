import { audit, commit, guard, now, rows, stmt, type Actor } from '../domain/model.ts'
import { carryClaimStatements } from './claim-carry.ts'
import { chunks, textChunks } from './batches.ts'
import { identityText } from './targets.ts'
import { type BundlePlan, targetId } from './bundle-plan.ts'

const tables = ['bm_clients', 'bm_appointments', 'bm_movein_notes', 'bm_movein_balances', 'bm_movein_insurance'] as const
export const quote = (name: string) => '"' + name.replaceAll('"', '""') + '"'
async function schema(db: D1Database) {
  return rows<{ table_name: string; column_name: string }>(db, `SELECT m.name AS table_name,p.name AS column_name FROM sqlite_schema m JOIN pragma_table_info(m.name) p WHERE m.type='table' AND m.name GLOB 'bm_*' ORDER BY m.name,p.cid`)
}
export const snapshot = (columns: string[], alias = 't') => `json_object(${columns.flatMap(c => ["'" + c.replaceAll("'", "''") + "'", alias + '.' + quote(c)]).join(',')})`
export const reportFor = (plan: BundlePlan) => ({ timeZone: plan.timeZone, counts: plan.counts, reconciliation: plan.reconciliation, diagnostics: plan.diagnostics, unmappedColumns: plan.unmappedColumns, unmappedRows: plan.unmappedRows, migrationReport: plan.migrationReport, mappingDigest: plan.mappingDigest })

export async function applyBundle(db: D1Database, who: Actor, plan: BundlePlan, acceptanceReason: string, approvedMapping = false) {
  const jobId = crypto.randomUUID(), at = now(), { bundle } = plan
  const clients = new Map(plan.patients.map(p => [p.sourceId, p.id]))
  const patients = plan.patients.map(p => ({ ...p, identity: identityText(p.firstName, p.lastName, p.dateOfBirth) }))
  const appointments = plan.appointments.map(a => ({ ...a, clientId: clients.get(a.patientId)! }))
  const notes = await Promise.all(bundle.notes.map(async n => ({ ...n, id: await targetId(bundle.provider, 'note', n.sourceId), clientId: clients.get(n.patientId)! })))
  const balances = await Promise.all(bundle.balances.map(async (b, index) => ({ ...b, sourceId: `${b.patientId}:${index}`, id: await targetId(bundle.provider, 'balance', `${b.patientId}:${index}`), clientId: clients.get(b.patientId)! })))
  const insurance = await Promise.all(bundle.insurance.map(async i => ({ ...i, id: await targetId(bundle.provider, 'insurance', i.sourceId), clientId: clients.get(i.patientId)! })))
  const report = JSON.stringify(reportFor(plan))
  const body = [
    guard(db, 'EXISTS(SELECT 1 FROM bm_settings WHERE id=1 AND version=?)', plan.settingsVersion),
    guard(db, 'NOT EXISTS(SELECT 1 FROM bm_movein_jobs WHERE source_json=?)', plan.sourceJson),
    stmt(db, `INSERT INTO bm_movein_jobs(id,provider,fingerprint,state,created_at,created_by,acceptance_reason,source_json,report_json) VALUES(?,?,?,'applied',?,?,?,?,?)`, jobId, bundle.provider, plan.fingerprint, at, who.id, acceptanceReason, plan.sourceJson, report.length > 200_000 ? JSON.stringify({ chunked: true }) : report),
  ]
  if (approvedMapping) {
    body.push(guard(db, "EXISTS(SELECT 1 FROM bm_audit WHERE action='movein.mapping_prepared' AND subject_id=? AND detail=?)", plan.fingerprint, plan.mappingDigest))
    for (const [type, digest] of [['mapping', plan.mappingDigest], ['cutover', plan.fingerprint]]) body.push(
      stmt(db, 'INSERT INTO bm_approvals(id,subject_type,subject_id,prepared_by,prepared_role,approved_by,approved_at,sha256) VALUES(?,?,?,?,?,?,?,?)', crypto.randomUUID(), 'movein.' + type, jobId + ':' + type, plan.preparation!.actor_email, plan.preparation!.actor_role, who.email, at, digest),
      audit(db, who, 'movein.' + type + '_approved', null, jobId, digest),
    )
  }
  for (const [kind, value] of [['source', plan.sourcePayload], ['report', report]] as const) {
    if (kind === 'source' ? value === plan.sourceJson : value.length <= 200_000) continue
    textChunks(value).forEach((data, part) => body.push(stmt(db, 'INSERT INTO bm_movein_payloads(job_id,kind,part,data) VALUES(?,?,?,?)', jobId, kind, part, data)))
  }
  for (const group of chunks(patients)) body.push(
    guard(db, `NOT EXISTS(SELECT 1 FROM json_each(?) p JOIN bm_erasure_journal e ON e.identity_hash=json_extract(p.value,'$.identityHash'))`, JSON.stringify(group)),
    guard(db, `NOT EXISTS(SELECT 1 FROM json_each(?) p JOIN bm_clients c ON 'client:'||lower(trim(c.first_name))||'|'||lower(trim(c.last_name))||'|'||COALESCE(c.date_of_birth,'')=json_extract(p.value,'$.identity'))`, JSON.stringify(group)),
    stmt(db, `INSERT INTO bm_clients(id,first_name,last_name,date_of_birth,email,phone,created_at,created_via)
      SELECT json_extract(value,'$.id'),json_extract(value,'$.firstName'),json_extract(value,'$.lastName'),json_extract(value,'$.dateOfBirth'),json_extract(value,'$.email'),json_extract(value,'$.phone'),?,'import' FROM json_each(?)`, at, JSON.stringify(group)),
  )
  if (appointments.length) body.push(
    guard(db, "EXISTS(SELECT 1 FROM bm_staff WHERE id=? AND version=? AND active=1 AND role='practitioner' AND erased_at IS NULL)", plan.practitionerId, plan.practitionerVersion),
    guard(db, 'EXISTS(SELECT 1 FROM bm_services WHERE id=? AND version=? AND active=1)', plan.serviceId, plan.serviceVersion),
  )
  for (const group of chunks(appointments)) body.push(
    stmt(db, `INSERT INTO bm_appointments(id,client_id,practitioner_id,service_id,start_at,end_at,status,booked_via,created_at,created_by)
      SELECT json_extract(value,'$.id'),json_extract(value,'$.clientId'),?,?,json_extract(value,'$.startAt'),json_extract(value,'$.endAt'),json_extract(value,'$.status'),'staff',?,? FROM json_each(?)`, plan.practitionerId, plan.serviceId, at, who.id, JSON.stringify(group)),
  )
  for (const group of chunks(notes)) body.push(
    stmt(db, `INSERT INTO bm_movein_notes(id,job_id,client_id,source_id,title,body,source_date) SELECT json_extract(value,'$.id'),?,json_extract(value,'$.clientId'),json_extract(value,'$.sourceId'),json_extract(value,'$.title'),json_extract(value,'$.body'),json_extract(value,'$.date') FROM json_each(?)`, jobId, JSON.stringify(group))
  )
  for (const group of chunks(balances)) body.push(
    stmt(db, `INSERT INTO bm_movein_balances(id,job_id,client_id,source_id,amount_cents) SELECT json_extract(value,'$.id'),?,json_extract(value,'$.clientId'),json_extract(value,'$.sourceId'),json_extract(value,'$.cents') FROM json_each(?)`, jobId, JSON.stringify(group))
  )
  for (const group of chunks(insurance)) body.push(
    stmt(db, `INSERT INTO bm_movein_insurance(id,job_id,client_id,source_id,payer,member_id,group_number) SELECT json_extract(value,'$.id'),?,json_extract(value,'$.clientId'),json_extract(value,'$.sourceId'),json_extract(value,'$.payer'),json_extract(value,'$.memberId'),json_extract(value,'$.groupNumber') FROM json_each(?)`, jobId, JSON.stringify(group))
  )
  body.push(...carryClaimStatements(db, who, plan, jobId, at))
  const sets = [patients, appointments, notes, balances, insurance]
  const kinds = ['patient', 'appointment', 'note', 'balance', 'insurance']
  const shapes = await schema(db)
  for (let i = 0; i < tables.length; i++) {
    const table = tables[i], shape = shapes.filter(c => c.table_name === table).map(c => c.column_name)
    for (const group of chunks<unknown>(sets[i])) body.push(stmt(db, `INSERT INTO bm_movein_records(job_id,provider,kind,source_id,target_table,target_id,snapshot)
      SELECT ?,?,?,json_extract(p.value,'$.sourceId'),?,t.id,${snapshot(shape)} FROM json_each(?) p JOIN ${quote(table)} t ON t.id=json_extract(p.value,'$.id')`, jobId, bundle.provider, kinds[i], table, JSON.stringify(group)))
  }
  body.push(audit(db, who, 'movein.applied', null, jobId, bundle.provider))
  for (const group of chunks(patients)) body.push(stmt(db, `INSERT INTO bm_audit(at,actor_email,actor_role,action,client_id,subject_id,detail)
    SELECT ?,?,?,'movein.patient_imported',json_extract(value,'$.id'),?,? FROM json_each(?)`, at, who.email, who.role, jobId, bundle.provider, JSON.stringify(group)))
  await commit(db, who, body)
  return jobId
}

/** Discover every native client and visit reference, including non-FK clinical work. */
function dependencies(shapes: { table_name: string; column_name: string }[], db: D1Database, jobId: string) {
  const statements: D1PreparedStatement[] = []
  for (const { table_name: name, column_name: column } of shapes) {
    if (name === 'bm_visit_reminders' || name === 'bm_integration_events' || name === 'bm_audit' || name.startsWith('bm_movein_') || name === 'bm_clients') continue
    const target = column === 'client_id' ? 'bm_clients' : ['appointment_id', 'source_appointment_id'].includes(column) ? 'bm_appointments' : null
    if (!target) continue
    // Imported appointments themselves are removed in this same transaction.
    const imported = name === 'bm_appointments' ? ' AND t.id NOT IN (SELECT target_id FROM bm_movein_records WHERE job_id=? AND target_table=\'bm_appointments\')' : ''
    statements.push(guard(db, `NOT EXISTS(SELECT 1 FROM ${quote(name)} t WHERE t.${quote(column)} IN (SELECT target_id FROM bm_movein_records WHERE job_id=? AND target_table=?)${imported})`, jobId, target, ...(imported ? [jobId] : [])))
  }
  return statements
}

export async function undoBundle(db: D1Database, who: Actor, jobId: string) {
  const shapes = await schema(db)
  const body = [guard(db, "EXISTS(SELECT 1 FROM bm_movein_jobs WHERE id=? AND state='applied')", jobId), ...dependencies(shapes, db, jobId)]
  // Unsent booking notifications are derived from the imported visits. Any
  // approved delivery keeps its event and blocks the whole undo atomically.
  body.push(guard(db, `NOT EXISTS(SELECT 1 FROM bm_integration_deliveries d
    JOIN bm_integration_events e ON e.id=d.event_id
    JOIN bm_movein_records r ON r.target_id=e.appointment_id
    WHERE r.job_id=? AND r.target_table='bm_appointments')`, jobId))
  for (const table of tables) {
    const shape = shapes.filter(c => c.table_name === table).map(c => c.column_name)
    body.push(guard(db, `NOT EXISTS(SELECT 1 FROM bm_movein_records r LEFT JOIN ${quote(table)} t ON t.id=r.target_id WHERE r.job_id=? AND r.target_table=? AND (t.id IS NULL OR r.snapshot<>${snapshot(shape)}))`, jobId, table))
    if (table.startsWith('bm_movein_')) body.push(guard(db, `NOT EXISTS(SELECT 1 FROM ${quote(table)} t WHERE t.job_id=? AND NOT EXISTS(SELECT 1 FROM bm_movein_records r WHERE r.job_id=? AND r.target_table=? AND r.target_id=t.id))`, jobId, jobId, table))
  }
  body.push(stmt(db, "UPDATE bm_movein_jobs SET state='undoing' WHERE id=?", jobId),
    stmt(db, "DELETE FROM bm_visit_reminders WHERE appointment_id IN (SELECT target_id FROM bm_movein_records WHERE job_id=? AND target_table='bm_appointments')", jobId))
  body.push(stmt(db, `DELETE FROM bm_integration_events WHERE appointment_id IN
    (SELECT target_id FROM bm_movein_records WHERE job_id=? AND target_table='bm_appointments')`, jobId))
  for (const table of ['bm_movein_notes', 'bm_movein_balances', 'bm_movein_insurance', 'bm_appointments', 'bm_clients']) body.push(stmt(db, `DELETE FROM ${quote(table)} WHERE id IN (SELECT target_id FROM bm_movein_records WHERE job_id=? AND target_table=?)`, jobId, table))
  body.push(stmt(db, "UPDATE bm_movein_jobs SET state='undone',undone_at=? WHERE id=?", now(), jobId), audit(db, who, 'movein.undone', null, jobId))
  await commit(db, who, body)
}
