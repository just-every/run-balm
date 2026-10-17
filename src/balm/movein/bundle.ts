import { audit, commit, guard, one, rows, type Actor } from '../domain/model.ts'
import { ImportError, requiredText } from './errors.ts'
import { planBundle, isError } from './bundle-plan.ts'
import { applyBundle, undoBundle } from './bundle-storage.ts'

async function owner(db: D1Database, who: Actor) {
  if (who.role !== 'owner') throw new ImportError('owner_required', 403)
  const live = await one(db, "SELECT 1 FROM oa_operators WHERE id=? AND lower(email)=lower(?) AND status='active' AND role='owner' AND version=?", who.id, who.email, who.operatorVersion)
  if (!live) throw new ImportError('owner_required', 403)
}

function jobValue(job: Record<string, any>): Record<string, any> {
  const { report_json, source_json: _source, ...value } = job
  return { ...value, report: JSON.parse(report_json) }
}

/** Metadata only: caller must enforce the owner page/API boundary. */
export async function bundleJobs(db: D1Database) {
  return (await rows(db, 'SELECT id,provider,fingerprint,state,created_at,created_by,undone_at,acceptance_reason,report_json FROM bm_movein_jobs ORDER BY created_at DESC')).map(jobValue)
}

async function journal(db: D1Database, jobId: string) {
  const job = await one(db, 'SELECT * FROM bm_movein_jobs WHERE id=?', jobId)
  if (!job) throw new ImportError('movein_job_not_found', 404)
  return { job: jobValue(job), records: await rows(db, 'SELECT kind,source_id,target_table,target_id FROM bm_movein_records WHERE job_id=? ORDER BY kind,source_id', jobId) }
}

/** All writes use one guarded D1 batch; no partial apply/resume state exists. */
export async function bundleCommand(db: D1Database, who: Actor, name: string, input: Record<string, unknown>) {
  await owner(db, who)
  if (name === 'movein.journal') {
    const value = await journal(db, requiredText(input.jobId, 'jobId'))
    await commit(db, who, [audit(db, who, 'movein.journal_read', null, value.job.id)])
    return value
  }
  if (name === 'movein.undo') {
    const jobId = requiredText(input.jobId, 'jobId'), value = await journal(db, jobId)
    if (value.job.state !== 'undone') await undoBundle(db, who, jobId)
    return journal(db, jobId)
  }
  if (name !== 'movein.preview' && name !== 'movein.apply') throw new ImportError('unknown_movein_command', 400)
  const plan = await planBundle(db, input)
  if (name === 'movein.preview') {
    await commit(db, who, [audit(db, who, 'movein.previewed', null, null, plan.provider)])
    const { bundle: _bundle, sourceJson: _sourceJson, practitionerVersion: _practitioner, serviceVersion: _service, ...value } = plan
    return value
  }
  if (requiredText(input.fingerprint, 'fingerprint') !== plan.fingerprint) throw new ImportError('review_fingerprint_mismatch', 409, 'Preview the exact source files and mapping before applying.')
  const existing = plan.existingJob
  if (existing) return journal(db, existing.id)
  if (plan.diagnostics.some(isError)) throw new ImportError('movein_validation_failed', 409, 'Resolve every error in the preview before applying.')
  const acceptanceReason = typeof input.acceptanceReason === 'string' ? input.acceptanceReason.trim() : ''
  if (plan.requiresAcceptance && (!acceptanceReason || acceptanceReason.length > 2000)) throw new ImportError('movein_acceptance_required', 409, 'Accept the reconciliation differences and unmapped records with a reason, or fix the source and preview again.')
  const jobId = await applyBundle(db, who, plan, acceptanceReason)
  return journal(db, jobId)
}

/** Clinical content never enters reception or agent context; every read is audited. */
export async function importedForClient(db: D1Database, who: Actor, clientId: string) {
  if (who.role === 'agent') throw new ImportError('clinical_access_denied', 403)
  const own = who.staffRole === 'practitioner' ? who.staffId : null
  const all = who.role === 'owner' || who.staffRole === 'reception'
  const visible = await one(db, `SELECT id FROM bm_clients c WHERE id=? AND erased_at IS NULL AND (?=1 OR EXISTS(SELECT 1 FROM bm_appointments a WHERE a.client_id=c.id AND a.practitioner_id=?))`, clientId, all ? 1 : 0, own)
  if (!visible) throw new ImportError('client_not_found', 404)
  const clinical = who.role === 'owner' || !!own
  const [notes, balances, insurance] = await Promise.all([
    clinical ? rows(db, 'SELECT n.*,j.provider FROM bm_movein_notes n JOIN bm_movein_jobs j ON j.id=n.job_id WHERE n.client_id=? ORDER BY n.source_date,n.id', clientId) : Promise.resolve(null),
    all ? rows(db, 'SELECT b.*,j.provider FROM bm_movein_balances b JOIN bm_movein_jobs j ON j.id=b.job_id WHERE b.client_id=?', clientId) : Promise.resolve([]),
    rows(db, 'SELECT i.*,j.provider FROM bm_movein_insurance i JOIN bm_movein_jobs j ON j.id=i.job_id WHERE i.client_id=?', clientId),
  ])
  await commit(db, who, [
    guard(db, 'EXISTS(SELECT 1 FROM bm_clients WHERE id=? AND erased_at IS NULL)', clientId),
    ...(!all ? [guard(db, 'EXISTS(SELECT 1 FROM bm_appointments WHERE client_id=? AND practitioner_id=?)', clientId, own)] : []),
    ...(notes ?? []).map(n => audit(db, who, 'movein.note_read', clientId, n.id)),
    audit(db, who, 'movein.records_read', clientId),
  ])
  return { notes, balances, insurance }
}
