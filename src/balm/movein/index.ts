import type { Bindings } from '../../auth.server'
import { patientCreationFence } from '../domain/hosting'
// Adapted from Strap's move-in transport (src/strap/movein/index.ts, just-every/run-strap @ 92c3892).
import {
  planD1Import, createD1ImportJob, applyD1ImportBatches, undoD1Import, resumeD1Import,
  readD1ImportJob, readD1ImportOriginals, readD1ImportUndoReport, rollbackD1Import, d1RequestContext,
} from '../../modules/import-kit/src/d1/index.ts'
import type { D1ImportContext, D1Database as KitDatabase, ImportMapping, ImportPlan } from '../../modules/import-kit/src/d1/index.ts'
import { dateFormat, formatName, namespace, patientSource } from './csv.ts'
import { destination, mappingVersion, hostingClientTargets, nativeConflicts } from './targets.ts'
import { ImportError, requiredText } from './errors.ts'
export { ImportError } from './errors.ts'
export type ImportActor = { id: string; email: string; role: string }

export function importContext(db: D1Database, actor: ImportActor, env?: Bindings): D1ImportContext {
  if (actor.role !== 'owner') throw new ImportError('owner_required', 403)
  return {
    destination, namespace, mappingVersion, storage: { database: db as unknown as KitDatabase, targets: hostingClientTargets(env) },
    batchSize: 10, maxBatches: 1, reversalPolicy: 'preserve-conflicts',
    authorization: { principalId: actor.id, predicate: () => ({
      sql: "EXISTS(SELECT 1 FROM oa_operators WHERE id=? AND lower(email)=? AND role='owner' AND status='active')",
      params: [actor.id, actor.email.toLowerCase()],
    }) },
  }
}
const mapping: ImportMapping = {
  version: mappingVersion,
  map(record) {
    const p = record.payload as Record<string, string | null>
    return { effects: [{ targetKind: 'client', targetId: 'cliniko-' + record.sourceId,
      value: { id: 'cliniko-' + record.sourceId, first_name: p.firstName, last_name: p.lastName, date_of_birth: p.dateOfBirth,
        email: p.email, phone: p.mobile, created_via: 'import', version: 1, erased_at: null, dependencies: '[]' } }] }
  },
}
const clientValues = (plan: ImportPlan) => plan.entries.flatMap(entry => entry.effects.map(effect => effect.value as Record<string, any>))

/** The transport authenticates a human session and checks request origin.
 * Current owner authority is also fenced inside every kit transaction. */
export async function importCommand(db: D1Database, actor: ImportActor, name: string, input: Record<string, unknown>, env?: Bindings): Promise<unknown> {
  const context = d1RequestContext(importContext(db, actor, env))
  const owner = await db.prepare("SELECT 1 FROM oa_operators WHERE id=? AND lower(email)=? AND role='owner' AND status='active'")
    .bind(actor.id, actor.email.toLowerCase()).first()
  if (!owner) throw new ImportError('owner_required', 403)
  if (name === 'import.apply' || name === 'import.resume') await patientCreationFence(db,env)
  try {
    if (name === 'import.preview' || name === 'import.apply') {
      const format = dateFormat(input.dateFormat), plan = await planD1Import(patientSource(input.csv, format), mapping, context)
      const clients = clientValues(plan), conflicts = await nativeConflicts(db, clients)
      if (name === 'import.preview') return { format: formatName, dateFormat: format, fileName: typeof input.fileName === 'string' ? input.fileName.slice(0, 200) : null, fingerprint: plan.fingerprint,
        counts: plan.counts, diagnostics: plan.diagnostics, clients, conflicts }
      const reviewedFingerprint = requiredText(input.fingerprint, 'fingerprint')
      if (reviewedFingerprint !== plan.fingerprint) throw new ImportError('review_fingerprint_mismatch', 409, 'The file or your clinic changed since the preview. Preview the file again before importing.')
      if (conflicts.length) throw new ImportError(conflicts[0].reason, 409, 'Some patients in the file are already in Balm or were erased. Remove those rows from the file and preview it again.')
      const job = await createD1ImportJob(plan, { ...context, reviewedFingerprint })
      return { job: await applyD1ImportBatches(job.id, context) }
    }
    if (!['import.rollback', 'import.undo', 'import.resume', 'import.journal'].includes(name)) throw new ImportError('unknown_import_command', 400)
    const jobId = requiredText(input.jobId, 'jobId')
    if (name === 'import.rollback') return { job: await rollbackD1Import(jobId, context) }
    if (name === 'import.undo') return { job: await undoD1Import(jobId, context) }
    if (name === 'import.resume') return { job: await resumeD1Import(jobId, context) }
    const job = await readD1ImportJob(jobId, context)
    // The original file is a download (importOriginal); the journal names it.
    const originals = (await readD1ImportOriginals(jobId, context)).map(({ original, ...file }) => ({ ...file, available: original.status === 'retained' }))
    const { results: batches } = await db.prepare('SELECT action,position,end_position,fence FROM ik_batches WHERE job_id=? ORDER BY rowid').bind(jobId).all()
    const undo = await readD1ImportUndoReport(jobId, context, { limit: 1000 })
    await readD1ImportJob(jobId, context)
    return { job, originals, batches, undo }
  } catch (error) {
    if (error instanceof ImportError) throw error
    const message = error instanceof Error ? error.message : ''
    if (message.includes('IMPORT_JOB_NOT_FOUND')) throw new ImportError('import_job_not_found', 404)
    if (/NATIVE_EDIT_CONFLICT|TARGET_REVISION_CONFLICT|SOURCE_ID_CONTENT_CONFLICT|IMPORT_ALREADY_REVERSING|IMPORT_ATOMIC_GUARD|IMPORT_FINAL_GUARD|JOB_BINDING_MISMATCH|OPERATION_KEY_CONFLICT|UNIQUE constraint|IMPORT_NOT_COMPLETED|IMPORT_NOT_COMPLETE|UNDO_REQUIRES|REVERSAL_MODE_CONFLICT/.test(message)) {
      throw new ImportError('import_conflict', 409, 'Import conflicts with current records or authority. Review the journal; later edits and dependent work are preserved.')
    }
    if (/IMPORT_D1_REQUEST_LIMIT|IMPORT_D1_TRANSPORT_LIMIT/.test(message)) throw new ImportError('import_request_limit', 409, 'Resume this import in a new request')
    throw error
  }
}

/** How an undone import ended: patients removed, and patients kept because they were booked, edited or given notes since. */
export async function undoCounts(db: D1Database, actor: ImportActor, jobId: string) {
  const report = await readD1ImportUndoReport(jobId, d1RequestContext(importContext(db, actor)), { limit: 1000 })
  const removed = report.dispositions.filter(d => d.disposition === 'reversed').length
  return { removed, kept: report.dispositions.length - removed }
}

/** The exact file an import read, as the owner uploaded it. */
export async function importOriginal(db: D1Database, actor: ImportActor, jobId: string) {
  const [file] = await readD1ImportOriginals(jobId, d1RequestContext(importContext(db, actor))).catch(error => {
    if (String((error as Error)?.message).includes('IMPORT_JOB_NOT_FOUND')) throw new ImportError('import_job_not_found', 404)
    throw error
  })
  if (!file || file.original.status !== 'retained') throw new ImportError('import_job_not_found', 404, 'The original file of this import is no longer kept.')
  return { name: file.name, bytes: Uint8Array.from(atob(file.original.base64), c => c.charCodeAt(0)) }
}
