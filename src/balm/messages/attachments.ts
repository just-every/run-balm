import { audit, commit, id, insist, one, sha256, stmt, type Actor, type Data } from '../domain/model'
import { messageActor, messageClient, clientAuthority } from './access'
import { patientActor, patientGuard, patientLink } from './links'
import { staffScope } from './routing'

export interface MessageAttachment { id: string; filename: string; mime: string; byteLength: number }
export interface Upload extends MessageAttachment { content: string; digest: string }
export const attachmentInput = '<label>Attachment (JPEG, PNG, WebP or PDF, up to 1 MB)<input type="file" name="attachment" accept="image/jpeg,image/png,image/webp,application/pdf"></label>'

/** One bounded original per message, checked by its bytes rather than its extension. */
export async function attachment(input: Data): Promise<Upload | null> {
  if (input.attachment === undefined || input.attachment === '') return null
  insist(typeof input.attachment === 'string' && input.attachment.length <= 1_333_450, 'attachment_too_large', 413)
  const match = /^data:(image\/(?:jpeg|png|webp)|application\/pdf);base64,([A-Za-z0-9+/]+={0,2})$/.exec(input.attachment)
  insist(match, 'choose_a_jpeg_png_webp_or_pdf_attachment')
  let bytes: Uint8Array
  try { bytes = Uint8Array.from(atob(match[2]), c => c.charCodeAt(0)) } catch { insist(false, 'invalid_attachment') }
  insist(bytes.length > 12 && bytes.length <= 1_000_000, 'attachment_too_large', 413)
  const mime = match[1]
  const start = String.fromCharCode(...bytes.slice(0, 12))
  insist(mime === 'image/jpeg' ? bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255
    : mime === 'image/png' ? [137,80,78,71,13,10,26,10].every((n,i) => bytes[i] === n)
    : mime === 'image/webp' ? start.startsWith('RIFF') && start.slice(8) === 'WEBP' : start.startsWith('%PDF-'), 'invalid_attachment')
  const filename = typeof input.attachmentName === 'string' ? input.attachmentName : 'attachment'
  insist(filename.length <= 180 && filename.trim() && !/[\x00-\x1f\x7f/\\]/.test(filename), 'invalid_attachment_filename')
  let binary = ''; for (let i = 0; i < bytes.length; i += 8192) binary += String.fromCharCode(...bytes.subarray(i, i + 8192))
  const content = btoa(binary)
  return { id: id(), filename: filename.trim(), mime, byteLength: bytes.length, content, digest: await sha256(content) }
}

export function attachmentWrites(db: D1Database, messageId: string, upload: Upload | null) {
  return upload ? [stmt(db, 'INSERT INTO bm_message_attachments(id,message_id,filename,mime,byte_length,content_base64,sha256) VALUES(?,?,?,?,?,?,?)',
    upload.id, messageId, upload.filename, upload.mime, upload.byteLength, upload.content, upload.digest)] : []
}

export async function uploadField(file: File) {
  insist(file.size <= 1_000_000, 'attachment_too_large', 413)
  let binary = ''; const bytes = new Uint8Array(await file.arrayBuffer())
  for (let i = 0; i < bytes.length; i += 8192) binary += String.fromCharCode(...bytes.subarray(i, i + 8192))
  return { attachment: `data:${file.type};base64,${btoa(binary)}`, attachmentName: file.name }
}

export async function attachmentRecord(db: D1Database, key: string) {
  const file = await one<MessageAttachment & { content: string; digest: string; clientId: string; route: string; practitionerId: string | null; messageId: string }>(db,
    `SELECT f.id,f.filename,f.mime,f.byte_length AS byteLength,f.content_base64 AS content,f.sha256 AS digest,
    m.client_id AS clientId,m.id AS messageId,m.route,m.practitioner_id AS practitionerId FROM bm_message_attachments f JOIN bm_messages m ON m.id=f.message_id WHERE f.id=?`, key)
  insist(file, 'attachment_not_found', 404)
  return file
}
export async function attachmentResponse(file: Awaited<ReturnType<typeof attachmentRecord>>) {
  insist(await sha256(file.content) === file.digest, 'attachment_integrity_error', 409)
  return new Response(Uint8Array.from(atob(file.content), c => c.charCodeAt(0)), { headers: {
    'content-type': file.mime, 'content-disposition': `attachment; filename="attachment.${file.mime === 'application/pdf' ? 'pdf' : file.mime.split('/')[1]}"; filename*=UTF-8''${encodeURIComponent(file.filename).replace(/['()*]/g, c => '%' + c.charCodeAt(0).toString(16))}`,
    'cache-control': 'no-store', 'referrer-policy': 'no-referrer', 'x-content-type-options': 'nosniff', 'content-security-policy': "default-src 'none'",
  } })
}
export async function clinicAttachment(db: D1Database, who: Actor, key: string) {
  const live = await messageActor(db, who), file = await attachmentRecord(db, key)
  await messageClient(db, live, file.clientId)
  const scope = staffScope(live)
  insist(await one(db, `SELECT 1 FROM bm_messages m WHERE m.id=? AND (${scope.sql})`, file.messageId, ...scope.values), 'attachment_not_found', 404)
  await commit(db, live, [clientAuthority(db, live, file.clientId), audit(db, live, 'message.attachment_downloaded', file.clientId, file.id)])
  return attachmentResponse(file)
}
export async function linkAttachment(db: D1Database, token: string, key: string) {
  const link = await patientLink(db, token), file = await attachmentRecord(db, key)
  insist(file.clientId === link.client_id && file.route === link.route && (file.practitionerId === link.practitioner_id || (link.route === 'practitioner' && link.practitioner_id !== null && file.practitionerId === null)), 'attachment_not_found', 404)
  await commit(db, null, [patientGuard(db, link), audit(db, patientActor, 'message.attachment_downloaded', file.clientId, file.id)])
  return attachmentResponse(file)
}
