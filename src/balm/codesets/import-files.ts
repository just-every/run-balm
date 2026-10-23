import { insist, rows, stmt, type Actor } from '../domain/model'
import { advanceImport, type ImportJob } from './import-store'
import { zipMembers } from './archive'
import { hcpcs, icdOrder, licensedCpt, mue, ptp } from './parsers'
export const CHUNK_BYTES = 512000
export const hashBytes = async (bytes: Uint8Array) => [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes as Uint8Array<ArrayBuffer>))].map(b => b.toString(16).padStart(2, '0')).join('')
export async function downloadArchive(url: string, fetcher: typeof fetch) {
  const response = await fetcher(url, { redirect: 'manual' })
  insist(response.ok, 'cms_release_download_failed', 424)
  insist(Number(response.headers.get('content-length') ?? 0) <= 64000000, 'cms_archive_too_large_for_this_update', 413)
  const reader = response.body!.getReader(), parts: Uint8Array[] = []; let size = 0
  try { for (;;) { const { done, value } = await reader.read(); if (done) break; size += value.length; insist(size <= 64000000, 'cms_archive_too_large_for_this_update', 413); parts.push(value) } }
  finally { await reader.cancel(); reader.releaseLock() }
  const bytes = new Uint8Array(size); let at = 0
  for (const part of parts) { bytes.set(part, at); at += part.length }
  return bytes
}
/** Stage one compressed archive; a large download can take several explicit
 * requests. Its first hash pins all subsequent downloads to the same bytes. */
export async function stageArchive(db: D1Database, who: Actor, job: ImportJob, bytes: Uint8Array, budget: { left: number }) {
  const digest = await hashBytes(bytes), index = job.file_index, source = job.spec.files[index]
  insist(!source?.sha256 || source.sha256 === digest, 'cms_file_digest_does_not_match_release_not_published', 409)
  const existing = job.manifest[index]
  insist(!existing || existing.sha256 === digest, 'cms_archive_changed_resume_requires_the_original_bytes', 409)
  const file = existing ?? { url: source?.url ?? 'deployment-licensed-file', sha256: digest, size: bytes.length, chunks: Math.ceil(bytes.length / CHUNK_BYTES), staged: 0, verified: false }
  insist(file.chunks > 0, 'code_archive_is_empty')
  while (file.staged < file.chunks && budget.left > 0) {
    const chunk = file.staged, manifest = [...job.manifest]
    manifest[index] = { ...file, staged: chunk + 1 }
    await advanceImport(db, who, job, { manifest }, [stmt(db, 'INSERT INTO bm_code_import_chunks(release_id,file_index,chunk_index,body) VALUES(?,?,?,?)', job.release_id, index, chunk, bytes.slice(chunk * CHUNK_BYTES, (chunk + 1) * CHUNK_BYTES).buffer)])
    file.staged++; budget.left--
  }
  if (file.staged === file.chunks && budget.left > 0) { await advanceImport(db, who, job, { phase: 'parse' }); budget.left-- }
}
export async function storedArchive(db: D1Database, job: ImportJob) {
  const file = job.manifest[job.file_index], bytes = new Uint8Array(file.size)
  // Do not materialize all D1 BLOBs beside a second complete archive buffer.
  for (let from = 0; from < file.chunks; from += 16) {
    const chunks = await rows(db, 'SELECT chunk_index,body FROM bm_code_import_chunks WHERE release_id=? AND file_index=? AND chunk_index>=? AND chunk_index<? ORDER BY chunk_index', job.release_id, job.file_index, from, from + 16)
    insist(chunks.length === Math.min(16, file.chunks - from), 'code_archive_chunk_missing', 409)
    for (const chunk of chunks) bytes.set(new Uint8Array(chunk.body), chunk.chunk_index * CHUNK_BYTES)
  }
  insist(await hashBytes(bytes) === file.sha256, 'stored_code_archive_digest_mismatch', 409)
  return bytes
}
const validMember = (kind: string, name: string) => kind === 'icd10' ? /icd10cm_order_\d{4}\.txt$/i.test(name) : kind === 'hcpcs' ? /ANWEB[^/]*\.txt$/i.test(name) : kind === 'ptp' ? /ccipra[^/]*\.txt$/i.test(name) : /PractitionerServices[^/]*\.csv$/i.test(name)
async function* cptText(bytes: Uint8Array) {
  const stream = new Blob([bytes.buffer as ArrayBuffer]).stream().pipeThrough(new DecompressionStream('gzip')).pipeThrough(new TextDecoderStream())
  const reader = stream.getReader()
  try { for (;;) { const { done, value } = await reader.read(); if (done) break; yield value } } finally { await reader.cancel(); reader.releaseLock() }
}
export function archiveRows(bytes: Uint8Array, job: ImportJob) {
  if (job.spec.kind === 'cpt') return licensedCpt(cptText(bytes), job.spec, job.spec.mapping!)
  const members = zipMembers(bytes).filter(m => validMember(job.spec.kind, m.name))
  insist(members.length === 1, 'cms_archive_does_not_contain_one_expected_complete_data_file')
  const parser = job.spec.kind === 'icd10' ? icdOrder : job.spec.kind === 'hcpcs' ? hcpcs : job.spec.kind === 'ptp' ? ptp : mue
  return parser(members[0].chunks(), job.spec)
}
