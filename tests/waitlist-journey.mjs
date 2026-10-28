import assert from 'node:assert/strict'

const offerPath = mail => new URL(mail.text.match(/https?:\/\/\S+\/offer\/[\w-]+/)[0]).pathname

// Continue the scheduling sanity journey through native commands and real offer links.
export async function waitlistPreferencesJourney(h) {
 await h.cmd('settings.save',{clinicName:'Riverside Physio',timeZone:'America/New_York',confirmTimeZone:true})
 const service=await h.cmd('service.save',{name:'Waitlist follow-up',durationMinutes:45,priceCents:9500})
 const p=await h.staff('Willa','practitioner',{discipline:'pt',profession:'Physical therapist'})
 await h.cmd('hours.save',{practitionerId:p.id,hours:[0,1,2,3,4,5,6].map(weekday=>({weekday,start:'00:00',end:'24:00'}))})
 const patient=async n=>h.cmd('client.save',{firstName:'Synthetic',lastName:'Waitlist '+n,dateOfBirth:'1990-01-01',email:['synthetic-balm-'+n,'patient.example'].join('@')})
 const [source,match,wrongDay,lateStart,earlyEnd,removed]=await Promise.all([501,502,503,504,505,506].map(patient))
 const input=clientId=>({clientId,practitionerId:p.id,serviceId:service.id,earliestDate:'2099-03-01',latestDate:'2099-11-08',weekdays:[0],timeFrom:'09:00',timeUntil:'09:45'})
 for(const invalid of [{weekdays:[]},{weekdays:[7]},{weekdays:['']},{weekdays:[true]},{timeFrom:'9:00'},{timeUntil:'24:01'},{timeFrom:'10:00'},{timeFrom:'09:45',timeUntil:'09:45'}]){
  await h.cmd('waitlist.add',{...input(match.id),...invalid},h.owner,400)
 }
 assert.equal((await h.state()).waitlist.entries.filter(e=>e.service_id===service.id).length,0,'invalid preferences never create an entry')
 const added=await h.cmd('waitlist.add',input(match.id))
 await h.cmd('waitlist.add',{...input(wrongDay.id),weekdays:[1]})
 await h.cmd('waitlist.add',{...input(lateStart.id),timeFrom:'09:01'})
 await h.cmd('waitlist.add',{...input(earlyEnd.id),timeUntil:'09:44'})
 const removedEntry=await h.cmd('waitlist.add',input(removed.id))
 await h.cmd('waitlist.remove',{id:removedEntry.id})
 const cancel=async(date,time='09:00')=>{
  const booked=await h.cmd('appointment.book',{clientId:source.id,practitionerId:p.id,serviceId:service.id,date,time})
  const before=h.mail.length
  await h.cmd('appointment.cancel',{id:booked.appointmentId,reason:'Synthetic opening'})
  return h.mail.slice(before).filter(m=>m.subject.startsWith('A time opened up'))
 }
 // The exact 45-minute window holds on both sides of the spring and autumn offset changes.
 const links=[]
 for(const [date,utc] of [['2099-03-01','2099-03-01T14:00:00.000Z'],['2099-03-08','2099-03-08T13:00:00.000Z'],['2099-11-01','2099-11-01T14:00:00.000Z'],['2099-11-08','2099-11-08T14:00:00.000Z']]){
  const mails=await cancel(date)
  assert.deepEqual(mails.map(m=>m.to[0]),[['synthetic-balm-502','patient.example'].join('@')],'only the complete Sunday window matches '+date)
  const link=offerPath(mails[0]);links.push(link)
  assert.match((await h.send(link)).text,/A time opened up/)
  assert.ok((await h.state()).waitlist.offers.some(o=>o.start_at===utc),'offers follow the clinic zone across DST')
 }
 assert.equal((await cancel('2099-03-08','08:59')).length,0,'a start before the preferred window never matches')
 assert.equal((await cancel('2099-03-08','09:01')).length,0,'a visit ending after the preferred window never matches')
 const count=async()=> (await h.state()).appointments.filter(a=>a.client_id===match.id&&a.status==='booked').length
 const refuse=async(path=links[0])=>{assert.equal((await h.form(path,{})).status,409);assert.equal(await count(),0,'refusal creates no appointment')}
 // Simulate preferences changed since delivery; the public acceptance always re-reads them.
 for(const [column,value,original] of [['preferred_weekdays','[1]','[0]'],['preferred_start_minute',541,540],['preferred_end_minute',584,585],['earliest_date','2099-03-02','2099-03-01'],['latest_date','2099-02-28','2099-11-08']]){
  // Date bounds must remain a valid stored window.
  if(column==='latest_date')await h.db.prepare('UPDATE bm_waitlist SET earliest_date=? WHERE id=?').bind('2099-02-01',added.id).run()
  await h.db.prepare(`UPDATE bm_waitlist SET ${column}=?,version=version+1 WHERE id=?`).bind(value,added.id).run()
  await refuse()
  await h.db.prepare(`UPDATE bm_waitlist SET ${column}=?,version=version+1 WHERE id=?`).bind(original,added.id).run()
 }
 await h.db.prepare('UPDATE bm_waitlist SET earliest_date=? WHERE id=?').bind('2099-03-01',added.id).run()
 // A service that became longer must still fit completely at acceptance.
 await h.cmd('service.save',{id:service.id,name:'Waitlist follow-up',durationMinutes:60,priceCents:9500})
 await refuse()
 await h.cmd('service.save',{id:service.id,name:'Waitlist follow-up',durationMinutes:45,priceCents:9500})
 const competitor=await h.cmd('appointment.book',{clientId:source.id,practitionerId:p.id,serviceId:service.id,date:'2099-03-01',time:'09:00'})
 await refuse()
 await h.cmd('appointment.cancel',{id:competitor.appointmentId,reason:'Synthetic opening restored'})
 // A delivered link cannot revive an entry removed by staff.
 await h.cmd('waitlist.remove',{id:added.id})
 await refuse(links[1])
 assert.match((await h.send(links[1])).text,/has been taken/)
 const history=(await h.state()).waitlist.entries.find(e=>e.id===added.id)
 assert.deepEqual([history.status,JSON.parse(history.preferred_weekdays),history.preferred_start_minute,history.preferred_end_minute],['removed',[0],540,585])
}
