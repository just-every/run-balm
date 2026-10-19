import {test} from 'node:test'
import assert from 'node:assert/strict'
import {run} from './harness.mjs'
import {readFile} from 'node:fs/promises'
import {clinic,pastVisit,slots} from './clinic.mjs'
import {fakeProviders} from './fakes/stripe.mjs'

// Last month in Brisbane (UTC+10, no daylight saving), so the whole month is history.
const now=new Date(Date.now()+10*3600_000),first=new Date(Date.UTC(now.getUTCFullYear(),now.getUTCMonth()-1,1))
const M=first.toISOString().slice(0,7),days=new Date(Date.UTC(first.getUTCFullYear(),first.getUTCMonth()+1,0)).getUTCDate()
const d=n=>`${M}-${String(n).padStart(2,'0')}`,last=d(days)
const weekdays=n=>Array.from({length:days},(_,i)=>new Date(Date.UTC(first.getUTCFullYear(),first.getUTCMonth(),i+1)).getUTCDay()).filter(w=>n.includes(w)).length
const firstWednesday=d(Array.from({length:7},(_,i)=>i+1).find(i=>new Date(Date.UTC(first.getUTCFullYear(),first.getUTCMonth(),i)).getUTCDay()===3))
// A local 10:00 visit starts at 00:00Z; boundary visits sit an hour or less either side of local midnight.
const at=(date,minutes)=>{const s=`${date}T00:00:00Z`;return [s,new Date(Date.parse(s)+minutes*60_000).toISOString()]}
const utc=(iso,minutes)=>[iso,new Date(Date.parse(iso)+minutes*60_000).toISOString()]
const prevDay=new Date(first.getTime()-86400_000).toISOString().slice(0,10)
const csvRows=text=>text.trim().split('\r\n').map(line=>[...line.matchAll(/"((?:[^"]|"")*)"/g)].map(m=>m[1].replace(/""/g,'"')))

