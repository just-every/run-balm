import { insist, now, one, rows, type Data } from '../domain/model'
import { pdf, type Block } from '../payments/pdf'

const core = 'http://hl7.org/fhir/us/core/StructureDefinition/'
export const base64 = (bytes: Uint8Array) => {
  let value = ''
  for (let i = 0; i < bytes.length; i += 8192) value += String.fromCharCode(...bytes.subarray(i, i + 8192))
  return btoa(value)
}
const encoded = (value: string) => base64(new TextEncoder().encode(value))
const escape = (value: string) => value.replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]!))
const narrative = (value: string) => ({ status: 'generated', div: `<div xmlns="http://www.w3.org/1999/xhtml"><p>${escape(value)}</p></div>` })
const parse = (value: unknown) => typeof value === 'string' && value ? JSON.parse(value) : value
/** Flatten saved clinical fields for a readable record; never retrieve keys,
 * bearer links, other patients' documents, or an assistant's hidden context. */
function readable(value: unknown, prefix = ''): string[] {
  if (value === null || value === undefined || value === '') return []
  if (Array.isArray(value)) return value.flatMap((v, i) => readable(v, `${prefix} ${i + 1}`.trim()))
  if (typeof value === 'object') return Object.entries(value).flatMap(([k,v]) => readable(v, `${prefix} ${k.replace(/([A-Z])/g,' $1')}`.trim()))
  return [`${prefix ? prefix + ': ' : ''}${String(value)}`]
}

/** One export snapshot, collected under the caller's live owner authority and
 * fenced against the retention epoch before it is stored. US Core 6.1.0 on R4. */
