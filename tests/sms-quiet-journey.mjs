import assert from 'node:assert/strict'
import {harness} from './harness.mjs'
import {clinic} from './clinic.mjs'
import {recordTestBaa} from './readiness-fixture.mjs'
import {fakeProviders} from './fakes/stripe.mjs'

export const smsAuth={SMS_PROVIDER:'twilio',TWILIO_ACCOUNT_SID:'synthetic-balm-sms-account',TWILIO_AUTH_TOKEN:'synthetic-balm-sms-token',TWILIO_FROM:'+15005550006'}
export const quietPolicy={intervals:'22:00-08:00',source:'synthetic-balm-401 reviewed appointment policy',attest:true}
export async function smsQuietFixture(h) {
 await h.finishSetup()
 const {service,practitioners:[priya]}=await clinic(h)
 const reception=await h.staff('Rosa','reception')
 const fields={firstName:'Synthetic',lastName:'Quiet patient',phone:'+13125550199'}
 const patient=await h.cmd('client.save',fields)
 await h.cmd('reminders.settings',{leadMinutes:'1440',sms:true})
 await h.cmd('reminders.consent',{clientId:patient.id,consent:true})
 return {service,priya,reception,fields,patient}
}

export async function smsQuietJourney() {
 const edge=fakeProviders();let loseResponse=false
 const h=await harness({entry:'tests/sms-quiet-worker.ts',auth:smsAuth,outbound:async request=>{
  const response=await edge.handler(request)
  if(loseResponse&&new URL(request.url).hostname==='api.twilio.com')throw Error('synthetic-balm-402 lost response after acceptance')
  return response
 }})
 try {
  const c=await smsQuietFixture(h)
  const tick=async at=>(await h.mf.getWorker()).scheduled({scheduledTime:Date.parse(at),cron:'* * * * *'})
  const book=async(date,time='15:30')=>h.cmd('appointment.book',{clientId:c.patient.id,practitionerId:c.priya.id,serviceId:c.service.id,date,time})
  const history=async id=>(await h.send('/api/balm/clients/'+c.patient.id,undefined,h.owner)).value.reminderHistory.find(r=>r.appointment_id===id&&r.channel==='sms')
  const saveZone=async zone=>h.cmd('client.save',{...c.fields,id:c.patient.id,smsTimeZone:zone})
  const noAttempt=async(visit,count=0)=>{
   const row=await history(visit.appointmentId)
   assert.ok(row);assert.equal(row.state,'pending');assert.equal(row.attempted_at,null);assert.equal(row.sent_at,null)
   assert.equal(edge.texts.length,count,'no HTTP request may be hidden by a deferred or refused reminder')
   assert.equal((await h.db.prepare('SELECT COUNT(*) n FROM bm_visit_reply_links WHERE reminder_id=?').bind(row.id).first()).n,0,'no private reply capability is issued before an eligible attempt')
   return row
  }
  const first=await book('2030-01-10')
  await tick('2030-01-09T13:00:00Z')
  assert.match((await noAttempt(first)).outcome,/owner.*quiet intervals/)
  await h.cmd('reminders.quiet_hours',{...quietPolicy,intervals:'25:00-08:00'},h.owner,400)
  await h.cmd('reminders.quiet_hours',{...quietPolicy,intervals:'08:00-08:00'},h.owner,400)
  await h.cmd('reminders.quiet_hours',{...quietPolicy,attest:false},h.owner,400)
  await h.cmd('reminders.quiet_hours',quietPolicy,c.reception.cookie,403)
  await h.cmd('reminders.quiet_hours',quietPolicy,c.priya.cookie,403)
  assert.equal((await h.state()).reminders.sms_quiet_policy_id,null)
  const policy=await h.cmd('reminders.quiet_hours',quietPolicy)
  await tick('2030-01-09T13:01:00Z')
  assert.match((await noAttempt(first)).outcome,/IANA time zone/)
  await h.cmd('client.save',{...c.fields,id:c.patient.id,smsTimeZone:'Not/A_Zone'},h.owner,400)
  assert.equal((await h.send('/api/balm/clients/'+c.patient.id,undefined,h.owner)).value.client.sms_time_zone,null)
  await saveZone('America/New_York')
  await Promise.all([tick('2030-01-09T13:02:00Z'),tick('2030-01-09T13:02:00Z')])
  assert.equal(edge.texts.length,1,'one eligible claim wins across scheduled replays')
  assert.deepEqual([(await history(first.appointmentId)).sms_quiet_policy_id,(await history(first.appointmentId)).sms_time_zone],[policy.id,'America/New_York'])
  assert.equal((await history(first.appointmentId)).state,'sent')
  assert.match(edge.texts[0].body.Body,/Your appointment/)
  assert.equal(edge.texts[0].body.To,'+13125550199')

  // Independent UTC instants: New York skips 02:00 on March 10, 2030 and repeats 01:00 on November 3.
  const spring=await book('2030-03-11','13:00')
  for(const at of ['2030-03-10T03:00:00Z','2030-03-10T05:30:00Z','2030-03-10T06:59:00Z','2030-03-10T07:00:00Z','2030-03-10T11:59:00Z']){
   await tick(at);assert.match((await noAttempt(spring,1)).outcome,/Deferred/)
  }
  await tick('2030-03-10T12:00:00Z');await tick('2030-03-10T12:01:00Z')
  assert.equal(edge.texts.length,2,'the first actual 08:00 after the spring clock jump is eligible exactly once')
  const fall=await book('2030-11-04')
  for(const at of ['2030-11-03T05:30:00Z','2030-11-03T06:30:00Z','2030-11-03T12:59:00Z']){
   await tick(at);await noAttempt(fall,2)
  }
  await tick('2030-11-03T13:00:00Z');assert.equal(edge.texts.length,3,'both repeated 01:30 hours stay quiet until 08:00 EST')

  const revoked=await book('2030-11-06')
  await tick('2030-11-05T05:30:00Z');await noAttempt(revoked,3)
  await h.cmd('reminders.consent',{clientId:c.patient.id,consent:false},c.reception.cookie)
  await tick('2030-11-05T13:00:00Z');assert.match((await noAttempt(revoked,3)).outcome,/not consented/)
  await h.cmd('reminders.consent',{clientId:c.patient.id,consent:true},c.reception.cookie)
  const baa=(await h.state()).readiness.baas.find(b=>b.processor==='sms'&&!b.revoked_at)
  await h.cmd('readiness.baa.revoke',{id:baa.id})
  await tick('2030-11-05T13:01:00Z');assert.match((await noAttempt(revoked,3)).outcome,/BAA/)
  await recordTestBaa(h,'sms')
  await saveZone('')
  await tick('2030-11-05T13:02:00Z');await noAttempt(revoked,3)
  await saveZone('America/New_York')
  await h.cmd('reminders.quiet_hours',{...quietPolicy,intervals:'08:00-20:00'})
  await tick('2030-11-05T13:03:00Z');await noAttempt(revoked,3)
  const latest=await h.cmd('reminders.quiet_hours',{...quietPolicy,intervals:'22:00-08:00\n12:00-13:00'})
  await tick('2030-11-05T13:04:00Z');assert.equal(edge.texts.length,4,'later eligibility uses current consent, BAA, zone and replacement policy')
  assert.equal((await history(revoked.appointmentId)).sms_quiet_policy_id,latest.id)

  const cancelled=await book('2030-11-08')
  await tick('2030-11-07T05:30:00Z');await noAttempt(cancelled,4)
  await h.cmd('appointment.cancel',{id:cancelled.appointmentId,reason:'Patient requested cancellation'})
  await tick('2030-11-07T13:00:00Z');assert.equal(edge.texts.length,4)
  assert.equal((await history(cancelled.appointmentId)).state,'cancelled')
  const expired=await book('2030-11-10')
  await tick('2030-11-09T05:30:00Z');await noAttempt(expired,4)
  await tick('2030-11-10T05:30:00Z');await tick('2030-11-10T13:00:00Z');assert.equal(edge.texts.length,4,'no deferred text goes out at or after the visit starts')
  assert.equal((await history(expired.appointmentId)).state,'cancelled')

  const uncertain=await book('2030-11-12')
  loseResponse=true
  await tick('2030-11-11T13:00:00Z');assert.equal(edge.texts.length,5)
  assert.equal((await history(uncertain.appointmentId)).state,'uncertain')
  loseResponse=false
  await h.cmd('reminders.quiet_hours',quietPolicy)
  await tick('2030-11-11T13:01:00Z');await tick('2030-11-11T13:20:00Z')
  assert.equal(edge.texts.length,5,'an uncertain HTTP attempt is never replayed after a policy change')
  const original=(await h.state()).reminders.sms_quiet_policy_id
  await h.cmd('reminders.quiet_hours',quietPolicy,h.owner,409,{'x-synthetic-revoke':h.auth.OWNER_EMAIL})
  assert.equal((await h.state(await h.signIn(h.auth.OWNER_EMAIL))).reminders.sms_quiet_policy_id,original,'live owner revocation rolls back the complete policy write')
  assert.equal((await h.db.prepare("SELECT COUNT(*) n FROM bm_audit WHERE action='sms.quiet_policy_recorded'").first()).n,4)
 } finally {await h.close()}
}
