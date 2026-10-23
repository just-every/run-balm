import { windowsForDate } from '../availability/windows'
import { windowSpans, fitsWindow } from '../availability/window-spans'
import { type AvailabilityWindow, type DateOverride } from '../availability/engine'
import { hostDateAt } from '../availability/timezone'
import { audit, commit, day, guard, human, id, insist, integer, need, one, rows, stmt, text, type Actor, type Data } from '../domain/model'

export function parsedList(value: unknown, field: string): string[] {
 let raw=value
 if(typeof raw==='string'){try{raw=JSON.parse(raw)}catch{raw=String(raw).split(',').map((s:string)=>s.trim()).filter(Boolean)}}
 insist(Array.isArray(raw)&&raw.length<=100,'invalid_'+field)
 return [...new Set(raw.map(v=>text(v,field,100)))]
}
export function windows(value: unknown, weekly=false) {
 let raw=value
 if(typeof raw==='string'){try{raw=JSON.parse(raw)}catch{insist(false,'invalid_hours')}}
 insist(Array.isArray(raw)&&raw.length<=50,'invalid_hours')
 const minute=(v:unknown)=>{if(typeof v==='number')return integer(v,'minute',0,1440);const s=text(v,'time',5);insist(/^(?:[01]\d|2[0-3]):[0-5]\d$|^24:00$/.test(s),'invalid_time');return +s.slice(0,2)*60+ +s.slice(3)}
 const result=raw.map(w=>({...(weekly?{weekday:integer(w.weekday,'weekday',0,6)}:{}),startMinute:minute(w.startMinute??w.start),endMinute:minute(w.endMinute??w.end)}))
 for(const w of result){insist(w.startMinute<w.endMinute,'invalid_hours');insist(!result.some(o=>o!==w&&o.weekday===w.weekday&&o.startMinute<w.endMinute&&o.endMinute>w.startMinute),'overlapping_hours')}
 return result
}
export async function saveException(db:D1Database,who:Actor,input:Data){
 need(who,'owner');human(who)
 const location=input.locationId?text(input.locationId,'location',100):null, practitioner=input.practitionerId?text(input.practitionerId,'practitioner',100):null
 insist(location||practitioner,'choose_location_or_practitioner')
 if(location)insist(await one(db,'SELECT 1 FROM bm_locations WHERE id=? AND active=1',location),'location_not_found',404)
 if(practitioner)insist(await one(db,"SELECT 1 FROM bm_staff WHERE id=? AND role='practitioner' AND active=1",practitioner),'practitioner_not_found',404)
 const date=day(input.date,'date'),mode=input.mode
 insist(['open','closed','remove'].includes(mode),'invalid_override')
 const prior=await one(db,"SELECT id FROM bm_schedule_exceptions WHERE COALESCE(location_id,'')=? AND COALESCE(practitioner_id,'')=? AND date=?",location??'',practitioner??'',date)
 const key=prior?.id??id(),hours=mode==='open'?windows(input.windows):[]
 insist(mode!=='open'||hours.length,'open_override_needs_hours')
 await commit(db,who,[...(mode==='remove'?[stmt(db,'DELETE FROM bm_schedule_exceptions WHERE id=?',key)]:[stmt(db,'INSERT INTO bm_schedule_exceptions(id,location_id,practitioner_id,date,mode,windows,name) VALUES(?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET mode=excluded.mode,windows=excluded.windows,name=excluded.name',key,location,practitioner,date,mode,JSON.stringify(hours),text(input.name,'name',100))]),audit(db,who,'schedule.exception_saved',null,key)])
 return {id:key}
}
export async function serviceContext(db:D1Database,serviceId:unknown,practitionerId:unknown,roomId?:unknown){
 const service=await one(db,'SELECT * FROM bm_services WHERE id=? AND active=1',serviceId)
 insist(service,'service_not_found',404)
 const people=JSON.parse(service.practitioner_ids),places=JSON.parse(service.location_ids)
 insist(!people.length||people.includes(practitionerId),'practitioner_not_bookable_for_service',409)
 const location=roomId?await one(db,'SELECT l.* FROM bm_locations l JOIN bm_room_locations r ON r.location_id=l.id JOIN bm_rooms m ON m.id=r.room_id WHERE r.room_id=? AND m.active=1 AND l.active=1',roomId):null
 insist(!places.length||location&&places.includes(location.id),'choose_a_bookable_service_location',409)
 const clinic=(await one(db,'SELECT time_zone FROM bm_settings WHERE id=1'))!
 return {service,location,zone:String(location?.time_zone||clinic.time_zone)}
}
const fitChecker=(zone:string,hours:AvailabilityWindow[],overrides:DateOverride[])=>{
 const cache=new Map<string,ReturnType<typeof windowSpans>>()
 return (start:Date,end:Date)=>{
  const date=hostDateAt(start,zone)
  if(!cache.has(date))cache.set(date,windowSpans(date,zone,windowsForDate(hours,overrides,date)))
  return [...cache.get(date)!.values()].some(t=>fitsWindow(t.spans,start,end))
 }
}
export async function ruleChecker(db:D1Database,v:Data){
 const {service,location,zone}=await serviceContext(db,v.serviceId,v.practitionerId,v.roomId)
 const exceptions=await rows(db,'SELECT * FROM bm_schedule_exceptions WHERE (location_id IS NULL OR location_id=?) AND (practitioner_id IS NULL OR practitioner_id=?)',location?.id??'',v.practitionerId)
 const hours=await rows(db,'SELECT weekday,start_minute AS startMinute,end_minute AS endMinute FROM bm_hours WHERE practitioner_id=?',v.practitionerId)
 const scopes=new Map<string,Data[]>()
 for(const e of exceptions){const key=(e.location_id??'')+'|'+(e.practitioner_id??'');scopes.set(key,[...(scopes.get(key)??[]),e])}
 const practitionerOverrides=exceptions.filter(e=>e.practitioner_id).map(e=>({hostDate:e.date,mode:e.mode,windows:JSON.parse(e.windows)})) as DateOverride[]
 const locationOverrides=exceptions.filter(e=>!e.practitioner_id).map(e=>({hostDate:e.date,mode:e.mode,windows:JSON.parse(e.windows)})) as DateOverride[]
 const holidays=JSON.parse((await one(db,'SELECT holidays FROM bm_settings WHERE id=1'))!.holidays)
 const practitionerFits=fitChecker(zone,hours as AvailabilityWindow[],practitionerOverrides),locationFits=fitChecker(zone,location?JSON.parse(location.hours):[],locationOverrides)
 const scopeFits=[...scopes.values()].map(group=>({group,fits:fitChecker(zone,[],group.map(e=>({hostDate:e.date,mode:e.mode,windows:JSON.parse(e.windows)})) as DateOverride[])}))
 const others=await rows(db,"SELECT a.id,a.start_at,a.end_at,s.before_buffer,s.after_buffer FROM bm_appointments a JOIN bm_services s ON s.id=a.service_id WHERE a.practitioner_id=? AND a.status IN ('booked','attended')",v.practitionerId)
 const problem=(startAt:string,endAt:string)=>{
  const start=new Date(startAt),end=new Date(endAt)
  if(holidays.some((h:Data)=>h.startAt<endAt&&h.endAt>startAt))return 'clinic_holiday'
  for(const scope of scopeFits){
   const e=scope.group.find(e=>e.date===hostDateAt(start,zone))
   if(e&&!scope.fits(start,end))return 'time_off_or_date_override'
  }
  if(!practitionerFits(start,end))return 'outside_practitioner_hours'
  if(location?.time_zone&&!locationFits(start,end))return 'outside_location_hours'
  return null
 }
 const buffers=(startAt:string,endAt:string)=>!others.some(a=>!(v.exclude??(v.except?[v.except]:[])).includes(a.id)&&((a.end_at<=startAt&&Date.parse(a.end_at)+(a.after_buffer+service.before_buffer)*60000>Date.parse(startAt))||(a.start_at>=endAt&&Date.parse(a.start_at)-(a.before_buffer+service.after_buffer)*60000<Date.parse(endAt))||(a.start_at<endAt&&a.end_at>startAt&&(a.before_buffer+a.after_buffer+service.before_buffer+service.after_buffer)>0)))
 return {zone,location,service,hours,practitionerOverrides,problem,buffers}
}
export async function ruleProblem(db:D1Database,v:Data){return (await ruleChecker(db,v)).problem(v.startAt,v.endAt)}
/** Snapshot the rule revision BEFORE reading rules. Every config mutation invalidates this guard. */
export async function serviceGuards(db:D1Database,v:Data){
 const revision=(await one(db,'SELECT version FROM bm_schedule_revision WHERE id=1'))!.version
 const problem=await ruleProblem(db,v)
 insist(!problem,problem??'slot_unavailable',409)
 return [guard(db,'EXISTS(SELECT 1 FROM bm_schedule_revision WHERE id=1 AND version=?)',revision),bufferGuard(db,v)]
}
// Reserve the sum of adjacent services' after/before buffers, regardless of capacity.
export function bufferGuard(db:D1Database,v:Data){
 return guard(db,`NOT EXISTS(SELECT 1 FROM bm_appointments a JOIN bm_services s ON s.id=a.service_id JOIN bm_services n ON n.id=? WHERE a.practitioner_id=? AND a.status IN ('booked','attended') AND a.id NOT IN(SELECT value FROM json_each(?)) AND
 ((a.end_at<=? AND (s.after_buffer+n.before_buffer)>0 AND julianday(a.end_at)+(s.after_buffer+n.before_buffer)/1440.0>julianday(?)+0.000000001) OR
 (a.start_at>=? AND (s.before_buffer+n.after_buffer)>0 AND julianday(a.start_at)-(s.before_buffer+n.after_buffer)/1440.0<julianday(?)-0.000000001) OR
 (a.start_at<? AND a.end_at>? AND (s.before_buffer+s.after_buffer+n.before_buffer+n.after_buffer)>0)))`,v.serviceId,v.practitionerId,JSON.stringify(v.exclude??(v.except?[v.except]:[])),v.startAt,v.startAt,v.endAt,v.endAt,v.endAt,v.startAt)
}
export async function buffersFit(db:D1Database,v:Data){return (await ruleChecker(db,v)).buffers(v.startAt,v.endAt)}
