import {statementPdf} from '../payments/documents'
import { insist, now, one, rows, type Data } from '../domain/model'
import { pdf, type Block } from '../payments/pdf'

const absent={extension:[{url:'http://hl7.org/fhir/StructureDefinition/data-absent-reason',valueCode:'unknown'}]}
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
const privateField=/(?:token(?:_|$)|secret(?:_|$)|^key_sealed$|^code_hash$|^reply_link|^checkout_session$|^payment_intent$|^receipt_base64$|^content_base64$|^artifact(?:_|$)|^image$|^pdf$|^bytes$)/i
const jsonFields=new Set(['payload','content','snapshot','benefits','answers','charges','documentation','clinical'])
function safeFields(row:Data):Data{
 return Object.fromEntries(Object.entries(row).filter(([key])=>!privateField.test(key)).map(([key,value])=>{
  if(jsonFields.has(key)&&typeof value==='string'){try{value=JSON.parse(value)}catch{}}
  if(value&&typeof value==='object'&&!Array.isArray(value))value=safeFields(value)
  if(Array.isArray(value))value=value.map(v=>v&&typeof v==='object'?safeFields(v):v)
  return [key,value]
 }))
}

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
  const blocks: Block[] = [{kind:'notes',lines:['This is a partial record copy. Some record categories and issued originals are not included yet. Contact the clinic for a complete copy; this export does not replace the clinic’s complete-record process.']},{kind:'facts',rows:[['Patient',`${client.first_name} ${client.last_name}`],['Date of birth',client.date_of_birth??'Not recorded'],['Record prepared',at],['Email',client.email??'Not recorded'],['Phone',client.phone??'Not recorded']]}]
  const coverage={status:'partial',omitted:['Shared multi-patient transport batches and remaining original-document categories','Complete structured US Core clinical mappings and terminology validation'],terminologyValidation:'not established'}
  resources.push({resourceType:'DocumentReference',id:'coverage-'+packageId,status:'current',text:narrative('Partial export coverage and omissions'),subject,date:at,type:{text:'Export coverage and omissions'},content:[{attachment:{contentType:'application/json',data:encoded(JSON.stringify(coverage)),title:'Partial export coverage',creation:at}}]})
  const addText = (key: string, title: string, date: string, lines: string[], code = '34133-9',status='current',docStatus?:string,clinical=true) => {
    const content = [title,...lines].join('\n')
    blocks.push({kind:'heading',text:title},{kind:'notes',lines})
    resources.push({resourceType:'DocumentReference',id:key,...(clinical?{meta:{profile:[core+'us-core-documentreference']}}:{}),text:narrative(title),status,...(docStatus?{docStatus}:{}),
      type:clinical?{coding:[{system:'http://loinc.org',code}]}:{text:title},...(clinical?{category:[{coding:[{system:'http://hl7.org/fhir/us/core/CodeSystem/us-core-documentreference-category',code:'clinical-note'}]}]}:{}),
      subject,date,content:[{attachment:{contentType:'text/plain',data:encoded(content),title,creation:date}}]})
  }
  const appointments = await rows(db,`SELECT a.id,a.practitioner_id,a.start_at,a.end_at,a.status,p.name AS practitioner,s.name AS service
    FROM bm_appointments a JOIN bm_staff p ON p.id=a.practitioner_id JOIN bm_services s ON s.id=a.service_id WHERE a.client_id=? ORDER BY a.start_at,a.id`,clientId)
  const organizationId='balm-practice'
  resources.push({resourceType:'Organization',id:organizationId,meta:{profile:[core+'us-core-organization']},name:clinic.clinic_name,_active:absent,text:narrative(clinic.clinic_name)})
  const staff=await rows(db,'SELECT id,name,profession,npi FROM bm_staff WHERE id IN (SELECT practitioner_id FROM bm_appointments WHERE client_id=? UNION SELECT author_id FROM bm_notes WHERE client_id=?)',clientId,clientId)
  for(const person of staff)resources.push({resourceType:'Practitioner',id:person.id,meta:{profile:[core+'us-core-practitioner']},text:narrative(person.name),name:[{text:person.name,_family:absent}],identifier:[{system:'urn:balm:practitioner',value:person.id},...(person.npi?[{system:'http://hl7.org/fhir/sid/us-npi',value:person.npi}]:[])]})
  for(const visit of appointments){
    if(visit.status==='attended')resources.push({resourceType:'Encounter',id:visit.id,meta:{profile:[core+'us-core-encounter']},text:narrative(visit.service+' · '+visit.start_at),identifier:[{system:'urn:balm:visit',value:visit.id}],status:'unknown',class:{system:'http://terminology.hl7.org/CodeSystem/v3-ActCode',code:'AMB'},type:[{text:visit.service}],subject,period:{start:visit.start_at,end:visit.end_at},participant:[{individual:{reference:'Practitioner/'+visit.practitioner_id}}],serviceProvider:{reference:'Organization/'+organizationId}})
    resources.push({resourceType:'Appointment',id:'appointment-'+visit.id,text:narrative(visit.service+' · '+visit.start_at),status:visit.status==='attended'?'arrived':visit.status==='cancelled'?'cancelled':visit.status==='no_show'?'noshow':'booked',start:visit.start_at,end:visit.end_at,description:visit.service,participant:[{actor:subject,status:'needs-action'},{actor:{reference:'Practitioner/'+visit.practitioner_id},status:'needs-action'}]})
  }
  const coded=await rows(db,"SELECT v.appointment_id,v.position,v.code FROM bm_visit_codes v JOIN bm_appointments a ON a.id=v.appointment_id WHERE a.client_id=? AND v.kind='icd10'",clientId)
  for(const visit of coded){
    const codes=[String(visit.code)].filter(code=>/^[A-Z][0-9][0-9A-Z](?:\.[0-9A-Z]{1,4})?$/.test(code))
    for(const code of new Set(codes))resources.push({resourceType:'Condition',id:'diagnosis-'+visit.appointment_id+'-'+visit.position,meta:{profile:[core+'us-core-condition-encounter-diagnosis']},text:narrative('Diagnosis recorded for this visit: '+code),category:[{coding:[{system:'http://terminology.hl7.org/CodeSystem/condition-category',code:'encounter-diagnosis'}]}],code:{coding:[{system:'http://hl7.org/fhir/sid/icd-10-cm',code}]},subject,...(appointments.some(a=>a.id===visit.appointment_id&&a.status==='attended')?{encounter:{reference:'Encounter/'+visit.appointment_id}}:{})})
  }
  for (const visit of appointments) addText('visit-'+visit.id,`${visit.service} · ${visit.start_at}`,visit.start_at,readable(visit))
  const notes = await rows(db,`SELECT n.id,n.author_id,n.created_at,n.template,n.signed_at,n.signed_revision,n.signer_name,n.signer_credentials,r.number,r.body,r.sections,r.charges,r.documentation,r.clinical,r.written_at
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
    if (data.length) addText(table.slice(3).replaceAll('_','-')+'-'+packageId,title,at,data.flatMap(r=>readable(safeFields(r))))
  }
  const sections:[string,string,string,boolean][]=[
    ['episodes','Episodes of care','SELECT * FROM bm_episodes WHERE client_id=?',true],
    ['plans','Plans of care and physician certification','SELECT * FROM bm_plans_of_care WHERE client_id=?',true],
    ['referrals','Referrals','SELECT * FROM bm_referrals WHERE client_id=?',true],
    ['diagnoses','Recorded visit diagnoses and procedures','SELECT v.* FROM bm_visit_codes v JOIN bm_appointments a ON a.id=v.appointment_id WHERE a.client_id=?',true],
    ['coverage','Insurance coverage','SELECT * FROM bm_policies WHERE client_id=?',false],
    ['authorizations','Authorization records','SELECT a.* FROM bm_authorizations a JOIN bm_policies p ON p.id=a.policy_id WHERE p.client_id=?',false],
    ['eligibility','Recorded eligibility','SELECT e.* FROM bm_eligibility e JOIN bm_policies p ON p.id=e.policy_id WHERE p.client_id=?',false],
    ['claims','Patient claim records','SELECT * FROM bm_claims WHERE client_id=?',false],
    ['remittances','Claim-level remittance records','SELECT r.* FROM bm_remittance_claims r JOIN bm_claims c ON c.id=r.claim_id WHERE c.client_id=?',false],
    ['payer-payments','Paper payer payment and takeback records','SELECT * FROM bm_payer_payment_lines WHERE client_id=?',false],
    ['insurance','Submitted insurance details','SELECT * FROM bm_intake_insurance WHERE client_id=?',false],
    ['invoices','Invoices and fixed billing facts','SELECT * FROM bm_invoices WHERE client_id=?',false],
    ['payments','Recorded payments','SELECT p.* FROM bm_invoice_payments p JOIN bm_invoices i ON i.id=p.invoice_id WHERE i.client_id=?',false],
    ['account','Posted account movements','SELECT * FROM bm_posted_account_entries WHERE client_id=?',false],
    ['profile','Submitted profile changes','SELECT * FROM bm_portal_profile_changes WHERE client_id=?',false],
    ['messages','Secure messages','SELECT * FROM bm_messages WHERE client_id=?',true],
    ['sessions','Home exercise completion and pain','SELECT d.* FROM bm_home_exercise_done d JOIN bm_home_exercises e ON e.id=d.exercise_id WHERE e.client_id=?',true],
  ]
  for(const [key,title,sql,clinical] of sections){
    const data=(await rows(db,sql,clientId)).map(safeFields)
    if(!data.length)continue
    addText(key+'-'+packageId,title,at,data.flatMap(r=>readable(r)),'34133-9','current',undefined,clinical)
    resources.push({resourceType:'DocumentReference',id:'data-'+key.slice(0,16)+'-'+packageId,status:'current',text:narrative(title),subject,date:at,type:{text:title},
      content:[{attachment:{contentType:'application/json',data:encoded(JSON.stringify(data)),title,creation:at}}]})
  }
  // Clinical originals are embedded, never remote URLs that could leak a session.
  const documents = await rows(db,'SELECT id,title,mime,content_base64,created_at,search_text,filename FROM bm_chart_documents WHERE client_id=? ORDER BY created_at,id',clientId)
  const consents = await rows(db,'SELECT id,policy_title AS title,pdf,signed_at AS created_at,policy_text,signer_name,signer_relationship FROM bm_intake_consents WHERE client_id=? ORDER BY signed_at,id',clientId)
  const originals: Data[] = [...documents,...consents.map((c:Data)=>({...c,mime:'application/pdf',content_base64:base64(new Uint8Array(c.pdf))}))]
  const attachments=await rows(db,'SELECT a.*,m.sent_at FROM bm_message_attachments a JOIN bm_messages m ON m.id=a.message_id WHERE m.client_id=? ORDER BY a.id',clientId)
  originals.push(...attachments.map(a=>({...a,id:'message-'+a.id,title:a.filename,created_at:a.sent_at})))
  const photos=await rows(db,`SELECT p.id,p.bytes,p.mime FROM bm_intake_photos p WHERE p.id IN (
    SELECT front FROM bm_intake_insurance WHERE client_id=? UNION SELECT back FROM bm_intake_insurance WHERE client_id=? UNION SELECT photo_id FROM bm_intake_identity WHERE client_id=?) ORDER BY p.id`,clientId,clientId,clientId)
  originals.push(...photos.map(p=>({id:'photo-'+p.id,title:'Uploaded insurance or identity image',mime:p.mime,content_base64:base64(new Uint8Array(p.bytes)),created_at:at})))
  const exerciseImages=await rows(db,'SELECT id,title,image,assigned_at FROM bm_home_exercises WHERE client_id=? AND image IS NOT NULL ORDER BY id',clientId)
  for(const e of exerciseImages){const image=String(e.image).match(/^data:([^;]+);base64,(.+)$/);if(image)originals.push({id:'exercise-'+e.id,title:e.title+' illustration',mime:image[1],content_base64:image[2],created_at:e.assigned_at})}
  const statements=await rows(db,'SELECT id,original_base64,issued_at FROM bm_patient_statements WHERE client_id=?',clientId)
  originals.push(...statements.map(r=>({id:r.id,title:'Issued statement',mime:'application/pdf',content_base64:r.original_base64,created_at:r.issued_at})))
  const estimates=await rows(db,'SELECT id,pdf,issued_at FROM bm_estimates WHERE client_id=?',clientId)
  originals.push(...estimates.map(r=>({id:r.id,title:'Issued Good Faith Estimate',mime:'application/pdf',content_base64:base64(new Uint8Array(r.pdf)),created_at:r.issued_at})))
  const aeobs=await rows(db,'SELECT s.id,s.content_base64,i.issued_at FROM bm_aeob_sources s JOIN bm_aeob_issues i ON i.source_id=s.id WHERE s.client_id=?',clientId)
  originals.push(...aeobs.map(r=>({id:r.id,title:'Issued payer estimate original',mime:'application/pdf',content_base64:r.content_base64,created_at:r.issued_at})))
  const invoices=await rows(db,"SELECT id,number,artifact,approved_at FROM bm_invoices WHERE client_id=? AND status='approved' AND artifact IS NOT NULL",clientId)
  originals.push(...invoices.map(r=>({id:r.id,title:'Issued invoice '+r.number,mime:'text/html',content_base64:encoded(r.artifact),created_at:r.approved_at})))
  const statement=await statementPdf(db,clientId)
  originals.push({id:'statement-'+packageId,title:'Statement at record preparation',mime:'application/pdf',content_base64:base64(statement.bytes),created_at:at})
  for (const doc of originals) {
    const title=String(doc.title), description=readable({title,filename:doc.filename,searchText:doc.search_text,policy:doc.policy_text,signer:doc.signer_name,relationship:doc.signer_relationship})
    addText('description-'+doc.id,title,doc.created_at,description)
    resources.push({resourceType:'DocumentReference',id:'original-'+doc.id,status:'current',text:narrative(title),subject,date:doc.created_at,
      type:{text:title},content:[{attachment:{contentType:doc.mime,data:doc.content_base64,title,creation:doc.created_at}}]})
    blocks.push({kind:'notes',lines:['Original attached in the machine-readable record: '+title]})
  }
  const bundle = {resourceType:'Bundle',id:packageId,type:'collection',timestamp:at,entry:resources.map(resource=>({fullUrl:`https://balm.invalid/fhir/${resource.resourceType}/${resource.id}`,resource}))}
  return {fhir:JSON.stringify(bundle,null,2),pdf:pdf({header:clinic.clinic_name,title:'Your patient record',blocks}),resources:resources.length}
}
