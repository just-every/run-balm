import { hostingProfile, hostingFixture, patientMode } from './readiness-fixture.mjs'
import { cutoverInventory, archivedInvoiceInventory, cutoverClaims, cutoverAuthorizations } from './movein-reconciliation-journey.mjs'
import {portalLogin} from './portal-billing.mjs'
import { chartFixture } from './chart-template-journey.mjs'
import { createHmac, randomBytes } from 'node:crypto'
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { cp, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { getPlatformProxy } from 'wrangler'
import { harness } from './harness.mjs'
import { mriUpload, mriReport } from './chart-document-fixtures.mjs'
import { modelEdge } from './defensibility-clinic.mjs'
import { clinic, pastVisit, slots, bookOnline } from './clinic.mjs'
import { fakeProviders } from './fakes/stripe.mjs'
import { checkInResponsibilityJourney } from './card-payments-journey.mjs'
import { fakeBucket } from './fakes/s3.mjs'
import { generateBackupKeys } from '../src/balm/backup/envelope.mjs'
// Match the local lifecycle: archive fixtures never need external Request.cf metadata.
process.env.CLOUDFLARE_CF_FETCH_ENABLED = 'false'
const exec = promisify(execFile)
const cli = resolve('node_modules/@runeditrun/rer/global/rer.mjs')
const command = async (cwd, args, expected = 0) => {
  let result
  const started = Date.now()
  console.log(`archive ${args[0]} started`)
  // These commands own a separate checkout, not the parent verify operation.
  const env = { ...process.env, CI: 'true', WRANGLER_SEND_METRICS: 'false' }
  delete env.RER_LOCAL_OPERATION
  delete env.RER_LOCAL_STATE_PATH
  // Under rer verify the child inherits the caller's queue membership; standalone it is its own CI caller.
  if (env.RER_JOB_POLICY) args = args.filter(arg => arg !== '--no-queue')
  try { result = { ...await exec(process.execPath, [cli, ...args], { cwd, env, maxBuffer: 2e6 }), code: 0 } }
  catch (error) { result = error }
  console.log(`archive ${args[0]} finished in ${Date.now()-started}ms`)
  assert.equal(result.code, expected, `${args[0]}: ${result.stdout ?? ''} ${result.stderr ?? ''}`)
}
async function checkout(root) {
  await mkdir(root)
  for (const name of ['package.json','pnpm-lock.yaml','OPERATIONS.json','RUN-LOCALLY.md','ACCEPTANCE.md','SEED-COMMAND-CONTRACT.md','OPERATIONS.md','.node-version','wrangler.jsonc','deploy.json','rer-setup.json','scripts','src','migrations']) await cp(name, join(root,name), { recursive: true })
  await symlink(resolve('node_modules'), join(root,'node_modules'), 'dir')
}
async function historicalErasurePatient(h,priya,service) {
  const patient=await h.cmd('client.save',{firstName:'Retained',lastName:'Historical',dateOfBirth:'1950-01-01'})
  const visit=await pastVisit(h,patient.id,priya,service.id,h.owner,12)
  await h.db.prepare('UPDATE bm_appointments SET start_at=?,end_at=? WHERE id=?').bind('1990-01-02T02:00:00.000Z','1990-01-02T02:45:00.000Z',visit).run()
  await h.db.prepare("INSERT INTO bm_calls(id,client_id,direction,occurred_at,staff_id,staff_name,recorded_by,recorded_at,disposition,route,practitioner_id) VALUES(?,?,'incoming','1990-01-02T03:00:00Z',?,'Historical Clinician',?,'1990-01-02T03:00:00Z','Historical archived call','practitioner',?)").bind(crypto.randomUUID(),patient.id,priya.id,priya.email,priya.id).run()
  return patient
}
async function archiveFixture({ signedTie = false, erasureOnly = false } = {}){
  const temporary = await mkdtemp(join(tmpdir(),'balm-archive-')), source=join(temporary,'source'), restored=join(temporary,'restored'), erased=join(temporary,'erased'), refused=join(temporary,'refused')
  let h
  try {
    for (const path of (erasureOnly ? [source,erased,refused] : [source,restored,erased,refused])) await checkout(path)
    // Apply fixture SQL and its ledger in the existing Worker; public transfers below still use the CLI.
    const webhookKey='whsec_'+Buffer.from('synthetic-balm-1').toString('base64')
    h=await harness({root:source,migrate:true,outbound:modelEdge().outbound,auth:{BALM_RESEND_WEBHOOK_KEY:webhookKey,BALM_RESEND_EVENT_NAMESPACE:'archive-clinic-account'}})
    const p=await h.cmd('client.save',{firstName:'Temporary',lastName:'Enquiry',dateOfBirth:'2000-01-01'})
    const {service,practitioners:[priya]}=await clinic(h)
    if (erasureOnly) {
      const retentionPatient=await historicalErasurePatient(h,priya,service)
      const identity={auth:h.auth,owner:h.owner}
      await h.close();h=null
      return {temporary,source,erased,refused,p,retentionPatient,identity}
    }
    await h.cmd('insurance.settings.save',{billingNpi:'1234567893',taxId:'123456789',address:'100 Main St',city:'Austin',state:'TX',postalCode:'78701',senderId:'BALMTEST',contactName:'Jordan Clinic',contactPhone:'5125550100'})
    const payer=await h.cmd('insurance.payer.save',{name:'Archive Health',payerId:'ARCHIVE',receiverId:'ARCHIVE',unitMethod:'fixed',fixedUnitMinutes:15})
    await h.cmd('insurance.schedule.save',{payerId:payer.id,planName:'synthetic-balm-113',effectiveOn:'2090-01-01',kind:'contracted',unitMethod:'ama',fees:[{code:'97110',cents:3000}],source:'synthetic-balm-114 future contract'})
    await h.cmd('insurance.license.save',{practitionerId:priya.id,state:'TX',number:'synthetic-balm-115',startsOn:'2020-01-01',endsOn:'2030-12-31',source:'synthetic-balm-116 board certificate'})
    const card='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl6V1sAAAAASUVORK5CYII='
    const insurance={insurancePayerId:payer.id,insuranceMemberId:'ARCHIVE-MEMBER',insuranceRelationship:'self',insurancePatientSex:'F',insuranceStartsOn:'2026-01-01',insuranceAddress:'200 Oak St',insuranceCity:'Austin',insuranceState:'TX',insurancePostalCode:'78701',insuranceFront:card,insuranceBack:card,identityPhoto:card}
    const booked=await bookOnline(h,service.id,priya.id,(await slots(h,service.id,priya.id))[0])
    const mail=h.mail.at(-1),messageId='mail_test_'+h.mail.length,eventId='archive-booking-delivered',timestamp=String(Math.floor(Date.now()/1000))
    const event=JSON.stringify({type:'email.delivered',created_at:new Date().toISOString(),data:{email_id:messageId,to:mail.to}})
    const signature=createHmac('sha256',Buffer.from(webhookKey.slice(6),'base64')).update(`${eventId}.${timestamp}.${event}`).digest('base64')
    const delivery=await h.mf.dispatchFetch(h.origin+'/api/balm/mail/events/resend',{method:'POST',body:event,headers:{'svix-id':eventId,'svix-timestamp':timestamp,'svix-signature':'v1,'+signature}})
    assert.equal(delivery.status,200)
    const token=booked.location.match(/\/intake\/([\w-]+)/)[1]
    const intakePage=await h.send('/intake/'+token)
    assert.equal((await h.form('/intake/'+token,{formId:'intake-v1',q_reason:'Restored ankle sprain',q_emergency:'Kim 0400',q_consent:'yes',consentVersion:intakePage.text.match(/name="consentVersion" value="([^"]+)"/)[1],consentAccepted:'on',signerName:'Maya Lee',signerRelationship:'patient',signatureTyped:'Maya Lee',...insurance})).status,303)
    const maya=(await h.state()).clients.find(c=>c.first_name==='Maya')
    const retail=await h.cmd('pay.retail.sell',{clientId:maya.id,confirm:true,kind:'gift_card',label:'Archive gift value',amountCents:2500,reference:'synthetic-balm-archive-gift'})
    const retailOriginal=(await h.send(retail.receiptUrl,undefined,h.owner)).text
    await h.cmd('finance.observation.record',{clientId:maya.id,kind:'eft',amountCents:2500,occurredOn:'2026-09-01',reference:'synthetic-balm-archive-eft',sourceReference:'synthetic-balm-archive-trace',evidence:'Owner reviewed synthetic EFT original'})
    await h.cmd('finance.reconcile.prepare',{month:'2026-09'})
    const runoutCsv=`Source claim,Patient ID,Payer ID,Patient control,Payer control,Service date,Billed,Balance,Status\nsynthetic-balm-221,${maya.id},${payer.id},synthetic-balm-222,synthetic-balm-223,2026-01-01,10.00,10.00,open\n`
    const runoutInput={source:'synthetic-balm-220',csv:runoutCsv},runoutPreview=await h.cmd('insurance.runout.preview',runoutInput)
    await h.cmd('insurance.runout.apply',{...runoutInput,fingerprint:runoutPreview.fingerprint,expectedBalanceCents:1000})
    await h.cmd('insurance.remittance.import',{payerId:payer.id,x12:'ST*835*0001*005010X221A1~BPR*I*5*C*CHK************20261023~TRN*1*synthetic-balm-224*1234567890~N1*PR*ARCHIVE*XV*ARCHIVE~CLP*synthetic-balm-222*1*10*5*0*CI*synthetic-balm-223~CAS*CO*45*5~SE*7*0001~'})

    const visit=await pastVisit(h,maya.id,priya,service.id,h.owner,2,{coverageChoice:'self_pay',deliveryMethod:'portal'})
    await h.cmd('appointment.attend',{id:visit})
    await h.cmd('call.log',{clientId:maya.id,recipient:priya.id,direction:'incoming',occurredAt:'2000-01-02T00:30:00Z',disposition:'Archived call disposition'},priya.cookie)
    const archivedCalls=(await h.send('/api/balm/clients/'+maya.id+'/communications?communicationChannel=call',undefined,h.owner)).value
    const checkedNote=await h.cmd('note.write',{clientId:maya.id,appointmentId:visit,body:'Restored treatment note'},priya.cookie)
    await h.cmd('scribe.save',{provider:'anthropic',key:'synthetic-balm-3'})
    const noteCheck=await h.cmd('note.check',{id:checkedNote.id,revision:1},priya.cookie)
    const invoice=await h.cmd('invoice.prepare',{appointmentId:visit})
    await h.cmd('invoice.approve',{id:invoice.id})
    const beforePayment=(await h.send('/api/balm/clients/'+maya.id,undefined,h.owner)).value.billing.ledger
    assert.equal(beforePayment.insurancePendingCents,0,'the archived cash visit was explicitly booked as self-pay')
    assert.equal(beforePayment.patientBalanceCents,9500)
    await h.cmd('payment.record',{invoiceId:invoice.id,amountCents:9500,reference:'Backup-EFTPOS-1'})
    const external=await h.cmd('pay.entry.prepare',{clientId:maya.id,kind:'credit',amount:'30.00',reason:'Archived external prepayment',reference:'Archive-external-30',occurredOn:'2001-01-02'})
    await h.cmd('pay.entry.approve',{id:external.id,sha256:external.sha256,attest:true})
    const externalReceipt=(await h.send('/api/balm/receipts/'+external.id+'.pdf',undefined,h.owner)).text
    const csv=await readFile('tests/fixtures/cliniko-patients.csv','utf8'),preview=await h.cmd('import.preview',{csv})
    await h.cmd('import.apply',{csv,fingerprint:preview.fingerprint})
    const inventoryInput=archivedInvoiceInventory()
    const inventoryPreview=await h.cmd('movein.prepare',inventoryInput)
    const moveinInventory=await h.cmd('movein.cutover',{...inventoryInput,fingerprint:inventoryPreview.fingerprint,mappingApproval:inventoryPreview.mappingDigest,cutoverApproval:inventoryPreview.fingerprint,acceptanceReason:'Archive the source inventories and explicit omissions; no invoice, authorization or claim is carried by this inventory.'})
    await h.cmd('disclosure.record',{clientId:maya.id,recipient:'Attorney Archive, records@example.test',purpose:'Patient-directed release',basis:'Written authorization',records:'Signed treatment note and intake',releasedAt:'2001-01-02T12:00:00Z'})
    await h.cmd('client.alert.save',{clientId:maya.id,kind:'precaution',text:'Archive weight-bearing restriction'})
    await h.cmd('holiday.save',{date:'2099-11-26',name:'Thanksgiving clinic closure'})
    const chartDocument=await h.cmd('chart.document.upload',mriUpload(maya.id,'2026-10-01'))
    const injuryPatient=await h.cmd('client.save',{firstName:'Synthetic',lastName:'Carrier archive',dateOfBirth:'1980-01-01'})
    const injuryPolicy=await h.cmd('insurance.policy.save',{clientId:injuryPatient.id,payerId:payer.id,memberId:'synthetic-balm-260',relationship:'18',patientSex:'F',address:'100 Synthetic St',city:'Austin',state:'TX',postalCode:'78701',startsOn:'2026-01-01'})
    await h.cmd('insurance.injury.save',{policyId:injuryPolicy.id,kind:'workers_comp',claimNumber:'synthetic-balm-261',adjuster:'Synthetic Adjuster',adjusterEmail:'adjuster@example.test',employerAttorney:'Synthetic Employer',billingRequirements:'Carrier claim number',authorizationRequirements:'Carrier authorization',reportRequirements:'Progress report',source:'synthetic-balm-262 original carrier instructions'})

    await h.cmd('agent.create',{label:'Excluded secret'})
    const feed=await h.cmd('calendar.feed.create',{},priya.cookie)
    const feedToken=feed.calendarFeedPath.split('/')[2].split('.')[0]
    const retentionPatient=await historicalErasurePatient(h,priya,service)
    const patientCookie=await portalLogin(h,'maya@client.example')
    await h.form('/portal/action',{name:'record.request'},patientCookie)
    const recordRequest=(await h.state()).recordRequests.find(r=>r.client_id===maya.id)
    const recordPackage=await h.cmd('record.prepare',{id:recordRequest.id})
    await h.cmd('record.release',{id:recordRequest.id,packageId:recordPackage.packageId,sha256:recordPackage.sha256,confirm:true})
    const recordOriginal=(await h.send('/portal/records/'+recordRequest.id+'.json',undefined,patientCookie)).text
    await h.cmd('exercise.program.assign',{clientId:maya.id,noteId:checkedNote.id,exerciseIds:['balm-cc0-001','balm-cc0-004']},priya.cookie)
    await h.form('/portal/action',{name:'profile.insurance',payer:'Archive proposed payer',memberId:'ARCHIVE-PROFILE',subscriber:'Maya Lee',relationship:'self',confirm:'on'},patientCookie)
    const guardianChild=await h.cmd('client.save',{firstName:'Archive',lastName:'Minor',dateOfBirth:'2014-01-01'})
    await h.cmd('guardian.grant',{clientId:guardianChild.id,email:'archive-parent@family.example',name:'Archive Parent',relationship:'parent',verification:'Synthetic verified guardian authority and confidentiality review.',verified:true})
    const libraryCsv='title,title_es,instructions,instructions_es,discipline,region,position,equipment,sets,reps,hold_seconds,frequency,media\nArchive practice exercise,Ejercicio de archivo,Move as directed.,Muévase según la indicación.,ot,hand,seated,none,1,5,0,Daily,archive.png'
    await h.cmd('exercise.library.import',{csv:libraryCsv,media:{'archive.png':card},rights:true},priya.cookie)
    const tie = signedTie ? await prepareSignedTie(h) : null
    const excludedHook=await h.cmd('integration.hook.create',{url:'https://archive.synthetic-balm.com/events',consent:true})
    const identity={auth:h.auth,owner:h.owner}
    await h.close();h=null
    return {archivedCalls,moveinInventory,retail,retailOriginal,temporary,source,restored,erased,refused,p,service,priya,maya,checkedNote,noteCheck,external,externalReceipt,chartDocument,feedToken,retentionPatient,recordRequest,recordPackage,recordOriginal,identity,tie}
  }catch(error){if(h)await h.close();await rm(temporary,{recursive:true,force:true,maxRetries:3,retryDelay:100});throw error}
}
const archiveRows=text=>text.split('\n').filter(Boolean).map(JSON.parse).filter(r=>r.kind==='part')
test('CHART-006 INS-001 AGENT-003 PAY-004 COMM-001 SCHED-003 SCHED-009 HIPAA-003 CHART-010 CHART-009: public CLI archive round trip refuses damaged or populated stores', {timeout:600_000},async()=>{
  const {archivedCalls,moveinInventory,retail,retailOriginal,temporary,source,restored,erased,refused,p,service,priya,maya,checkedNote,noteCheck,external,externalReceipt,chartDocument,feedToken,retentionPatient,recordRequest,recordPackage,recordOriginal,identity,tie}=await archiveFixture({ signedTie: true })
  try{
    const old=join(temporary,'before.rer'),again=join(temporary,'again.rer')
    await command(source,['export','--output',old,'--no-queue'])
    const bytes=await readFile(old,'utf8');for(const kept of ['Thanksgiving clinic closure','Temporary','Restored ankle sprain','Restored treatment note','Backup-EFTPOS-1','patients.csv','appointment.booked','client.imported','Attorney Archive','disclosure.recorded','Archive weight-bearing restriction','knee-MRI-report.pdf','chart.document_uploaded',mriReport().toString('base64')])assert.ok(bytes.includes(kept),kept);assert.ok(!bytes.includes('Excluded secret'));assert.ok(!bytes.includes('https://archive.synthetic-balm.com/events'));assert.ok(!bytes.includes(feedToken));assert.ok(!bytes.includes('"token_hash"'))
    const rows=archiveRows
    assert.ok(rows(bytes).length>0)
    const corrupt=join(temporary,'corrupt.rer');await writeFile(corrupt,bytes.replace('Restored treatment note','Changed treatment note'),{mode:0o600})
    // Each pair owns independent stores. Keep all CLI cases with at most two children.
    // Checksum damage is a transfer failure (1); restore policy conflicts remain 4.
    const refusals = (async()=>{
      await command(erased,['import','--input',corrupt,'--yes','--no-queue'],1)
      await command(source,['import','--input',old,'--yes','--no-queue'],4)
    })()
    // The source refusal is independent of the restored export. Join both
    // before checking either store, retaining at most two CLI children.
    await command(restored,['import','--input',old,'--yes','--no-queue'])
    await Promise.all([command(restored,['export','--output',again,'--no-queue']), refusals])
    assert.deepEqual(archiveRows(await readFile(again,'utf8')),archiveRows(bytes))
    const restoredClinic=await harness({root:restored,...identity})
    try {
      await assertSignedTie(restoredClinic, tie)
      const retailCookie=await restoredClinic.signIn(restoredClinic.auth.OWNER_EMAIL)
      assert.equal((await restoredClinic.send(retail.receiptUrl,undefined,retailCookie)).text,retailOriginal)
      const finance=await restoredClinic.cmd('finance.reconcile.prepare',{month:'2026-09'},retailCookie)
      assert.equal(finance.findings.length,1);assert.equal(finance.findings[0].kind,'missing_era')
      const cookie=await restoredClinic.signIn(restoredClinic.auth.OWNER_EMAIL)
      const inventoryJournal=await restoredClinic.cmd('movein.journal',{jobId:moveinInventory.job.id},cookie)
      assert.deepEqual(inventoryJournal.job.report,moveinInventory.job.report,'reviewed inventory counts, omissions, identifiers and references survive CLI restore')
      const restoredInvoices=(await restoredClinic.send('/api/balm/clients/'+moveinInventory.records.find(r=>r.kind==='patient').target_id,undefined,cookie)).value.imported.invoices
      assert.deepEqual(restoredInvoices.map(i=>[i.reference,i.issued_on,i.billed_cents,i.balance_cents]),[['Archived historical invoice','2000-01-15',10000,8000]],'historical invoice source facts survive CLI restore without issuing new bills')
      const restoredSource=await restoredClinic.db.prepare('SELECT source_json FROM bm_movein_jobs WHERE id=?').bind(moveinInventory.job.id).first()
      assert.deepEqual(JSON.parse(restoredSource.source_json).bundle.files,archivedInvoiceInventory().files,'original inventory bytes survive CLI restore')
      assert.equal((await restoredClinic.send('/api/balm/records/'+recordPackage.packageId+'.json',undefined,cookie)).text,recordOriginal,'reviewed FHIR original survives CLI restore byte-for-byte')
      assert.ok((await restoredClinic.state(cookie)).recordRequests.some(r=>r.id===recordRequest.id&&r.released_at))
      assert.equal((await restoredClinic.state(cookie)).integrations.hooks.length,0,'hook credentials and consent are not transplanted into a restored installation')
      const restoredLibrary=await restoredClinic.send('/api/balm/exercises?q=Archive%20practice',undefined,cookie)
      assert.equal(restoredLibrary.value.total,1,'practice library originals travel in CLI archives')
      const chartBeforeEdit=(await restoredClinic.send('/api/balm/clients/'+maya.id,undefined,cookie)).value
      assert.ok(chartBeforeEdit.homeExercises.some(e=>e.libraryId==='balm-cc0-004'&&e.sourceNoteId===checkedNote.id&&e.license==='CC0-1.0'))
      assert.ok(chartBeforeEdit.portalProfileChanges.some(r=>r.payload.memberId==='ARCHIVE-PROFILE'))
      assert.ok((await restoredClinic.db.prepare('SELECT id FROM bm_guardian_grants WHERE email=?').bind('archive-parent@family.example').all()).results.length)
      const checkedFile=await restoredClinic.send('/api/balm/clients/'+maya.id,undefined,cookie)
      assert.deepEqual(checkedFile.value.notes.find(n=>n.id===checkedNote.id).defensibility,noteCheck,'AGENT-003 preserves original questions, sources and revision through CLI archive restore')
      const setupState=(await restoredClinic.send('/api/balm/state',undefined,cookie)).value
      assert.equal(setupState.insurance.schedules[0].source,'synthetic-balm-114 future contract')
      assert.equal(setupState.insurance.licenses[0].number,'synthetic-balm-115')
      assert.equal(setupState.insurance.injuryCases[0].claim_number,'synthetic-balm-261')
      assert.equal(setupState.insurance.injuryCases[0].source,'synthetic-balm-262 original carrier instructions')
      const runout=await restoredClinic.cmd('insurance.runout.read',{},cookie)
      assert.equal(runout.claims[0].source_claim,'synthetic-balm-221')
      assert.equal(runout.totals.importedCents,1000);assert.equal(runout.totals.remainingCents,0)
      assert.equal(runout.posted.paidCents,500);assert.equal(runout.deposits[0].depositCents,500)
      const clinicianCookie=await restoredClinic.signIn('priya@clinic.example')
      await restoredClinic.cmd('note.amend',{id:checkedNote.id,revision:1,body:'Synthetic treatment after restore.',charges:[{code:'97110',minutes:30},{code:'97140',minutes:8}]},clinicianCookie)
      const restoredPreview=(await restoredClinic.send('/api/balm/clients/'+maya.id,undefined,clinicianCookie)).value.notes.find(n=>n.id===checkedNote.id).billing
      assert.deepEqual(restoredPreview.lines.map(l=>l.units),[2,0],'CHART-006 / INS-001 restored payer threshold controls newly saved clinical minutes')
      assert.equal(restoredPreview.fixedUnitMinutes,15)
      const setup=await restoredClinic.form('/setup',{confirm:'yes'},cookie)
      assert.equal(setup.status,303);assert.equal(setup.location,'/app')
      const restoredEntry=(await restoredClinic.send('/api/balm/clients/'+maya.id,undefined,cookie)).value.billing.account.entries.find(e=>e.id===external.id)
      assert.equal(restoredEntry.sha256,external.sha256,'PAY-004 exact approved proposal survives CLI archive')
      assert.ok(restoredEntry.approved_by)
      assert.equal((await restoredClinic.send('/api/balm/receipts/'+external.id+'.pdf',undefined,cookie)).text,externalReceipt,'PAY-004 original external receipt survives CLI archive')
      assert.deepEqual((await restoredClinic.send('/api/balm/clients/'+maya.id+'/communications?communicationChannel=call',undefined,cookie)).value,archivedCalls,'COMM-003 exact call facts and searchable history survive CLI archive restore')
      await assert.rejects(restoredClinic.db.prepare('DELETE FROM bm_calls WHERE client_id=?').bind(maya.id).run(),/calls_are_health_records/)
      const restoredMail=(await restoredClinic.send('/api/balm/clients/'+maya.id,undefined,cookie)).value.mailHistory
      assert.ok(restoredMail.some(m=>m.kind==='intake'&&m.state==='delivered'),'COMM-001 verified delivery survives the public CLI archive round trip')
      const restoredState=await restoredClinic.state(cookie)
      assert.equal(JSON.parse(restoredState.settings.holidays)[0].name,'Thanksgiving clinic closure')
      await restoredClinic.cmd('appointment.book',{clientId:maya.id,practitionerId:priya.id,serviceId:service.id,date:'2099-11-26',time:'10:00'},cookie,409)
      const search=await restoredClinic.send('/api/balm/clients/'+maya.id+'/history?historyText=MRI&historyType=imaging',undefined,cookie)
      assert.deepEqual(search.value.entries.map(r=>r.id),[chartDocument.id])
      for(const [kind,count] of [['consent',1],['identity',1],['insurance_card',2]]) {
        const found=await restoredClinic.send('/api/balm/clients/'+maya.id+'/history?historyType='+kind,undefined,cookie)
        assert.equal(found.status,200,found.text);assert.equal(found.value.total,count)
        for(const record of found.value.entries)assert.equal((await restoredClinic.send(record.url,undefined,cookie)).status,200)
      }
      const original=await restoredClinic.mf.dispatchFetch(restoredClinic.origin+search.value.entries[0].url,{headers:{cookie}})
      assert.deepEqual(Buffer.from(await original.arrayBuffer()),mriReport())
    }finally{await restoredClinic.close()}
  }finally{await rm(temporary,{recursive:true,force:true,maxRetries:3,retryDelay:100})}
})

test('HIPAA-002 ERASE-001: public CLI erasure journals refuse both ordinary erasure and later destruction resurrection', {timeout:600_000},async()=>{
  const {temporary,source,erased,refused,p,retentionPatient,identity}=await archiveFixture({erasureOnly:true})
  let h
  try{
    const old=join(temporary,'before.rer'),beforeDestruction=join(temporary,'before-destruction.rer'),later=join(temporary,'later.rer')
    h=await harness({root:source,...identity})
    await h.cmd('hosting.mode',patientMode('demo'))
    const historicalSale=crypto.randomUUID()
    const historicalVisit=await h.db.prepare('SELECT id,service_id FROM bm_appointments WHERE client_id=?').bind(retentionPatient.id).first()
    await h.db.prepare("INSERT INTO bm_retail_sales(id,client_id,kind,label,service_id,units,amount_cents,tax_cents,tax_basis_points,tax_state,tax_evidence,reference,recorded_at,recorded_by,receipt_base64) VALUES(?,?,'membership','Synthetic resolved historical membership',?,2,2000,0,0,'','','synthetic-balm-stale-member','1990-01-02T03:00:00.000Z',?,?)").bind(historicalSale,retentionPatient.id,historicalVisit.service_id,h.auth.OWNER_EMAIL,btoa('%PDF-1.4 Synthetic historical receipt')).run()
    await h.db.prepare('INSERT INTO bm_package_uses VALUES(?,?,?,?)').bind(historicalVisit.id,historicalSale,retentionPatient.id,'1990-01-02T04:00:00.000Z').run()
    await h.db.prepare("INSERT INTO bm_membership_cancellations(sale_id,client_id,effective_at,authorized_at,authorization_method,consent_evidence,reason,recorded_by,recorded_at,visits_left) VALUES(?,?,'1990-01-02T05:00:00.000Z','1990-01-02T04:00:00.000Z','Specific request in person','Synthetic specific cancellation authorization','Synthetic exhausted cancellation',?,'1990-01-02T05:00:00.000Z',0)").bind(historicalSale,retentionPatient.id,h.auth.OWNER_EMAIL).run()
    const scopedPatient=await h.cmd('client.save',{firstName:'Synthetic',lastName:'Scoped retail archive',dateOfBirth:'1950-01-01'})
    const scopedVisit=crypto.randomUUID()
    const originalVisit=await h.db.prepare('SELECT * FROM bm_appointments WHERE id=?').bind(historicalVisit.id).first()
    await h.db.prepare("INSERT INTO bm_appointments(id,client_id,service_id,practitioner_id,start_at,end_at,status,booked_via,created_by,created_at,coverage_choice) VALUES(?,?,?,?, '1989-01-02T02:00:00.000Z','1989-01-02T02:45:00.000Z','cancelled','staff',?,'1989-01-02T02:00:00.000Z','self_pay')").bind(scopedVisit,scopedPatient.id,originalVisit.service_id,originalVisit.practitioner_id,h.auth.OWNER_EMAIL).run()
    await h.db.prepare("UPDATE bm_appointments SET status='attended' WHERE id=?").bind(scopedVisit).run()
    const scopedSale=crypto.randomUUID()
    await h.db.prepare("INSERT INTO bm_retail_sales(id,client_id,kind,label,units,amount_cents,tax_cents,tax_basis_points,tax_state,tax_evidence,reference,recorded_at,recorded_by,receipt_base64) VALUES(?,?,'product','synthetic-balm-expired-private-receipt',0,1200,0,0,'TX','synthetic-balm-tax-evidence','synthetic-balm-retired-archive-sale','1990-01-02T03:00:00.000Z',?,?)").bind(scopedSale,scopedPatient.id,h.auth.OWNER_EMAIL,btoa('%PDF-1.4 synthetic-balm-expired-private-receipt')).run()
    const retainedGift=await h.cmd('pay.retail.sell',{clientId:scopedPatient.id,kind:'gift_card',label:'synthetic-balm-unresolved-gift',amountCents:700,reference:'synthetic-balm-scoped-archive-gift',confirm:true})
    await h.db.prepare("INSERT INTO bm_membership_settlements(sale_id,client_id,units,amount_cents,reference,evidence,recorded_at,recorded_by) VALUES(?,?,1,1000,'synthetic-balm-stale-settlement','synthetic-balm-private-settlement','1990-01-02T05:00:00.000Z',?)").bind(historicalSale,retentionPatient.id,h.auth.OWNER_EMAIL).run()
    await h.close();h=null
    await command(source,['export','--output',old,'--no-queue'])
        h=await harness({root:source,...identity});await h.cmd('client.erase',{id:p.id},await h.signIn(h.auth.OWNER_EMAIL));await h.close();h=null
        await command(source,['export','--output',beforeDestruction,'--no-queue'])
        h=await harness({root:source,...identity})
        const ownerCookie=await h.signIn(h.auth.OWNER_EMAIL)
        await h.cmd('hosting.mode',patientMode('demo'),ownerCookie)
        await h.cmd('client.erase',{id:retentionPatient.id},ownerCookie,409)
        await h.cmd('retention.save',{state:'AZ'},ownerCookie)
        const scopedPreview=await h.cmd('retention.retail.preview',{clientId:scopedPatient.id},ownerCookie)
        assert.deepEqual(scopedPreview.saleIds,[scopedSale])
        await h.cmd('retention.retail.destroy',{...scopedPreview,confirm:true},ownerCookie)
        const scopedFile=(await h.send('/api/balm/clients/'+scopedPatient.id,undefined,ownerCookie)).value
        assert.equal(scopedFile.client.first_name,'Synthetic')
        assert.deepEqual(scopedFile.billing.retail.map(x=>x.id),[retainedGift.id])
        await h.cmd('pay.retail.sell',{clientId:scopedPatient.id,kind:'product',label:'synthetic-balm-replayed-private-receipt',amountCents:1200,taxBasisPoints:0,taxState:'TX',taxEvidence:'synthetic-balm-tax-evidence',reference:'synthetic-balm-retired-archive-sale',confirm:true},ownerCookie,409)
        const destruction=await h.cmd('retention.preview',{clientId:retentionPatient.id},ownerCookie)
        await h.cmd('retention.destroy',{previewId:destruction.previewId,digest:destruction.digest,confirm:true},ownerCookie)
        for(const table of ['bm_retail_sales','bm_package_uses','bm_membership_cancellations','bm_membership_settlements','bm_calls'])assert.equal((await h.db.prepare('SELECT COUNT(*) n FROM '+table+' WHERE client_id=?').bind(retentionPatient.id).first()).n,0)
        assert.equal((await h.db.prepare('SELECT SUM(amount_cents) n FROM bm_destroyed_retail').first()).n,3200)
        await h.cmd('client.save',{firstName:'Retained',lastName:'Historical',dateOfBirth:'1950-01-01'},ownerCookie,409)
        await h.close();h=null
        await command(source,['export','--output',later,'--no-queue'])
    await Promise.all([
      command(refused,['import','--input',old,'--journal',later,'--yes','--no-queue'],4),
      command(erased,['import','--input',later,'--yes','--no-queue']),
    ])
    // This archive was made after ordinary erasure, so only HIPAA-002's later
    // destruction can cause this refusal; the empty store remains unchanged.
    await command(refused,['import','--input',beforeDestruction,'--journal',later,'--yes','--no-queue'],4)
    const proxy=await getPlatformProxy({configPath:join(erased,'wrangler.jsonc'),persist:{path:join(erased,'.wrangler/state/v3')},remoteBindings:false})
    try { assert.equal((await proxy.env.DB.prepare('SELECT first_name FROM bm_clients WHERE id=?').bind(p.id).first()).first_name,'Erased');assert.equal((await proxy.env.DB.prepare('SELECT COUNT(*) n FROM bm_clients WHERE id=?').bind(retentionPatient.id).first()).n,0,'HIPAA-002 destroyed patient cannot return in a later restored archive') }
    finally { await proxy.dispose() }
    const current=await getPlatformProxy({configPath:join(erased,'wrangler.jsonc'),persist:{path:join(erased,'.wrangler/state/v3')},remoteBindings:false})
    try {
      for(const table of ['bm_retail_sales','bm_package_uses','bm_membership_cancellations','bm_membership_settlements','bm_calls'])assert.equal((await current.env.DB.prepare('SELECT COUNT(*) n FROM '+table+' WHERE client_id=?').bind(retentionPatient.id).first()).n,0)
      assert.equal((await current.env.DB.prepare('SELECT SUM(amount_cents) n FROM bm_destroyed_retail').first()).n,3200)
      assert.equal(await current.env.DB.prepare('SELECT id FROM bm_retail_sales WHERE id=?').bind(scopedSale).first(),null)
      assert.equal((await current.env.DB.prepare('SELECT id FROM bm_clients WHERE id=?').bind(scopedPatient.id).first()).id,scopedPatient.id)
      assert.equal((await current.env.DB.prepare('SELECT id FROM bm_retail_sales WHERE id=?').bind(retainedGift.id).first()).id,retainedGift.id)
      assert.equal((await current.env.DB.prepare('SELECT COUNT(*) n FROM bm_retired_retail_references').first()).n,1)
    } finally {await current.dispose()}
    h=await harness({root:erased,...identity})
    const restoredOwner=await h.signIn(h.auth.OWNER_EMAIL)
    await h.cmd('pay.retail.sell',{clientId:scopedPatient.id,kind:'product',label:'synthetic-balm-replayed-private-receipt',amountCents:1200,taxBasisPoints:0,taxState:'TX',taxEvidence:'synthetic-balm-tax-evidence',reference:'synthetic-balm-retired-archive-sale',confirm:true},restoredOwner,409)
    assert.equal((await h.send('/api/balm/receipts/'+scopedSale+'.pdf',undefined,restoredOwner)).status,404)
    assert.equal((await h.send('/api/balm/receipts/'+retainedGift.id+'.pdf',undefined,restoredOwner)).status,200)
    await h.cmd('pay.retail.settle',{clientId:retentionPatient.id,saleId:historicalSale,confirm:true},restoredOwner,404)
    await h.cmd('pay.retail.membership',{clientId:retentionPatient.id,saleId:historicalSale,state:'active',confirm:true},restoredOwner,404)
  }finally{if(h)await h.close();await rm(temporary,{recursive:true,force:true,maxRetries:3,retryDelay:100})}
})

// Both archive cases use the same real export/import. Keep the signed-note,
// diagnosis allocation, locked-unit and original-invoice assertions together.
async function prepareSignedTie(h) {
  const {service,practitioners:[priya]}=await clinic(h, ['TieClinician'])
  const patient=await h.cmd('client.save',{firstName:'Synthetic',lastName:'Tie choice',dateOfBirth:'1980-01-01'})
  const visit=await pastVisit(h,patient.id,priya,service.id)
  await h.cmd('appointment.attend',{id:visit})
  await h.cmd('pay.codes.save',{appointmentId:visit,icd10:'M25.561, M54.50'})
  const note=await h.cmd('note.write',{clientId:patient.id,appointmentId:visit,body:'Synthetic clinician-selected manual therapy unit.',charges:[{code:'97110',minutes:8,diagnosisCodes:['M25.561']},{code:'97140',minutes:8,cmsTieChosen:true,diagnosisCodes:['M54.50']}]},priya.cookie)
  await h.cmd('note.sign',{id:note.id,revision:1,signature:'TieClinician',credentials:'PT',attest:true,supervisionGiven:'in_room'},priya.cookie)
  const invoice=await h.cmd('invoice.prepare',{appointmentId:visit})
  assert.deepEqual(invoice.snapshot.procedures.map(p=>p.units),[0,1])
  await h.cmd('invoice.approve',{id:invoice.id})
  const original=(await h.send('/api/balm/invoices/'+invoice.id+'.html',undefined,h.owner)).text
  return { patient, note, invoice, original }
}

async function assertSignedTie(h, { patient, note, invoice, original }) {
  const clinician=await h.signIn('tieclinician@clinic.example')
  const restoredNote=(await h.send('/api/balm/clients/'+patient.id,undefined,clinician)).value.notes.find(n=>n.id===note.id)
  assert.equal(restoredNote.status,'signed')
  assert.deepEqual(restoredNote.billing.lines.map(l=>l.units),[0,1])
  assert.deepEqual(restoredNote.billing.cmsTie.selected,['97140'])
  assert.deepEqual(restoredNote.revisions[0].charges.map(c=>c.diagnosisCodes),[['M25.561'],['M54.50']])
  const restoredInvoice=(await h.send('/api/balm/clients/'+patient.id,undefined,await h.signIn(h.auth.OWNER_EMAIL))).value.invoices.find(i=>i.id===invoice.id)
  assert.deepEqual(restoredInvoice.snapshot.procedures.map(p=>p.diagnosisCodes),[['M25.561'],['M54.50']])
  await h.cmd('note.amend',{id:note.id,revision:1,body:'Attempted changed allocation',charges:[{code:'97110',minutes:8,cmsTieChosen:true},{code:'97140',minutes:8}]},clinician,409)
  const owner=await h.signIn(h.auth.OWNER_EMAIL)
  assert.equal((await h.send('/api/balm/invoices/'+invoice.id+'.html',undefined,owner)).text,original)
}

test('HIPAA-004 automatic encrypted backups reach the owner\'s storage, show a recovery point, and the last one restores into a scratch deployment with a later change present', { timeout: 600_000 }, async () => {
  const temporary = await mkdtemp(join(tmpdir(), 'balm-backup-')), source = join(temporary, 'source'), scratch = join(temporary, 'scratch'), refused = join(temporary, 'refused')
  const bucket = fakeBucket({ locked: true }), keys = await generateBackupKeys(), other = await generateBackupKeys(), local = await bucket.serve()
  const storage = { endpoint: 'https://s3.balm-test.example', bucket: bucket.config.bucket, region: bucket.config.region, prefix: 'clinic', accessKeyId: bucket.config.accessKeyId, secretAccessKey: bucket.config.secretAccessKey, publicKey: keys.publicKey, intervalHours: 24, consent: 'on' }
  const began = Date.now(), mark = label => console.log(`backup ${label} at ${Date.now() - began}ms`)
  let h
  try {
    // Managed exposes the refusal through the same owner page and command door, without any storage write.
    const managed = await harness({ auth: { RER_INSTALLATION_ID: 'synthetic-balm-1', RER_MANAGEMENT_ORIGIN: 'https://managed.balm-test.example' }, outbound: bucket.fetchHandler })
    try {
      await clinic(managed, []); await managed.finishSetup()
      const panel = (await managed.send('/app/clinic', undefined, managed.owner)).text
      assert.match(panel, /Automatic backups are not available yet on RER Managed hosting/)
      assert.ok(!panel.includes('name=backup.save'))
      assert.equal((await managed.state()).backups.managed, true)
      await managed.cmd('backup.save', storage, managed.owner, 409)
      assert.equal((await managed.db.prepare('SELECT COUNT(*) AS n FROM bm_backup_settings').first()).n, 0)
      assert.equal(bucket.log.length, 0, 'Managed never contacts storage')
    } finally { await managed.close() }
    for (const path of [source, scratch, refused]) await checkout(path)
    await exec(process.execPath, [resolve('node_modules/wrangler/bin/wrangler.js'), 'd1', 'migrations', 'apply', 'foundation', '--local'], { cwd: source, env: { ...process.env, CI: 'true', WRANGLER_SEND_METRICS: 'false' }, maxBuffer: 16e6 })
    h = await harness({ root: source, outbound: bucket.fetchHandler })
    await clinic(h, []); await h.finishSetup()
    const tick = async at => (await h.mf.getWorker()).scheduled({ scheduledTime: at, cron: '* * * * *' })
    const reception = await h.staff('Riley', 'reception')
    // Only the owner, with the consent box ticked, a valid public key and working credentials, turns backups on.
    await h.cmd('backup.save', storage, reception.cookie, 403)
    await h.cmd('backup.save', { ...storage, consent: undefined }, h.owner, 400)
    await h.cmd('backup.save', { ...storage, publicKey: 'not a key' }, h.owner, 400)
    await h.cmd('backup.save', { ...storage, endpoint: 'http://s3.balm-test.example' }, h.owner, 400)
    assert.equal(bucket.objects.size, 0, 'nothing is written until the owner has saved valid settings')
    await h.cmd('backup.save', { ...storage, secretAccessKey: 'synthetic-balm-wrong' }, h.owner)
    assert.equal((await h.state()).backups.saved.check_ok, 0, 'wrong credentials are reported, not hidden')
    assert.equal((await h.send('/app/clinic', undefined, h.owner)).text.includes('synthetic-balm-secret'), false)
    const saved = await h.cmd('backup.save', storage, h.owner)
    assert.equal(saved.ok, true, saved.message)
    assert.equal(bucket.objects.size, 1)
    assert.match([...bucket.objects.keys()][0], /^clinic\/balm-connection-check-.*\.txt$/)
    const firstCheck = [...bucket.objects.keys()][0]
    assert.equal((await h.cmd('backup.save', { ...storage, secretAccessKey: '', publicKey: '', consent: undefined }, h.owner)).ok, true)
    assert.equal(bucket.objects.size, 2, 'a second save writes a new connection-check object even in a locked bucket')
    assert.ok(bucket.objects.has(firstCheck))
    const state = await h.state()
    const credentials = await h.db.prepare('SELECT secret_sealed FROM bm_backup_settings WHERE id=1').first()
    assert.match(credentials.secret_sealed, /^v1\.[^.]+\.[^.]+$/)
    assert.ok(!credentials.secret_sealed.includes(storage.secretAccessKey), 'the database holds sealed storage credentials')
    assert.equal(state.backups.saved.secret_hint, '…cret'); assert.ok(!JSON.stringify(state).includes('synthetic-balm-secret'), 'the storage secret is sealed and never sent back')
    assert.equal((await h.state(reception.cookie)).backups, null, 'staff other than the owner see no backup settings')
    // Before any backup the dashboard says one is pending.
    assert.ok(/data-recovery-point="waiting"/.test((await h.send('/app', undefined, h.owner)).text), 'before the first backup the dashboard says it is pending')
    mark('settings checked')
    // Change data, then the scheduler backs up by itself.
    await h.cmd('client.save', { firstName: 'Before', lastName: 'Backup', dateOfBirth: '1990-01-01' })
    const enquiry = await h.cmd('client.save', { firstName: 'Temporary', lastName: 'Enquiry', dateOfBirth: '2000-01-01' })
    const first = Date.now()
    await tick(first)
    const names = () => [...bucket.objects.keys()].filter(k => k.endsWith('.balmbk')).sort()
    assert.equal(names().length, 1, 'the first backup is written without anyone asking')
    const stored = Buffer.from(bucket.objects.get(names()[0]))
    assert.ok(stored.subarray(0, 8).toString() === 'BALMBK1\n' && !stored.includes('Backup') && !stored.includes('clinic_name') && !stored.includes('"kind":"manifest"'), 'the stored object is ciphertext: no clinic text, table name or archive structure')
    assert.equal(bucket.log.filter(r => r.refused).length > 0, true, 'the wrong secret was refused by the signature check')
    await tick(first + 3_600_000)
    assert.equal(names().length, 1, 'no second backup before the owner\'s interval has passed')
    // The newest recovery point is on the schedule and the Clinic page, and a change after it is not in it.
    const strip = (await h.send('/app', undefined, h.owner)).text
    assert.ok(/data-recovery-point="ok"/.test(strip) && /Recovery point/.test(strip), 'the owner\'s schedule shows the recovery point')
    assert.equal((await h.send('/app', undefined, reception.cookie)).text.includes('data-recovery-point'), false, 'reception sees no recovery strip')
    const panelHtml = (await h.send('/app/clinic', undefined, h.owner)).text
    assert.ok(panelHtml.includes('id="backups"') && panelHtml.includes(keys.fingerprint) && panelHtml.includes('2 clients'))
    const changed = await h.cmd('client.save', { firstName: 'Changed', lastName: 'AfterBackup', dateOfBirth: '1991-02-02' })
    // Real chart uploads make the next archive exceed one multipart part, without changing the upload limit.
    const scan = mriReport('synthetic-balm-1', 'synthetic-balm-2 '.repeat(55_000))
    for (let i = 0; i < 8; i++) await h.cmd('chart.document.upload', {
      ...mriUpload(changed.id, '2026-10-01'), title: `synthetic-balm-${i + 3}`,
      attachment: 'data:application/pdf;base64,' + scan.toString('base64'),
    })
    await tick(first + 25 * 3_600_000)
    assert.equal(names().length, 2, 'the next automatic backup follows the interval and is a new object')
    assert.ok(Buffer.compare(Buffer.from(bucket.objects.get(names()[0])), stored) === 0, 'an earlier backup is never rewritten')
    const runs = (await h.state()).backups.runs
    assert.deepEqual(runs.map(r => r.state), ['ok', 'ok']); assert.equal(runs[0].counts.clients, 3); assert.equal(runs[1].counts.clients, 2)
    // An erasure after those backups: the next backup carries it, and the older ones cannot bring the patient back.
    await h.cmd('client.erase', { id: enquiry.id })
    mark('automatic backups checked')
    // A storage outage is shown on the dashboard and retried after a pause, never silently dropped.
    bucket.state.refusePart = 503
    await tick(first + 50 * 3_600_000)
    assert.ok(/role="alert"[^>]*data-recovery-point="failing"[\s\S]*refused by the storage/.test((await h.send('/app', undefined, h.owner)).text), 'a failed backup is shown on the dashboard')
    await tick(first + 50 * 3_600_000 + 5 * 60_000)
    assert.equal((await h.state()).backups.runs.filter(r => r.state === 'failed').length, 1, 'a failed backup waits before it is retried')
    assert.equal(bucket.uploads.size, 0, 'a failed multipart upload is aborted even with bucket lock')
    assert.ok(bucket.log.some(r => r.method === 'DELETE' && r.query?.uploadId))
    bucket.state.refusePart = 0
    await tick(first + 50 * 3_600_000 + 16 * 60_000)
    assert.equal(names().length, 3, 'the backup succeeds once storage is back')
    await h.cmd('backup.run', {}, reception.cookie, 403)
    const audit = (await h.db.prepare('SELECT * FROM bm_audit ORDER BY sequence').all()).results
    const consent = audit.findLast(r => r.action === 'backup.saved' && r.detail.includes('consent recorded') && r.detail.includes(saved.fingerprint))
    assert.ok(consent, 'owner consent is recorded in the append-only audit')
    assert.equal(consent.actor_email, h.auth.OWNER_EMAIL); assert.equal(consent.actor_role, 'owner')
    assert.ok(Date.parse(consent.at) >= Date.parse(state.backups.saved.consent_at), 'the consent audit row records its time')
    assert.ok(consent.detail.includes(storage.bucket) && consent.detail.includes(storage.endpoint))
    assert.ok(!JSON.stringify(audit).includes(storage.secretAccessKey), 'no storage secret appears anywhere in the audit')
    assert.ok(bucket.log.some(r => r.query?.uploads === '') && bucket.log.some(r => r.query?.partNumber), 'scheduled backups exercise multipart uploads')
    assert.equal(bucket.uploads.size, 0)
    assert.ok(!bucket.log.some(r => r.method === 'DELETE' && !r.query?.uploadId), 'no object is deleted')
    assert.ok(!bucket.log.some(r => r.refused === 'OverwriteRefused'), 'no object is rewritten')
    const writes = bucket.log.filter(r => !r.refused && ((r.method === 'PUT' && !r.query.partNumber) || (r.method === 'POST' && r.query.uploadId)))
    assert.equal(new Set(writes.map(r => r.path)).size, writes.length, 'every completed object has a new key')
    const baa=(await h.send('/api/balm/readiness.json',undefined,h.owner)).value.baas.find(b=>b.processor==='backups')
    await h.cmd('readiness.baa.revoke',{id:baa.id})
    const countBeforeRevoke=bucket.log.length
    await h.cmd('backup.run',{},h.owner,409)
    await h.cmd('backup.resume',{},h.owner,409)
    await tick(Date.now()+86400_000)
    assert.equal(bucket.log.length,countBeforeRevoke,'revoked storage BAA fences manual and scheduled backup attempts')
    const identity = { auth: h.auth, owner: h.owner }
    await h.close(); h = null
    mark('outage and retry checked')
    // The restore drill and the restore itself run on the owner's computer with only the private key, against the bucket.
    const env = join(temporary, 'backup.env'), keyFile = join(temporary, 'private.pem'), wrongFile = join(temporary, 'wrong.pem')
    await writeFile(keyFile, keys.privateKeyPem, { mode: 0o600 }); await writeFile(wrongFile, other.privateKeyPem, { mode: 0o600 })
    await writeFile(env, `BALM_BACKUP_ENDPOINT=${local.url}\nBALM_BACKUP_REGION=${bucket.config.region}\nBALM_BACKUP_BUCKET=${bucket.config.bucket}\nBALM_BACKUP_PREFIX=clinic\nBALM_BACKUP_ACCESS_KEY_ID=${bucket.config.accessKeyId}\nBALM_BACKUP_SECRET_ACCESS_KEY=${bucket.config.secretAccessKey}\n`, { mode: 0o600 })
    const script = async (name, extra, expected = 0) => {
      let result
      try { result = { ...await exec(process.execPath, [join(source, 'scripts/backups', name), ...extra], { cwd: source, env: { ...process.env, CI: 'true', WRANGLER_SEND_METRICS: 'false' }, maxBuffer: 2e6 }), code: 0 } } catch (error) { result = error }
      assert.equal(result.code, expected, `${name}: ${result.stdout ?? ''} ${result.stderr ?? ''}`)
      return `${result.stdout}${result.stderr}`
    }
    assert.match(await script('restore.mjs', ['--key', wrongFile, '--env-file', env, '--output', join(temporary, 'nope.rer')], 2), /does not open this backup/)
    const damaged = join(temporary, 'damaged.balmbk'), good = Buffer.from(bucket.objects.get(names().at(-1)))
    good[good.length - 40] ^= 1; await writeFile(damaged, good)
    assert.match(await script('restore.mjs', ['--key', keyFile, '--input', damaged, '--output', join(temporary, 'bad.rer')], 2), /damaged/)
    assert.equal(await readFile(join(temporary, 'bad.rer')).then(() => true, () => false), false, 'a damaged backup leaves no partial archive')
    assert.match(await script('drill.mjs', ['--key', keyFile, '--env-file', env]), /Drill passed/)
    mark('drill passed')
    const restored = join(temporary, 'restored.rer')
    assert.match(await script('restore.mjs', ['--key', keyFile, '--env-file', env, '--output', restored]), /recovery point/)
    const older = join(temporary, 'older.rer')
    assert.match(await script('restore.mjs', ['--key', keyFile, '--env-file', env, '--object', names()[0], '--output', older]), /journal/)
    await command(refused, ['import', '--input', older, '--journal', older + '.later.rer', '--yes', '--no-queue'], 4)
    await command(scratch, ['import', '--input', restored, '--yes', '--no-queue'])
    const scratchClinic = await harness({ root: scratch, ...identity })
    try {
      const cookie = await scratchClinic.signIn(scratchClinic.auth.OWNER_EMAIL)
      const names2 = (await scratchClinic.state(cookie)).clients.map(c => c.first_name)
      assert.ok(names2.includes('Before') && names2.includes('Changed'), 'the change made after the first backup is present in the scratch deployment')
      assert.ok(!names2.includes('Temporary'), 'the patient erased before the last backup stays erased')
    } finally { await scratchClinic.close() }
  } finally { if (h) await h.close(); await local.close(); await rm(temporary, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 }) }
})


test('ROLE-002 CHART-008 PAY-007 INTAKE-002: CLI archive preserves jobs, both signatures, estimate originals and versioned scores', {timeout:240_000}, async()=>{
 const temporary=await mkdtemp(join(tmpdir(),'balm-c23-archive-')),source=join(temporary,'source'),restored=join(temporary,'restored')
 let h
 try {
  await checkout(source);await checkout(restored)
  await exec(process.execPath,[resolve('node_modules/wrangler/bin/wrangler.js'),'d1','migrations','apply','foundation','--local'],{cwd:source,env:{...process.env,CI:'true',WRANGLER_SEND_METRICS:'false'},maxBuffer:16e6})
  h=await harness({root:source})
  const {service,practitioners:[priya]}=await clinic(h)
  const student=await h.staff('ArchiveStudent','student',{discipline:'pt',supervisorId:priya.id,credentials:'SPT'})
  await h.cmd('hours.save',{practitionerId:student.id,hours:[0,1,2,3,4,5,6].map(weekday=>({weekday,start:'00:00',end:'24:00'}))})
  const patient=await h.cmd('client.save',{firstName:'Synthetic',lastName:'Portability',dateOfBirth:'1980-01-01',email:'portable@patient.example'})
  const visit=await pastVisit(h,patient.id,student,service.id)
  const note=await h.cmd('note.write',{clientId:patient.id,appointmentId:visit,body:'Synthetic portable supervised care'},student.cookie)
  await h.cmd('supervision.deadline.save',{staffId:student.id,state:'TX',hours:24,source:'Synthetic reviewed state deadline'})
  await h.cmd('note.submit',{id:note.id,revision:1,signature:'ArchiveStudent',credentials:'SPT',attest:true},student.cookie)
  await h.cmd('note.cosign',{id:note.id,revision:1,signature:'Priya',credentials:'PT',attest:true,supervisionGiven:'in_room'},priya.cookie)
  const assistant=await h.staff('ArchiveAssistant','assistant',{discipline:'pt',supervisorId:priya.id,credentials:'PTA'})
  await h.cmd('hours.save',{practitionerId:assistant.id,hours:[0,1,2,3,4,5,6].map(weekday=>({weekday,start:'00:00',end:'24:00'}))})
  const dailyVisit=await pastVisit(h,patient.id,assistant,service.id,h.owner,4)
  const dailyNote=await h.cmd('note.write',{clientId:patient.id,appointmentId:dailyVisit,template:'pt.daily',...chartFixture(),sections:{...chartFixture().sections,subjective:'Synthetic daily history',objective:'Synthetic skilled work',assessment:'Response',goals:'Function',plan:'Continue'}},assistant.cookie)
  const dailyRule=await h.cmd('assistant_daily.save',{staffId:assistant.id,state:'TX',startsOn:'2020-01-01',endsOn:'2099-12-31',stateSource:'Synthetic reviewed state rule',payerSource:'Synthetic cash daily-signing permission',attest:true})
  await h.cmd('note.sign',{id:dailyNote.id,revision:1,ruleId:dailyRule.id,signature:'ArchiveAssistant',credentials:'PTA',attest:true},assistant.cookie)
  await h.cmd('note.supervision',{id:dailyNote.id,signature:'Priya',credentials:'PT',supervisionGiven:'on_site',attest:true},priya.cookie)
  const today=new Date(Date.now()+10*3600000).toISOString().slice(0,10)
  const request=await h.cmd('estimate.request',{clientId:patient.id,coverageKind:'self_pay',coverageAttestation:'Patient elected self-pay',deliveryMethod:'paper',attest:true})
  const referral=await h.cmd('case.open',{clientId:patient.id,receivedOn:today,referringFirst:'Synthetic',referringLast:'Referrer',diagnosis:'M25.561 knee pain'})
  const contributor={name:'Synthetic Imaging Center',npi:'1245319599',taxId:'98-7654321',address:'200 Main St, Austin TX 78701',sourceReference:'synthetic-balm-5',receivedOn:today,diagnosisCodes:['M25.561'],lines:[{name:'Knee imaging',code:'73721',quantity:1,unitCents:30000}],attest:true}
  const prepared=await h.cmd('estimate.prepare',{requestId:request.id,referralId:referral.id,fromOn:today,throughOn:today,lines:[{serviceId:service.id,quantity:1,code:'97161'}],contributors:[contributor],attest:true})
  const estimate=await h.cmd('estimate.issue',{id:prepared.id,sha256:prepared.sha256,attest:true})
  const original=(await h.send('/api/balm/estimates/'+estimate.id+'.pdf',undefined,h.owner)).text
  const issued=(await h.send('/api/balm/clients/'+patient.id,undefined,h.owner)).value.estimates.issued[0]
  await h.cmd('estimate.deliver',{id:estimate.id,sha256:issued.sha256,method:'handed',deliveredOn:today,attest:true})
  const packet=await h.cmd('intake.prepare',{title:'Portable LEFS packet',serviceId:service.id,questions:[{id:'reason',label:'Reason',type:'short',required:true}],instruments:[{kind:'lefs',items:Array.from({length:20},(_,i)=>'Synthetic item '+i)}]})
  const form=await h.cmd('intake.publish',{id:packet.id})
  const booked=await bookOnline(h,service.id,student.id,(await slots(h,service.id,student.id))[0],{firstName:'Synthetic',lastName:'Portability',dateOfBirth:'1980-01-01',email:'portable@patient.example'})
  const path=booked.location.split('?')[0],page=await h.send(path)
  const fields={formId:form.id,q_reason:'Synthetic portable answer',consentVersion:page.text.match(/name="consentVersion" value="([^"]+)"/)[1],consentAccepted:'on',signerName:'Synthetic Portability',signerRelationship:'patient',signatureTyped:'Synthetic Portability'}
  for(let i=1;i<=20;i++)fields['q_out_lefs_'+i]='3'
  assert.equal((await h.form(path,fields)).status,303)
  const payer=await h.cmd('insurance.payer.save',{name:'Synthetic archive payer',payerId:'SYNTHETICARCHIVE',receiverId:'SYNTHETIC',unitMethod:'cms',fees:[{code:'97110',cents:3500}]})
  const archivePolicy=await h.cmd('insurance.policy.save',{clientId:patient.id,payerId:payer.id,memberId:'synthetic-balm-2',relationship:'18',patientSex:'F',address:'100 Main St',city:'Austin',state:'TX',postalCode:'78701',startsOn:'2020-01-01',endsOn:'2099-12-31'})
  const {payerEstimatePdf}=await import('./payer-estimate-journey.mjs')
  const payerOriginal=payerEstimatePdf('Synthetic Portability')
  const payerSource=await h.cmd('estimate.aeob.prepare',{clientId:patient.id,policyId:archivePolicy.id,sourceReference:'synthetic-balm-6',sourceDate:new Date().toISOString().slice(0,10),matchEvidence:'Matched name, birth date and member ID on the payer original',attachment:'data:application/pdf;base64,'+payerOriginal.toString('base64'),attachmentName:'synthetic-balm-6.pdf',attest:true})
  const payerPath='/api/balm/aeobs/'+payerSource.id+'.pdf'
  assert.equal((await h.send(payerPath,undefined,h.owner)).text,payerOriginal.toString())
  await h.cmd('estimate.aeob.issue',{id:payerSource.id,sha256:payerSource.sha256,portalConsent:'Patient requested the portal copy at the desk',attest:true})
  const release=await h.cmd('note_release.prepare',{clientId:patient.id,payerId:payer.id,purpose:'appeal',reference:'synthetic-balm-3',appointmentIds:[visit]})
  const releasePath='/api/balm/note-releases/'+release.id+'.pdf',releaseOriginal=(await h.send(releasePath,undefined,h.owner)).text
  await h.cmd('note_release.approve',{id:release.id,sha256:release.sha256,attest:true})
  const scheduleLocation=await h.cmd('location.save',{name:'Synthetic portable location',timeZone:'America/Chicago',hours:[{weekday:1,start:'09:00',end:'17:00'}]})
  const scheduleRoom=await h.cmd('room.save',{name:'Synthetic portable room'})
  await h.cmd('room.location',{roomId:scheduleRoom.id,locationId:scheduleLocation.id})
  const scheduleService=await h.cmd('service.save',{name:'Synthetic portable evaluation',durationMinutes:60,priceCents:15000,practitionerIds:[priya.id],locationIds:[scheduleLocation.id],cptDefaults:['97161'],beforeBuffer:10,afterBuffer:15})
  await h.cmd('schedule.exception',{locationId:scheduleLocation.id,date:'2099-03-02',mode:'closed',name:'Synthetic portable day off'})
  const cyclePatient=await h.cmd('client.save',{firstName:'Postal',lastName:'Portability',email:'postal@patient.example'})
  const cycleVisit=await pastVisit(h,cyclePatient.id,priya,service.id,h.owner,8)
  await h.cmd('appointment.attend',{id:cycleVisit})
  const cycleInvoice=await h.cmd('invoice.prepare',{appointmentId:cycleVisit})
  await h.cmd('invoice.approve',{id:cycleInvoice.id})
  await h.cmd('pay.cycle.preference',{clientId:cyclePatient.id,channel:'mail',address:'200 Main Street\nAustin TX 78701',authorized:true,evidence:'Patient signed monthly postal delivery authorization'})
  const cycle=await h.cmd('pay.cycle.run',{cycleOn:'2025-01-01',confirm:true})
  const statementFile=(await h.send('/api/balm/clients/'+cyclePatient.id,undefined,h.owner)).value
  const cycleStatement=statementFile.billing.statements.find(s=>s.due_on==='2025-01-01')
  assert.ok(cycleStatement,JSON.stringify({cycle,ledger:statementFile.billing.ledger}))
  const statementPath='/api/balm/issued-statements/'+cycleStatement.id+'.pdf'
  const statementBytes=(await h.send(statementPath,undefined,h.owner)).text
  const batchPath='/api/balm/statement-batches/'+cycle.id+'.pdf',batchBytes=(await h.send(batchPath,undefined,h.owner)).text
  const auth=h.auth,ownerSession=h.owner
  await h.close();h=null
  const archive=join(temporary,'clinic.rer')
  await command(source,['export','--output',archive,'--no-queue'])
  await command(restored,['import','--input',archive,'--yes','--no-queue'])
  h=await harness({root:restored,auth,owner:ownerSession,autoMfa:false})
  for(const table of ['bm_staff_factors','bm_staff_factor_pending','bm_staff_recovery','bm_staff_session_proofs'])assert.equal((await h.db.prepare('SELECT COUNT(*) n FROM '+table).first()).n,0,'SEC-001 credentials and proofs never travel in an archive')
  const owner=await h.signIn(auth.OWNER_EMAIL),cookie=await h.signIn('archivestudent@clinic.example')
  await h.state(owner,401);await h.state(cookie,401)
  assert.match((await h.send('/auth/security',undefined,owner)).text,/Set up an authenticator before opening clinic records/)
  const {authorizeTestSession}=await import('./staff-second-step.mjs')
  await authorizeTestSession(h.send,owner,auth.OWNER_EMAIL,auth.SESSION_SECRET+':'+restored)
  await authorizeTestSession(h.send,cookie,'archivestudent@clinic.example',auth.SESSION_SECRET+':'+restored)
  const restoredScheduling=await h.state(owner),restoredService=restoredScheduling.services.find(s=>s.id===scheduleService.id),restoredLocation=restoredScheduling.locations.find(l=>l.id===scheduleLocation.id)
  assert.deepEqual([restoredService.duration_minutes,restoredService.price_cents,JSON.parse(restoredService.practitioner_ids),JSON.parse(restoredService.location_ids),JSON.parse(restoredService.cpt_defaults),restoredService.before_buffer,restoredService.after_buffer],[60,15000,[priya.id],[scheduleLocation.id],['97161'],10,15],'SCHED-007 service defaults and padded restrictions survive the public CLI archive')
  assert.equal(restoredLocation.time_zone,'America/Chicago');assert.deepEqual(JSON.parse(restoredLocation.hours),[{weekday:1,startMinute:540,endMinute:1020}])
  assert.equal(restoredScheduling.scheduleExceptions.find(e=>e.location_id===scheduleLocation.id).name,'Synthetic portable day off')
  await h.cmd('appointment.book',{clientId:patient.id,practitionerId:priya.id,serviceId:scheduleService.id,roomId:scheduleRoom.id,date:'2099-03-02',time:'10:00'},owner,409)
  const file=await h.send('/api/balm/clients/'+patient.id,undefined,owner)
  assert.equal(file.status,200,file.text)
  assert.equal((await h.send(statementPath,undefined,owner)).text,statementBytes)
  assert.equal((await h.send(batchPath,undefined,owner)).text,batchBytes)
  const restoredCycleFile=(await h.send('/api/balm/clients/'+cyclePatient.id,undefined,owner)).value
  assert.equal(restoredCycleFile.billing.cycle.preference.channel,'mail')
  assert.equal(restoredCycleFile.billing.cycle.deliveries[0].outcome,'prepared')
  const restoredPatient=await portalLogin(h,'postal@patient.example')
  assert.equal((await h.send('/portal/statements/'+cycleStatement.id+'.pdf',undefined,restoredPatient)).text,statementBytes)

  const fixed=file.value.notes.find(n=>n.id===note.id)
  const restoredDaily=file.value.notes.find(n=>n.id===dailyNote.id)
  assert.equal(restoredDaily.signature.name,'ArchiveAssistant');assert.equal(restoredDaily.assistantDaily.rule.id,dailyRule.id);assert.equal(restoredDaily.assistantDaily.endorsement.supervisor_name,'Priya')
  assert.ok(fixed.submissions[0].due_at);assert.equal(JSON.parse(fixed.submissions[0].deadline_basis).state,'TX')
  assert.equal((await h.send(releasePath,undefined,owner)).text,releaseOriginal)
  assert.ok(file.value.noteReleases.find(r=>r.id===release.id).approved_at)
  assert.equal(fixed.submissions[0].supervision_given,'in_room');assert.equal(fixed.signature.name,'Priya');assert.equal(fixed.submissions[0].author_name,'ArchiveStudent');assert.equal(fixed.submissions[0].decision,'cosigned')
  assert.equal(file.value.estimates.issued[0].contributors[0].sourceReference,contributor.sourceReference)
  assert.equal(file.value.estimates.issued[0].contributors[0].totalCents,30000)
  assert.equal((await h.send(payerPath,undefined,owner)).text,payerOriginal.toString())
  assert.ok(file.value.aeobs.find(a=>a.id===payerSource.id).issued_at)
  assert.equal(file.value.estimates.issued[0].delivery.method,'handed');assert.equal(file.value.estimates.issued[0].delivery.original_sha256,issued.sha256)
  assert.equal(file.value.intake[0].scores[0].score,60);assert.equal(file.value.intake[0].formNumber,form.number)
  assert.equal((await h.send('/api/balm/estimates/'+estimate.id+'.pdf',undefined,owner)).text,original)
  await h.cmd('note.sign',{id:note.id,revision:1,signature:'ArchiveStudent',attest:true},cookie,403)
 } finally {await h?.close();await rm(temporary,{recursive:true,force:true})}
})

test('INS-012: CLI archive preserves jobs and restores fixed manual EOB batches, signed recoupments and deposit arithmetic', {timeout:240000},async()=>{
 const {manualPayerJourney,payerEobPdf}=await import('./manual-payer-journey.mjs')
 const temporary=await mkdtemp(join(tmpdir(),'balm-payer-archive-')),source=join(temporary,'source'),restored=join(temporary,'restored')
 let h
 try{
  await checkout(source);await checkout(restored)
  await exec(process.execPath,[resolve('node_modules/wrangler/bin/wrangler.js'),'d1','migrations','apply','foundation','--local'],{cwd:source,env:{...process.env,CI:'true',WRANGLER_SEND_METRICS:'false'},maxBuffer:16e6})
  h=await harness({root:source})
  const result=await manualPayerJourney(h),identity={owner:h.owner,auth:h.auth},archive=join(temporary,'payer.rer')
  await h.close();h=null
  await command(source,['export','--output',archive,'--no-queue'])
  await command(restored,['import','--input',archive,'--yes','--no-queue'])
  h=await harness({root:restored,...identity})
  const owner=await h.signIn(h.auth.OWNER_EMAIL)
  const third=(await h.send('/api/balm/clients/'+result.claims[2].patient.id,undefined,owner)).value
  assert.equal(third.billing.ledger.balanceCents,2000);assert.equal(third.billing.ledger.insurancePendingCents,2000)
  const batch=(await h.state(owner)).insurance.manualPayers.find(b=>b.id===result.batch.id)
  assert.equal(batch.status,'closed');assert.equal(batch.postedCents,12100)
  assert.ok(batch.lines.some(l=>l.adjustments.some(a=>a.group==='CO'&&a.reason==='45')))
  assert.equal((await h.send('/api/balm/insurance/eob/'+batch.id,undefined,owner)).text,payerEobPdf.toString())
  const report=(await h.send('/api/balm/reports/financial?from='+result.today+'&to='+result.today,undefined,owner)).value
  assert.equal(report.deposits.rows.find(d=>d.reference==='synthetic-balm-10').receivedCents,12100)
 }finally{await h?.close();await rm(temporary,{recursive:true,force:true,maxRetries:3,retryDelay:100})}
})

test('retail and finance originals, paused entitlements and preparation authority survive a public CLI archive round trip', {timeout:240000},async()=>{
  const temporary=await mkdtemp(join(tmpdir(),'balm-retail-archive-')),source=join(temporary,'source'),restored=join(temporary,'restored')
  let h
  try {
    await checkout(source);await checkout(restored)
    await exec(process.execPath,[resolve('node_modules/wrangler/bin/wrangler.js'),'d1','migrations','apply','foundation','--local'],{cwd:source,env:{...process.env,CI:'true',WRANGLER_SEND_METRICS:'false'},maxBuffer:16e6})
    const {quickbooksEdge,accountingMappings}=await import('./fakes/quickbooks.mjs'),qbo=quickbooksEdge(),stripe=fakeProviders()
    h=await harness({root:source,outbound:r=>new URL(r.url).hostname==='api.stripe.com'?stripe.handler(r):qbo.outbound(r)})
    const {service,practitioners:[priya]}=await clinic(h)
    const patient=await h.cmd('client.save',{firstName:'Synthetic',lastName:'Retail archive',dateOfBirth:'1950-01-01'})
    const member=await h.cmd('pay.retail.sell',{clientId:patient.id,kind:'membership',serviceId:service.id,units:2,amountCents:5000,label:'Synthetic finite membership',reference:'synthetic-balm-archive-member',confirm:true})
    await h.cmd('pay.retail.membership',{clientId:patient.id,saleId:member.id,state:'paused',reason:'Synthetic pause',consentEvidence:'Synthetic patient authorization',effectiveAt:new Date().toISOString(),authorizedAt:new Date(Date.now()-120000).toISOString(),authorizationMethod:'Specific request in person',confirm:true})
    for(const state of ['active','paused'])await h.cmd('pay.retail.membership',{clientId:patient.id,saleId:member.id,state,reason:'Synthetic patient change',consentEvidence:'Synthetic patient authorization',effectiveAt:new Date().toISOString(),authorizedAt:new Date(Date.now()-120000).toISOString(),authorizationMethod:'Specific request in person',confirm:true})
    const exhausted=await h.cmd('pay.retail.sell',{clientId:patient.id,kind:'membership',serviceId:service.id,units:1,amountCents:1000,label:'Synthetic exhausted membership',reference:'synthetic-balm-archive-exhausted',confirm:true})
    const visit=await pastVisit(h,patient.id,priya,service.id,h.owner,8,{coverageChoice:'self_pay',deliveryMethod:'paper'})
    await h.cmd('pay.retail.assign',{clientId:patient.id,saleId:exhausted.id,appointmentId:visit})
    await h.cmd('appointment.attend',{id:visit},priya.cookie)
    const renewalTerms={clientId:patient.id,saleId:exhausted.id,kind:'membership',serviceId:service.id,units:3,amountCents:3000,label:'Synthetic renewed membership',reference:'synthetic-balm-archive-renewal',reason:'Patient requested three new cash visits',consentEvidence:'Specific patient authorization',effectiveAt:new Date().toISOString(),authorizedAt:new Date(Date.now()-120000).toISOString(),authorizationMethod:'Patient in person',confirm:true,cashConfirm:true}
    const renewed=await h.cmd('pay.retail.renew',renewalTerms)
    const renewalBefore=await h.db.prepare('SELECT * FROM bm_retail_sales WHERE id=?').bind(renewed.id).first()
    const settlementTerms={...renewalTerms,saleId:renewed.id,effectiveAt:new Date().toISOString(),settlementAmountCents:3000,settlementReference:'synthetic-balm-archive-cash-refund',settlementEvidence:'Completed external cash refund original',cashReturned:true}
    await h.cmd('pay.retail.settle',settlementTerms)
    const settlementBefore=await h.db.prepare('SELECT * FROM bm_membership_settlements WHERE sale_id=?').bind(renewed.id).first()

    const cancellationTerms={clientId:patient.id,saleId:exhausted.id,reason:'Patient requested cancellation after consumption',consentEvidence:'Patient authorized cancelling this exhausted membership',effectiveAt:new Date().toISOString(),authorizedAt:new Date(Date.now()-120000).toISOString(),authorizationMethod:'Specific patient request in person',confirm:true}
    await h.cmd('pay.retail.cancel',cancellationTerms)
    const cancellationBefore=await h.db.prepare('SELECT * FROM bm_membership_cancellations WHERE sale_id=?').bind(exhausted.id).first()
    const eventsBefore=(await h.db.prepare('SELECT * FROM bm_membership_events WHERE sale_id=? ORDER BY id').bind(member.id).all()).results
    const inactive=await h.staff('InactiveRetailDesk','reception')
    await h.cmd('staff.save',{id:inactive.id,name:'InactiveRetailDesk',email:'inactiveretaildesk@clinic.example',role:'reception',active:false})
    const original=(await h.send(member.receiptUrl,undefined,h.owner)).text
    const base={clientId:patient.id,amountCents:5000,occurredOn:'2026-09-01',evidence:'Owner reviewed synthetic original'}
    await h.cmd('finance.observation.record',{...base,kind:'eft',reference:'synthetic-balm-archive-eft',sourceReference:'synthetic-balm-archive-trace'})
    await h.cmd('finance.source.record',{...base,kind:'charge',reference:'synthetic-balm-archive-charge',sourceReference:'synthetic-balm-archive-original',confirm:true})
    const review=(await h.cmd('finance.reconcile.prepare',{month:'2026-09'})).findings[0]
    await h.cmd('finance.review.approve',{id:review.id,sha256:review.sha256,confirm:true})
    const {giftSettlementJourney}=await import('./retail-gift-settlement-journey.mjs')
    const giftSettlement=await giftSettlementJourney(h)
    const giftOriginal=(await h.send('/portal/receipts/'+giftSettlement.member.id+'.pdf',undefined,await portalLogin(h,h.auth.OWNER_EMAIL))).text
    await h.cmd('accounting.connect',{realmId:'123',clientId:'synthetic-balm-8',clientSecret:'synthetic-balm-9',refreshToken:'synthetic-balm-10',environment:'sandbox',confirm:true})
    await h.cmd('accounting.mapping',{mappings:accountingMappings,confirm:true})
    const settlementDay=new Date(Date.parse(settlementBefore.recorded_at)+10*3600000).toISOString().slice(0,10)
    const accounting=await h.cmd('accounting.prepare',{day:settlementDay})
    const accountingSources=JSON.parse((await h.db.prepare('SELECT sources FROM bm_accounting_batches WHERE id=?').bind(accounting.id).first()).sources)
    assert.deepEqual(accountingSources.find(s=>s.id==='membership-settlement:'+renewed.id),{id:'membership-settlement:'+renewed.id,kind:'refund',method:'cash',cents:3000,debit:'income',credit:'cash'})
    assert.deepEqual(accountingSources.find(s=>s.id==='membership-settlement:'+giftSettlement.member.id),{id:'membership-settlement:'+giftSettlement.member.id,kind:'refund',method:'gift',cents:3001,debit:'income',credit:'liability'})
    const key=await h.cmd('agent.create',{label:'Synthetic excluded finance grant',scopes:['finance.reconcile.prepare']})
    const payer=await h.cmd('insurance.payer.save',{name:'Synthetic archive carry payer',payerId:'ARCHIVE'})
    const claimCarryInput=cutoverClaims(payer.id),claimCarryPreview=await h.cmd('movein.prepare',claimCarryInput)
    const moveinClaims=await h.cmd('movein.cutover',{...claimCarryInput,fingerprint:claimCarryPreview.fingerprint,mappingApproval:claimCarryPreview.mappingDigest,cutoverApproval:claimCarryPreview.fingerprint,acceptanceReason:'Original aging exactly matches carried receivables; retain the source records.'})
    const authorizationInput=cutoverAuthorizations(payer.id,priya.id),authorizationPreview=await h.cmd('movein.prepare',authorizationInput)
    const moveinAuthorizations=await h.cmd('movein.cutover',{...authorizationInput,fingerprint:authorizationPreview.fingerprint,mappingApproval:authorizationPreview.mappingDigest,cutoverApproval:authorizationPreview.fingerprint,acceptanceReason:'Reviewed original source allowances and usage; retain native policy custody.'})
    const authorizationClient=authorizationPreview.patients[1].id
    const authorizationBefore=(await h.send('/api/balm/clients/'+authorizationClient,undefined,h.owner)).value.insurance
    const carriedBeforeRestore=(await h.cmd('insurance.runout.read',{})).claims.filter(c=>moveinClaims.records.some(r=>r.target_id===c.id))
    await h.cmd('pay.stripe.connect',{secretKey:'synthetic-balm-1'})
    const reception=await h.staff('Rosa','reception')
    const responsibility=await checkInResponsibilityJourney({h,stripe,service,priya,reception})
    const moneyBefore=(await h.db.prepare('SELECT id,invoice_id,appointment_id,collection_purpose,amount_cents,payment_intent,stripe_account_id,stripe_customer_id,status FROM bm_card_payments WHERE client_id=? ORDER BY id').bind(responsibility.patient.id).all()).results
    const retailSeller=await h.staff('ArchiveRetailSeller','reception')
    const saleAuthority=await h.cmd('pay.retail.authorize',{staffId:retailSeller.id,expiresAt:new Date(Date.now()+3600_000).toISOString(),reason:'synthetic-balm-archive-sale-authority',confirm:true})
    assert.equal((await h.send('/api/balm/clients/'+patient.id,undefined,retailSeller.cookie)).value.billing.retailSalesAllowed,true)
    const identity={auth:h.auth,owner:h.owner}
    await h.close();h=null
    const archive=join(temporary,'retail.rer')
    await command(source,['export','--output',archive,'--no-queue'])
    const bytes=await readFile(archive,'utf8')
    assert.ok(!bytes.includes(key.token)&&!bytes.includes('Synthetic excluded finance grant'))
    await command(restored,['import','--input',archive,'--yes','--no-queue'])
    h=await harness({root:restored,...identity})
    const owner=await h.signIn(h.auth.OWNER_EMAIL)
    assert.equal((await h.db.prepare('SELECT id FROM bm_retail_staff_approvals WHERE id=?').bind(saleAuthority.approvalId).first()).id,saleAuthority.approvalId,'historical approval stays evidence without restored execution authority')
    const seller=await h.signIn((await h.db.prepare('SELECT email FROM bm_staff WHERE id=?').bind(retailSeller.id).first()).email)
    await h.cmd('pay.retail.sell',{clientId:patient.id,kind:'gift_card',amountCents:1000,label:'synthetic-balm-refused-restored-sale',reference:'synthetic-balm-refused-restored-sale',confirm:true},seller,403)
    assert.equal((await h.db.prepare('SELECT COUNT(*) n FROM bm_retail_staff_grants').first()).n,0,'a historical archive cannot restore sale authority')
    assert.equal((await h.send('/api/balm/clients/'+patient.id,undefined,seller)).value.billing.retailSalesAllowed,false)
    const moneyAfter=(await h.db.prepare('SELECT id,invoice_id,appointment_id,collection_purpose,amount_cents,payment_intent,stripe_account_id,stripe_customer_id,status FROM bm_card_payments WHERE client_id=? ORDER BY id').bind(responsibility.patient.id).all()).results
    assert.deepEqual(moneyAfter,moneyBefore)
    const patientSession=await portalLogin(h,'responsibility@patient.example')
    assert.equal((await h.send('/portal/receipts/'+responsibility.saved.id+'.pdf',undefined,patientSession)).text,responsibility.original)
    assert.equal((await h.send('/portal/receipts/'+responsibility.terminal.id+'.pdf',undefined,patientSession)).text,responsibility.receipt)
    assert.equal((await h.send('/api/balm/clients/'+responsibility.patient.id,undefined,owner)).value.billing.ledger.patientBalanceCents,0)
      assert.deepEqual((await h.cmd('movein.journal',{jobId:moveinClaims.job.id},owner)).job.report,moveinClaims.job.report,'carried claim reconciliation survives restore')
      const carriedAfterRestore=(await h.cmd('insurance.runout.read',{},owner)).claims.filter(c=>moveinClaims.records.some(r=>r.target_id===c.id))
      assert.deepEqual(carriedAfterRestore.map(({age_days,...facts})=>facts),carriedBeforeRestore.map(({age_days,...facts})=>facts),'all original carried claim facts and balances survive restore')
      await h.cmd('movein.undo',{jobId:moveinClaims.job.id},owner,409)
    const authorizationAfter=(await h.send('/api/balm/clients/'+authorizationClient,undefined,owner)).value.insurance
    assert.deepEqual(authorizationAfter.policies,authorizationBefore.policies,'native carried policy facts survive CLI restore')
    assert.deepEqual(authorizationAfter.authorizations,authorizationBefore.authorizations,'source authorization baseline, scope and remaining allowance survive CLI restore')
    const carriedAuthorization = authorizationAfter.authorizations[0]
    await h.cmd('insurance.authorization.save', { id: carriedAuthorization.id, policyId: carriedAuthorization.policy_id, number: carriedAuthorization.number, startsOn: carriedAuthorization.starts_on, endsOn: carriedAuthorization.ends_on, allowanceKind: 'visits', visits: 12 }, owner, 409)

    assert.deepEqual((await h.cmd('movein.journal',{jobId:moveinAuthorizations.job.id},owner)).job.report,moveinAuthorizations.job.report)
    await h.cmd('movein.undo',{jobId:moveinAuthorizations.job.id},owner,409)
    assert.equal((await h.state(owner)).accounting.connection,null,'restored clinic must explicitly reconnect its accounting provider')
    const restoredGiftCookie=await portalLogin(h,h.auth.OWNER_EMAIL)
    assert.equal((await h.send('/portal/receipts/'+giftSettlement.member.id+'.pdf',undefined,restoredGiftCookie)).text,giftOriginal)
    assert.ok((await h.send('/portal/home',undefined,restoredGiftCookie)).text.includes('Unused membership value returned to your original gift: $30.01.'))
    const restoredGift=(await h.send('/api/balm/clients/'+giftSettlement.patient.id,undefined,owner)).value.billing.retail
    assert.equal(restoredGift.find(s=>s.id===giftSettlement.gift.id).gift_left_cents,0)
    assert.equal(restoredGift.find(s=>s.id===giftSettlement.member.id).restored_gift_cents,3001)
    await h.cmd('pay.retail.gift_settle',giftSettlement.input,owner,409)
    assert.equal((await h.send(member.receiptUrl,undefined,owner)).text,original)
    const file=(await h.send('/api/balm/clients/'+patient.id,undefined,owner)).value
    assert.equal(file.billing.retail.find(x=>x.id===member.id).membership_state,'paused')
    assert.equal(file.billing.retail.find(x=>x.id===member.id).visits_left,2)
    assert.equal(file.billing.retail.find(x=>x.id===exhausted.id).membership_state,'cancelled')
    assert.equal(file.billing.retail.find(x=>x.id===exhausted.id).visits_left,0)
    assert.deepEqual(await h.db.prepare('SELECT * FROM bm_membership_cancellations WHERE sale_id=?').bind(exhausted.id).first(),cancellationBefore)
    assert.deepEqual(await h.db.prepare('SELECT * FROM bm_retail_sales WHERE id=?').bind(renewed.id).first(),renewalBefore)
    assert.equal(file.billing.retail.find(x=>x.id===renewed.id).visits_left,0)
    assert.equal(file.billing.retail.find(x=>x.id===renewed.id).membership_state,'cancelled')
    assert.deepEqual(await h.db.prepare('SELECT * FROM bm_membership_settlements WHERE sale_id=?').bind(renewed.id).first(),settlementBefore)
    await h.cmd('pay.retail.settle',settlementTerms,owner,409)
    await h.cmd('pay.retail.settle',settlementTerms,inactive.cookie,401)
    await h.cmd('pay.retail.renew',renewalTerms,owner,409)
    await h.cmd('pay.retail.renew',renewalTerms,inactive.cookie,401)
    await h.cmd('pay.retail.cancel',cancellationTerms,owner,409)
    await h.cmd('pay.retail.membership',{...cancellationTerms,state:'active'},owner,409)

    assert.deepEqual((await h.db.prepare('SELECT * FROM bm_membership_events WHERE sale_id=? ORDER BY id').bind(member.id).all()).results,eventsBefore)
    await h.cmd('pay.retail.membership',{clientId:patient.id,saleId:member.id,state:'active'},inactive.cookie,401)
    const restoredStaff=(await h.state(owner)).staff.find(x=>x.id===inactive.id)
    assert.equal(restoredStaff.active,0)
    assert.equal(h.outboundRequests.filter(x=>x.origin.includes('stripe')).length,0)
    const finance=await h.cmd('finance.reconcile.prepare',{month:'2026-09'},owner)
    assert.equal(finance.matching.length,2)
    assert.ok(finance.matching.find(x=>x.reference==='synthetic-balm-archive-charge').explanations.some(x=>x.includes('No recorded card settlement')))
    assert.equal(finance.findings[0].sha256,review.sha256)
    assert.ok(finance.findings[0].approved_by)
    await h.cmd('finance.review.approve',{id:review.id,sha256:review.sha256,confirm:true},owner,409)
    assert.equal((await h.send('/api/balm/agent/command',{name:'finance.reconcile.prepare',input:{month:'2026-09'}},'',{authorization:'Bearer '+key.token})).status,401)
    assert.equal(file.billing.payments.length,0,'historical preparation approval creates no payment')
    assert.equal(h.outboundRequests.filter(x=>x.origin.includes('stripe')||x.origin.includes('payer')).length,0)
  } finally {await h?.close();await rm(temporary,{recursive:true,force:true,maxRetries:3,retryDelay:100})}
})

test('prior authorization signed packets and recorded payer decisions survive a public CLI archive round trip',{timeout:240000},async()=>{
 const temporary=await mkdtemp(join(tmpdir(),'balm-authorization-archive-')),source=join(temporary,'source'),restored=join(temporary,'restored')
 let h
 try{
  await checkout(source);await checkout(restored)
  await exec(process.execPath,[resolve('node_modules/wrangler/bin/wrangler.js'),'d1','migrations','apply','foundation','--local'],{cwd:source,env:{...process.env,CI:'true',WRANGLER_SEND_METRICS:'false'},maxBuffer:16e6})
  h=await harness({root:source})
  const {authorizationRequestFixture,approveAuthorizationRelease}=await import('./authorization-request-journey.mjs'),c=await authorizationRequestFixture(h)
  await c.sign()
  const request=await h.cmd('insurance.authorization_request.prepare',c.input)
  const original=(await h.send('/api/balm/insurance/authorization-request/'+request.id,undefined,h.owner)).text
  await approveAuthorizationRelease(h,request,c.patient.id)
  assert.equal((await h.send('/api/balm/insurance/authorization-request/'+request.id,undefined,c.biller.cookie)).status,200)
  await h.cmd('insurance.authorization_request.submit',{...request,channel:'availity',submittedOn:c.today,reference:'synthetic-balm-8',attest:true},c.biller.cookie)
  const result=await h.cmd('insurance.authorization_request.decide',{...c.approval,...request},c.biller.cookie)
  const clinicalLetter=await h.cmd('letter.prepare',{noteId:c.input.noteId},c.priya.cookie)
  const deliveredLetter=await h.cmd('letter.deliver',{...clinicalLetter,attest:true},c.priya.cookie)
  const letterSource=await h.mf.dispatchFetch(h.origin+'/api/balm/chart-documents/'+deliveredLetter.documentId,{headers:{cookie:h.owner}})
  assert.equal(letterSource.status,200)
  const letterOriginal=Buffer.from(await letterSource.arrayBuffer())
  const identity={auth:h.auth,owner:h.owner}
  await h.close();h=null
  const archive=join(temporary,'authorization.rer')
  await command(source,['export','--output',archive,'--no-queue'])
  await command(restored,['import','--input',archive,'--yes','--no-queue'])
  h=await harness({root:restored,...identity})
  const owner=await h.signIn(h.auth.OWNER_EMAIL)
  assert.equal((await h.send('/api/balm/insurance/authorization-request/'+request.id,undefined,owner)).text,original)
  const file=(await h.send('/api/balm/clients/'+c.patient.id,undefined,owner)).value
  const record=file.insurance.authorizationRequests[0]
  assert.deepEqual([record.status,record.channel,record.submission_reference,record.decision_reference,record.authorization_id],['approved','availity','synthetic-balm-8','synthetic-balm-5',result.authorizationId])
  assert.equal(file.insurance.authorizations.find(a=>a.id===result.authorizationId).remaining_visits,1)
  const letterRestored=await h.mf.dispatchFetch(h.origin+'/api/balm/chart-documents/'+deliveredLetter.documentId,{headers:{cookie:owner}})
  assert.equal(letterRestored.status,200)
  assert.deepEqual(Buffer.from(await letterRestored.arrayBuffer()),letterOriginal)
  const restoredLetter=await h.db.prepare('SELECT l.author_id,l.episode_id,d.sha256,d.channel FROM bm_clinical_letters l JOIN bm_letter_deliveries d ON d.letter_id=l.id WHERE l.id=?').bind(clinicalLetter.id).first()
  assert.equal(restoredLetter.episode_id,c.referral.episodeId);assert.equal(restoredLetter.author_id,c.priya.id);assert.equal(restoredLetter.sha256,deliveredLetter.sha256);assert.equal(restoredLetter.channel,'portal')
  assert.ok(file.audit.some(a=>a.action==='insurance.authorization_decision_recorded'))
  await h.cmd('insurance.authorization_request.decide',{...c.approval,...request},owner,409)
 }finally{await h?.close();await rm(temporary,{recursive:true,force:true,maxRetries:3,retryDelay:100})}
})


// Keep call custody independent of the large clinical archive fixture. Both
// installations start from the real migrations; only public CLI transfer moves data.
test('COMM-003 SCHED-005: public CLI archive round trip preserves exact calls, waitlist preferences and custody in an empty install', {timeout:180000},async()=>{
 const temporary=await mkdtemp(join(tmpdir(),'balm-call-archive-')),source=join(temporary,'source'),restored=join(temporary,'restored')
 let h
 const snapshot=async(db,clientId)=>({
  quietPolicies:(await db.prepare('SELECT * FROM bm_sms_quiet_policies ORDER BY id').all()).results,
  quietPolicy:(await db.prepare('SELECT sms_quiet_policy_id FROM bm_settings WHERE id=1').first()).sms_quiet_policy_id,
  patientZone:(await db.prepare('SELECT sms_time_zone FROM bm_clients WHERE id=?').bind(clientId).first()).sms_time_zone,
  calls:(await db.prepare('SELECT * FROM bm_calls WHERE client_id=? ORDER BY id').bind(clientId).all()).results,
  waitlist:(await db.prepare('SELECT * FROM bm_waitlist WHERE client_id=? ORDER BY id').bind(clientId).all()).results,
  offers:(await db.prepare('SELECT * FROM bm_offers ORDER BY id').all()).results,
  recipients:(await db.prepare('SELECT offer_id,entry_id,channel,delivery,outcome,responded_at,taken_notice,position,activated_at,expires_at FROM bm_offer_recipients ORDER BY offer_id,entry_id').all()).results,
  audit:(await db.prepare('SELECT * FROM bm_audit WHERE client_id=? ORDER BY sequence').bind(clientId).all()).results,
 })
 try{
  await checkout(source);await checkout(restored)
  // Build an unclaimed, empty installation without spawning Wrangler for each
  // migration. The CLI still checks the ledger and enforces empty-target restore.
  h=await harness({root:restored,migrate:true,unclaimed:true,codeSets:false});await h.close();h=null
  h=await harness({root:source,migrate:true,codeSets:false})
  const desk=await h.staff('Rosa','reception')
  const patient=await h.cmd('client.save',{firstName:'Synthetic',lastName:'Call custody',email:['synthetic-balm-510','patient.example'].join('@'),smsTimeZone:'America/New_York'})
  await h.cmd('reminders.quiet_hours',{intervals:'21:00-08:00',source:'synthetic-balm-403 earlier reviewed policy',attest:true})
  const policy=await h.cmd('reminders.quiet_hours',{intervals:'22:00-08:00\n12:00-13:00',source:'synthetic-balm-404 current reviewed policy',attest:true})
  const ids=[]
  for(const [direction,occurredAt,disposition] of [
   ['incoming','2000-01-02T03:00:00Z','synthetic-balm-301 scheduling question'],
   ['outgoing','2000-01-03T04:00:00Z','synthetic-balm-302 appointment confirmed'],
  ])ids.push((await h.cmd('call.log',{clientId:patient.id,recipient:'front_desk',direction,occurredAt,disposition},desk.cookie)).id)
  const path='/api/balm/clients/'+patient.id+'/communications?communicationChannel=call'
  const history=(await h.send(path,undefined,h.owner)).value
  assert.equal(history.total,2)
  assert.deepEqual(new Set(history.results.map(r=>r.id)),new Set(ids))
  const {service,practitioners:[priya]}=await clinic(h)
  const sourcePatient=await h.cmd('client.save',{firstName:'Synthetic',lastName:'Opening'})
  const entryInput={clientId:patient.id,practitionerId:priya.id,serviceId:service.id,earliestDate:'2099-03-01',latestDate:'2099-03-31',weekdays:[0],timeFrom:'09:00',timeUntil:'09:45'}
  await h.cmd('waitlist.add',entryInput)
  const visit=await h.cmd('appointment.book',{clientId:sourcePatient.id,practitionerId:priya.id,serviceId:service.id,date:'2099-03-01',time:'09:00'})
  await h.cmd('appointment.cancel',{id:visit.appointmentId,reason:'Synthetic archive opening'})
  const offerPath=new URL(h.mail.findLast(m=>m.subject.startsWith('A time opened up')).text.match(/https?:\/\/\S+\/offer\/[\w-]+/)[0]).pathname
  assert.equal((await h.form(offerPath,{})).status,303)
  const removed=await h.cmd('waitlist.add',{...entryInput,timeFrom:'10:00',timeUntil:'11:00'})
  await h.cmd('waitlist.remove',{id:removed.id})
  await h.cmd('waitlist.add',{...entryInput,weekdays:[1,3],timeFrom:'14:00',timeUntil:'16:00'})
  const secondVisit=await h.cmd('appointment.book',{clientId:sourcePatient.id,practitionerId:priya.id,serviceId:service.id,date:'2099-03-02',time:'14:00'})
  await h.cmd('appointment.cancel',{id:secondVisit.appointmentId,reason:'Synthetic live archive offer'})
  const openOfferPath=new URL(h.mail.findLast(m=>m.subject.startsWith('A time opened up')).text.match(/https?:\/\/\S+\/offer\/[\w-]+/)[0]).pathname
  assert.match((await h.send(openOfferPath)).text,/A time opened up/)
  const bearerHashes=(await h.db.prepare('SELECT offer_token_hash FROM bm_offer_recipients').all()).results.map(r=>r.offer_token_hash)
  const original=await snapshot(h.db,patient.id)
  assert.deepEqual(original.waitlist.map(e=>e.status).sort(),['booked','removed','waiting'])
  assert.equal(original.recipients.filter(r=>r.outcome==='accepted').length,1)
  assert.equal(original.recipients.filter(r=>r.outcome===null).length,1)
  assert.equal(original.calls.length,2)
  assert.equal(original.quietPolicy,policy.id)
  assert.equal(original.patientZone,'America/New_York')
  assert.deepEqual(original.quietPolicies.map(p=>[p.source,JSON.parse(p.intervals)]).sort(),[
   ['synthetic-balm-403 earlier reviewed policy',[{start:'21:00',end:'08:00'}]],
   ['synthetic-balm-404 current reviewed policy',[{start:'22:00',end:'08:00'},{start:'12:00',end:'13:00'}]],
  ])
  assert.ok(original.quietPolicies.every(p=>p.recorded_by===h.auth.OWNER_EMAIL&&p.recorded_at))
  assert.deepEqual(original.calls.map(c=>[c.direction,c.occurred_at,c.staff_id,c.staff_name,c.recorded_by,c.disposition]).sort(),[
   ['incoming','2000-01-02T03:00:00.000Z',desk.id,'Rosa',desk.email,'synthetic-balm-301 scheduling question'],
   ['outgoing','2000-01-03T04:00:00.000Z',desk.id,'Rosa',desk.email,'synthetic-balm-302 appointment confirmed'],
  ])
  assert.equal(original.audit.filter(a=>a.action==='call.logged').length,2)
  assert.equal(original.audit.filter(a=>a.action==='communication.call_read').length,2)
  const identity={auth:h.auth,owner:h.owner}
  await h.close();h=null
  const archive=join(temporary,'calls.rer')
  await command(source,['export','--output',archive,'--no-queue'])
  const archiveText=await readFile(archive,'utf8')
  for(const hash of bearerHashes)assert.ok(!archiveText.includes(hash),'offer capability hashes never enter the archive')
  await command(restored,['import','--input',archive,'--yes','--no-queue'])
  h=await harness({root:restored,...identity,codeSets:false})
  assert.deepEqual(await snapshot(h.db,patient.id),original,'every call field, patient zone, recorded quiet policy, waitlist preference, offer outcome and patient custody audit row survives unchanged')
  assert.equal((await h.send(path,undefined,identity.owner)).status,401,'archive does not transplant a live staff session')
  for(const stale of [offerPath,openOfferPath]){
   assert.equal((await h.send(stale)).status,404,'archive does not revive an offer bearer')
   assert.equal((await h.form(stale,{})).status,404,'an archived offer cannot place a booking')
  }
  const mailCount=h.mail.length
  await h.db.prepare("UPDATE bm_offers SET hold_until=? WHERE status='open'").bind(new Date(Date.now()-60000).toISOString()).run()
  await (await h.mf.getWorker()).scheduled({scheduledTime:Date.now(),cron:'* * * * *'})
  assert.equal(h.mail.length,mailCount,'restored historical queues never restart outbound offers')
  const cookie=await h.signIn(h.auth.OWNER_EMAIL)
  assert.deepEqual((await h.send(path,undefined,cookie)).value,history,'restored public call history is identical')
  await assert.rejects(h.db.prepare('UPDATE bm_calls SET disposition=? WHERE id=?').bind('Changed original',ids[0]).run(),/calls_are_health_records/)
  await assert.rejects(h.db.prepare('DELETE FROM bm_calls WHERE id=?').bind(ids[0]).run(),/calls_are_health_records/)
  await h.cmd('client.erase',{id:patient.id},cookie,409)
 }finally{await h?.close();await rm(temporary,{recursive:true,force:true,maxRetries:3,retryDelay:100})}
})

test('HIPAA-001: public CLI archive restores the readiness review and complete BAA history', {timeout:600000},async()=>{
 const temporary=await mkdtemp(join(tmpdir(),'balm-readiness-archive-')),source=join(temporary,'source'),restored=join(temporary,'restored')
 let h
 try{
  await checkout(source);await checkout(restored)
  h=await harness({root:source,migrate:true,codeSets:false,auth:{BALM_HOSTING_PROFILE:JSON.stringify(hostingProfile)}})
  const before=(await h.send('/api/balm/readiness.json',undefined,h.owner)).value
  assert.equal(before.ready,true)
  assert.equal(before.record.privacy_officer,'Synthetic Privacy Officer')
  assert.equal(before.record.risk_reviewed_on,'2026-10-01')
  assert.deepEqual(before.baas.map(b=>b.processor).sort(),['backups','clearinghouse','mail','scribe','sms'])
  const retired=await hostingFixture(h)
  await h.cmd('hosting.revoke',{id:retired.id})
  const current=await hostingFixture(h)
  await h.cmd('hosting.mode',patientMode('real',current.id))
  await h.cmd('readiness.baa.revoke',{id:before.baas.find(b=>b.processor==='sms').id})
  const original=(await h.send('/api/balm/readiness.json',undefined,h.owner)).value
  const identity={auth:h.auth,owner:h.owner}
  await h.close();h=null
  const archive=join(temporary,'readiness.rer')
  await command(source,['export','--output',archive,'--no-queue'])
  await command(restored,['import','--input',archive,'--yes','--no-queue'])
  h=await harness({root:restored,...identity,codeSets:false})
  const cookie=await h.signIn(h.auth.OWNER_EMAIL)
  const after=(await h.send('/api/balm/readiness.json',undefined,cookie)).value
  const {hosting:sourceHosting,...sourceRecord}=original,{hosting:restoredHosting,...restoredRecord}=after
  assert.deepEqual(restoredRecord,sourceRecord,'the public readiness export is byte-equivalent after the CLI archive round trip, including revoked agreement history')
  const evidence=records=>records.map(({qualification_present,...row})=>row)
  assert.deepEqual(evidence(restoredHosting.records),evidence(sourceHosting.records),'all hosting evidence and revocations survive unchanged')
  assert.equal(restoredHosting.mode,'blocked');assert.equal(restoredHosting.permitted,false)
  assert.ok(restoredHosting.records.every(r=>r.qualification_present===0),'historical evidence grants no deployment qualification')
  assert.equal((await h.cmd('client.save',{firstName:'Synthetic',lastName:'Restored'},cookie,409)).code,'hosting_readiness_required')
  await h.cmd('hosting.mode',patientMode('real',current.id),cookie,409)
  const modeAudit=await h.db.prepare("SELECT subject_id FROM bm_audit WHERE action='hosting.mode_changed' AND subject_id=?").bind(current.id).first()
  assert.equal(modeAudit.subject_id,current.id,'the old activation audit remains evidence only')
  const audits=(await h.db.prepare("SELECT action FROM bm_audit WHERE action LIKE 'readiness.%'").all()).results.map(r=>r.action)
  assert.ok(audits.includes('readiness.recorded')&&audits.includes('readiness.baa_recorded')&&audits.includes('readiness.baa_revoked'))
 }finally{if(h)await h.close();await rm(temporary,{recursive:true,force:true,maxRetries:3,retryDelay:100})}
})

test('denial appeal originals and complete adjudications survive public CLI archive round trip', {timeout:240000},async()=>{
 const {denialJourney}=await import('./denial-resolver-journey.mjs')
 const temporary=await mkdtemp(join(tmpdir(),'balm-denial-archive-')),source=join(temporary,'source'),restored=join(temporary,'restored')
 let h
 try{
  await checkout(source);await checkout(restored)
  h=await harness({root:source,migrate:true})
  const c=await denialJourney(h)
  await h.cmd('note_release.revoke',{id:c.packet.releaseId})
  const before=(await c.view()).appeals.find(a=>a.id===c.packet.id)
  const pdf=(await h.send('/api/balm/note-releases/'+c.packet.releaseId+'.pdf',undefined,h.owner)).text
  const adjudications=(await h.db.prepare('SELECT * FROM bm_cob_adjudications WHERE claim_id=? ORDER BY recorded_at,id').bind(c.claim.id).all()).results
  assert.equal(adjudications.length,2)
  const identity={auth:h.auth,owner:h.owner}
  await h.close();h=null
  const archive=join(temporary,'denial.rer.gz')
  await command(source,['export','--output',archive,'--no-queue'])
  await command(restored,['import','--input',archive,'--yes','--no-queue'])
  h=await harness({root:restored,...identity})
  const owner=await h.signIn(h.auth.OWNER_EMAIL)
  const after=(await h.send('/api/balm/cases',undefined,owner)).value.cases.find(a=>a.referral.id===c.referral.id).appeals.find(a=>a.id===c.packet.id)
  assert.deepEqual(after,before,'approved packet, all citations, authorization snapshot, digest and payment resolution survive restore')
  const originals=(await h.db.prepare("SELECT detail FROM bm_claim_events WHERE claim_id=? AND kind='835' ORDER BY created_at,id").bind(c.claim.id).all()).results.map(r=>JSON.parse(r.detail))
  assert.deepEqual(originals,c.originals,'every original adjudication field survives CLI restore')
  assert.deepEqual((await h.db.prepare('SELECT * FROM bm_cob_adjudications WHERE claim_id=? ORDER BY recorded_at,id').bind(c.claim.id).all()).results,adjudications,'all immutable coordination adjudication payloads survive CLI restore')
  assert.equal((await h.send('/api/balm/note-releases/'+c.packet.releaseId+'.pdf',undefined,owner)).text,pdf)
  const biller=await h.signIn('appealbiller@clinic.example')
  assert.equal((await h.send('/api/balm/note-releases/'+c.packet.releaseId+'.pdf',undefined,biller)).status,403,'revocation survives restore')
 }finally{if(h)await h.close();await rm(temporary,{recursive:true,force:true,maxRetries:3,retryDelay:100})}
})

test('booking prepayments and fixed receipts survive a public CLI archive round trip without bearer authority', {timeout:360000},async()=>{
 const temporary=await mkdtemp(join(tmpdir(),'balm-booking-archive-')),source=join(temporary,'source'),restored=join(temporary,'restored')
 let h
 try{
  await checkout(source);await checkout(restored)
  const {fakeProviders}=await import('./fakes/stripe.mjs'),stripe=fakeProviders()
  h=await harness({root:source,migrate:true,outbound:stripe.handler})
  const {bookingPrepaymentJourney}=await import('./booking-prepayment-journey.mjs')
  const {paid,receipt,client}=await bookingPrepaymentJourney(h,stripe)
  const bookingRows=(await h.db.prepare('SELECT * FROM bm_booking_payments ORDER BY id').all()).results
  const originalTokens=(await h.db.prepare('SELECT token_hash FROM bm_booking_payment_tokens').all()).results
  const identity={auth:h.auth,owner:h.owner}
  await h.close();h=null
  const archive=join(temporary,'booking.rer')
  await command(source,['export','--output',archive,'--no-queue'])
  const archiveText=await readFile(archive,'utf8')
  for(const t of originalTokens)assert.ok(!archiveText.includes(t.token_hash),'booking bearer hashes do not travel')
  await command(restored,['import','--input',archive,'--yes','--no-queue'])
  h=await harness({root:restored,...identity})
  const owner=await h.signIn(h.auth.OWNER_EMAIL)
  assert.equal((await h.send('/api/balm/receipts/'+paid.id+'.pdf',undefined,owner)).text,receipt.text)
  const restoredRows=(await h.db.prepare('SELECT * FROM bm_booking_payments ORDER BY id').all()).results
  assert.deepEqual(restoredRows.map(({checkout_url,...r})=>r),bookingRows.map(({checkout_url,...r})=>r))
  assert.ok(restoredRows.every(r=>r.checkout_url===null))
  assert.equal((await h.db.prepare('SELECT COUNT(*) AS n FROM bm_booking_payment_tokens').first()).n,0)
  assert.equal((await h.send('/api/balm/clients/'+client.id,undefined,owner)).value.billing.ledger.paymentsCents,15000)
 }finally{await h?.close();await rm(temporary,{recursive:true,force:true,maxRetries:3,retryDelay:100})}
})
