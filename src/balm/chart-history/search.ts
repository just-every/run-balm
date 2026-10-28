import { existingHistory } from './records'
import { episodeIndex } from '../episodes'
import { rows } from '../domain/model'
import { audit, commit, day, insist, integer, optional, practitionerId, type Actor, type Data } from '../domain/model'
import { clinicalActor, documentReader, documentsFor, documentScope, documentTypes } from './documents'

const PAGE_SIZE = 50
const fold = (value: string) => value.toLocaleLowerCase('en-US')
export const historyTypes = [...documentTypes, ['progress_letter','Progress letter'], ['note','Treatment note'], ['intake','Intake form'], ['plan','Plan of care'], ['consent','Signed consent'], ['insurance_card','Insurance card'], ['identity','Photo ID'], ['historical_note','Historical note'], ['message','Secure message'], ['message_attachment','Message attachment']] as const

/** Existing notes/intake keep their current scope; only uploads use shared clinical access. */
export async function chartHistory(db: D1Database, who: Actor, file: Data, zone: string, input: Data = {}) {
  clinicalActor(who)
  const clientId = file.client.id as string
  const query = optional(input.historyText, 'history_text', 200) ?? ''
  const from = input.historyFrom ? day(input.historyFrom, 'history_from') : '', to = input.historyTo ? day(input.historyTo, 'history_to') : ''
  insist(!from || !to || from <= to, 'history_dates_out_of_order')
  const kind = optional(input.historyType, 'history_type', 30) ?? ''
  insist(!kind || historyTypes.some(([key]) => key === kind), 'invalid_history_type')
  const page = input.historyPage ? integer(input.historyPage, 'history_page', 1, 1_000_000) : 1
  // REF-003: every record carries its episode; 'none' finds records no episode holds.
  const index = await episodeIndex(db, clientId)
  const episode = optional(input.historyEpisode, 'history_episode', 100) ?? ''
  insist(!episode || episode === 'none' || index.episodes.some(e => e.id === episode), 'episode_not_found', 404)
  // A CHART-013 care-team grant reads notes only; uploaded documents need a visit or open break glass.
  const reader = await documentReader(db, who, clientId).catch(() => null)
  const documents = reader ? await documentsFor(db, who, clientId) : []
  const records: Data[] = documents.map(d => ({ id:d.id, title:d.title, type:d.document_type, date:d.document_date, text:[d.title,d.filename,d.search_text].join('\n'),
    filename:d.filename, byteLength:d.byte_length, planId:d.plan_id, certificationEpisode:d.certification_episode, signatureDate:d.signature_date, certificationDate:d.certification_date, filedAt:d.filed_at, filedBy:d.created_by, url:'/api/balm/chart-documents/'+d.id, action:'Download original', audit:'chart.document_read' }))
  records.push(...existingHistory(file,zone))
  const responses = new Map((await rows(db, `SELECT r.id AS response_id,r.appointment_id,c.id AS consent_id,i.id AS insurance_id,d.id AS identity_id FROM bm_intake_responses r
    LEFT JOIN bm_intake_consents c ON c.response_id=r.id LEFT JOIN bm_intake_insurance i ON i.response_id=r.id LEFT JOIN bm_intake_identity d ON d.response_id=r.id WHERE r.client_id=?`, clientId))
    .flatMap(r => [r.response_id, r.consent_id, r.insurance_id, r.identity_id].filter(Boolean).map(k => [k as string, r.appointment_id as string])))
  const visitOf = (key: string) => responses.has(key) ? index.of('visit', responses.get(key)!) : ''
  const byId = (list: Data[] | null | undefined) => new Map((list ?? []).map(x => [x.id as string, x.episodeId as string]))
  const notes = byId(file.notes), plans = byId(file.plans)
  const episodeOf: Record<string, (r: Data) => string> = {
    note: r => notes.get(r.id) ?? '', plan: r => plans.get(r.id) ?? '', intake: r => visitOf(r.id), consent: r => visitOf(r.id),
    insurance_card: r => visitOf(String(r.id).replace(/-(front|back)$/, '')), identity: r => visitOf(r.id),
    historical_note: r => index.of('historical_note', r.id), message: r => index.of('message', r.id), message_attachment: r => index.of('message', r.messageId),
  }
  for (const r of records) r.episodeId = r.planId ? (r.certificationEpisode ?? '') : (episodeOf[r.type] ?? (x => index.of('document', x.id)))(r)
  const matching = records.filter(r => (!kind || r.type===kind) && (!episode || r.episodeId === (episode === 'none' ? '' : episode)) && ((!from && !to) || (r.date && (!from || r.date>=from) && (!to || r.date<=to))) && (!query || fold(r.text).includes(fold(query))))
    .sort((a,b)=>b.date.localeCompare(a.date)||a.id.localeCompare(b.id))
  const selected = matching.slice((page-1)*PAGE_SIZE,page*PAGE_SIZE)
  await commit(db, who, [...(reader ? [documentScope(db, who, clientId)] : []), audit(db, who, 'chart.history_searched', clientId),
    // Existing file readers already audit their records once per request.
    ...selected.filter(r=>r.audit==='chart.document_read').map(r=>audit(db,who,r.audit,clientId,r.id,reader?.breakGlass?`break glass: ${reader.breakGlass}`:'')),
  ])
  return { filters:{historyText:query,historyFrom:from,historyTo:to,historyType:kind,historyEpisode:episode}, page, pageSize:PAGE_SIZE, total:matching.length,
    entries:selected.map(({text,audit,messageId,...r})=>r) }
}

/** Administrative file reads carry no history metadata, count or search results. */
export async function fileHistory(db: D1Database, who: Actor, file: Data, zone: string, input: Data = {}) {
  return who.role==='owner'||(who.role!=='agent'&&practitionerId(who)) ? chartHistory(db,who,file,zone,input) : null
}
