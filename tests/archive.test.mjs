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
test('CHART-006 INS-001 AGENT-003 PAY-004 HIPAA-002 COMM-001 SCHED-003 SCHED-009 HIPAA-003 CHART-010 CHART-009: public CLI archive round trip refuses damaged or populated stores and respects erasure', { timeout: 240_000 }, async () => {
  const temporary = await mkdtemp(join(tmpdir(),'balm-archive-')), source=join(temporary,'source'), restored=join(temporary,'restored'), erased=join(temporary,'erased'), refused=join(temporary,'refused')
  let h
  try {
    for (const path of [source,restored,erased,refused]) await checkout(path)
    await exec(process.execPath, [resolve('node_modules/wrangler/bin/wrangler.js'),'d1','migrations','apply','foundation','--local'], { cwd:source, env:{...process.env,CI:'true',WRANGLER_SEND_METRICS:'false'}, maxBuffer:2e6 })
    const webhookKey='whsec_'+randomBytes(32).toString('base64')
    h=await harness({root:source,outbound:modelEdge().outbound,auth:{BALM_RESEND_WEBHOOK_KEY:webhookKey,BALM_RESEND_EVENT_NAMESPACE:'archive-clinic-account'}})
    const p=await h.cmd('client.save',{firstName:'Temporary',lastName:'Enquiry',dateOfBirth:'2000-01-01'})
    const {service,practitioners:[priya]}=await clinic(h)
    await h.cmd('insurance.settings.save',{billingNpi:'1234567893',taxId:'123456789',address:'100 Main St',city:'Austin',state:'TX',postalCode:'78701',senderId:'BALMTEST',contactName:'Jordan Clinic',contactPhone:'5125550100'})
    const payer=await h.cmd('insurance.payer.save',{name:'Archive Health',payerId:'ARCHIVE',receiverId:'ARCHIVE',unitMethod:'fixed',fixedUnitMinutes:15})
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
    const visit=await pastVisit(h,maya.id,priya,service.id)
    await h.cmd('appointment.attend',{id:visit})
    const checkedNote=await h.cmd('note.write',{clientId:maya.id,appointmentId:visit,body:'Restored treatment note'},priya.cookie)
    await h.cmd('scribe.save',{provider:'anthropic',key:'sk-ant-archive-test'})
    const noteCheck=await h.cmd('note.check',{id:checkedNote.id,revision:1},priya.cookie)
    const invoice=await h.cmd('invoice.prepare',{appointmentId:visit})
    await h.cmd('invoice.approve',{id:invoice.id})
    await h.cmd('payment.record',{invoiceId:invoice.id,amountCents:9500,reference:'Backup-EFTPOS-1'})
    const external=await h.cmd('pay.entry.prepare',{clientId:maya.id,kind:'credit',amount:'30.00',reason:'Archived external prepayment',reference:'Archive-external-30',occurredOn:'2001-01-02'})
    await h.cmd('pay.entry.approve',{id:external.id,sha256:external.sha256,attest:true})
    const externalReceipt=(await h.send('/api/balm/receipts/'+external.id+'.pdf',undefined,h.owner)).text
    const csv=await readFile('tests/fixtures/cliniko-patients.csv','utf8'),preview=await h.cmd('import.preview',{csv})
    await h.cmd('import.apply',{csv,fingerprint:preview.fingerprint})
    await h.cmd('disclosure.record',{clientId:maya.id,recipient:'Attorney Archive, records@example.test',purpose:'Patient-directed release',basis:'Written authorization',records:'Signed treatment note and intake',releasedAt:'2001-01-02T12:00:00Z'})
    await h.cmd('client.alert.save',{clientId:maya.id,kind:'precaution',text:'Archive weight-bearing restriction'})
    await h.cmd('holiday.save',{date:'2099-11-26',name:'Thanksgiving clinic closure'})
    const chartDocument=await h.cmd('chart.document.upload',mriUpload(maya.id,'2026-10-01'))
    await h.cmd('agent.create',{label:'Excluded secret'})
    const feed=await h.cmd('calendar.feed.create',{},priya.cookie)
    const feedToken=feed.calendarFeedPath.split('/')[2].split('.')[0]
    const retentionPatient=await h.cmd('client.save',{firstName:'Retained',lastName:'Historical',dateOfBirth:'1950-01-01'})
    const retentionVisit=await pastVisit(h,retentionPatient.id,priya,service.id,h.owner,12)
    await h.db.prepare('UPDATE bm_appointments SET start_at=?,end_at=? WHERE id=?').bind('1990-01-02T02:00:00.000Z','1990-01-02T02:45:00.000Z',retentionVisit).run()
    const identity={auth:h.auth,owner:h.owner}
    await h.close();h=null
    const old=join(temporary,'before.rer'),beforeDestruction=join(temporary,'before-destruction.rer'),later=join(temporary,'later.rer'),again=join(temporary,'again.rer')
    await command(source,['export','--output',old,'--no-queue'])
    const bytes=await readFile(old,'utf8');for(const kept of ['Thanksgiving clinic closure','Temporary','Restored ankle sprain','Restored treatment note','Backup-EFTPOS-1','patients.csv','appointment.booked','client.imported','Attorney Archive','disclosure.recorded','Archive weight-bearing restriction','knee-MRI-report.pdf','chart.document_uploaded',mriReport().toString('base64')])assert.ok(bytes.includes(kept),kept);assert.ok(!bytes.includes('Excluded secret'));assert.ok(!bytes.includes(feedToken));assert.ok(!bytes.includes('"token_hash"'))
    const rows=text=>text.split('\n').filter(Boolean).map(JSON.parse).filter(r=>r.kind==='part')
    assert.ok(rows(bytes).length>0)
    const corrupt=join(temporary,'corrupt.rer');await writeFile(corrupt,bytes.replace('Restored treatment note','Changed treatment note'),{mode:0o600})
    // Each pair owns independent stores. Keep all CLI cases with at most two children.
    // Checksum damage is a transfer failure (1); restore policy conflicts remain 4.
    await Promise.all([
      command(restored,['import','--input',old,'--yes','--no-queue']),
      (async()=>{
        await command(erased,['import','--input',corrupt,'--yes','--no-queue'],1)
        await command(source,['import','--input',old,'--yes','--no-queue'],4)
      })(),
    ])
    await Promise.all([
      command(restored,['export','--output',again,'--no-queue']),
      (async()=>{
        h=await harness({root:source,...identity});await h.cmd('client.erase',{id:p.id},await h.signIn(h.auth.OWNER_EMAIL));await h.close();h=null
        await command(source,['export','--output',beforeDestruction,'--no-queue'])
        h=await harness({root:source,...identity})
        const ownerCookie=await h.signIn(h.auth.OWNER_EMAIL)
        await h.cmd('client.erase',{id:retentionPatient.id},ownerCookie,409)
        await h.cmd('retention.save',{state:'AZ'},ownerCookie)
        const destruction=await h.cmd('retention.preview',{clientId:retentionPatient.id},ownerCookie)
        await h.cmd('retention.destroy',{previewId:destruction.previewId,digest:destruction.digest,confirm:true},ownerCookie)
        await h.cmd('client.save',{firstName:'Retained',lastName:'Historical',dateOfBirth:'1950-01-01'},ownerCookie,409)
        await h.close();h=null
        await command(source,['export','--output',later,'--no-queue'])
      })(),
    ])
    assert.deepEqual(rows(await readFile(again,'utf8')),rows(bytes))
    await Promise.all([
      command(refused,['import','--input',old,'--journal',later,'--yes','--no-queue'],4),
      command(erased,['import','--input',later,'--yes','--no-queue']),
    ])
    // This archive was made after ordinary erasure, so only HIPAA-002's later
    // destruction can cause this refusal; the empty store remains unchanged.
    await command(refused,['import','--input',beforeDestruction,'--journal',later,'--yes','--no-queue'],4)
    const restoredClinic=await harness({root:restored,...identity})
    try {
      const cookie=await restoredClinic.signIn(restoredClinic.auth.OWNER_EMAIL)
      const checkedFile=await restoredClinic.send('/api/balm/clients/'+maya.id,undefined,cookie)
      assert.deepEqual(checkedFile.value.notes.find(n=>n.id===checkedNote.id).defensibility,noteCheck,'AGENT-003 preserves original questions, sources and revision through CLI archive restore')
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
    const proxy=await getPlatformProxy({configPath:join(erased,'wrangler.jsonc'),persist:{path:join(erased,'.wrangler/state/v3')},remoteBindings:false})
    try { assert.equal((await proxy.env.DB.prepare('SELECT first_name FROM bm_clients WHERE id=?').bind(p.id).first()).first_name,'Erased');assert.equal((await proxy.env.DB.prepare('SELECT COUNT(*) n FROM bm_clients WHERE id=?').bind(retentionPatient.id).first()).n,0,'HIPAA-002 destroyed patient cannot return in a later restored archive') }
    finally { await proxy.dispose() }
  // macOS can add .DS_Store during removal; only filesystem cleanup is retried.
  } finally { if(h)await h.close();await rm(temporary,{recursive:true,force:true,maxRetries:3,retryDelay:100}) }
})
