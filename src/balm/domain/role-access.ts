import { audit, commit, guard, human, id, insist, need, now, one, rows, stmt, text, type Actor, type Data, type StaffKind } from './model'
import { reportRange } from '../reports/range'
import { template } from '../charting/templates'
import { type Charge } from '../charting/cpt'

export const supervised = (who: Actor) => ['assistant','student','fellow'].includes(who.staffKind ?? '')
export const biller = (who: Actor) => who.role !== 'owner' && who.staffKind === 'biller'
export const manager = (who: Actor) => who.role !== 'owner' && who.staffKind === 'location_manager'
export const evaluationCodes = new Set(['97161','97162','97163','97164','97165','97166','97167','97168','92521','92522','92523','92524','92610'])

/** Assistants document daily treatment only; a role change cannot revive a prohibited draft. */
export function assistantNote(who: Actor, key: unknown, charges: Charge[]) {
 if (who.staffKind !== 'assistant') return
 insist(template(key)?.kind === 'daily', 'assistants_write_daily_notes_only', 403)
 insist(charges.every(c => !evaluationCodes.has(c.code)), 'assistants_cannot_charge_evaluation_codes', 403)
}
const billingWrites = new Set(['note_release.prepare','estimate.request','estimate.prepare','invoice.prepare','invoice.approve','payment.record','pay.entry.prepare','pay.entry.approve','pay.link.create','pay.copay.save','pay.invoice.charge','pay.card.remove','pay.statements.save','pay.reminders.save','pay.reminders.stop','pay.plan.create','pay.plan.stop',
 'insurance.policy.save','insurance.authorization.save','insurance.eligibility.prepare','insurance.eligibility.submit','insurance.eligibility.import','insurance.eligibility.record','insurance.claim.prepare','insurance.claim.correct','insurance.claim.scrub','insurance.batch.prepare','insurance.batch.submit','insurance.acknowledgment.import','insurance.remittance.import','insurance.medicare.save','insurance.medicare.recognized.save'])