export async function recordExport(db: D1Database, clientId: string, packageId: string) {
  const client = await one(db, 'SELECT id,first_name,last_name,date_of_birth,email,phone FROM bm_clients WHERE id=? AND erased_at IS NULL', clientId)
  insist(client, 'client_not_found', 404)
  const clinic = (await one(db, 'SELECT clinic_name,address FROM bm_settings WHERE id=1'))!
  const at = now(), subject = { reference: `Patient/${clientId}` }
  const patient: Data = { resourceType:'Patient', id:clientId, meta:{profile:[core+'us-core-patient']},
    text:narrative(`${client.first_name} ${client.last_name}`), identifier:[{system:'urn:balm:patient',value:clientId}],
    name:[{use:'usual',family:client.last_name,given:[client.first_name]}], gender:'unknown',
    ...(client.date_of_birth ? {birthDate:client.date_of_birth} : {}),
    ...([client.email,client.phone].some(Boolean) ? {telecom:[...(client.email?[{system:'email',value:client.email}]:[]),...(client.phone?[{system:'phone',value:client.phone}]:[])]} : {}) }
  const resources: Data[] = [patient]
  const blocks: Block[] = [{kind:'facts',rows:[['Patient',`${client.first_name} ${client.last_name}`],['Date of birth',client.date_of_birth??'Not recorded'],['Record prepared',at],['Email',client.email??'Not recorded'],['Phone',client.phone??'Not recorded']]}]
  const addText = (key: string, title: string, date: string, lines: string[], code = '34133-9',status='current',docStatus?:string) => {
    const content = [title,...lines].join('\n')
    blocks.push({kind:'heading',text:title},{kind:'notes',lines})
    resources.push({resourceType:'DocumentReference',id:key,meta:{profile:[core+'us-core-documentreference']},text:narrative(title),status,...(docStatus?{docStatus}:{}),
      type:{coding:[{system:'http://loinc.org',code}]},category:[{coding:[{system:'http://hl7.org/fhir/us/core/CodeSystem/us-core-documentreference-category',code:'clinical-note'}]}],
      subject,date,content:[{attachment:{contentType:'text/plain',data:encoded(content),title,creation:date}}]})
  }
  const appointments = await rows(db,`SELECT a.id,a.start_at,a.end_at,a.status,p.name AS practitioner,s.name AS service
    FROM bm_appointments a JOIN bm_staff p ON p.id=a.practitioner_id JOIN bm_services s ON s.id=a.service_id WHERE a.client_id=? ORDER BY a.start_at,a.id`,clientId)
  for (const visit of appointments) addText('visit-'+visit.id,`${visit.service} · ${visit.start_at}`,visit.start_at,readable(visit))
  const notes = await rows(db,`SELECT n.id,n.created_at,n.template,n.signed_at,n.signed_revision,n.signer_name,n.signer_credentials,r.number,r.body,r.sections,r.charges,r.documentation,r.clinical,r.written_at
    FROM bm_notes n JOIN bm_note_revisions r ON r.note_id=n.id WHERE n.client_id=? ORDER BY n.created_at,n.id,r.number`,clientId)
  for (const note of notes) {
    const signed=!!note.signed_at&&note.number===note.signed_revision
    const superseded=notes.some(n=>n.id===note.id&&n.number>note.number)
    const title = `${note.template || 'Treatment note'} · revision ${note.number} · ${signed?'Signed original':superseded?'Earlier unsigned revision':'Unsigned draft'}`
    const lines = readable({...note,signed_at:signed?note.signed_at:null,signer_name:signed?note.signer_name:null,signer_credentials:signed?note.signer_credentials:null,sections:parse(note.sections),charges:parse(note.charges),documentation:parse(note.documentation),clinical:parse(note.clinical)})
    addText(`note-${note.id}-${note.number}`,title,note.written_at,lines,'11506-3',superseded?'superseded':'current',signed?'final':'preliminary')
  }
  const addenda = await rows(db,'SELECT a.id,a.body,a.written_at,a.signer_name,a.signer_credentials FROM bm_note_addenda a JOIN bm_notes n ON n.id=a.note_id WHERE n.client_id=? ORDER BY a.written_at,a.id',clientId)
  for (const a of addenda) addText('addendum-'+a.id,'Signed addendum',a.written_at,readable(a),'11506-3')
  const intakes = await rows(db,`SELECT r.id,r.answers,r.submitted_at,f.title,f.questions FROM bm_intake_responses r JOIN bm_intake_forms f ON f.id=r.form_id WHERE r.client_id=? ORDER BY r.submitted_at,r.id`,clientId)
  for (const intake of intakes) {
    const answers=parse(intake.answers), questions=parse(intake.questions)
    addText('intake-'+intake.id,intake.title,intake.submitted_at,questions.flatMap((q:Data)=>readable(answers[q.id],q.label)))
  }
  for (const [table,title] of [['bm_measures','Objective measures'],['bm_home_exercises','Home exercise program'],['bm_client_alerts','Clinical alerts'],['bm_movein_notes','Imported notes']] as const) {
    const data = await rows(db,`SELECT * FROM ${table} WHERE client_id=? ORDER BY rowid`,clientId)
    if (data.length) addText(table.slice(3)+'-'+packageId,title,at,data.flatMap(r=>readable(r)))
  }
  // Clinical originals are embedded, never remote URLs that could leak a session.
  const documents = await rows(db,'SELECT id,title,mime,content_base64,created_at,search_text,filename FROM bm_chart_documents WHERE client_id=? ORDER BY created_at,id',clientId)
  const consents = await rows(db,'SELECT id,policy_title AS title,pdf,signed_at AS created_at,policy_text,signer_name,signer_relationship FROM bm_intake_consents WHERE client_id=? ORDER BY signed_at,id',clientId)
  const originals: Data[] = [...documents,...consents.map((c:Data)=>({...c,mime:'application/pdf',content_base64:base64(new Uint8Array(c.pdf))}))]
  for (const doc of originals) {
    const title=String(doc.title), description=readable({title,filename:doc.filename,searchText:doc.search_text,policy:doc.policy_text,signer:doc.signer_name,relationship:doc.signer_relationship})
    addText('description-'+doc.id,title,doc.created_at,description)
    resources.push({resourceType:'DocumentReference',id:'original-'+doc.id,status:'current',subject,date:doc.created_at,
      type:{text:title},content:[{attachment:{contentType:doc.mime,data:doc.content_base64,title,creation:doc.created_at}}]})
    blocks.push({kind:'notes',lines:['Original attached in the machine-readable record: '+title]})
  }
  const bundle = {resourceType:'Bundle',id:packageId,type:'collection',timestamp:at,entry:resources.map(resource=>({fullUrl:`https://balm.invalid/fhir/${resource.resourceType}/${resource.id}`,resource}))}
  return {fhir:JSON.stringify(bundle,null,2),pdf:pdf({header:clinic.clinic_name,title:'Your patient record',blocks}),resources:resources.length}
}
