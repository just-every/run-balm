import { form, h, hidden, stamp } from './shared'
import { patientForm } from './portal-content'

export function patientRecordPanel(d:any) {
 return `<section class="card portal-section" id="records"><h2>Your patient record</h2><p>Ask for a copy of your record. The clinic reviews and releases a readable PDF and a machine-readable FHIR file here within 30 days. No record is sent by email.</p>${patientForm('record.request','','Request my record')}${(d.recordRequests??[]).map((r:any)=>`<article><h3>${r.released_at?'Partial copy available':'Requested'}</h3><p>Requested ${h(r.requested_at.slice(0,10))} · Due ${h(r.due_at.slice(0,10))}</p>${r.released_at?`<p>A partial copy was released ${h(r.released_at.slice(0,10))}. Contact the clinic for the remaining record categories.</p><p><a href="/portal/records/${h(r.id)}.pdf">Download record PDF</a> · <a href="/portal/records/${h(r.id)}.json">Download FHIR record</a></p>`:'<p>The clinic is preparing your copy. Contact the clinic if you need help.</p>'}</article>`).join('')}</section>`
}
export function recordQueue(s:any) {
 if(s.actor.role!=='owner')return ''
 const requests=s.recordRequests??[]
 if(!requests.length)return ''
 const items=requests.map((r:any)=>{
  const dates=`<h3>${h(r.patient)}</h3><p>${r.overdue?'<strong>Due date passed</strong> · ':''}Due ${stamp(s,r.due_at)} · Requested ${stamp(s,r.requested_at)}</p><p><a href="/app/clients/${h(r.client_id)}">Open patient file</a></p>`
  if(r.released_at)return `<article class="entry">${dates}<p><strong>Partial copy delivered ${stamp(s,r.released_at)}.</strong> This delivery does not establish fulfillment of the complete-record request. Keep the remaining categories in the clinic's record-release process.</p></article>`
  const review=r.prepared_id?`<p>Review both fixed originals: <a href="/api/balm/records/${h(r.prepared_id)}.pdf">Preview PDF</a> · <a href="/api/balm/records/${h(r.prepared_id)}.json">Preview FHIR</a>.</p><p class="help">The partial copy includes notes, intake, plans, diagnoses, exercises, coverage, billing facts and messages, with available image/document originals attached in FHIR. Shared multi-patient transport batches, some original categories and complete structured clinical mappings are not included.</p>${form('record.release','/app#record-requests',hidden('id',r.id)+hidden('packageId',r.prepared_id)+hidden('sha256',r.prepared_sha256)+'<label class="check"><input type="checkbox" name="confirm" required><span>I reviewed both copies and approve this exact partial delivery. I will fulfill the remaining record categories through the clinic’s complete-record process.</span></label>','Release partial record copy')}`:''
  return `<article class="entry">${dates}${form('record.prepare','/app#record-requests',hidden('id',r.id),'Prepare record copy')}${review}</article>`
 }).join('')
 return `<section class="panel full" id="record-requests"><h2>Patient record requests</h2>${items}</section>`
}
