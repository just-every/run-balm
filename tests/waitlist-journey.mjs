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
 await h.cmd('capacity.save',{practitionerId:p.id,capacity:2})
 await h.cmd('capacity.save',{serviceId:service.id,capacity:2})
 await h.cmd('appointment.book',{clientId:source.id,practitionerId:p.id,serviceId:service.id,date:'2099-11-08',time:'09:00'})
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
 await h.db.prepare("UPDATE bm_offers SET hold_until=? WHERE start_at='2099-03-08T13:00:00.000Z'").bind(new Date(Date.now()-60000).toISOString()).run()
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
 // The original recipient must not lose an active hold to a staff booking.
 await h.cmd('appointment.book',{clientId:source.id,practitionerId:p.id,serviceId:service.id,date:'2099-03-01',time:'09:00'},h.owner,409)
 await h.db.prepare("UPDATE bm_offers SET hold_until=? WHERE start_at='2099-03-01T14:00:00.000Z'").bind(new Date(Date.now()-60000).toISOString()).run()
 await h.cmd('capacity.save',{practitionerId:p.id,capacity:1})
 const competitor=await h.cmd('appointment.book',{clientId:source.id,practitionerId:p.id,serviceId:service.id,date:'2099-03-01',time:'09:00'})
 await refuse()
 await h.cmd('appointment.cancel',{id:competitor.appointmentId,reason:'Synthetic opening restored'})
 // Authorization is checked again after delivery, with no new booking on refusal.
 const payer=await h.cmd('insurance.payer.save',{name:'Synthetic waitlist Medicare',payerId:'SYNTHETICBALM507',receiverId:'CMS',unitMethod:'cms',medicare:true})
 const policyInput=clientId=>({clientId,payerId:payer.id,memberId:'synthetic-balm-508',relationship:'18',patientSex:'M',address:'1 Synthetic St',city:'Austin',state:'TX',postalCode:'78701',startsOn:'2099-01-01',endsOn:'2099-12-31'})
 const policy=await h.cmd('insurance.policy.save',policyInput(match.id))
 await h.cmd('insurance.authorization.save',{policyId:policy.id,number:'synthetic-balm-509',startsOn:'2099-01-01',endsOn:'2099-12-31',visits:1,bookingAction:'block'})
 const reserved=await h.cmd('appointment.book',{clientId:match.id,practitionerId:p.id,serviceId:service.id,date:'2099-11-07',time:'12:00',acknowledgeInsurance:'on'})
 const reservedCount=await count()
 assert.equal((await h.form(links[3],{})).status,409)
 assert.equal(await count(),reservedCount,'an exhausted authorization cannot be bypassed by an old offer')
 await h.cmd('appointment.cancel',{id:reserved.appointmentId,reason:'Synthetic reservation released'})
 // Capacity left does not authorize overlapping two Medicare patients.
 await h.cmd('capacity.save',{practitionerId:p.id,capacity:2})
 await h.cmd('capacity.save',{serviceId:service.id,capacity:2})
 await h.cmd('insurance.policy.save',policyInput(source.id))
 // A pre-existing overlapping visit became Medicare-covered after delivery.
 await refuse(links[3])
 // A delivered link cannot revive an entry removed by staff.
 await h.cmd('waitlist.remove',{id:added.id})
 await refuse(links[1])
 assert.match((await h.send(links[1])).text,/has been taken/)
 const history=(await h.state()).waitlist.entries.find(e=>e.id===added.id)
 assert.deepEqual([history.status,JSON.parse(history.preferred_weekdays),history.preferred_start_minute,history.preferred_end_minute],['removed',[0],540,585])
 await waitlistTurnCompatibility(h,p,source)
}

