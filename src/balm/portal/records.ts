import { audit, commit, guard, human, id, insist, now, one, rows, sha256, stmt, text, type Actor, type Data } from '../domain/model'
import { patientActor, portalGuard, type Patient } from './auth'
import { base64, recordExport } from './record-export'

const owner = (who: Actor) => { human(who); insist(who.role==='owner','only_the_owner_releases_records',403) }
export async function recordRequests(db: D1Database, who: Actor) {
  if (who.role!=='owner') return []
  const list = await rows(db,`SELECT r.*,c.first_name||' '||c.last_name AS patient,
    (SELECT id FROM bm_record_packages p WHERE p.request_id=r.id ORDER BY p.prepared_at DESC,p.rowid DESC LIMIT 1) AS prepared_id,
    (SELECT sha256 FROM bm_record_packages p WHERE p.request_id=r.id ORDER BY p.prepared_at DESC,p.rowid DESC LIMIT 1) AS prepared_sha256
    FROM bm_record_requests r JOIN bm_clients c ON c.id=r.client_id WHERE c.erased_at IS NULL ORDER BY r.released_at IS NOT NULL,r.due_at,r.id`)
  await commit(db,who,list.map(r=>audit(db,who,'record_request.read',r.client_id,r.id)))
  return list.map(r=>({...r,overdue:!r.released_at && r.due_at<now()}))
}
export const patientRecordRequests = (db: D1Database, patient: Patient) => rows(db,
  'SELECT id,requested_at,due_at,released_at FROM bm_record_requests WHERE client_id=? ORDER BY requested_at DESC,id',patient.clientId)

export async function requestRecord(db: D1Database, patient: Patient) {
  const key=id(),at=now(),due=new Date(Date.parse(at)+30*86400_000).toISOString()
  await commit(db,null,[portalGuard(db,patient),
    stmt(db,'INSERT INTO bm_record_requests(id,client_id,requested_at,due_at) SELECT ?,?,?,? WHERE NOT EXISTS(SELECT 1 FROM bm_record_requests WHERE client_id=? AND released_at IS NULL)',key,patient.clientId,at,due,patient.clientId),
    audit(db,patientActor,'record.requested',patient.clientId),
  ])
  return one(db,'SELECT id,due_at FROM bm_record_requests WHERE client_id=? AND released_at IS NULL',patient.clientId)
}

export async function recordCommand(db: D1Database, who: Actor, name: string, input: Data) {
  owner(who)
  const requestId=text(input.id,'record_request',100)
  const request=await one(db,'SELECT r.* FROM bm_record_requests r JOIN bm_clients c ON c.id=r.client_id WHERE r.id=? AND c.erased_at IS NULL',requestId)
  insist(request,'record_request_not_found',404)
  insist(!request.released_at,'record_already_released',409)
  if(name==='record.prepare') {
    const key=id(),epoch=(await one(db,'SELECT version FROM bm_retention_epoch WHERE id=1'))!.version
    const snapshot=await recordExport(db,request.client_id,key),pdfData=base64(snapshot.pdf)
    const pdfHash=await sha256(pdfData),fhirHash=await sha256(snapshot.fhir),digest=await sha256(JSON.stringify({requestId,pdfHash,fhirHash}))
    const parts:D1PreparedStatement[]=[]
    for (const [format,value] of [['pdf',pdfData],['fhir',snapshot.fhir]]) for(let offset=0;offset<value.length;offset+=48000)
      parts.push(stmt(db,'INSERT INTO bm_record_parts(package_id,format,part,content) VALUES(?,?,?,?)',key,format,offset/48000,value.slice(offset,offset+48000)))
    insist(parts.length<=500,'record_too_large_contact_the_clinic_for_an_offline_copy',409)
    // The JSON row carries the bounded chunk matrix once. Split D1 writes stay
    // inside one transaction and cannot publish an incomplete package.
    const chunks=parts.length
    await commit(db,who,[guard(db,'EXISTS(SELECT 1 FROM bm_record_requests WHERE id=? AND released_at IS NULL)',requestId),
      guard(db,'EXISTS(SELECT 1 FROM bm_retention_epoch WHERE id=1 AND version=?)',epoch),
      stmt(db,'INSERT INTO bm_record_packages(id,request_id,client_id,prepared_at,prepared_by,sha256,pdf_sha256,fhir_sha256) VALUES(?,?,?,?,?,?,?,?)',key,requestId,request.client_id,now(),who.email,digest,pdfHash,fhirHash),
      ...parts,audit(db,who,'record.prepared',request.client_id,requestId),
    ])
    return {id:requestId,packageId:key,sha256:digest,chunks}
  }
  insist(name==='record.release','unknown_command',404)
  insist(input.confirm===true||input.confirm==='on','confirm_you_reviewed_both_record_formats')
  const key=text(input.packageId,'record_package',100),digest=text(input.sha256,'record_digest',64)
  const prepared=await one(db,'SELECT id FROM bm_record_packages WHERE id=? AND request_id=? AND client_id=? AND sha256=?',key,requestId,request.client_id,digest)
  insist(prepared,'record_package_changed_refresh_and_review',409)
  const at=now()
  await commit(db,who,[guard(db,'EXISTS(SELECT 1 FROM bm_record_packages WHERE id=? AND request_id=? AND client_id=? AND sha256=?)',key,requestId,request.client_id,digest),
    stmt(db,'UPDATE bm_record_requests SET released_at=?,released_by=?,package_id=? WHERE id=? AND released_at IS NULL',at,who.email,key,requestId),guard(db,'changes()=1'),
    audit(db,who,'record.released',request.client_id,requestId),
  ])
  return {id:requestId,releasedAt:at}
}

/** The patient selector always comes from the live portal session. A prepared
 * package is private to the owner until its exact digest is released. */
export async function recordDownload(db: D1Database, key: string, format: 'pdf'|'fhir', who: Actor|Patient) {
  const isPatient='clientId' in who
  if(!isPatient)owner(who)
  const row=await one(db,`SELECT p.* FROM bm_record_packages p JOIN bm_record_requests r ON r.id=p.request_id JOIN bm_clients c ON c.id=r.client_id
    WHERE ${isPatient?'r.id=? AND r.client_id=? AND r.package_id=p.id AND r.released_at IS NOT NULL':'p.id=?'} AND c.erased_at IS NULL`,key,...(isPatient?[who.clientId]:[]))
  insist(row,'record_not_found',404)
  const parts=await rows(db,'SELECT content FROM bm_record_parts WHERE package_id=? AND format=? ORDER BY part',row.id,format)
  const value=parts.map(p=>p.content).join('')
  insist(parts.length && await sha256(value)===row[format==='pdf'?'pdf_sha256':'fhir_sha256'],'record_integrity_check_failed',409)
  await commit(db,isPatient?null:who,[...(isPatient?[portalGuard(db,who)]:[]),audit(db,isPatient?patientActor:who,'record.downloaded',row.client_id,row.request_id,format)])
  const bytes=format==='fhir'?new TextEncoder().encode(value):Uint8Array.from(atob(value),c=>c.charCodeAt(0))
  return new Response(bytes,{headers:{'content-type':format==='pdf'?'application/pdf':'application/fhir+json','content-disposition':`attachment; filename="patient-record.${format==='pdf'?'pdf':'json'}"`,'cache-control':'no-store','referrer-policy':'no-referrer','x-content-type-options':'nosniff','content-security-policy':"default-src 'none'"}})
}
