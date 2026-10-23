import { integer, stmt, text, type Actor, type Data } from '../domain/model'
import type { CodeRow } from './types'
import { archiveRows, downloadArchive, stageArchive, storedArchive } from './import-files'
import { advanceImport, importJob, incompleteReceipt } from './import-store'
import { publishImport } from './import-publish'
const INSERT_ROWS = `INSERT INTO bm_code_items(release_id,item_key,code,description,billable,code2,effective_on,deleted_on,modifier,max_units,adjudication,timed,payload)
 SELECT ?,json_extract(value,'$.key'),json_extract(value,'$.code'),json_extract(value,'$.description'),json_extract(value,'$.billable'),json_extract(value,'$.code2'),json_extract(value,'$.effectiveOn'),json_extract(value,'$.deletedOn'),json_extract(value,'$.modifier'),json_extract(value,'$.maxUnits'),json_extract(value,'$.adjudication'),json_extract(value,'$.timed'),value FROM json_each(?)`
export const IMPORT_BATCH_LIMIT = 64
/** Every write (staging, cursor, rows, final publication) spends one batch. Each
 * batch has a fixed number of queries, below the paid Worker's request budget. */
export async function continueCodeImport(db: D1Database, who: Actor, input: Data, fetcher: typeof fetch = fetch, allowance = IMPORT_BATCH_LIMIT) {
  const job = await importJob(db, who, text(input.resumeId, 'resume_id', 100))
  if (job.phase === 'complete') return job.receipt!
  const budget = { left: Math.min(allowance, integer(input.batchLimit ?? IMPORT_BATCH_LIMIT, 'import_batch_limit', 1, IMPORT_BATCH_LIMIT)) }
  while (budget.left > 0) {
    if (job.phase === 'download') {
      const file = job.manifest[job.file_index]
      if (file && file.staged === file.chunks) { await advanceImport(db, who, job, { phase: 'parse' }); budget.left--; continue }
      await stageArchive(db, who, job, await downloadArchive(job.spec.files[job.file_index].url, fetcher), budget)
      if (job.phase !== 'parse') break
    }
    if (job.phase === 'parse' && budget.left > 0) {
      const bytes = await storedArchive(db, job), cursor = job.row_cursor
      let seen = 0, pending: CodeRow[] = [], exhausted = true
      const flush = async () => {
        if (!pending.length) return
        const count = pending.length
        await advanceImport(db, who, job, { row_cursor: job.row_cursor + count, row_count: job.row_count + count }, [stmt(db, INSERT_ROWS, job.release_id, JSON.stringify(pending))])
        budget.left--; pending = []
      }
      // Re-read the pinned archive and skip committed rows. Only exhaustion
      // reaches the decoder's final CRC and size checks; stopping early cannot
      // mark a file verified or make its release available to billing.
      for await (const row of archiveRows(bytes, job)) {
        if (seen++ < cursor) continue
        pending.push(row)
        if (pending.length === 500) { await flush(); if (!budget.left) { exhausted = false; break } }
      }
      if (pending.length && budget.left > 0) await flush()
      if (!exhausted) break
      if (!budget.left) break // recheck EOF/CRC explicitly on the next request
      const manifest = [...job.manifest]; manifest[job.file_index] = { ...manifest[job.file_index], verified: true }
      const index = job.file_index + 1
      await advanceImport(db, who, job, { manifest, file_index: index, row_cursor: 0, phase: index === (job.spec.kind === 'cpt' ? 1 : job.spec.files.length) ? 'publish' : 'download' })
      budget.left--
    }
    if (job.phase === 'publish' && budget.left > 0) return publishImport(db, who, job)
  }
  return incompleteReceipt(job)
}
