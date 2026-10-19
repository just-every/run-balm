import { existingHistory } from './records'
import { audit, commit, day, insist, integer, optional, practitionerId, type Actor, type Data } from '../domain/model'
import { clinicalActor, documentsFor, documentScope, documentTypes } from './documents'

const PAGE_SIZE = 50
const fold = (value: string) => value.toLocaleLowerCase('en-US')
export const historyTypes = [...documentTypes, ['note','Treatment note'], ['intake','Intake form'], ['plan','Plan of care'], ['consent','Signed consent'], ['insurance_card','Insurance card'], ['identity','Photo ID'], ['historical_note','Historical note'], ['message','Secure message'], ['message_attachment','Message attachment']] as const

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
  const documents = await documentsFor(db, who, clientId)
  const records: Data[] = documents.map(d => ({ id:d.id, title:d.title, type:d.document_type, date:d.document_date, text:[d.title,d.filename,d.search_text].join('\n'),
    filename:d.filename, byteLength:d.byte_length, filedBy:d.created_by, url:'/api/balm/chart-documents/'+d.id, action:'Download original', audit:'chart.document_read' }))
  records.push(...existingHistory(file,zone))
  const matching = records.filter(r => (!kind || r.type===kind) && ((!from && !to) || (r.date && (!from || r.date>=from) && (!to || r.date<=to))) && (!query || fold(r.text).includes(fold(query))))
    .sort((a,b)=>b.date.localeCompare(a.date)||a.id.localeCompare(b.id))
  const selected = matching.slice((page-1)*PAGE_SIZE,page*PAGE_SIZE)
  await commit(db, who, [documentScope(db, who, clientId), audit(db, who, 'chart.history_searched', clientId),
    // Existing file readers already audit their records once per request.
    ...selected.filter(r=>r.audit==='chart.document_read').map(r=>audit(db,who,r.audit,clientId,r.id)),
  ])
  return { filters:{historyText:query,historyFrom:from,historyTo:to,historyType:kind}, page, pageSize:PAGE_SIZE, total:matching.length,
    entries:selected.map(({text,audit,...r})=>r) }
}

/** Administrative file reads carry no history metadata, count or search results. */
export async function fileHistory(db: D1Database, who: Actor, file: Data, zone: string, input: Data = {}) {
  return who.role==='owner'||(who.role!=='agent'&&practitionerId(who)) ? chartHistory(db,who,file,zone,input) : null
}