test('REPORT-001: a month of visits, plans, evaluations, utilization and payroll match a hand count, filter by practitioner and export as CSV',()=>run(async h=>{
 await h.finishSetup()
 const {service,practitioners:[priya,sam]}=await clinic(h,['Priya','Sam'])
 const followUp=await h.cmd('service.save',{name:'Follow-up visit',durationMinutes:30,priceCents:6500})
 await h.cmd('hours.save',{practitionerId:priya.id,hours:[1,2,3,4,5].map(weekday=>({weekday,start:'08:00',end:'16:00'}))})
 await h.cmd('hours.save',{practitionerId:sam.id,hours:[2,4].map(weekday=>({weekday,start:'09:00',end:'13:00'}))})
 await h.cmd('holiday.save',{date:firstWednesday,name:'Clinic closure'})
 const move=async(practitioner,serviceId,patients,visits)=>{
  const bundle={provider:'cliniko',practitionerId:practitioner.id,serviceId,dateFormat:'MDY',files:[
   {kind:'patients',name:'patients.csv',csv:'Patient ID,First Name,Last Name,Date of Birth\n'+patients.join('\n')+'\n'},
   {kind:'appointments',name:'appointments.csv',csv:'Source ID,Patient ID,Start At,End At,Status\n'+visits.map(([id,patient,[start,end],status])=>[id,patient,start,end,status].join(',')).join('\n')+'\n'}]}
  const preview=await h.cmd('movein.preview',bundle);assert.equal(preview.canApply,true,JSON.stringify(preview.diagnostics))
  await h.cmd('movein.apply',{...bundle,fingerprint:preview.fingerprint,acceptanceReason:'Reviewed last month of attendance for reporting.'})
 }
 await move(priya,service.id,['p1,Maya,Santos,1988-04-12','p2,Elliot,Reed,1975-11-24','p3,Ana,Cruz,1990-02-03'],[
  ['a1','p1',utc(prevDay+'T15:00:00Z',45),'attended'],// 01:00 local on the 1st: inside the month
  ['a2','p1',at(d(3),45),'attended'],['a3','p2',at(d(4),45),'attended'],['a4','p2',at(d(8),45),'attended'],['a5','p3',at(d(5),60),'attended'],
  ['a6','p1',at(d(10),45),'cancelled'],['a7','p2',at(d(11),45),'cancelled'],['a8','p3',at(d(12),45),'no_show'],
  ['a9','p1',utc(last+'T14:30:00Z',45),'attended'],// 00:30 local on the 1st of this month: outside
  ['a0','p2',utc(prevDay+'T13:30:00Z',45),'attended'],// 23:30 local the day before the month: outside
 ])
 await move(sam,followUp.id,['s1,Leo,Park,1982-07-19','s2,Ivy,Chen,1979-09-30'],[
  ['b1','s1',at(d(2),30),'attended'],['b2','s1',at(d(9),30),'attended'],['b3','s2',at(d(16),30),'no_show'],
 ])
 const state=await h.state(),client=name=>state.clients.find(c=>c.last_name===name)
 const visit=async(name,start)=>(await h.send('/api/balm/clients/'+client(name).id,undefined,h.owner)).value.appointments.find(a=>a.start_at.startsWith(start))
 const sections={subjective:'Knee pain after stairs.',objective:'Flexion 118 deg.',assessment:'Improving tolerance.',plan:'Progress step height.'}
 const sign=async(who,name,input)=>{const note=await h.cmd('note.write',input,who.cookie);await h.cmd('note.sign',{id:note.id,revision:1,signature:name,credentials:name==='Priya'?'PT':'OT',attest:true},who.cookie);return note}
 await sign(priya,'Priya',{clientId:client('Santos').id,appointmentId:(await visit('Santos',d(3))).id,template:'pt.evaluation',sections:{...sections,diagnosis:'M25.561',goals:'Walk stairs'}})
 await sign(priya,'Priya',{clientId:client('Reed').id,appointmentId:(await visit('Reed',d(4))).id,body:'Daily treatment; not an evaluation.'})
 await h.cmd('note.write',{clientId:client('Cruz').id,appointmentId:(await visit('Cruz',d(5))).id,template:'pt.evaluation',sections:{...sections,diagnosis:'M54.50',goals:'Lift safely'}},priya.cookie)// unsigned: not counted
 await sign(priya,'Priya',{clientId:client('Santos').id,appointmentId:(await visit('Santos',last)).id,template:'pt.evaluation',sections:{...sections,diagnosis:'M25.561',goals:'Walk stairs'}})// next month's visit: outside
 await sign(sam,'Sam',{clientId:client('Park').id,appointmentId:(await visit('Park',d(2))).id,template:'ot.evaluation',sections:{...sections,diagnosis:'M79.641',goals:'Grip a cup'}})
 const plan=(clientId,startDate,frequencyPerWeek,durationWeeks)=>h.cmd('plan.send',{clientId,diagnoses:'M25.561',shortTermGoals:'Walk',longTermGoals:'Community walking',frequencyPerWeek,durationWeeks,interventions:'Therapeutic exercise',startDate,physicianName:'Dr Anika Patel',physicianEmail:'physician@clinic.example',signature:'Priya',credentials:'PT',attest:true},priya.cookie)
 await plan(client('Santos').id,d(1),2,2)// 4 planned, a1+a2 attended, nothing booked: dropped off
 await plan(client('Reed').id,d(2),1,2)// 2 planned, a3+a4 attended: completed
 await plan(client('Cruz').id,d(5),3,4)// 12 planned, a5 attended, next visit booked below: in progress
 const next=new Date(Date.parse((await slots(h,service.id,priya.id))[0])+10*3600_000).toISOString()
 await h.cmd('appointment.book',{clientId:client('Cruz').id,practitionerId:priya.id,serviceId:service.id,date:next.slice(0,10),time:next.slice(11,16)})

 // Hand count.
 const priyaAvailable=480*(weekdays([1,2,3,4,5])-1),samAvailable=240*weekdays([2,4]),rate=(a,b)=>Math.round(a/b*1000)/10
 const report=(await h.send(`/api/balm/reports?from=${d(1)}&to=${last}`,undefined,h.owner)).value
 const row=(kind,who)=>report[kind].rows.find(r=>r.practitionerId===who.id)
 assert.deepEqual([report.from,report.to,report.timeZone],[d(1),last,'Australia/Brisbane'])
 assert.deepEqual(row('visits',priya),{practitionerId:priya.id,practitioner:'Priya',scheduled:8,booked:0,arrived:5,cancelled:2,noShows:1,noShowRate:16.7})
 assert.deepEqual(row('visits',sam),{practitionerId:sam.id,practitioner:'Sam',scheduled:3,booked:0,arrived:2,cancelled:0,noShows:1,noShowRate:33.3})
 assert.deepEqual(report.visits.total,{scheduled:11,booked:0,arrived:7,cancelled:2,noShows:2,noShowRate:22.2})
 assert.deepEqual(row('plans',priya),{practitionerId:priya.id,practitioner:'Priya',plans:3,completed:1,inProgress:1,droppedOff:1,attendedVisits:5,plannedVisits:18,visitsPerPlan:1.7,dropOffRate:33.3})
 assert.deepEqual(row('plans',sam),{practitionerId:sam.id,practitioner:'Sam',plans:0,completed:0,inProgress:0,droppedOff:0,attendedVisits:0,plannedVisits:0,visitsPerPlan:null,dropOffRate:null})
 assert.deepEqual([row('evaluations',priya).pt,row('evaluations',priya).total,row('evaluations',sam).ot,report.evaluations.total.total],[1,1,1,2])
 assert.deepEqual(row('utilization',priya),{practitionerId:priya.id,practitioner:'Priya',availableMinutes:priyaAvailable,bookedMinutes:285,attendedMinutes:240,utilization:rate(285,priyaAvailable),productivity:rate(240,priyaAvailable)})
 assert.deepEqual(row('utilization',sam),{practitionerId:sam.id,practitioner:'Sam',availableMinutes:samAvailable,bookedMinutes:90,attendedMinutes:60,utilization:rate(90,samAvailable),productivity:rate(60,samAvailable)})
 assert.deepEqual(report.payroll.rows.map(r=>[r.practitioner,r.service,r.attendedVisits,r.attendedMinutes]),[['Priya','Initial consultation',5,240],['Sam','Follow-up visit',2,60]])
 assert.equal(report.referrals,null,'no referral records exist to convert')
 assert.ok(!JSON.stringify(report).match(/Santos|Reed|Cruz|Park|Chen|Knee pain/),'aggregates never name patients or carry note text')

 // Practitioner filter.
 const only=(await h.send(`/api/balm/reports?from=${d(1)}&to=${last}&practitionerId=${sam.id}`,undefined,h.owner)).value
 assert.deepEqual(only.visits.rows.map(r=>r.practitionerId),[sam.id]);assert.equal(only.visits.total.scheduled,3);assert.equal(only.payroll.rows.length,1);assert.equal(only.evaluations.total.total,1)
 assert.equal((await h.send(`/api/balm/reports?from=${last}&to=${d(1)}`,undefined,h.owner)).status,400)

 // Export every report and reopen it.
 const expected={visits:['8','0','5','2','1','16.7'],plans:['3','1','1','1','5','18','1.7','33.3'],evaluations:['1','0','0','1'],utilization:[String(priyaAvailable),'285','240',String(rate(285,priyaAvailable)),String(rate(240,priyaAvailable))],payroll:['Initial consultation','5','240']}
 for(const kind of Object.keys(expected)){
  const file=await h.send(`/api/balm/reports/${kind}.csv?from=${d(1)}&to=${last}`,undefined,h.owner)
  assert.equal(file.status,200);assert.match(file.headers.get('content-type'),/^text\/csv/);assert.match(file.headers.get('content-disposition'),new RegExp(`attachment; filename="balm-${kind}-${d(1)}-${last}.csv"`))
  const table=csvRows(file.text)
  assert.equal(table.length,4,kind+': header, two practitioners and the total');assert.deepEqual(table[1],['Priya',...expected[kind]]);assert.equal(table[3][0],'All practitioners')
 }

 // The owner's page carries the same filters into every download.
 const page=await h.send(`/app/reports?from=${d(1)}&to=${last}&practitionerId=${sam.id}`,undefined,h.owner)
 assert.equal(page.status,200)
 for(const kind of Object.keys(expected))assert.ok(page.text.includes(`id="report-${kind}"`)&&page.text.includes(`/api/balm/reports/${kind}.csv?from=${d(1)}&amp;to=${last}&amp;practitionerId=${sam.id}`),kind)

 // Only the owner sees reports.
 const reception=await h.staff('Rosa','reception'),key=await h.cmd('agent.create',{label:'Reports assistant'})
 for(const cookie of [reception.cookie,sam.cookie]){assert.equal((await h.send('/api/balm/reports',undefined,cookie)).status,403);assert.equal((await h.send('/api/balm/reports/visits.csv',undefined,cookie)).status,403);assert.equal((await h.send('/app/reports',undefined,cookie)).status,403)}
 assert.equal((await h.send('/api/balm/reports',undefined,'',{authorization:'Bearer '+key.token})).status,401,'agent keys are not a credential for reports')
}))

