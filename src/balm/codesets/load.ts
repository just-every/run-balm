import { commit, id, insist, now, one, rows, sha256, stmt, type Actor, type Data } from '../domain/model'
import { releaseSpec, verifyCmsListing } from './sources'
import { downloadArchive, hashBytes, stageArchive } from './import-files'
import { importJob, importOwner, type ImportSpec } from './import-store'
import { continueCodeImport, IMPORT_BATCH_LIMIT } from './import-run'
export { continueCodeImport } from './import-run'

async function startImport(db: D1Database, who: Actor, spec: ImportSpec) {
  const key = id()
  await commit(db, who, [stmt(db, "INSERT INTO bm_code_releases(id,kind,version,effective_on,next_due_on,source_page,files,sha256,status,license_basis,loaded_by,loaded_at) VALUES(?,?,?,?,?,?,?,?,'loading',?,?,?)", key, spec.kind, spec.version, spec.effectiveOn, spec.nextDueOn, spec.sourcePage, '[]', 'pending:' + key, spec.licenseBasis, who.email, now()),
    stmt(db, 'INSERT INTO bm_code_imports(release_id,owner_id,spec) VALUES(?,?,?)', key, who.id, JSON.stringify(spec))])
  return key
}
/** The first request verifies CMS's listing and pins the complete manifest.
 * Explicit continuations accept only the job ID, never replacement rows/files. */
export async function updateCodes(db: D1Database, who: Actor, input: Data, fetcher: typeof fetch = fetch) {
  importOwner(who)
  if (input.resumeId) return continueCodeImport(db, who, input, fetcher)
  const spec = releaseSpec(input)
  insist(spec.kind !== 'cpt', 'upload_your_deployments_licensed_cpt_file')
  await verifyCmsListing(spec, fetcher)
  const installed = await rows(db, "SELECT id,row_count,sha256 FROM bm_code_releases WHERE kind=? AND effective_on=? AND status='ready'", spec.kind, spec.effectiveOn)
  if (installed.length) {
    const observed = []
    for (const file of spec.files) {
      const bytes = await downloadArchive(file.url, fetcher), digest = await hashBytes(bytes)
      insist(!file.sha256 || file.sha256 === digest, 'cms_file_digest_does_not_match_release_not_published', 409)
      observed.push({ url: file.url, sha256: digest })
    }
    const digest = await sha256(JSON.stringify(observed)), same = installed.find(r => r.sha256 === digest)
    if (same) return { id: same.id, duplicate: true, changed: false, rows: same.row_count }
    // These observations are immutable expected hashes for the new job.
    spec.files = observed
  }
  const key = await startImport(db, who, spec)
  return continueCodeImport(db, who, { resumeId: key, batchLimit: input.batchLimit }, fetcher, IMPORT_BATCH_LIMIT - 1)
}
export async function importLicensedCpt(db: D1Database, who: Actor, input: Data) {
  importOwner(who)
  const spec: ImportSpec = releaseSpec({ ...input, kind: 'cpt' }), content = input.content
  insist(typeof content === 'string' && content.trim().length > 0 && content.length <= 20000000, 'choose_your_deployments_licensed_cpt_file')
  const plain = new TextEncoder().encode(content)
  insist(plain.length <= 20000000, 'licensed_cpt_file_too_large', 413)
  spec.mapping = input.mapping; spec.contentHash = await sha256(content)
  const duplicate = await one(db, "SELECT id,row_count FROM bm_code_releases WHERE kind='cpt' AND effective_on=? AND sha256=? AND status='ready'", spec.effectiveOn, spec.contentHash)
  if (duplicate) return { id: duplicate.id, duplicate: true, changed: false, rows: duplicate.row_count }
  const bytes = new Uint8Array(await new Response(new Blob([plain.buffer]).stream().pipeThrough(new CompressionStream('gzip'))).arrayBuffer())
  const key = await startImport(db, who, spec), job = await importJob(db, who, key), budget = { left: IMPORT_BATCH_LIMIT - 1 }
  // A licensed upload is staged in this request; later requests read only its
  // private compressed chunks, never ask the owner to resend or expose a URL.
  await stageArchive(db, who, job, bytes, budget)
  return continueCodeImport(db, who, { resumeId: key, batchLimit: input.batchLimit }, fetch, budget.left)
}
