import { days, hoursDay } from './hours'
import { timeZoneField } from './time-zone'
import { field, form, h, hidden, panel, select } from './shared'

export function serviceAvailability(x:any,s:any){
 const ids=(name:string,key:string,list:any[])=>`<fieldset><legend>${h(name)}</legend><p class="help">Leave all unchecked to allow every active ${key==='practitionerIds'?'practitioner':'location'}.</p>${hidden(key,'')}${list.map(p=>`<label class="check"><input type="checkbox" name="${key}_item" value="${h(p.id)}"${JSON.parse(x?.[key==='practitionerIds'?'practitioner_ids':'location_ids']??'[]').includes(p.id)?' checked':''}><span>${h(p.name)}</span></label>`).join('')}</fieldset>`
 return ids('Bookable practitioners','practitionerIds',(s.staff??[]).filter((p:any)=>p.role==='practitioner'&&p.active))+ids('Bookable locations','locationIds',s.locations??[])
 +field('cptDefaults','Suggested CPT codes (comma separated)',JSON.parse(x?.cpt_defaults??'[]').join(', '),'text','maxlength="600"')+'<p class="help">Suggestions appear in a blank note draft. They record no minutes or treatment; the clinician reviews and saves them using the licensed catalog.</p>'
 +'<div class="pair">'+field('beforeBuffer','Buffer before (minutes)',x?.before_buffer??0,'number','min="0" max="120" required')+field('afterBuffer','Buffer after (minutes)',x?.after_buffer??0,'number','min="0" max="120" required')+'</div>'
}
function locationFields(s:any,l?:any){
 const hours=JSON.parse(l?.hours??'[]')
 return (l?hidden('id',l.id):'')+field('name','Location name',l?.name??'','text','required maxlength="100"')+timeZoneField({time_zone:l?.time_zone||s.settings.time_zone,time_zone_chosen:1}).replace('id="zone-note"','')+hidden('hoursForm','on')
 +[1,2,3,4,5,6,0].map(d=>hoursDay(d,hours.filter((w:any)=>w.weekday===d).map((w:any)=>({start_minute:w.startMinute,end_minute:w.endMinute})),!l)).join('')
 +'<p class="help">Hours and practitioner weekly clock times use this location’s time zone. Existing visits keep their exact moments when rules change. The staff calendar and staff booking forms stay in the clinic’s time zone. Assign a room below before offering this location.</p>'
}
export function locationsPanel(s:any){
 return panel('Locations', '<details><summary>Add a location</summary>'+form('location.save','/app/clinic',locationFields(s),'Add location')+'</details>'+(s.locations??[]).map((l:any)=>'<details><summary>'+h(l.name)+'</summary>'+form('location.save','/app/clinic',locationFields(s,l),'Save location')+'</details>').join('')
 +(s.rooms??[]).map((r:any)=>form('room.location','/app/clinic',hidden('roomId',r.id)+select('locationId',r.name,(s.locations??[]).map((l:any)=>[l.id,l.name]),(s.roomLocations??[]).find((x:any)=>x.room_id===r.id)?.location_id),'Assign room',true)).join(''),'','locations')
}
export function exceptionsPanel(s:any){
 const fields=select('locationId','Location',[['','All locations'],...(s.locations??[]).map((l:any)=>[l.id,l.name])],'','')+select('practitionerId','Practitioner',[['','All practitioners'],...(s.staff??[]).filter((p:any)=>p.role==='practitioner').map((p:any)=>[p.id,p.name])],'','')+field('date','Date in the location’s time zone','','date','required')+field('name','Reason / holiday name','','text','required maxlength="100"')+select('mode','Availability',[['closed','Day off / closed'],['open','Replace this date’s hours']])+field('start','Opens at','','time')+field('end','Closes at','','time')
 return panel('Time off and one-day hours','<p>Choose a location, practitioner or both. A day off always closes that scope. A one-day opening replaces its usual hours, but cannot override another scope’s closure or a clinic holiday. Without a location, the date applies in the location being booked.</p>'+form('schedule.exception','/app/clinic',fields,'Save date rule')+(s.scheduleExceptions??[]).map((e:any)=>'<p>'+h(e.date)+' · '+h(e.name)+' · '+h(e.mode==='closed'?'Closed':JSON.parse(e.windows).map((w:any)=>Math.floor(w.startMinute/60)+':'+String(w.startMinute%60).padStart(2,'0')+'–'+Math.floor(w.endMinute/60)+':'+String(w.endMinute%60).padStart(2,'0')).join(', '))+'</p>'+form('schedule.exception','/app/clinic',hidden('locationId',e.location_id)+hidden('practitionerId',e.practitioner_id)+hidden('date',e.date)+hidden('mode','remove'),'Remove date rule',true)).join(''),'','date-rules')
}
