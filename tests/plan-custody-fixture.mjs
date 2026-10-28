import {createHash} from 'node:crypto'
import {signedPlanBytes} from './plan-version-journey.mjs'

/** Historical records establish elapsed custody without editing a signed original. */
export async function historicalPlanCustody(h,{patient,priya,planId}){
 const at='1990-01-02T03:00:00.000Z',address=['synthetic-balm-physician','example.test'].join('@')
 const first=planId??crypto.randomUUID(),current=planId??crypto.randomUUID(),documentId=crypto.randomUUID()
 const token='synthetic-balm-link-'+current,sha=value=>createHash('sha256').update(value).digest('hex')
 const content=JSON.stringify({startDate:'1990-01-01',certifiedThrough:'1990-02-11',frequencyPerWeek:1,durationWeeks:6,diagnoses:'M25.561',shortTermGoals:'Synthetic historical goal',longTermGoals:'Synthetic historical recovery',interventions:'Synthetic exercise',therapist:{name:'Historical Clinician',credentials:'PT'}})
 for(const id of new Set([first,current])){
  if(planId)await h.db.prepare("UPDATE bm_plans_of_care SET status='certified',certified_at=?,certifier_name='Synthetic Physician',certifier_credentials='MD' WHERE id=?").bind(at,id).run()
  else await h.db.prepare("INSERT INTO bm_plans_of_care(id,client_id,author_id,content,content_sha256,therapist_name,therapist_credentials,created_at,physician_name,physician_email,sign_token_hash,sign_token_expires_at,sent_at,status,certified_at,certifier_name,certifier_credentials) VALUES(?,?,?,?,?,'Historical Clinician','PT',?,'Synthetic Physician',?,?,'2099-01-01T00:00:00.000Z',?,'certified',?,'Synthetic Physician','MD')").bind(id,patient.id,priya.id,content,sha(content),at,address,sha(id===current?token:'synthetic-balm-link-'+id),at,at).run()
  await h.db.prepare("INSERT INTO bm_plan_sends VALUES(?,?,?,'link','Synthetic Physician',?,?,?)").bind(crypto.randomUUID(),id,patient.id,address,at,priya.email).run()
 }
 if(!planId)await h.db.prepare('INSERT INTO bm_plan_replacements VALUES(?,?,?,NULL,?,?)').bind(first,current,patient.id,at,priya.email).run()
 const bytes=signedPlanBytes.toString('base64')
 await h.db.prepare("INSERT INTO bm_chart_documents VALUES(?,?,'Signed plan of care','signed_plan','1990-01-01','Synthetic historical certification','synthetic-balm-signed-plan.pdf','application/pdf',?,?,?,?,?)").bind(documentId,patient.id,signedPlanBytes.length,bytes,sha(bytes),at,priya.email).run()
 await h.db.prepare("INSERT INTO bm_plan_certifications VALUES(?,?,?,NULL,'1990-01-01','1990-01-02',?,?)").bind(current,documentId,patient.id,at,priya.email).run()
 return {first,current,documentId,token}
}
