import type { Bindings } from '../../auth.server'
import { audit, commit, guard, human, id, insist, now, one, rows, stmt, text, type Actor, type Data } from '../domain/model'
import { managedInstall } from '../payments/stripe-api'
import { seal, unseal } from '../scribe/seal'

export const keyScopes = ['context.read','appointments.read','patients.read','charges.read','payments.read','invoice.prepare','reminder.prepare','intake.prepare'] as const
export const legacyScopes = ['context.read','invoice.prepare','reminder.prepare','intake.prepare']
type KeyActor = Actor & { keyId?: string; keyScopes?: string[] }
export function requireScope(who: Actor, scope: string) {
  insist(who.role==='agent' && (who as KeyActor).keyScopes?.includes(scope),'key_scope_refused',403)
  who.keyScope=scope
}
export async function scopedRead(db: D1Database, who: Actor, kind: string) {
  requireScope(who,kind+'.read')
  const tables: Record<string,string> = {
    appointments:'SELECT id,client_id,practitioner_id,service_id,start_at,end_at,status FROM bm_appointments ORDER BY start_at,id LIMIT 300',
    patients:'SELECT id,first_name,last_name,date_of_birth,email,phone FROM bm_clients WHERE erased_at IS NULL ORDER BY id LIMIT 300',
    charges:"SELECT id,client_id,appointment_id,number,status,amount_cents,approved_at FROM bm_invoices ORDER BY id LIMIT 300",
    payments:'SELECT p.id,i.client_id,p.invoice_id,p.amount_cents,p.recorded_at FROM bm_payments p JOIN bm_invoices i ON i.id=p.invoice_id ORDER BY p.recorded_at,p.id LIMIT 300',
  }
  insist(kind in tables,'not_found',404)
  const list=await rows(db,tables[kind])
  await commit(db,who,[...await keyGuard(db,who,kind+'.read'),...Array.from(new Set(list.map(r=>kind==='patients'?r.id:r.client_id))).map(clientId=>audit(db,who,'integration.'+kind+'_read',clientId,(who as KeyActor).keyId??null))])
  return {records:list,limit:300}
}
/** A second key check in the read/write batch closes revocation races. */
export async function keyGuard(db: D1Database, who: Actor, scope: string) {
 const key=(who as KeyActor).keyId
 insist(key,'agent_credential_required',401)
 return [guard(db,`EXISTS(SELECT 1 FROM bm_agent_keys k JOIN oa_operators o ON o.id=k.owner_id WHERE k.id=? AND k.revoked_at IS NULL AND k.expires_at>?
   AND o.status='active' AND o.role='owner' AND o.version=k.owner_version AND (k.scopes IS NULL OR EXISTS(SELECT 1 FROM json_each(k.scopes) WHERE value=?)))`,key,Date.now(),scope)]
}
const owner=(who:Actor)=>{human(who);insist(who.role==='owner','only_the_owner_manages_integrations',403)}
export async function integrationState(db:D1Database,who:Actor) {
 if(who.role!=='owner')return null
 const hooks=await rows(db,'SELECT id,url,consent_at,created_at,revoked_at FROM bm_integration_hooks WHERE owner_id=? ORDER BY created_at DESC',who.id)
 const events=await rows(db,`SELECT e.id,e.appointment_id,e.created_at FROM bm_integration_events e JOIN bm_clients c ON c.id=e.client_id WHERE c.erased_at IS NULL ORDER BY e.created_at DESC,e.id LIMIT 30`)
 const deliveries=await rows(db,'SELECT d.id,d.hook_id,d.event_id,d.outcome,d.response_status,d.approved_at FROM bm_integration_deliveries d JOIN bm_integration_hooks h ON h.id=d.hook_id WHERE h.owner_id=? ORDER BY d.approved_at DESC LIMIT 100',who.id)
 return {hooks,events,deliveries}
}
function destination(value:unknown) {
 let url:URL
 try{url=new URL(text(value,'webhook_url',1000))}catch{insist(false,'use_a_public_https_webhook_address')}
 const host=url!.hostname.toLowerCase()
 insist(url!.protocol==='https:'&&!url!.username&&!url!.password&&!url!.hash&&(!url!.port||url!.port==='443')
   && /^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,}$/.test(host)
   && !/(^|\.)(localhost|local|internal|test|invalid|example)$/.test(host),'use_a_public_https_webhook_address')
 return url!.href
}
export async function integrationCommand(env:Bindings,who:Actor,name:string,input:Data) {
 owner(who)
 const db=env.DB
 if(name==='integration.hook.create') {
  insist(input.consent===true||input.consent==='on','confirm_you_authorize_this_webhook')
  const url=destination(input.url),key=id(),secret=id()+id(),at=now()
  await commit(db,who,[stmt(db,'INSERT INTO bm_integration_hooks(id,owner_id,owner_version,url,secret_sealed,consent_at,created_at) VALUES(?,?,?,?,?,?,?)',key,who.id,who.operatorVersion,url,await seal(env.SESSION_SECRET,'balm-integration:'+key,secret),at,at),audit(db,who,'integration.hook_created',null,key)])
  return {id:key,secret}
 }
 if(name==='integration.hook.revoke') {
  const key=text(input.id,'webhook',100)
  await commit(db,who,[stmt(db,'UPDATE bm_integration_hooks SET revoked_at=? WHERE id=? AND owner_id=? AND revoked_at IS NULL',now(),key,who.id),audit(db,who,'integration.hook_revoked',null,key)])
  return {revoked:true}
 }
 insist(name==='integration.hook.deliver','unknown_command',404)
 insist(!managedInstall(env),'webhooks_are_not_available_yet_on_RER_Managed',409)
 insist(input.confirm===true||input.confirm==='on','confirm_this_booking_notification')
 const hookId=text(input.hookId,'webhook',100),eventId=text(input.eventId,'booking_event',100)
 const available=`EXISTS(SELECT 1 FROM bm_integration_hooks h JOIN oa_operators o ON o.id=h.owner_id WHERE h.id=? AND h.owner_id=? AND h.owner_version=o.version AND o.role='owner' AND o.status='active' AND h.revoked_at IS NULL)`
 const hook=await one(db,'SELECT * FROM bm_integration_hooks WHERE id=? AND owner_id=? AND revoked_at IS NULL',hookId,who.id)
 const event=await one(db,'SELECT e.* FROM bm_integration_events e JOIN bm_clients c ON c.id=e.client_id WHERE e.id=? AND c.erased_at IS NULL',eventId)
 insist(hook&&event&&event.created_at>=hook.consent_at,'booking_notification_not_available',404)
 const deliveryId=id(),at=now()
 // One durable attempt. Unknown outcomes need review and are never retried.
 await commit(db,who,[guard(db,available,hookId,who.id),guard(db,'EXISTS(SELECT 1 FROM bm_integration_events e JOIN bm_clients c ON c.id=e.client_id WHERE e.id=? AND c.erased_at IS NULL)',eventId),
  stmt(db,"INSERT INTO bm_integration_deliveries(id,hook_id,event_id,approved_by,approved_at,outcome) VALUES(?,?,?,?,?,'pending')",deliveryId,hookId,eventId,who.email,at),audit(db,who,'integration.delivery_approved',event.client_id,eventId)])
 const secret=await unseal(env.SESSION_SECRET,'balm-integration:'+hookId,hook.secret_sealed)
 insist(secret,'webhook_key_unavailable',409)
 const body=JSON.stringify({id:event.id,type:'appointment.booked',createdAt:event.created_at,appointmentId:event.appointment_id})
 const time=String(Math.floor(Date.now()/1000)),key=await crypto.subtle.importKey('raw',new TextEncoder().encode(secret),{name:'HMAC',hash:'SHA-256'},false,['sign'])
 const signature=Array.from(new Uint8Array(await crypto.subtle.sign('HMAC',key,new TextEncoder().encode(time+'.'+body))),b=>b.toString(16).padStart(2,'0')).join('')
 let outcome='uncertain',status:number|null=null
 await commit(db,who,[guard(db,available,hookId,who.id)])
 try {
  const response=await fetch(destination(hook.url),{method:'POST',headers:{'content-type':'application/json','balm-signature':`t=${time},v1=${signature}`,'idempotency-key':deliveryId},body,redirect:'manual',signal:AbortSignal.timeout(10000)})
  status=response.status;outcome=response.ok?'accepted':response.status>=500?'uncertain':'refused'
  await response.body?.cancel()
 }catch{ /* No retry: the destination might have received the bytes. */ }
 await commit(db,who,[stmt(db,'UPDATE bm_integration_deliveries SET outcome=?,response_status=?,finished_at=? WHERE id=? AND outcome=\'pending\'',outcome,status,now(),deliveryId),audit(db,who,'integration.delivery_'+outcome,event.client_id,eventId)])
 return {id:deliveryId,outcome,status}
}
