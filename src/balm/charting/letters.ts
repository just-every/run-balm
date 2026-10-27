import { audit, commit, guard, human, id, insist, now, one, practitionerId, rows, sha256, stmt, text, type Actor, type Data } from '../domain/model'
import { documentReader, documentScope } from '../chart-history/documents'
import { episodeIndex } from '../episodes'
import { pdf } from '../payments/pdf'
import { attachmentResponse } from '../messages/attachments'
import { portalGuard, type Patient } from '../portal/auth'
import { guardianActor } from '../portal/guardians'

const author = (who: Actor) => { human(who); const key = practitionerId(who); insist(key, 'only_practitioners_write_letters', 403); return key }
const encoded = (bytes: Uint8Array) => { let value = ''; for (const byte of bytes) value += String.fromCharCode(byte); return btoa(value) }
async function original(snapshot: Data, body: string) {
  const bytes = pdf({header:snapshot.clinic,title:'Progress letter',blocks:[{kind:'facts',rows:[['Patient',snapshot.patient],['Date of birth',snapshot.birth || 'Not recorded'],['Episode',snapshot.episode],['Clinician',snapshot.author],['Prepared',snapshot.date]]},{kind:'notes',lines:body.split('\n')}]})
  const content = encoded(bytes)
  const digest = await sha256(content)
  return { content, digest, length:bytes.length }
}
const authorFence = (db: D1Database, who: Actor) => guard(db,"EXISTS(SELECT 1 FROM bm_staff WHERE id=? AND role='practitioner' AND active=1 AND erased_at IS NULL AND version=?)",practitionerId(who) ?? '',who.staffVersion ?? -1)
const delivery = `NOT EXISTS(SELECT 1 FROM bm_letter_deliveries WHERE letter_id=?)`
export async function prepareLetter(db: D1Database, who: Actor, input: Data) {
  const own = author(who), noteId = text(input.noteId,'note',100)
  const note = await one(db, `SELECT n.*,r.body,c.first_name,c.last_name,c.date_of_birth FROM bm_notes n JOIN bm_note_revisions r ON r.note_id=n.id AND r.number=n.signed_revision JOIN bm_clients c ON c.id=n.client_id WHERE n.id=? AND n.author_id=? AND n.signed_at IS NOT NULL AND c.erased_at IS NULL`,noteId,own)
  insist(note,'signed_note_not_found',404)
  await documentReader(db,who,note.client_id)
  const index = await episodeIndex(db,note.client_id)
  const episodeId = index.of('note',note.id) || (note.appointment_id ? index.of('visit',note.appointment_id) : '')
  const clinic = await one(db,'SELECT clinic_name FROM bm_settings WHERE id=1')
  const measures = await rows(db,'SELECT name,value,unit FROM bm_measures WHERE note_id=? ORDER BY id',note.id)
  const snapshot = {clinic:clinic!.clinic_name,patient:note.first_name+' '+note.last_name,birth:note.date_of_birth,episode:index.episodes.find(e=>e.id===episodeId)?.title ?? 'Not assigned to an episode',author:note.signer_name+(note.signer_credentials?', '+note.signer_credentials:''),date:now().slice(0,10)}
  const body = note.body + (measures.length?'\n\nObjective measures\n'+measures.map(m=>`${m.name}: ${m.value} ${m.unit}`).join('\n'):'')
  const file = await original(snapshot,body), key=id(), at=now()
  await commit(db,who,[authorFence(db,who),documentScope(db,who,note.client_id),guard(db,'EXISTS(SELECT 1 FROM bm_notes WHERE id=? AND author_id=? AND signed_sha256=?)',note.id,own,note.signed_sha256),
    stmt(db,'INSERT INTO bm_clinical_letters(id,client_id,episode_id,note_id,author_id,author_email,snapshot,body,revision,content_base64,sha256,byte_length,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,1,?,?,?,?,?)',key,note.client_id,episodeId||null,note.id,own,who.email,JSON.stringify(snapshot),body,file.content,file.digest,file.length,at,at),
    audit(db,who,'letter.prepared',note.client_id,key),audit(db,who,'note.read',note.client_id,note.id)])
  return {id:key,clientId:note.client_id,sha256:file.digest}
}
async function ownDraft(db: D1Database, who: Actor, input: Data) {
  const own=author(who), letter=await one(db,'SELECT * FROM bm_clinical_letters WHERE id=? AND author_id=?',text(input.id,'letter',100),own)
  insist(letter,'letter_not_found',404)
  insist(!await one(db,'SELECT 1 FROM bm_letter_deliveries WHERE letter_id=?',letter.id),'letter_already_delivered',409)
  insist(input.sha256===letter.sha256,'letter_changed_review_again',409)
  return letter
}
export async function editLetter(db: D1Database, who: Actor, input: Data) {
  const letter=await ownDraft(db,who,input), body=text(input.body,'letter_body',20000), file=await original(JSON.parse(letter.snapshot),body)
  await commit(db,who,[authorFence(db,who),documentScope(db,who,letter.client_id),guard(db,delivery,letter.id),stmt(db,'UPDATE bm_clinical_letters SET body=?,content_base64=?,sha256=?,byte_length=?,revision=revision+1,updated_at=? WHERE id=? AND sha256=?',body,file.content,file.digest,file.length,now(),letter.id,letter.sha256),guard(db,'changes()=1'),audit(db,who,'letter.edited',letter.client_id,letter.id)])
  return {id:letter.id,sha256:file.digest}
}
export async function deliverLetter(db: D1Database, who: Actor, input: Data) {
  const letter=await ownDraft(db,who,input)
  insist(input.attest===true||input.attest==='on','review_letter_before_delivery')
  const key=id(),at=now()
  await commit(db,who,[authorFence(db,who),documentScope(db,who,letter.client_id),guard(db,delivery,letter.id),guard(db,'EXISTS(SELECT 1 FROM bm_clinical_letters WHERE id=? AND sha256=?)',letter.id,letter.sha256),
    stmt(db,`INSERT INTO bm_chart_documents(id,client_id,title,document_type,document_date,search_text,filename,mime,byte_length,content_base64,sha256,created_at,created_by) VALUES(?,?,?,'other',?,?,?,'application/pdf',?,?,?,?,?)`,key,letter.client_id,'Progress letter',at.slice(0,10),letter.body,'progress-letter-'+key+'.pdf',letter.byte_length,letter.content_base64,letter.sha256,at,who.email),
    ...(!letter.episode_id?[stmt(db,"DELETE FROM bm_episode_records WHERE record_kind='document' AND record_id=?",key)]:[]),
    ...(letter.episode_id?[stmt(db,`INSERT INTO bm_episode_records(record_kind,record_id,client_id,episode_id,assigned_at,assigned_by) VALUES('document',?,?,?,?,?) ON CONFLICT(record_kind,record_id) DO UPDATE SET episode_id=excluded.episode_id`,key,letter.client_id,letter.episode_id,at,who.email)]:[]),
    stmt(db,`INSERT INTO bm_letter_deliveries(letter_id,document_id,client_id,channel,delivered_at,delivered_by,sha256) VALUES(?,?,?,'portal',?,?,?)`,letter.id,key,letter.client_id,at,who.email,letter.sha256),audit(db,who,'letter.portal_delivered',letter.client_id,letter.id)])
  return {id:letter.id,documentId:key,clientId:letter.client_id,sha256:letter.sha256,channel:'portal'}
}
export async function lettersFor(db: D1Database, who: Actor, clientId: string) {
  if(who.role==='agent'||!practitionerId(who))return null
  const letters=await rows(db,`SELECT l.*,d.document_id,d.delivered_at,d.channel FROM bm_clinical_letters l LEFT JOIN bm_letter_deliveries d ON d.letter_id=l.id WHERE l.client_id=? AND l.author_id=? ORDER BY l.created_at,l.id`,clientId,practitionerId(who))
  if(!letters.length)return []
  await commit(db,who,[documentScope(db,who,clientId),...letters.map(l=>audit(db,who,'letter.read',clientId,l.id))])
  return letters.map(({content_base64,...l})=>l)
}
export async function previewLetter(db: D1Database, who: Actor, key: string) {
  const own=author(who),letter=await one(db,'SELECT * FROM bm_clinical_letters WHERE id=? AND author_id=?',key,own)
  insist(letter,'letter_not_found',404)
  await commit(db,who,[authorFence(db,who),documentScope(db,who,letter.client_id),audit(db,who,'letter.previewed',letter.client_id,key)])
  return attachmentResponse({filename:'progress-letter.pdf',mime:'application/pdf',content:letter.content_base64,digest:letter.sha256})
}
export async function patientLetters(db: D1Database, patient: Patient) {
  const list=await rows(db,`SELECT d.document_id AS id,d.delivered_at,l.snapshot FROM bm_letter_deliveries d JOIN bm_clinical_letters l ON l.id=d.letter_id WHERE d.client_id=? ORDER BY d.delivered_at,d.document_id`,patient.clientId)
  await commit(db,null,[portalGuard(db,patient),...list.map(l=>audit(db,guardianActor(patient),'letter.portal_read',patient.clientId,l.id))])
  return list.map(l=>({id:l.id,deliveredAt:l.delivered_at,author:JSON.parse(l.snapshot).author}))
}
export async function patientLetter(db: D1Database, patient: Patient, key: string) {
  const doc=await one(db,`SELECT f.* FROM bm_letter_deliveries d JOIN bm_chart_documents f ON f.id=d.document_id WHERE d.document_id=? AND d.client_id=?`,key,patient.clientId)
  insist(doc,'document_not_found',404)
  await commit(db,null,[portalGuard(db,patient),audit(db,guardianActor(patient),'letter.portal_downloaded',patient.clientId,key)])
  return attachmentResponse({filename:doc.filename,mime:doc.mime,content:doc.content_base64,digest:doc.sha256})
}
