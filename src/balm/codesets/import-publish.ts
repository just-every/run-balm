import { audit, guard, insist, now, one, sha256, stmt, type Actor } from '../domain/model'
import { advanceImport, type ImportJob } from './import-store'
export async function publishImport(db: D1Database, who: Actor, job: ImportJob) {
  insist(job.row_count > 0 && job.manifest.length === (job.spec.kind === 'cpt' ? 1 : job.spec.files.length) && job.manifest.every(f => f.verified), 'all_code_archives_must_pass_checksum_before_publication', 409)
  const files = job.manifest.map(f => ({ url: f.url, sha256: job.spec.contentHash ?? f.sha256, archiveSha256: f.sha256 }))
  const digest = job.spec.contentHash ?? await sha256(JSON.stringify(files.map(f => ({ url: f.url, sha256: f.sha256 }))))
  const duplicate = await one(db, "SELECT id,row_count FROM bm_code_releases WHERE kind=? AND effective_on=? AND sha256=? AND status='ready'", job.spec.kind, job.spec.effectiveOn, digest)
  if (duplicate) {
    const receipt = { id: duplicate.id, duplicate: true, changed: false, rows: duplicate.row_count, incompleteAttempt: job.release_id }
    await advanceImport(db, who, job, { phase: 'complete', receipt }, [stmt(db, 'DELETE FROM bm_code_import_chunks WHERE release_id=?', job.release_id)])
    return receipt
  }
  const prior = await one(db, "SELECT id FROM bm_code_releases WHERE kind=? AND status='ready' AND effective_on<=? ORDER BY effective_on DESC,completed_at DESC,id DESC LIMIT 1", job.spec.kind, job.spec.effectiveOn)
  const comparable = (name: string) => job.spec.kind === 'ptp' ? `${name}.payload` : `json_remove(${name}.payload,'$.effectiveOn')`
  const difference = await one(db, `SELECT
    (SELECT COUNT(*) FROM bm_code_items n WHERE n.release_id=? AND NOT EXISTS(SELECT 1 FROM bm_code_items p WHERE p.release_id=? AND p.item_key=n.item_key)) AS added,
    (SELECT COUNT(*) FROM bm_code_items p WHERE p.release_id=? AND NOT EXISTS(SELECT 1 FROM bm_code_items n WHERE n.release_id=? AND n.item_key=p.item_key)) AS removed,
    (SELECT COUNT(*) FROM bm_code_items n JOIN bm_code_items p ON p.release_id=? AND p.item_key=n.item_key WHERE n.release_id=? AND ${comparable('n')}<>${comparable('p')}) AS changed`, job.release_id, prior?.id ?? '', prior?.id ?? '', job.release_id, prior?.id ?? '', job.release_id)
  const receipt = { id: job.release_id, duplicate: false, changed: true, rows: job.row_count, changes: difference }
  await advanceImport(db, who, job, { phase: 'complete', receipt }, [
    guard(db, '(SELECT COUNT(*) FROM bm_code_items WHERE release_id=?)=?', job.release_id, job.row_count),
    stmt(db, "UPDATE bm_code_releases SET status='ready',files=?,sha256=?,row_count=?,completed_at=? WHERE id=? AND status='loading'", JSON.stringify(files), digest, job.row_count, now(), job.release_id), guard(db, 'changes()=1'),
    stmt(db, 'DELETE FROM bm_code_import_chunks WHERE release_id=?', job.release_id),
    audit(db, who, 'codes.release_loaded', null, job.release_id, `${job.spec.kind} ${job.spec.version}; ${job.row_count} rows`)])
  return receipt
}
