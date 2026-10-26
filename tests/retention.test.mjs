import { fakeProviders } from './fakes/stripe.mjs'
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { run } from './harness.mjs'
import { clinic, pastVisit } from './clinic.mjs'

const policy = {state:'AZ',adultYears:6,minorYears:6,payerYears:0,majorityAge:18}
const file = async(h,id) => (await h.send('/api/balm/clients/'+id,undefined,h.owner)).value
// Historical visit anchors are fixture setup, not an application clock override.
async function ageVisit(h,visit,date='1990-01-02') {
  await h.db.prepare('UPDATE bm_appointments SET start_at=?,end_at=? WHERE id=?').bind(date+'T02:00:00.000Z',date+'T02:45:00.000Z',visit).run()
}

test('HIPAA-002: state rules, payer/practice maximums and minor majority protect treated records until their period ends',()=>run(async h=>{
  await h.finishSetup()
  const {service,practitioners:[priya]}=await clinic(h)
  const patient=await h.cmd('client.save',{firstName:'Aged',lastName:'Patient',dateOfBirth:'1960-01-01'})
  const visit=await pastVisit(h,patient.id,priya,service.id)
  const defaults=await h.cmd('retention.save',{state:'AZ',adultYears:'',minorYears:'',majorityAge:''})
  assert.equal(defaults.policy.adult,defaults.policy.rule.adultYears)
  assert.ok(defaults.policy.rule.source.startsWith('https://'))
  await h.cmd('retention.preview',{clientId:patient.id,now:'2200-01-01'},h.owner,409)
  await h.cmd('client.erase',{id:patient.id},h.owner,409)
  await ageVisit(h,visit)
  const oldest=(await file(h,patient.id)).retention
  assert.equal(oldest.eligible,true)
  await h.cmd('retention.save',{...policy,payerYears:70})
  assert.equal((await file(h,patient.id)).retention.eligible,false)
  await h.cmd('retention.save',{...policy,adultYears:70})
  assert.equal((await file(h,patient.id)).retention.eligible,false)
  const year=new Date().getUTCFullYear()
  const minor=await h.cmd('client.save',{firstName:'Minor',lastName:'Patient',dateOfBirth:`${year-19}-01-01`})
  const childVisit=await pastVisit(h,minor.id,priya,service.id)
  await ageVisit(h,childVisit,`${year-10}-01-02`)
  await h.cmd('retention.save',policy)
  const child=(await file(h,minor.id)).retention
  assert.equal(child.minor,true)
  assert.equal(child.eligible,false,'adult last-treatment period has ended but majority-plus-period has not')
  await h.cmd('retention.preview',{clientId:minor.id},h.owner,409)
  await h.cmd('retention.save',{...policy,state:'TX',adultYears:10,minorYears:10})
  assert.equal((await file(h,patient.id)).retention.eligible,false,'ambiguous applicable rule fails closed')
  await h.cmd('retention.save',{...policy,state:'TX',adultYears:10,minorYears:10,reviewedRule:'Practice counsel reviewed all disciplines and payer contracts; retain ten years after treatment and majority.'})
  assert.equal((await file(h,patient.id)).retention.eligible,true)
  const state=await h.state()
  const states=state.retention.states
  assert.equal(new Set(states.map(r=>r.state)).size,51,'all 50 states and DC')
  for(const r of states) {
    assert.ok(['verified','ambiguous'].includes(r.status),`${r.state} reviewed against a primary source`)
    assert.ok(r.source.startsWith('https://')&&r.sourceTitle&&/^\d{4}-\d{2}-\d{2}$/.test(r.reviewedOn),`${r.state} cites its source and retrieval date`)
    if(r.status==='verified') assert.ok(Number.isInteger(r.adultYears)&&Number.isInteger(r.minorYears)&&r.majorityAge,`${r.state} verified rows carry adult and minor periods`)
  }
  for(const s of states.filter(r=>r.status==='ambiguous').map(r=>r.state)) {
    await h.cmd('retention.save',{state:s,adultYears:'',minorYears:'',payerYears:0,majorityAge:''})
    assert.deepEqual((await file(h,patient.id)).retention.reasons,['state_rule_requires_review'],`${s} ambiguous rule fails closed without the owner's documented rule`)
  }
  const page=await h.send('/app/clinic',undefined,h.owner)
  assert.equal(page.status,200)
  assert.match(page.text,/name=retention.save/)
  assert.match(page.text,/Indiana Code §16-39-7-1[^<]*<\/a> · retrieved/)
}))

