import { commit, guard, human, insist, one, stmt, type Actor, type Data } from '../domain/model'
import type { ReleaseSpec } from './types'
import type { CptMapping } from './parsers'
export type ImportSpec = ReleaseSpec & { mapping?: CptMapping; contentHash?: string }
export type ImportFile = { url: string; sha256: string; size: number; chunks: number; staged: number; verified: boolean }
export type ImportJob = { release_id: string; owner_id: string; spec: ImportSpec; manifest: ImportFile[]; file_index: number; row_cursor: number; row_count: number; phase: string; version: number; receipt?: Data }
export function importOwner(who: Actor) { human(who); insist(who.role === 'owner', 'only_the_owner_updates_code_sets', 403) }
export async function importJob(db: D1Database, who: Actor, key: string): Promise<ImportJob> {
  importOwner(who)
  const row = await one(db, 'SELECT * FROM bm_code_imports WHERE release_id=?', key)
  insist(row && row.owner_id === who.id, 'code_import_not_found_for_this_owner', 404)
  return { ...row, spec: JSON.parse(row.spec), manifest: JSON.parse(row.manifest), receipt: row.receipt ? JSON.parse(row.receipt) : undefined } as ImportJob
}
/** The cursor and its corresponding rows/chunks advance in one guarded batch.
 * A racing or replayed request cannot append the same work twice. */
export async function advanceImport(db: D1Database, who: Actor, job: ImportJob, changes: Partial<ImportJob>, writes: D1PreparedStatement[] = []) {
  const next = { ...job, ...changes }
  await commit(db, who, [stmt(db, `UPDATE bm_code_imports SET manifest=?,file_index=?,row_cursor=?,row_count=?,phase=?,receipt=?,version=version+1 WHERE release_id=? AND owner_id=? AND version=?`,
    JSON.stringify(next.manifest), next.file_index, next.row_cursor, next.row_count, next.phase, next.receipt ? JSON.stringify(next.receipt) : null, job.release_id, who.id, job.version), guard(db, 'changes()=1'),
    guard(db, "EXISTS(SELECT 1 FROM bm_code_releases WHERE id=? AND status='loading')", job.release_id), ...writes])
  Object.assign(job, next, { version: job.version + 1 })
}
export function incompleteReceipt(job: ImportJob) {
  return { status: 'incomplete', id: job.release_id, rows: job.row_count, fileIndex: job.file_index, rowCursor: job.row_cursor, phase: job.phase,
    files: job.manifest.map(f => ({ url: f.url, sha256: f.sha256, stagedChunks: f.staged, chunks: f.chunks, verified: f.verified })),
    continue: { name: 'codes.update.continue', input: { resumeId: job.release_id } } }
}
