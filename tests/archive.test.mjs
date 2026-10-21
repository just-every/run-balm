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
import { fakeBucket } from './fakes/s3.mjs'
import { generateBackupKeys } from '../src/balm/backup/envelope.mjs'
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
    await h.cmd('scribe.save',{provider:'anthropic',key:'synthetic-balm-3'})
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


test('CHART-006 recorded diagnoses and CMS tie choice survive a public CLI archive with signed units and fixed invoice bytes', { timeout: 120_000 }, async () => {
  const temporary=await mkdtemp(join(tmpdir(),'balm-tie-archive-')),source=join(temporary,'source'),restored=join(temporary,'restored')
  let h
  try {
    for(const path of [source,restored])await checkout(path)
    await exec(process.execPath,[resolve('node_modules/wrangler/bin/wrangler.js'),'d1','migrations','apply','foundation','--local'],{cwd:source,env:{...process.env,CI:'true',WRANGLER_SEND_METRICS:'false'},maxBuffer:2e6})
    h=await harness({root:source})
    const {service,practitioners:[priya]}=await clinic(h)
    const patient=await h.cmd('client.save',{firstName:'Synthetic',lastName:'Tie choice',dateOfBirth:'1980-01-01'})
    const visit=await pastVisit(h,patient.id,priya,service.id)
    await h.cmd('appointment.attend',{id:visit})
    await h.cmd('pay.codes.save',{appointmentId:visit,icd10:'M25.561, M54.50'})
    const note=await h.cmd('note.write',{clientId:patient.id,appointmentId:visit,body:'Synthetic clinician-selected manual therapy unit.',charges:[{code:'97110',minutes:8,diagnosisCodes:['M25.561']},{code:'97140',minutes:8,cmsTieChosen:true,diagnosisCodes:['M54.50']}]},priya.cookie)
    await h.cmd('note.sign',{id:note.id,revision:1,signature:'Priya',credentials:'PT',attest:true},priya.cookie)
    const invoice=await h.cmd('invoice.prepare',{appointmentId:visit})
    assert.deepEqual(invoice.snapshot.procedures.map(p=>p.units),[0,1])
    await h.cmd('invoice.approve',{id:invoice.id})
    const original=(await h.send('/api/balm/invoices/'+invoice.id+'.html',undefined,h.owner)).text
    const identity={auth:h.auth,owner:h.owner}
    await h.close();h=null
    const archive=join(temporary,'tie.rer')
    await command(source,['export','--output',archive,'--no-queue'])
    await command(restored,['import','--input',archive,'--yes','--no-queue'])
    h=await harness({root:restored,...identity})
    const clinician=await h.signIn('priya@clinic.example')
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
  } finally {if(h)await h.close();await rm(temporary,{recursive:true,force:true,maxRetries:3,retryDelay:100})}
})


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
    await exec(process.execPath, [resolve('node_modules/wrangler/bin/wrangler.js'), 'd1', 'migrations', 'apply', 'foundation', '--local'], { cwd: source, env: { ...process.env, CI: 'true', WRANGLER_SEND_METRICS: 'false' }, maxBuffer: 2e6 })
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
  await exec(process.execPath,[resolve('node_modules/wrangler/bin/wrangler.js'),'d1','migrations','apply','foundation','--local'],{cwd:source,env:{...process.env,CI:'true',WRANGLER_SEND_METRICS:'false'},maxBuffer:2e6})
  h=await harness({root:source})
  const {service,practitioners:[priya]}=await clinic(h)
  const student=await h.staff('ArchiveStudent','student',{supervisorId:priya.id,credentials:'SPT'})
  await h.cmd('hours.save',{practitionerId:student.id,hours:[0,1,2,3,4,5,6].map(weekday=>({weekday,start:'00:00',end:'24:00'}))})
  const patient=await h.cmd('client.save',{firstName:'Synthetic',lastName:'Portability',dateOfBirth:'1980-01-01',email:'portable@patient.example'})
  const visit=await pastVisit(h,patient.id,student,service.id)
  const note=await h.cmd('note.write',{clientId:patient.id,appointmentId:visit,body:'Synthetic portable supervised care'},student.cookie)
  await h.cmd('note.submit',{id:note.id,revision:1,signature:'ArchiveStudent',credentials:'SPT',attest:true},student.cookie)
  await h.cmd('note.cosign',{id:note.id,revision:1,signature:'Priya',credentials:'PT',attest:true},priya.cookie)
  const today=new Date(Date.now()+10*3600000).toISOString().slice(0,10)
  const request=await h.cmd('estimate.request',{clientId:patient.id,coverageKind:'self_pay',coverageAttestation:'Patient elected self-pay',attest:true})
  const prepared=await h.cmd('estimate.prepare',{requestId:request.id,fromOn:today,throughOn:today,lines:[{serviceId:service.id,quantity:1}],attest:true})
  const estimate=await h.cmd('estimate.issue',{id:prepared.id,sha256:prepared.sha256,attest:true})
  const original=(await h.send('/api/balm/estimates/'+estimate.id+'.pdf',undefined,h.owner)).text
  const packet=await h.cmd('intake.prepare',{title:'Portable LEFS packet',serviceId:service.id,questions:[{id:'reason',label:'Reason',type:'short',required:true}],instruments:[{kind:'lefs',items:Array.from({length:20},(_,i)=>'Synthetic item '+i)}]})
  const form=await h.cmd('intake.publish',{id:packet.id})
  const booked=await bookOnline(h,service.id,priya.id,(await slots(h,service.id,priya.id))[0],{firstName:'Synthetic',lastName:'Portability',dateOfBirth:'1980-01-01',email:'portable@patient.example'})
  const path=booked.location.split('?')[0],page=await h.send(path)
  const fields={formId:form.id,q_reason:'Synthetic portable answer',consentVersion:page.text.match(/name="consentVersion" value="([^"]+)"/)[1],consentAccepted:'on',signerName:'Synthetic Portability',signerRelationship:'patient',signatureTyped:'Synthetic Portability'}
  for(let i=1;i<=20;i++)fields['q_out_lefs_'+i]='3'
  assert.equal((await h.form(path,fields)).status,303)
  const auth=h.auth,ownerSession=h.owner
  await h.close();h=null
  const archive=join(temporary,'clinic.rer')
  await command(source,['export','--output',archive,'--no-queue'])
  await command(restored,['import','--input',archive,'--yes','--no-queue'])
  h=await harness({root:restored,auth,owner:ownerSession})
  const owner=await h.signIn(auth.OWNER_EMAIL),cookie=await h.signIn('archivestudent@clinic.example')
  const file=await h.send('/api/balm/clients/'+patient.id,undefined,owner)
  assert.equal(file.status,200,file.text)
  const fixed=file.value.notes.find(n=>n.id===note.id)
  assert.equal(fixed.signature.name,'Priya');assert.equal(fixed.submissions[0].author_name,'ArchiveStudent');assert.equal(fixed.submissions[0].decision,'cosigned')
  assert.equal(file.value.intake[0].scores[0].score,60);assert.equal(file.value.intake[0].formNumber,form.number)
  assert.equal((await h.send('/api/balm/estimates/'+estimate.id+'.pdf',undefined,owner)).text,original)
  await h.cmd('note.sign',{id:note.id,revision:1,signature:'ArchiveStudent',attest:true},cookie,403)
 } finally {await h?.close();await rm(temporary,{recursive:true,force:true})}
})