test('HIPAA-002: only the owner approves an unchanged eligible inventory; holds, mutations and expired previews refuse destruction',()=>run(async h=>{
  const {service,practitioners:[priya]}=await clinic(h)
  const reception=await h.staff('Rosa','reception')
  const patient=await h.cmd('client.save',{firstName:'Review',lastName:'Patient',dateOfBirth:'1950-01-01'})
  const visit=await pastVisit(h,patient.id,priya,service.id)
  await ageVisit(h,visit)
  for(const cookie of [priya.cookie,reception.cookie]) {
    await h.cmd('retention.save',policy,cookie,403)
    await h.cmd('retention.hold',{clientId:patient.id,reason:'Pending litigation'},cookie,403)
    await h.cmd('retention.preview',{clientId:patient.id},cookie,403)
    await h.cmd('retention.destroy',{previewId:'unknown',digest:'unknown',confirm:true},cookie,403)
  }
  await h.cmd('retention.save',policy)
  const preview=await h.cmd('retention.preview',{clientId:patient.id})
  await h.cmd('retention.destroy',{...preview},h.owner,400)
  await h.cmd('retention.destroy',{...preview,confirm:true,digest:'wrong'},h.owner,409)
  await h.cmd('retention.hold',{clientId:patient.id,reason:'Pending litigation'})
  await h.cmd('retention.destroy',{...preview,confirm:true},h.owner,409)
  await h.cmd('retention.hold',{clientId:patient.id,release:true,reason:'Counsel released hold'})
  await h.cmd('retention.destroy',{...preview,confirm:true},h.owner,409)
  const changed=await h.cmd('retention.preview',{clientId:patient.id})
  await h.cmd('client.save',{id:patient.id,firstName:'Revised',lastName:'Patient',dateOfBirth:'1950-01-01'})
  await h.cmd('retention.destroy',{...changed,confirm:true},h.owner,409)
  const expired=await h.cmd('retention.preview',{clientId:patient.id})
  await h.db.prepare("UPDATE bm_retention_previews SET expires_at='2000-01-01T00:00:00.000Z' WHERE id=?").bind(expired.previewId).run()
  await h.cmd('retention.destroy',{...expired,confirm:true},h.owner,409)
  const unused=await h.cmd('client.save',{firstName:'Held',lastName:'Unused'})
  await h.cmd('retention.hold',{clientId:unused.id,reason:'Preservation demand'})
  await h.cmd('client.erase',{id:unused.id},h.owner,409)
}))