test('REPORT-002: charges, payments, adjustments, A/R aging by payer and patient, collections per visit, days in A/R and deposits match the ledger and export as CSV',()=>{
 const stripe=fakeProviders()
 return run(async h=>{
  await h.finishSetup()
  const {service,practitioners:[priya]}=await clinic(h)
  await h.cmd('staff.save',{id:priya.id,name:'Priya Shah',email:priya.email,role:'practitioner',credentials:'PT',active:true})
  await h.cmd('pay.npi.save',{staffId:priya.id,npi:'1234567893'})
  await h.cmd('insurance.settings.save',{billingNpi:'1234567893',taxId:'123456789',address:'100 Main St',city:'Austin',state:'TX',postalCode:'78701',senderId:'BALMTEST',contactName:'Jordan Clinic',contactPhone:'5125550100'})
  const payer=await h.cmd('insurance.payer.save',{name:'Aetna',payerId:'60054',receiverId:'AETNA',unitMethod:'cms',fees:[{code:'97110',cents:3500},{code:'97140',cents:2500}]})
  await h.cmd('insurance.enrollment.save',{payerId:payer.id,practitionerId:priya.id,taxonomy:'225100000X',active:true})
  const year=new Date().getUTCFullYear(),coverage={startsOn:`${year-1}-01-01`,endsOn:`${year+1}-12-31`}
  const maya=await h.cmd('client.save',{firstName:'Maya',lastName:'Lee',dateOfBirth:'1988-04-02'})
  const policy=await h.cmd('insurance.policy.save',{clientId:maya.id,payerId:payer.id,memberId:'MEMBER123',relationship:'18',patientSex:'F',address:'200 Oak St',city:'Austin',state:'TX',postalCode:'78701',...coverage})
  const insuredVisit=async hoursAgo=>{
   const appointmentId=await pastVisit(h,maya.id,priya,service.id,h.owner,hoursAgo);await h.cmd('appointment.attend',{id:appointmentId})
   const note=await h.cmd('note.write',{clientId:maya.id,appointmentId,body:'Synthetic therapy visit.',charges:[{code:'97110',minutes:23},{code:'97140',minutes:15}]},priya.cookie)
   await h.cmd('note.sign',{id:note.id,revision:1,signature:'Priya Shah',attest:true},priya.cookie);await h.cmd('pay.codes.save',{appointmentId,icd10:'M25.561'})
   const invoice=await h.cmd('invoice.prepare',{appointmentId});await h.cmd('invoice.approve',{id:invoice.id})
   return {appointmentId,invoice,claim:await h.cmd('insurance.claim.prepare',{appointmentId,policyId:policy.id})}
  }
  // Billed, sent and paid by ERA: $95 charge, $60 paid, $20 CO-45, $15 patient share then paid by card.
  const paid=await insuredVisit(2)
  const batch=await h.cmd('insurance.batch.prepare',{claimIds:[paid.claim.id]});await h.cmd('insurance.batch.submit',{id:batch.id})
  const fixture=async name=>(await readFile(`tests/fixtures/insurance/${name}`,'utf8')).replaceAll('{{CLAIM}}',paid.claim.id)
  await h.cmd('insurance.acknowledgment.import',{payerId:payer.id,x12:await fixture('277CA.x12')})
  await h.cmd('insurance.remittance.import',{payerId:payer.id,x12:await fixture('835-paid.x12')})
  await h.cmd('pay.stripe.connect',{secretKey:'sk_test_'+'a'.repeat(24)})
  const link=await h.cmd('pay.link.create',{clientId:maya.id,purpose:'card',delivery:'shown'}),cardPath=new URL(link.url).pathname
  const session=(await h.form(cardPath+'?do=card',{consent:'on'})).location.split('/').pop();stripe.complete(session)
  assert.equal((await h.send(cardPath+'?setup='+session)).status,200)
  await h.cmd('pay.invoice.charge',{invoiceId:paid.invoice.id})
  // Billed and still at the payer: $95 owed by Aetna.
  await insuredVisit(4)
  // Self-pay, served 45 days ago, $20 paid at the desk: $75 owed by the patient.
  const now=new Date(Date.now()+10*3600_000),today=now.toISOString().slice(0,10),shift=n=>new Date(Date.parse(today)+n*86400_000).toISOString().slice(0,10)
  const bundle={provider:'cliniko',practitionerId:priya.id,serviceId:service.id,dateFormat:'MDY',files:[
   {kind:'patients',name:'patients.csv',csv:'Patient ID,First Name,Last Name,Date of Birth\nn1,Noah,Kim,1979-03-04\n'},
   {kind:'appointments',name:'appointments.csv',csv:`Source ID,Patient ID,Start At,End At,Status\nv1,n1,${shift(-45)}T00:00:00Z,${shift(-45)}T00:45:00Z,attended\n`}]}
  const preview=await h.cmd('movein.preview',bundle);await h.cmd('movein.apply',{...bundle,fingerprint:preview.fingerprint,acceptanceReason:'Reviewed the self-pay history.'})
  const noah=(await h.state()).clients.find(c=>c.last_name==='Kim'),noahFile=async()=>(await h.send('/api/balm/clients/'+noah.id,undefined,h.owner)).value
  const selfPay=await h.cmd('invoice.prepare',{appointmentId:(await noahFile()).appointments[0].id});await h.cmd('invoice.approve',{id:selfPay.id})
  await h.cmd('payment.record',{invoiceId:selfPay.id,amountCents:2000,reference:'CHECK-1001'})

  // Hand count over the last 60 clinic days.
  const query=`from=${shift(-59)}&to=${today}`,report=(await h.send('/api/balm/reports/financial?'+query,undefined,h.owner)).value
  assert.deepEqual(report.summary,{chargesCents:28500,charges:3,paymentsCents:9500,insurancePaymentsCents:6000,cardPaymentsCents:1500,deskPaymentsCents:2000,adjustmentsCents:2000,attendedVisits:3,collectionsPerVisitCents:3167,arCents:17000,daysInAr:35.8})
  assert.deepEqual(report.agingByPayer.rows,[{payer:'Aetna','0-30':9500,'31-60':0,'61-90':0,'91-120':0,'over-120':0,total:9500}])
  assert.deepEqual(report.agingByPatient.rows,[{clientId:noah.id,patient:'Noah Kim','0-30':0,'31-60':7500,'61-90':0,'91-120':0,'over-120':0,total:7500}])
  assert.deepEqual(report.deposits.rows.map(d=>[d.source,d.reference,d.receivedCents,d.postedCents,d.creditCents,d.unpostedCents]),[
   ['Card payments (Stripe)','1 payment',1500,1500,0,0],['ERA · Aetna','EFTPAID001',6000,6000,0,0],['Recorded at the desk','1 payment',2000,2000,0,0]])
  // The same figures as each patient's ledger.
  const mayaLedger=(await h.send('/api/balm/clients/'+maya.id,undefined,h.owner)).value.billing.ledger,noahLedger=(await noahFile()).billing.ledger
  assert.equal(report.agingByPayer.total.total,mayaLedger.insurancePendingCents+noahLedger.insurancePendingCents)
  assert.equal(report.agingByPatient.total.total,mayaLedger.patientBalanceCents+noahLedger.patientBalanceCents)
  assert.equal(report.summary.paymentsCents,mayaLedger.paymentsCents+noahLedger.paymentsCents)
  assert.equal(report.summary.adjustmentsCents,mayaLedger.adjustmentsCents+noahLedger.adjustmentsCents)
  assert.equal(report.deposits.total.receivedCents,report.summary.paymentsCents+report.deposits.total.creditCents+report.deposits.total.unpostedCents)
  assert.ok((await noahFile()).audit.some(a=>a.action==='report.financial_read'),'the named patient on the aging list is audited')

  // Export every report and reopen it.
  const csv=async kind=>{const file=await h.send(`/api/balm/reports/financial/${kind}.csv?${query}`,undefined,h.owner);assert.equal(file.status,200);assert.match(file.headers.get('content-type'),/^text\/csv/);return csvRows(file.text)}
  const summary=Object.fromEntries((await csv('summary')).slice(1))
  assert.deepEqual([summary.charges_usd,summary.payments_usd,summary.adjustments_usd,summary.collections_per_visit_usd,summary.ar_usd,summary.days_in_ar],['285.00','95.00','20.00','31.67','170.00','35.8'])
  assert.deepEqual((await csv('aging-payer'))[1],['Aetna','95.00','0.00','0.00','0.00','0.00','95.00'])
  assert.deepEqual((await csv('aging-patient'))[1],['Noah Kim','0.00','75.00','0.00','0.00','0.00','75.00'])
  const deposits=await csv('deposits');assert.equal(deposits.length,5);assert.deepEqual(deposits[2].slice(1),['ERA · Aetna','EFTPAID001','60.00','60.00','0.00','0.00']);assert.deepEqual(deposits[4].slice(3),['95.00','95.00','0.00','0.00'])
  assert.match((await h.send('/app/reports?'+query,undefined,h.owner)).text,/id="report-deposits"/)
  for(const cookie of [(await h.staff('Rosa','reception')).cookie,priya.cookie])assert.equal((await h.send('/api/balm/reports/financial',undefined,cookie)).status,403)
 },{auth:{BALM_INSURANCE_ADAPTER_URL:'https://gateway.example/submit',BALM_INSURANCE_ADAPTER_TOKEN:'fixture-gateway-key'},outbound:async request=>request.url==='https://gateway.example/submit'?Response.json({status:'submitted',reference:'fixture-batch-accepted'}):stripe.handler(request)})
})
