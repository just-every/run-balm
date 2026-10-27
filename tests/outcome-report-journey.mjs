import assert from 'node:assert/strict'
import {clinic,slots,pastVisit} from './clinic.mjs'

export async function outcomeReportFixture(h) {
 await h.finishSetup()
 const {service,practitioners:[priya,sam]}=await clinic(h,['Priya','Sam'])
 const payer=await h.cmd('insurance.payer.save',{name:'Synthetic payer',payerId:'SYNTHETIC1',receiverId:'SYNTHETIC1',unitMethod:'cms',fees:[]})
 const episodes=[]
 const available=await slots(h,service.id,priya.id)
 assert.ok(available.length>40)
 const start=new Date(available[0]),date=offset=>new Date(start.getTime()+offset*86400000).toISOString().slice(0,10)
 const publish=async changed=>{
  const draft=await h.cmd('intake.prepare',{title:'Synthetic function questionnaire',serviceId:service.id,questions:[{id:'reason',label:'Reason',type:'short',required:false}],instruments:changed==='empty'?[]:[{kind:'lefs',items:Array.from({length:20},(_,i)=>(changed?'Revised activity ':'Activity ')+(i+1))}]})
  return h.cmd('intake.publish',{id:draft.id})
 }
 let form=await publish(false)
 const record=async (entry,offset,answer,when=form)=>{
  if(answer===null)when=await publish('empty')
  const visit=await h.cmd('appointment.book',{clientId:entry.client.id,practitionerId:entry.practitioner.id,serviceId:service.id,date:date(offset),time:entry.time,episodeId:entry.episode.id})
  entry.visits.push(visit)
  await h.cmd('pay.codes.save',{appointmentId:visit.appointmentId,icd10:entry.index<10?'M25.561,M54.50':'M54.50'})
  {
   const path='/intake/'+visit.token,page=await h.send(path)
   assert.equal(page.status,200,page.text)
   const consents=Object.fromEntries([...page.text.matchAll(/name="(consentVersion[^"]*)" value="([^"]+)"/g)].flatMap(([,name,value])=>[[name,value],[name.replace('Version','Accepted'),'on']]))
   const values=answer===null?[]:Array.isArray(answer)?answer:Array(20).fill(answer)
   const fields={formId:when.id,...consents,signerName:'Synthetic Patient',signerRelationship:'patient',signatureTyped:'Synthetic Patient',...Object.fromEntries(values.map((v,i)=>['q_out_lefs_'+(i+1),String(v)]))}
   const result=await h.form(path,fields);assert.equal(result.status,303,result.text)
  }
  if(answer===null)form=await publish(false)
 }
 for(let i=0;i<20;i++){
  const practitioner=i<10?priya:sam
  const client=await h.cmd('client.save',{firstName:'Synthetic',lastName:'Outcome '+i,dateOfBirth:'1980-01-01'})
  const episode=await h.cmd('episode.open',{clientId:client.id,title:'Synthetic episode '+i,start:'direct_access'})
  const entry={client,episode,practitioner,index:i,time:String(8+i%10).padStart(2,'0')+':00',visits:[]};episodes.push(entry)
  if(i<10)await h.cmd('insurance.policy.save',{clientId:client.id,payerId:payer.id,memberId:'synthetic-balm-'+i,relationship:'18',patientSex:'U',address:'100 Synthetic Street',city:'Austin',state:'TX',postalCode:'78701',startsOn:'2000-01-01',endsOn:'2099-12-31'})
  await record(entry,0,i===7||i===8||i===19?null:2)
 }
 // Republishing identical authorized items retains instrument identity, while
 // allowing the existing intake door to issue a fresh questionnaire for a visit.
 form=await publish(false)
 for(const entry of episodes)await record(entry,2,[6,8,18,19].includes(entry.index)?null:entry.index<10?3:1)
 // Repeated diagnoses and secondary coverage must never multiply an episode.
 await h.cmd('insurance.policy.save',{clientId:episodes[0].client.id,payerId:payer.id,memberId:'synthetic-balm-secondary',priority:2,relationship:'18',patientSex:'U',address:'100 Synthetic Street',city:'Austin',state:'TX',postalCode:'78701',startsOn:'2000-01-01',endsOn:'2099-12-31'})
 const query='from='+date(-1)+'&to='+date(5)
 return {service,priya,sam,payer,episodes,query,record,publish,date}
}

