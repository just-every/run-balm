import { clinicalClient } from '../intake/records'
import { episodeChoice } from '../episodes'
import { breakGlassOpen, openBreakGlass } from '../domain/care-team'
import { attachment, attachmentResponse } from '../messages/attachments'
import { audit, commit, day, guard, human, insist, now, one, optional, practitionerId, rows, stmt, text, type Actor, type Data } from '../domain/model'

export const documentTypes = [['referral','Referral'],['imaging','Imaging report'],['order','Physician order'],['signed_plan','Signed plan of care'],['photo','Photo'],['other','Other document']] as const
export const clinicalActor = (who: Actor) => {
  human(who)
  insist(who.role === 'owner' || !!practitionerId(who), 'clinical_access_required', 403)
}
/** Ct 19 Oct: every treating practitioner sees all uploaded chart documents, and
 * CHART-013 open break glass reads them too. Uploading still needs a visit. */
export function documentScope(db: D1Database, who: Actor, clientId: string) {
  return guard(db, `EXISTS(SELECT 1 FROM bm_clients c WHERE c.id=? AND c.erased_at IS NULL AND
    (?='owner' OR EXISTS(SELECT 1 FROM bm_appointments a WHERE a.client_id=c.id AND a.practitioner_id=?) OR ${breakGlassOpen}))`, clientId, who.role, practitionerId(who) ?? '', clientId, practitionerId(who) ?? '', now())
}

/** Who reads uploaded documents: the owner, a treating practitioner, or open break glass (with its reason). */
export async function documentReader(db: D1Database, who: Actor, clientId: string) {
  clinicalActor(who)
  if (who.role === 'owner') return { breakGlass: null }
  const own = practitionerId(who)!
  insist(await one(db, 'SELECT 1 FROM bm_clients WHERE id=? AND erased_at IS NULL', clientId), 'client_not_found', 404)
  if (await one(db, 'SELECT 1 FROM bm_appointments WHERE client_id=? AND practitioner_id=?', clientId, own)) return { breakGlass: null }
  const glass = await openBreakGlass(db, clientId, own)
  insist(glass, 'document_not_found', 404)
  return { breakGlass: glass.reason as string }
}

export async function uploadDocument(db: D1Database, who: Actor, input: Data) {
  clinicalActor(who)
  const clientId = text(input.clientId, 'client', 100)
  await clinicalClient(db, who, clientId)
  const upload = await attachment(input)
  insist(upload, 'choose_a_chart_document')
  const title = text(input.title, 'document_title', 160), kind = text(input.documentType, 'document_type', 30)
  insist(documentTypes.some(([key]) => key === kind), 'invalid_document_type')
  const date = day(input.documentDate, 'document_date'), search = optional(input.searchText, 'document_search_text', 8000) ?? ''
  const filing = await episodeChoice(db, who, clientId, 'document', upload.id, input.episodeId)
  await commit(db, who, [documentScope(db, who, clientId), ...filing,
    stmt(db, `INSERT INTO bm_chart_documents(id,client_id,title,document_type,document_date,search_text,filename,mime,byte_length,content_base64,sha256,created_at,created_by)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)`, upload.id, clientId, title, kind, date, search, upload.filename, upload.mime, upload.byteLength, upload.content, upload.digest, now(), who.email),
    audit(db, who, 'chart.document_uploaded', clientId, upload.id),
  ])
  return { id: upload.id, clientId }
}

/** Search reads metadata and entered text, never the original file's bytes. */
export async function documentsFor(db: D1Database, who: Actor, clientId: string) {
  await documentReader(db, who, clientId)
  return rows(db, `SELECT f.id,f.title,CASE WHEN EXISTS(SELECT 1 FROM bm_letter_deliveries d WHERE d.document_id=f.id) THEN 'progress_letter' ELSE f.document_type END AS document_type,f.document_date,f.search_text,f.filename,f.mime,f.byte_length,f.sha256,f.created_at,f.created_by,cert.plan_id,cert.episode_id AS certification_episode,cert.signature_date,cert.certification_date,cert.filed_at,cert.filed_by
    FROM bm_chart_documents f LEFT JOIN bm_plan_certifications cert ON cert.document_id=f.id WHERE f.client_id=? ORDER BY f.document_date DESC,f.id`, clientId)
}

export async function downloadDocument(db: D1Database, who: Actor, key: string) {
  clinicalActor(who)
  const file = await one(db, 'SELECT * FROM bm_chart_documents WHERE id=?', text(key, 'document', 100))
  insist(file, 'document_not_found', 404)
  const reader = await documentReader(db, who, file.client_id)
  await commit(db, who, [documentScope(db, who, file.client_id), audit(db, who, 'chart.document_downloaded', file.client_id, file.id, reader.breakGlass ? `break glass: ${reader.breakGlass}` : '')])
  return attachmentResponse({ filename: file.filename, mime: file.mime, content: file.content_base64, digest: file.sha256 })
}