test('HIPAA-002: approved destruction removes clinical bytes and private tokens, retains anonymous accounts and immutable audit and receipt, and cannot be replayed',()=>run(async h=>{
  await h.finishSetup()
  const {service,practitioners:[priya]}=await clinic(h)
  const patient=await h.cmd('client.save',{firstName:'Destroy',lastName:'Private',dateOfBirth:'1950-01-01',email:'private@patient.example'})
  const other=await h.cmd('client.save',{firstName:'Keep',lastName:'Patient'})
  const location=await h.cmd('location.save',{name:'Historical clinic'})
  const room=await h.cmd('room.save',{name:'Historical room'})
  await h.cmd('room.location',{roomId:room.id,locationId:location.id})
  const visit=await pastVisit(h,patient.id,priya,service.id,h.owner,2,{roomId:room.id})
  await ageVisit(h,visit)
  // An already signed historical chart: no test rewrites any signed content or bypasses its immutability.
  const noteId=crypto.randomUUID()
  await h.db.prepare("INSERT INTO bm_notes(id,client_id,appointment_id,author_id,created_at,template) VALUES(?,?,?,?,?,'pt.evaluation')").bind(noteId,patient.id,visit,priya.id,'1990-01-02T02:45:00.000Z').run()
  await h.db.prepare('INSERT INTO bm_note_revisions(note_id,number,body,written_at) VALUES(?,?,?,?)').bind(noteId,1,'Sensitive historical treatment narrative','1990-01-02T02:45:00.000Z').run()
  await h.db.prepare("INSERT INTO bm_measures(id,note_id,client_id,kind,name,side,value,unit,recorded_by,recorded_at) VALUES(?,?,?,'rom','Knee flexion','right',95,'degrees',?,?)").bind(crypto.randomUUID(),noteId,patient.id,priya.id,'1990-01-02T02:50:00.000Z').run()
  await h.db.prepare("INSERT INTO bm_note_checks(id,note_id,revision,context_sha256,model,result,checked_by,checked_at) VALUES(?,?,1,'historical','test-model',?,'clinician@clinic.example','1990-01-02T02:50:00.000Z')").bind(crypto.randomUUID(),noteId,JSON.stringify({findings:[{evidence:'Sensitive historical treatment narrative'}]})).run()
  const submissionId=crypto.randomUUID()
  await h.db.prepare('INSERT INTO bm_note_submissions(id,note_id,revision,supervisor_id,author_name,author_credentials,submitted_at,sha256) VALUES(?,?,1,?,?,?,?,?)').bind(submissionId,noteId,priya.id,'Historical student','SPT','1990-01-02T02:55:00.000Z','synthetic-balm-4').run()
  await h.db.prepare("INSERT INTO bm_note_reviews(submission_id,decision,reason,reviewed_at,reviewed_by) VALUES(?,'cosigned','',?,?)").bind(submissionId,'1990-01-02T03:00:00.000Z',priya.email).run()
  await h.db.prepare('UPDATE bm_notes SET signed_at=?,signed_revision=1,signer_name=?,signer_credentials=?,signed_sha256=? WHERE id=?').bind('1990-01-02T03:00:00.000Z','Historical Clinician','PT','historical-signature',noteId).run()
  const historicalExercise=crypto.randomUUID()
  await h.db.prepare("INSERT INTO bm_home_exercises(id,client_id,title,sets,reps,frequency,instructions,assigned_by,assigned_at,source_note_id,hold_seconds) VALUES(?,?,'Historical home program',1,'5','Daily','Historical private instructions',?,'1990-01-02T03:00:00.000Z',?,3)").bind(historicalExercise,patient.id,priya.email,noteId).run()
  await h.db.prepare("INSERT INTO bm_home_exercise_done(exercise_id,day,done_at,pain) VALUES(?,'1990-01-03','1990-01-03T03:00:00.000Z',2)").bind(historicalExercise).run()
  await h.db.prepare("INSERT INTO bm_audit(at,actor_email,actor_role,action,client_id,subject_id,detail) VALUES(?,?,?,?,?,?,?)").bind('1990-01-02T03:00:00.000Z','clinician@clinic.example','practitioner','note.break_glass_read',patient.id,noteId,'Patient-specific emergency narrative').run()
  // A second historical note was finalized under an explicit assistant daily rule.
  const historicalAssistant=await h.staff('HistoricalAssistant','assistant',{discipline:'pt',supervisorId:priya.id,credentials:'PTA'})
  const historicalRule=await h.cmd('assistant_daily.save',{staffId:historicalAssistant.id,state:'AZ',startsOn:'1990-01-01',endsOn:'1990-12-31',stateSource:'Synthetic historical state permission',payerSource:'Synthetic historical cash permission',attest:true})
  const historicalDaily=crypto.randomUUID()
  await h.db.prepare("INSERT INTO bm_notes(id,client_id,appointment_id,author_id,created_at,template) VALUES(?,?,?,?,?,'pt.daily')").bind(historicalDaily,patient.id,visit,historicalAssistant.id,'1990-01-02T02:45:00.000Z').run()
  await h.db.prepare('INSERT INTO bm_note_revisions(note_id,number,body,written_at) VALUES(?,1,?,?)').bind(historicalDaily,'Historical assistant clinical content','1990-01-02T02:45:00.000Z').run()
  await h.db.prepare('UPDATE bm_notes SET signed_at=?,signed_revision=1,signer_name=?,signer_credentials=?,signed_sha256=? WHERE id=?').bind('1990-01-02T03:00:00.000Z','HistoricalAssistant','PTA','synthetic-balm-5',historicalDaily).run()
  const historicalBasis=await h.db.prepare('SELECT * FROM bm_assistant_daily_rules WHERE id=?').bind(historicalRule.id).first()
  await h.db.prepare('INSERT INTO bm_assistant_signed_notes(note_id,supervisor_id,rule_id,rule_snapshot,author_discipline) VALUES(?,?,?,?,?)').bind(historicalDaily,priya.id,historicalRule.id,JSON.stringify(historicalBasis),'pt').run()
  await h.db.prepare('INSERT INTO bm_assistant_supervision(note_id,supervision_given,supervisor_name,supervisor_credentials,attested_at,sha256) VALUES(?,?,?,?,?,?)').bind(historicalDaily,'on_site','Priya','PT','1990-01-02T03:00:00.000Z','synthetic-balm-6').run()
  await assert.rejects(h.db.prepare('DELETE FROM bm_note_revisions WHERE note_id=?').bind(noteId).run())
  await assert.rejects(h.db.prepare("UPDATE bm_audit SET detail='' WHERE client_id=?").bind(patient.id).run(),/audit_append_only/)
  await h.cmd('appointment.attend',{id:visit},priya.cookie)
  const invoice=await h.cmd('invoice.prepare',{appointmentId:visit})
  await h.cmd('invoice.approve',{id:invoice.id})
  await h.cmd('payment.record',{invoiceId:invoice.id,amountCents:9500,reference:'Historical-payment'})
  const planContent=JSON.stringify({startDate:'1990-01-01',frequencyPerWeek:1,durationWeeks:1,goals:'Private historical goals'})
  await h.db.prepare(`INSERT INTO bm_plans_of_care(id,client_id,author_id,note_id,content,content_sha256,therapist_name,therapist_credentials,created_at,physician_name,physician_email,sent_at,status)
    VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)`).bind(crypto.randomUUID(),patient.id,priya.id,noteId,planContent,'historical-plan-signature','Historical Clinician','PT','1990-01-02T03:00:00.000Z','Private Physician','physician@example.test','1990-01-02T03:00:00.000Z','sent').run()
  await h.form('/portal',{email:'private@patient.example'})
  const portalMail=h.mail.findLast(m=>m.to.includes('private@patient.example')&&m.text.includes('/portal/confirm?token='))
  assert.ok(portalMail)
  const portalLink=new URL(portalMail.text.match(/https?:\/\/[^\s]+\/portal\/confirm\?token=[^\s]+/)[0])
  assert.equal((await h.send(portalLink.pathname+portalLink.search)).status,200)
  const reports=async()=>{
    const operational=await h.send('/api/balm/reports?from=1990-01-01&to=1990-01-31',undefined,h.owner)
    assert.equal(operational.status,200)
    const financial=[]
    for(const year of [1990,new Date().getUTCFullYear()]) {
      const result=await h.send(`/api/balm/reports/financial?from=${year}-01-01&to=${year}-12-31`,undefined,h.owner)
      assert.equal(result.status,200)
      const r=result.value
      for(const row of r.deposits.rows)if(['Cash sale','Gift value purchased'].includes(row.source))row.reference='Retail receipt'
      financial.push({summary:r.summary,agingByPayer:r.agingByPayer,patientTotal:r.agingByPatient.total,deposits:r.deposits})
    }
    return {operational:operational.value,financial}
  }
  const releasePayer=await h.cmd('insurance.payer.save',{name:'Synthetic retained payer',payerId:'SYNTHETICRETENTION',receiverId:'SYNTHETIC',unitMethod:'cms',fees:[{code:'97110',cents:3500}]})
  await h.cmd('insurance.policy.save',{clientId:patient.id,payerId:releasePayer.id,memberId:'synthetic-balm-1',relationship:'18',patientSex:'F',address:'100 Main St',city:'Austin',state:'TX',postalCode:'78701',startsOn:'1980-01-01',endsOn:'2099-12-31'})
  const released=await h.cmd('note_release.prepare',{clientId:patient.id,payerId:releasePayer.id,purpose:'appeal',reference:'synthetic-balm-2',appointmentIds:[visit]})
  await h.send('/api/balm/note-releases/'+released.id+'.pdf',undefined,h.owner)
  await h.cmd('note_release.approve',{id:released.id,sha256:released.sha256,attest:true})
  // Historical retail originals, including a partially redeemed gift and used package.
  const giftId=crypto.randomUUID(),productId=crypto.randomUUID(),packageId=crypto.randomUUID()
  const retailOriginal=btoa('%PDF-1.4 Synthetic historical retail original')
  for(const [id,kind,amount,tax,gift,units] of [[giftId,'gift_card',10000,0,null,0],[productId,'product',5000,413,giftId,0],[packageId,'membership',40000,0,null,5]]) {
    await h.db.prepare(`INSERT INTO bm_retail_sales(id,client_id,kind,label,service_id,units,amount_cents,tax_cents,tax_basis_points,tax_state,tax_evidence,gift_id,reference,recorded_at,recorded_by,receipt_base64)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,'1990-01-02T03:00:00.000Z',?,?)`).bind(id,patient.id,kind,'Private historical item',kind==='membership'?service.id:null,units,amount,tax,kind==='product'?825:0,kind==='product'?'TX':'','Private tax evidence',gift,'Private retail '+id,h.auth.OWNER_EMAIL,retailOriginal).run()
  }
  await h.db.prepare("INSERT INTO bm_membership_events(id,sale_id,client_id,state,reason,consent_evidence,recorded_by,recorded_at) VALUES(?,?,?,'active','Private reason','Private consent',?,'1990-01-02T03:00:00.000Z')").bind(crypto.randomUUID(),packageId,patient.id,h.auth.OWNER_EMAIL).run()
  await h.db.prepare('INSERT INTO bm_package_assignments VALUES(?,?,?,?,?)').bind(visit,packageId,patient.id,h.auth.OWNER_EMAIL,'1990-01-02T03:00:00.000Z').run()
  await h.db.prepare('INSERT INTO bm_package_uses VALUES(?,?,?,?)').bind(visit,packageId,patient.id,'1990-01-02T03:00:00.000Z').run()
  assert.equal((await h.send('/api/balm/receipts/'+giftId+'.pdf',undefined,h.owner)).status,200)
  await assert.rejects(h.db.prepare('DELETE FROM bm_retail_sales WHERE id=?').bind(productId).run(),/retail_original_kept/)
  const reportBefore=await reports()
  assert.equal(reportBefore.operational.evaluations.total.pt,1)
  assert.equal(reportBefore.operational.plans.total.completed,1)
  assert.equal(reportBefore.operational.payroll.total.attendedVisits,1)
  assert.ok(reportBefore.operational.utilization.total.attendedMinutes>0)
  assert.equal(reportBefore.financial[0].summary.chargesCents,54913)
  assert.equal(reportBefore.financial[1].deposits.total.receivedCents,9500)
  await h.cmd('retention.save',policy)
  const locationBefore=await h.send('/api/balm/reports?from=1990-01-01&to=1990-01-31&locationId='+location.id,undefined,h.owner)
  assert.equal(locationBefore.status,200)
  const preview=await h.cmd('retention.preview',{clientId:patient.id})
  assert.ok(preview.records.bm_note_revisions>0)
  assert.equal(preview.records.bm_note_releases,1);assert.equal(preview.records.bm_note_release_approvals,1)
  assert.equal(preview.records.bm_note_checks,1,'AGENT-003 questions containing clinical excerpts join destruction scope')
  assert.ok(preview.records.bm_portal_links>0)
  assert.equal(preview.records.bm_measures,1)
  assert.equal(preview.records.bm_membership_events,1)
  assert.equal(preview.records.bm_assistant_signed_notes,1);assert.equal(preview.records.bm_assistant_supervision,1)
  assert.equal(preview.records.bm_note_submissions,1);assert.equal(preview.records.bm_note_reviews,1)
  const before=await h.db.prepare('SELECT sequence,at,actor_email,actor_role,action,client_id,subject_id FROM bm_audit WHERE client_id=?').bind(patient.id).all()
  const destroyed=await h.cmd('retention.destroy',{previewId:preview.previewId,digest:preview.digest,confirm:true})
  assert.equal(destroyed.destroyed,true)
  assert.equal((await h.db.prepare('SELECT COUNT(*) n FROM bm_assistant_signed_notes WHERE note_id=?').bind(historicalDaily).first()).n,0)
  assert.equal((await h.db.prepare('SELECT COUNT(*) n FROM bm_assistant_supervision WHERE note_id=?').bind(historicalDaily).first()).n,0)
  assert.equal((await h.send('/api/balm/note-releases/'+released.id+'.pdf',undefined,h.owner)).status,404)
  assert.equal((await h.db.prepare('SELECT COUNT(*) n FROM bm_note_releases WHERE client_id=?').bind(patient.id).first()).n,0)
  const locationAfter=await h.send('/api/balm/reports?from=1990-01-01&to=1990-01-31&locationId='+location.id,undefined,h.owner)
  assert.deepEqual(locationAfter.value,locationBefore.value,'anonymous location reports retain every figure')
  assert.equal((await h.db.prepare('SELECT COUNT(*) n FROM bm_note_checks WHERE note_id=?').bind(noteId).first()).n,0,'AGENT-003 clinical excerpts are removed by approved destruction')
  assert.deepEqual(await reports(),reportBefore,'destruction preserves dated financial and operational reporting')
  assert.equal((await h.form('/portal/confirm',{token:portalLink.searchParams.get('token')})).status,410)
  assert.equal((await h.send('/api/balm/clients/'+patient.id,undefined,h.owner)).status,404)
  assert.equal((await h.send('/api/balm/clients/'+other.id,undefined,h.owner)).status,200)
  const remaining=await h.db.prepare('SELECT sequence,at,actor_email,actor_role,action,client_id,subject_id,detail FROM bm_audit WHERE client_id=?').bind(patient.id).all()
  for(const row of before.results) assert.ok(remaining.results.some(r=>Object.keys(row).every(k=>row[k]===r[k])))
  assert.ok(remaining.results.every(r=>r.detail===''))
  assert.equal((await h.db.prepare('SELECT COUNT(*) n FROM bm_note_revisions WHERE note_id=?').bind(noteId).first()).n,0)
  assert.equal((await h.db.prepare('SELECT COUNT(*) n FROM bm_measures WHERE client_id=?').bind(patient.id).first()).n,0)
  const ledger=await h.db.prepare('SELECT (SELECT SUM(amount_cents) FROM bm_destroyed_invoices) invoiced,(SELECT SUM(amount_cents) FROM bm_destroyed_payments) paid').first()
  assert.equal(ledger.invoiced,9500)
  assert.equal(ledger.paid,9500)
  for(const id of [giftId,productId,packageId])assert.equal((await h.send('/api/balm/receipts/'+id+'.pdf',undefined,h.owner)).status,404)
  const retailFacts=await h.db.prepare('SELECT * FROM bm_destroyed_retail').all()
  assert.equal(retailFacts.results.length,3)
  assert.ok(!JSON.stringify(retailFacts.results).includes(patient.id))
  assert.ok(!JSON.stringify(retailFacts.results).includes('Private'))
  assert.equal((await h.db.prepare('SELECT COUNT(*) n FROM bm_package_uses WHERE client_id=?').bind(patient.id).first()).n,0)

  const receipt=(await h.state()).retention.destructions.find(r=>r.id===destroyed.receiptId)
  assert.ok(receipt)
  assert.ok(!JSON.stringify(receipt).includes(patient.id)&&!JSON.stringify(receipt).includes('Sensitive historical'))
  await assert.rejects(h.db.prepare('DELETE FROM bm_destructions WHERE id=?').bind(receipt.id).run(),/destruction_receipt_fixed/)
  await assert.rejects(h.db.prepare('DELETE FROM bm_audit WHERE client_id=?').bind(patient.id).run(),/audit_append_only/)
  await h.cmd('retention.destroy',{...preview,confirm:true},h.owner,409)
  assert.equal((await h.db.prepare('SELECT COUNT(*) n FROM bm_retention_permits').first()).n,0)
}))

