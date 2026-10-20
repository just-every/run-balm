import test from 'node:test'
import assert from 'node:assert/strict'
import {run} from './harness.mjs'
import {portalLogin} from './portal-billing.mjs'
import {authorizationClinic,localDay,shiftDay} from './authorization-clinic.mjs'

const allowance=(file,id)=>file.insurance.authorizations.find(a=>a.id===id)

test('INS-003 / REPORT-004: visit and CPT-unit authorizations count attendance, reserve bookings, enforce dates and configured limits, flag uncovered CPTs and clear renewed daily-close warnings', {timeout:120_000},()=>run(async h=>{
 const c=await authorizationClinic(h)
 // The stated 12-visit journey: eight attended visits leave four, on the file and calendar.
 const maya=await c.patient('Maya'),visitAuth=await c.auth(maya,{number:'VISIT12'})
 const visits=[]
 for(let i=0;i<8;i++)visits.push(await c.attend(maya,1+i))
 let a=allowance(await c.file(maya),visitAuth.id)
 assert.deepEqual([a.used_visits,a.reserved_visits,a.remaining_allowance],[8,0,4])
 const visit=(await c.file(maya)).appointments.find(v=>v.id===visits[0]),visitDay=localDay(Date.parse(visit.start_at))
 assert.match((await h.send(`/api/balm/day-sheet.html?date=${visitDay}`,undefined,c.reception.cookie)).text,/4 of 12 visits left/)
 const outside=shiftDay(c.coverage.endsOn,1)
 let warning=await c.book(maya,outside,'09:00',{},409)
 assert.ok(warning.detail.insuranceBooking.warnings.some(w=>w.code==='authorization_outside_dates'&&!w.blocking))
 const acknowledged=await c.book(maya,outside,'09:00',{acknowledgeInsurance:true})
 await h.cmd('appointment.cancel',{id:acknowledged.appointmentId,reason:'Coverage review before treatment'})
 await c.auth(maya,{id:visitAuth.id,number:'VISIT12',bookingAction:'block'})
 warning=await c.book(maya,outside,'10:00',{acknowledgeInsurance:true},409)
 assert.ok(warning.detail.insuranceBooking.warnings.some(w=>w.code==='authorization_outside_dates'&&w.blocking))
 await c.book(maya,c.coverage.endsOn,'09:00') // the authorization's end date is inclusive

 const marisol=await c.patient('Marisol'),day=shiftDay(c.today,3)
 const unitInput={number:'UNITS12',allowanceKind:'units',units:12,unitsPerVisit:3,cptScope:['97110','97140'],lowRemainder:2}
 for(const bad of [{unitsPerVisit:0},{cptScope:'not a code list'},{lowRemainder:-1}])await h.cmd('insurance.authorization.save',{policyId:marisol.policy.id,...c.coverage,...unitInput,...bad},h.owner,400)
 const unitAuth=await c.auth(marisol,unitInput)
 const booked=await c.book(marisol,day)
 const attended=await c.attend(marisol,12)
 a=allowance(await c.file(marisol),unitAuth.id)
 assert.deepEqual([a.used_units,a.reserved_units,a.remaining_allowance],[0,6,6],'unsigned attended and future booked visits each reserve three units')
 await c.sign(marisol,attended)
 a=allowance(await c.file(marisol),unitAuth.id)
 assert.deepEqual([a.used_units,a.reserved_units,a.remaining_allowance],[1,3,8],'CMS bills the whole 16-minute visit as one unit, replacing its reservation')
 await h.cmd('insurance.payer.save',{id:c.payer.id,name:'Aetna',payerId:'60054',receiverId:'AETNA',unitMethod:'ama'})
 assert.equal(allowance(await c.file(marisol),unitAuth.id).used_units,2,'AMA bills each eight-minute service as one unit')
 await h.cmd('insurance.payer.save',{id:c.payer.id,name:'Aetna',payerId:'60054',receiverId:'AETNA',unitMethod:'cms'})
 let page=await h.send(`/app?view=day&date=${day}&appt=${booked.appointmentId}`,undefined,c.reception.cookie)
 assert.match(page.text,/8 of 12 units left/)
 assert.match((await h.send(`/api/balm/day-sheet.csv?date=${day}`,undefined,c.reception.cookie)).text,/8 of 12 units left/)
 await c.auth(marisol,{...unitInput,id:unitAuth.id,lowRemainder:8})
 const referral=await h.cmd('case.open',{clientId:marisol.id,policyId:marisol.policy.id,receivedOn:c.coverage.startsOn,referringFirst:'Anika',referringLast:'Patel',referringNpi:'1234567893',diagnosis:'M25.561 knee pain',authorizationEmail:'authorizations@payer.example'})
 const prepared=(await h.send('/api/balm/cases',undefined,h.owner)).value.cases.find(x=>x.referral.id===referral.id).steps.find(s=>s.kind==='authorization.request')
 assert.ok(prepared)
 await h.cmd('case.approve',{caseId:referral.id,key:prepared.key,digest:prepared.digest,wording:prepared.wording})
 const sent=h.mail.findLast(m=>m.to.includes('authorizations@payer.example'))
 assert.match(sent.text,/12 further units/,'the payer request asks for units rather than an invented number of visits')
 warning=await c.book(marisol,day,'10:00',{},409)
 assert.ok(warning.detail.insuranceBooking.warnings.some(w=>w.code==='authorization_low'&&w.remainingAllowance===8))
 const second=await c.book(marisol,day,'10:00',{acknowledgeInsurance:true})
 await c.auth(marisol,{...unitInput,id:unitAuth.id,units:7,lowRemainder:0,bookingAction:'block'})
 warning=await c.book(marisol,day,'11:00',{acknowledgeInsurance:true},409)
 assert.ok(warning.detail.insuranceBooking.warnings.some(w=>w.code==='authorization_exhausted'&&w.blocking))
 const close=()=>h.state().then(s=>s.dailyClose.authorizations)
 assert.ok((await close()).some(x=>x.clientId===marisol.id&&x.kind==='low_authorization'))
 await h.cmd('service.save',{id:c.service.id,selfBookAuthRequired:true})
 const cookie=await portalLogin(h,'marisol@patient.example')
 const start=time=>new Date(`${day}T${time}:00+10:00`).toISOString()
 const action=(name,input)=>h.form('/portal/action',{name,...input},cookie)
 assert.equal((await action('appointment.book',{serviceId:c.service.id,practitionerId:c.priya.id,start:start('11:00')})).status,409)
 assert.equal((await h.form('/book',{serviceId:c.service.id,practitionerId:c.priya.id,start:start('11:00'),firstName:'Marisol',lastName:'Rivera',dateOfBirth:'1980-03-07',email:'marisol@patient.example',privacy:'on'})).status,409)
 assert.equal((await action('appointment.move',{id:booked.appointmentId,start:start('11:00')})).status,303,'moving releases its own three-unit reservation before reserving the destination')
 assert.equal(allowance(await c.file(marisol),unitAuth.id).remaining_allowance,0)
 // New current coverage clears the obsolete low alert and permits another patient booking.
 const renewal=await c.auth(marisol,{...unitInput,number:'RENEWED20',startsOn:c.today,units:20,lowRemainder:4,bookingAction:'block'})
 assert.ok(!(await close()).some(x=>x.clientId===marisol.id&&x.kind==='low_authorization'))
 assert.equal((await action('appointment.book',{serviceId:c.service.id,practitionerId:c.priya.id,start:start('12:00')})).status,303)
 const signedDay=localDay(Date.parse((await c.file(marisol)).appointments.find(v=>v.id===attended).start_at))
 const renewalUsed=Number(signedDay>=c.today)
 a=allowance(await c.file(marisol),renewal.id)
 assert.deepEqual([a.used_units,a.reserved_units,a.remaining_allowance],[renewalUsed,9,11-renewalUsed])
 const audit=(await c.file(marisol)).audit
 assert.ok(audit.some(x=>x.action==='report.daily_close_read'))
 assert.equal((await h.state(c.priya.cookie)).dailyClose,null)

 // A known outside-scope CPT flags the whole visit and reserves/debits nothing.
 await c.auth(marisol,{...unitInput,id:renewal.id,number:'RENEWED20',startsOn:c.today,units:20,cptScope:['97110'],lowRemainder:4})
 await h.cmd('pay.codes.save',{appointmentId:second.appointmentId,cpt:'97140 GP x1',icd10:'M25.561'})
 let file=await c.file(marisol)
 assert.ok(file.insurance.warnings[second.appointmentId].some(w=>w.code==='authorization_not_covered'))
 assert.equal(allowance(file,renewal.id).reserved_units,6,'the outside-scope booking no longer reserves three units')
 assert.ok((await close()).some(x=>x.id===second.appointmentId&&x.kind==='authorization_scope'))
 page=await h.send(`/app?view=day&date=${day}&appt=${second.appointmentId}`,undefined,c.reception.cookie)
 assert.match(page.text,/data-authorization-covered="false"/)
 // Scope is checked after CMS allocates across both CPTs: a scope containing only
 // the zero-unit code does not silently take the billed unit from the other code.
 const signedAuth=renewalUsed?renewal:unitAuth
 await c.auth(marisol,{...unitInput,id:signedAuth.id,startsOn:renewalUsed?c.today:c.coverage.startsOn,cptScope:['97140'],units:20})
 a=allowance(await c.file(marisol),signedAuth.id)
 assert.equal(a.used_units,0)
 assert.ok((await close()).some(x=>x.id===attended&&x.kind==='authorization_scope'))
 await c.auth(maya,{id:visitAuth.id,number:'VISIT12',cptScope:['97110']})
 await h.cmd('pay.codes.save',{appointmentId:visits[0],cpt:'97140 GP x1',icd10:'M25.561'})
 assert.equal(allowance(await c.file(maya),visitAuth.id).used_visits,7,'CPT scope also controls visit-based consumption')
 // Expired unit coverage remains in the close while it leaves a future visit uncovered.
 const expired=await c.patient('Elena',c.sam)
 const expiredAuth=await c.auth(expired,{...unitInput,number:'EXPIRED',endsOn:shiftDay(c.today,-1),bookingAction:'warn'})
 await c.book(expired,day,'09:00',{acknowledgeInsurance:true})
 assert.ok((await close()).some(x=>x.id===expiredAuth.id&&x.kind==='expired_authorization'))
 await c.auth(expired,{...unitInput,number:'ELENA-RENEW',startsOn:c.today,units:20})
 assert.ok(!(await close()).some(x=>x.clientId===expired.id&&x.kind==='expired_authorization'))
}))