// Retain the original competing-recipient guarantee for pre-migration links,
// while new turns skip a removed recipient through the native scheduler.
async function waitlistTurnCompatibility(h,p,source) {
 const service=await h.cmd('service.save',{name:'Synthetic legacy follow-up',durationMinutes:45,priceCents:9500})
 const people=[]
 for(const n of [530,531])people.push(await h.cmd('client.save',{firstName:'Synthetic',lastName:'Turn '+n,email:['synthetic-balm-'+n,'patient.example'].join('@')}))
 for(const person of people)await h.cmd('waitlist.add',{clientId:person.id,practitionerId:p.id,serviceId:service.id,earliestDate:'2099-12-01',latestDate:'2099-12-31'})
 const sourceVisit=await h.cmd('appointment.book',{clientId:source.id,practitionerId:p.id,serviceId:service.id,date:'2099-12-01',time:'14:00'})
 await h.cmd('appointment.cancel',{id:sourceVisit.appointmentId,reason:'Synthetic migration opening'})
 const first=offerPath(h.mail.findLast(m=>m.subject.startsWith('A time opened up')))
 const offer=(await h.state()).waitlist.offers.find(o=>o.source_appointment_id===sourceVisit.appointmentId)
 const recipient=await h.db.prepare('SELECT r.entry_id FROM bm_offer_recipients r JOIN bm_waitlist w ON w.id=r.entry_id WHERE r.offer_id=? AND w.client_id=?').bind(offer.id,people[1].id).first()
 // Model an already-delivered simultaneous offer from the older schema.
 const token=crypto.randomUUID().replaceAll('-','')
 const digest=Buffer.from(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(token))).toString('hex')
 await h.db.prepare('UPDATE bm_offers SET ordered=0 WHERE id=?').bind(offer.id).run()
 await h.db.prepare("UPDATE bm_offer_recipients SET offer_token_hash=?,delivery='sent' WHERE offer_id=? AND entry_id=?").bind(digest,offer.id,recipient.entry_id).run()
 const links=[first,'/offer/'+token]
 const answers=await Promise.all(links.map(path=>h.form(path,{})))
 assert.deepEqual(answers.map(r=>r.status).sort(),[303,409],'legacy recipients still race for exactly one booking')
 assert.match(answers.find(r=>r.status===409).text,/This time has been taken/)
 const winner=answers.findIndex(r=>r.status===303)
 assert.match((await h.send(links[winner])).text,/You're booked/)
 assert.match((await h.send(links[1-winner])).text,/has been taken/)
 assert.ok(h.mail.some(m=>m.to.includes(['synthetic-balm-'+(530+1-winner),'patient.example'].join('@'))&&m.subject.includes('has been taken')))
 assert.equal((await h.state()).appointments.filter(a=>a.service_id===service.id&&a.start_at===offer.start_at&&a.status==='booked').length,1)
 // A removed active turn releases the reservation and never receives another message.
 for(const entry of (await h.state()).waitlist.entries.filter(e=>e.service_id===service.id&&e.status==='waiting'))await h.cmd('waitlist.remove',{id:entry.id})
 const nextService=await h.cmd('service.save',{name:'Synthetic removed-turn follow-up',durationMinutes:45,priceCents:9500})
 const entries=[]
 for(const person of people)entries.push(await h.cmd('waitlist.add',{clientId:person.id,practitionerId:p.id,serviceId:nextService.id,earliestDate:'2099-12-01',latestDate:'2099-12-31'}))
 const opening=await h.cmd('appointment.book',{clientId:source.id,practitionerId:p.id,serviceId:nextService.id,date:'2099-12-02',time:'14:00'})
 await h.cmd('appointment.cancel',{id:opening.appointmentId,reason:'Synthetic removal opening'})
 const old=offerPath(h.mail.findLast(m=>m.subject.startsWith('A time opened up')))
 await h.cmd('waitlist.remove',{id:entries[0].id})
 const before=h.mail.length
 for(let i=0;i<2;i++)await (await h.mf.getWorker()).scheduled({scheduledTime:Date.now(),cron:'* * * * *'})
 const advanced=h.mail.slice(before).filter(m=>m.subject.startsWith('A time opened up'))
 assert.deepEqual(advanced.map(m=>m.to[0]),[['synthetic-balm-531','patient.example'].join('@')],'removal advances once to the next eligible patient')
 assert.equal((await h.form(old,{})).status,409,'a removed turn cannot accept the successor hold')
}