// New financial record kinds retain anonymous arithmetic when their chart is destroyed.
test('PAY-002 PAY-004 HIPAA-002: Stripe and external refunds retain totals without private originals',()=>{
 const stripe=fakeProviders();let loseRefund=true
 const outbound=async request=>{
  const response=await stripe.handler(request)
  if(loseRefund&&request.method==='POST'&&new URL(request.url).pathname==='/v1/refunds'){loseRefund=false;return Response.json({error:{message:'Refund response lost after acceptance'}},{status:503})}
  return response
 }
 return run(async h=>{
  const {service,practitioners:[priya]}=await clinic(h)
  const patient=await h.cmd('client.save',{firstName:'External',lastName:'Private',dateOfBirth:'1950-01-01'})
  const visit=await pastVisit(h,patient.id,priya,service.id)
  await ageVisit(h,visit)
  // Establish a historical unsigned chart before attending; no signed record is rewritten.
  const note=crypto.randomUUID()
  await h.db.prepare("INSERT INTO bm_notes(id,client_id,appointment_id,author_id,created_at,template) VALUES(?,?,?,?,?,'pt.daily')").bind(note,patient.id,visit,priya.id,'1990-01-02T02:00:00.000Z').run()
  await h.cmd('appointment.attend',{id:visit},priya.cookie)
  const invoice=await h.cmd('invoice.prepare',{appointmentId:visit});await h.cmd('invoice.approve',{id:invoice.id})
  const post=async(kind,amount,reference,extra={})=>{
    const e=await h.cmd('pay.entry.prepare',{clientId:patient.id,kind,amount,reference,reason:'Private financial reason',occurredOn:'2001-01-02',...extra})
    await h.cmd('pay.entry.approve',{id:e.id,sha256:e.sha256,attest:true});return e
  }
  await post('write_off','5.00','Private-writeoff',{invoiceId:invoice.id})
  await h.cmd('pay.stripe.connect',{secretKey:'synthetic-balm-1'})
  const link=await h.cmd('pay.link.create',{clientId:patient.id,purpose:'card',delivery:'shown'})
  const path=new URL(link.url).pathname,started=await h.form(path+'?do=card',{consent:'on'})
  assert.equal(started.status,303)
  const session=stripe.complete(started.location.split('/').at(-1));await h.send(path+'?setup='+session.id)
  const cardPayment=await h.cmd('pay.invoice.charge',{invoiceId:invoice.id})
  const cardRefund=await h.cmd('pay.refund.prepare',{paymentId:cardPayment.id,amount:'30.00',reason:'Synthetic historical overcollection'})
  const uncertain=await h.cmd('pay.refund.approve',{id:cardRefund.id,sha256:cardRefund.sha256,attest:true})
  assert.equal(uncertain.status,'uncertain')
  await h.cmd('retention.save',policy)
  assert.ok((await file(h,patient.id)).retention.reasons.includes('stripe_refund_outcome_pending'))
  await h.cmd('retention.preview',{clientId:patient.id},h.owner,409)
  const confirmed=await h.cmd('pay.refund.reconcile',{id:cardRefund.id})
  assert.equal(confirmed.status,'confirmed')
  const credit=await post('credit','100.00','Private-receipt')
  await post('refund','4.00','Private-refund',{creditId:credit.id})
  const clock=Date.now()+10*3600000,day=offset=>new Date(clock+offset*86400000).toISOString().slice(0,10),range=`from=${day(-1)}&to=${day(1)}`
  const before=(await h.send('/api/balm/reports/financial?'+range,undefined,h.owner)).value
  assert.equal(before.deposits.total.refundedCents,3400)
  await h.cmd('retention.save',policy)
  const preview=await h.cmd('retention.preview',{clientId:patient.id})
  assert.equal(preview.records.bm_account_entries,3);assert.equal(preview.records.bm_account_postings,3)
  assert.equal(preview.records.bm_card_refunds,1);assert.equal(preview.records.bm_card_refund_allocations,1)
  await h.cmd('retention.destroy',{previewId:preview.previewId,digest:preview.digest,confirm:true})
  const after=(await h.send('/api/balm/reports/financial?'+range,undefined,h.owner)).value
  assert.deepEqual(after.summary,before.summary)
  assert.deepEqual(after.deposits.total,before.deposits.total)
  assert.deepEqual(after.agingByPatient.total,before.agingByPatient.total)
  assert.ok(!JSON.stringify(after).includes('Private-receipt')&&!JSON.stringify(after).includes('Private-refund'))
  assert.equal((await h.send('/api/balm/receipts/'+credit.id+'.pdf',undefined,h.owner)).status,404)
},{outbound})
})