const traineeWrites = new Set(['note.check','note.write','note.amend','note.measure','note.measure_remove','note.submit'])
/** The narrower job is enforced before dispatch, including commands added later. */
export function roleCommand(who: Actor, name: string) {
 if (who.role === 'owner' || name === 'session.signout') return
 if (manager(who)) insist(['appointment.book','appointment.move','appointment.cancel','pay.checkin'].includes(name), 'location_manager_action_refused', 403)
 if (biller(who)) insist(billingWrites.has(name), 'biller_action_refused', 403)
 if (supervised(who)) insist(traineeWrites.has(name)||who.staffKind==='assistant'&&name==='note.sign', 'supervised_staff_draft_only', 403)
}
export function roleRead(who: Actor, path: string) {
 if (who.role === 'owner') return
 if (manager(who)) insist(['/app','/app/reports','/api/balm/state','/api/balm/reports/location'].includes(path), 'location_scope_refused', 403)
 if (biller(who)) insist(['/app','/app/clients','/app/invoices','/app/insurance','/app/reports','/api/balm/state','/api/balm/commands','/api/balm/reports/financial'].includes(path)
  || /^\/app\/clients\/[\w-]+$/.test(path) || /^\/api\/balm\/clients\/[\w-]+$/.test(path)
  || /^\/api\/balm\/(note-releases|period-superbills|estimates|invoices|payments|receipts|statements|superbills|account-receipts|issued-statements)\//.test(path)
  || /^\/api\/balm\/reports\/financial\//.test(path) || /^\/api\/balm\/insurance\/(270|837P)\//.test(path), 'biller_read_refused', 403)
 if (supervised(who)) insist(['/app','/app/clients','/api/balm/state','/api/balm/commands'].includes(path)
  || /^\/app\/clients\/[\w-]+$/.test(path) || /^\/api\/balm\/clients\/[\w-]+$/.test(path), 'supervised_staff_read_refused', 403)
}

export async function saveLocation(db: D1Database, who: Actor, input: Data) {
 human(who); need(who,'owner')
 const key = input.id ? text(input.id,'location',100) : id(), name = text(input.name,'location_name',100)
 await commit(db,who,[stmt(db,'INSERT INTO bm_locations(id,name) VALUES(?,?) ON CONFLICT(id) DO UPDATE SET name=excluded.name',key,name),audit(db,who,'location.saved',null,key)])
 return { id:key }
}
export async function locateRoom(db: D1Database, who: Actor, input: Data) {
 human(who); need(who,'owner')
 const room = text(input.roomId,'room',100), location = text(input.locationId,'location',100)
 // Moving an occupied room would silently move historical reports. Use a new room.
 await commit(db,who,[guard(db,'EXISTS(SELECT 1 FROM bm_rooms WHERE id=?) AND EXISTS(SELECT 1 FROM bm_locations WHERE id=? AND active=1)',room,location),
 guard(db,'NOT EXISTS(SELECT 1 FROM bm_appointments WHERE room_id=?) OR EXISTS(SELECT 1 FROM bm_room_locations WHERE room_id=? AND location_id=?)',room,room,location),
 stmt(db,'INSERT INTO bm_room_locations(room_id,location_id) VALUES(?,?) ON CONFLICT(room_id) DO UPDATE SET location_id=excluded.location_id',room,location),audit(db,who,'room.location_saved',null,room)])
 return { roomId:room,locationId:location }
}
/** Location managers receive only this result, never the unscoped working state. */
export async function locationState(db: D1Database, who: Actor, input: Data = {}) {
 insist(manager(who) && who.locationId,'location_scope_refused',403)
 const location = await one(db,'SELECT id,name FROM bm_locations WHERE id=? AND active=1',who.locationId)
 insist(location,'location_scope_refused',403)
 const range = await reportRange(db,input)
 const appointments = await rows(db,`SELECT a.id,a.client_id,a.practitioner_id,a.service_id,a.room_id,a.version,a.checked_in_at,a.start_at,a.end_at,a.status,c.first_name||' '||c.last_name AS client,p.name AS practitioner,s.name AS service,r.name AS room
 FROM bm_appointments a JOIN bm_room_locations l ON l.room_id=a.room_id JOIN bm_rooms r ON r.id=a.room_id JOIN bm_clients c ON c.id=a.client_id JOIN bm_staff p ON p.id=a.practitioner_id JOIN bm_services s ON s.id=a.service_id
 WHERE l.location_id=? AND a.start_at>=? AND a.start_at<? AND c.erased_at IS NULL ORDER BY a.start_at,a.id`,who.locationId,range.start,range.end)
 await commit(db,who,[guard(db,"EXISTS(SELECT 1 FROM bm_staff_access WHERE staff_id=? AND kind='location_manager' AND location_id=?)",who.staffId,who.locationId),
 ...[...new Set(appointments.map(a=>a.client_id))].map(key=>audit(db,who,'location.schedule_read',key,null,who.locationId))])
 const counts = Object.fromEntries(['booked','attended','cancelled','no_show'].map(status=>[status,appointments.filter(a=>a.status===status).length]))
 const settings = await one(db,'SELECT clinic_name,time_zone FROM bm_settings WHERE id=1')
 const rooms=await rows(db,'SELECT r.id,r.name FROM bm_rooms r JOIN bm_room_locations l ON l.room_id=r.id WHERE l.location_id=? AND r.active=1',who.locationId)
 const patients=await rows(db,`SELECT DISTINCT c.id,c.first_name||' '||c.last_name AS name FROM bm_clients c JOIN bm_appointments a ON a.client_id=c.id JOIN bm_room_locations l ON l.room_id=a.room_id WHERE l.location_id=? AND c.erased_at IS NULL ORDER BY name`,who.locationId)
 const practitioners=await rows(db,`SELECT id,name FROM bm_staff WHERE role='practitioner' AND active=1 AND erased_at IS NULL ORDER BY name`)
 const services=await rows(db,'SELECT id,name FROM bm_services WHERE active=1 ORDER BY name')
 return {actor:who,settings,staff:[],services:[],clients:[],appointments:[],invoices:[],drafts:[],location:{...location,from:range.from,to:range.to,appointments,counts,rooms,patients,practitioners,services}}
}

export async function locateHours(db:D1Database,who:Actor,input:Data){
 human(who);need(who,'owner')
 const parts=text(input.window,'hours_window',150).split('|')
 insist(parts.length===3 && /^[0-6]$/.test(parts[1]) && /^\d{1,4}$/.test(parts[2]),'invalid_hours_window')
 const location=text(input.locationId,'location',100)
 await commit(db,who,[guard(db,'EXISTS(SELECT 1 FROM bm_hours WHERE practitioner_id=? AND weekday=? AND start_minute=?) AND EXISTS(SELECT 1 FROM bm_locations WHERE id=? AND active=1)',parts[0],Number(parts[1]),Number(parts[2]),location),stmt(db,'INSERT INTO bm_hour_locations(practitioner_id,weekday,start_minute,location_id) VALUES(?,?,?,?) ON CONFLICT(practitioner_id,weekday,start_minute) DO UPDATE SET location_id=excluded.location_id',parts[0],Number(parts[1]),Number(parts[2]),location),audit(db,who,'hours.location_saved',null,parts[0])])
 return {saved:true}
}

/** Location writes fence both the existing visit and its destination in the transaction. */
export async function locationWrite(db:D1Database,who:Actor,roomId:unknown,clientId?:unknown){
 if(!manager(who))return []
 const condition=`EXISTS(SELECT 1 FROM bm_staff_access x JOIN bm_locations l ON l.id=x.location_id JOIN bm_room_locations r ON r.location_id=l.id
 WHERE x.staff_id=? AND x.kind='location_manager' AND x.location_id=? AND l.active=1 AND r.room_id=?)`
 const args=[who.staffId,who.locationId,roomId??'']
 insist(await one(db,'SELECT 1 WHERE '+condition,...args),'location_scope_refused',403)
 const predicates=[guard(db,condition,...args)]
 if(clientId){
  const scope=`EXISTS(SELECT 1 FROM bm_appointments a JOIN bm_room_locations l ON l.room_id=a.room_id WHERE a.client_id=? AND l.location_id=?)`
  insist(await one(db,'SELECT 1 WHERE '+scope,clientId,who.locationId),'patient_not_in_your_location',403)
  predicates.push(guard(db,scope,clientId,who.locationId))
 }
 return predicates
}