export async function assertOutcomeReport(h,c) {
 const read=async extra=>{const r=await h.send('/api/balm/reports/outcomes?'+c.query+(extra??''),undefined,h.owner);assert.equal(r.status,200,r.text);return r.value}
 const report=await read(),row=id=>report.rows.find(r=>r.practitionerId===id)
 const counts=r=>[r.episodes,r.paired,r.missingBaseline,r.missingFollowUp,r.missingBoth,r.baselineMean,r.followUpMean,r.meanChange]
 assert.equal(report.episodes,20);assert.equal(report.rows.length,2)
 assert.equal(report.episodesWithoutScores,2)
 assert.deepEqual(counts(row(c.priya.id)),[10,7,2,2,1,40,60,20])
 assert.deepEqual(counts(row(c.sam.id)),[10,8,1,2,1,40,20,-20])
 assert.deepEqual((await read('&diagnosis=M25.561&payerId='+c.payer.id)).rows.map(counts),[[10,7,2,2,1,40,60,20]])
 assert.deepEqual((await read('&payerId=unrecorded&outcomePractitionerId='+c.sam.id)).rows.map(counts),[[10,8,1,2,1,40,20,-20]])
 assert.equal((await read('&diagnosis=M99.999')).episodes,0)
 assert.deepEqual((await read('&diagnosis=M99.999')).rows,[])
 const csv=await h.send('/api/balm/reports/outcomes.csv?'+c.query,undefined,h.owner)
 assert.equal(csv.status,200);assert.match(csv.headers.get('content-type'),/^text\/csv/)
 const {read:readSheet,utils}=await import('xlsx')
 const cells=text=>{const book=readSheet(text,{type:'string'});return utils.sheet_to_json(book.Sheets[book.SheetNames[0]],{header:1,defval:''})}
 const lines=cells(csv.text)
 assert.equal(lines.length,3)
 assert.deepEqual(lines[1].slice(8),[10,7,2,2,1,40,60,20,0])
 assert.deepEqual(lines[2].slice(8),[10,8,1,2,1,40,20,-20,0])
 // External labels stay text even when they begin like a spreadsheet formula.
 await h.cmd('staff.save',{id:c.sam.id,name:'=1+1',email:c.sam.email,role:'practitioner',active:true})
 const guarded=await h.send('/api/balm/reports/outcomes.csv?'+c.query+'&outcomePractitionerId='+c.sam.id,undefined,h.owner)
 assert.equal(guarded.status,200)
 assert.equal(cells(guarded.text)[1][0],"'=1+1")
 assert.deepEqual(cells(guarded.text)[1].slice(13,16),[40,20,-20],'numeric means and negative change remain numbers; text labels stay guarded')
 await h.cmd('staff.save',{id:c.sam.id,name:'Sam',email:c.sam.email,role:'practitioner',active:true})
 assert.ok(!JSON.stringify(report).includes('Outcome 0'),'no patient names in report')
 const audit=await h.db.prepare("SELECT client_id,detail FROM bm_audit WHERE action='report.outcomes_read'").all()
 assert.equal(new Set(audit.results.filter(r=>r.client_id).map(r=>r.client_id)).size,20)
 assert.ok(audit.results.some(r=>r.detail.includes(c.payer.id)),'selected filters audited')
 for(const role of ['reception','biller','practitioner']){
  const person=await h.staff('Report'+role,role)
  for(const path of ['/api/balm/reports/outcomes','/api/balm/reports/outcomes.csv'])assert.equal((await h.send(path,undefined,person.cookie)).status,403)
  if(role==='biller')assert.ok(!(await h.send('/app/reports',undefined,person.cookie)).text.includes('id="report-outcomes"'))
  await h.cmd('staff.save',{id:person.id,name:person.name,email:person.email,role,active:false})
  assert.equal((await h.send('/api/balm/reports/outcomes',undefined,person.cookie)).status,403)
 }
 const key=await h.cmd('agent.create',{label:'Synthetic report agent'})
 assert.equal((await h.send('/api/balm/reports/outcomes',undefined,'',{authorization:'Bearer '+key.token})).status,401)
 assert.equal((await h.send('/api/balm/reports/outcomes',undefined,'')).status,401)
 // A changed item set cannot become a follow-up for the older instrument.
 const changed=await c.publish(true)
 await c.record(c.episodes[8],4,4,changed)
 const separated=await read('&outcomePractitionerId='+c.priya.id)
 assert.equal(separated.rows.length,2)
 const revised=separated.rows.find(r=>r.instrumentVersion!==row(c.priya.id).instrumentVersion)
 assert.deepEqual(counts(revised),[10,0,10,9,9,null,null,null])
 assert.deepEqual(counts(separated.rows.find(r=>r.instrumentVersion===row(c.priya.id).instrumentVersion)),[10,7,2,2,1,40,60,20])
 // Signed chart measurements have no instrument or scoring version. Their
 // presence is counted, but they cannot silently enter compatible means.
 for(const [i,value] of [[0,10],[1,90]]){
  const appointmentId=await pastVisit(h,c.episodes[0].client.id,c.priya,c.service.id,h.owner,i?2:4)
  await h.cmd('appointment.attend',{id:appointmentId})
  const note=await h.cmd('note.write',{clientId:c.episodes[0].client.id,appointmentId,body:'Synthetic score observation'},c.priya.cookie)
  await h.cmd('note.measure',{noteId:note.id,kind:'score',name:'LEFS',value,unit:'points'},c.priya.cookie)
  await h.cmd('note.sign',{id:note.id,revision:1,signature:'Priya',credentials:'PT',attest:true},c.priya.cookie)
 }
 const chartReport=await h.send('/api/balm/reports/outcomes?from='+c.date(-5)+'&to='+c.date(5),undefined,h.owner)
 assert.equal(chartReport.status,200)
 const chart=chartReport.value.rows.find(r=>r.source==='Signed chart')
 assert.equal(chart.unversionedPairs,1);assert.equal(chart.paired,0);assert.equal(chart.meanChange,null)
 return report
}
