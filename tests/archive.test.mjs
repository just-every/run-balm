import { test } from 'node:test'
import assert from 'node:assert/strict'
import { cp, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { getPlatformProxy } from 'wrangler'
import { harness } from './harness.mjs'
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
test('public CLI archive round trip refuses damaged or populated stores and respects erasure', { timeout: 240_000 }, async () => {
  const temporary = await mkdtemp(join(tmpdir(),'balm-archive-')), source=join(temporary,'source'), restored=join(temporary,'restored'), erased=join(temporary,'erased'), refused=join(temporary,'refused')
  let h
  try {
    for (const path of [source,restored,erased,refused]) await checkout(path)
    await exec(process.execPath, [resolve('node_modules/wrangler/bin/wrangler.js'),'d1','migrations','apply','foundation','--local'], { cwd:source, env:{...process.env,CI:'true',WRANGLER_SEND_METRICS:'false'}, maxBuffer:2e6 })
    h=await harness({root:source})
    const p=await h.cmd('client.save',{firstName:'Temporary',lastName:'Enquiry',dateOfBirth:'2000-01-01'})
    const {service,practitioners:[priya]}=await clinic(h)
    await h.cmd('insurance.settings.save',{billingNpi:'1234567893',taxId:'123456789',address:'100 Main St',city:'Austin',state:'TX',postalCode:'78701',senderId:'BALMTEST',contactName:'Jordan Clinic',contactPhone:'5125550100'})
    const payer=await h.cmd('insurance.payer.save',{name:'Archive Health',payerId:'ARCHIVE',receiverId:'ARCHIVE'})
    const card='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl6V1sAAAAASUVORK5CYII='
    const insurance={insurancePayerId:payer.id,insuranceMemberId:'ARCHIVE-MEMBER',insuranceRelationship:'self',insurancePatientSex:'F',insuranceStartsOn:'2026-01-01',insuranceAddress:'200 Oak St',insuranceCity:'Austin',insuranceState:'TX',insurancePostalCode:'78701',insuranceFront:card,insuranceBack:card,identityPhoto:card}
    const booked=await bookOnline(h,service.id,priya.id,(await slots(h,service.id,priya.id))[0])
    const token=booked.location.match(/\/intake\/([\w-]+)/)[1]
    const intakePage=await h.send('/intake/'+token)
    assert.equal((await h.form('/intake/'+token,{formId:'intake-v1',q_reason:'Restored ankle sprain',q_emergency:'Kim 0400',q_consent:'yes',consentVersion:intakePage.text.match(/name="consentVersion" value="([^"]+)"/)[1],consentAccepted:'on',signerName:'Maya Lee',signerRelationship:'patient',signatureTyped:'Maya Lee',...insurance})).status,303)
    const maya=(await h.state()).clients.find(c=>c.first_name==='Maya')
    const visit=await pastVisit(h,maya.id,priya,service.id)
    await h.cmd('appointment.attend',{id:visit})
    await h.cmd('note.write',{clientId:maya.id,appointmentId:visit,body:'Restored treatment note'},priya.cookie)
    const invoice=await h.cmd('invoice.prepare',{appointmentId:visit})
    await h.cmd('invoice.approve',{id:invoice.id})
    await h.cmd('payment.record',{invoiceId:invoice.id,amountCents:9500,reference:'Backup-EFTPOS-1'})
    const csv=await readFile('tests/fixtures/cliniko-patients.csv','utf8'),preview=await h.cmd('import.preview',{csv})
    await h.cmd('import.apply',{csv,fingerprint:preview.fingerprint})
    await h.cmd('agent.create',{label:'Excluded secret'})
    const identity={auth:h.auth,owner:h.owner}
    await h.close();h=null
    const old=join(temporary,'before.rer'),later=join(temporary,'later.rer'),again=join(temporary,'again.rer')
    await command(source,['export','--output',old,'--no-queue'])
    const bytes=await readFile(old,'utf8');for(const kept of ['Temporary','Restored ankle sprain','Restored treatment note','Backup-EFTPOS-1','patients.csv','appointment.booked','client.imported'])assert.ok(bytes.includes(kept),kept);assert.ok(!bytes.includes('Excluded secret'));assert.ok(!bytes.includes('"token_hash"'))
    const rows=text=>text.split('\n').filter(Boolean).map(JSON.parse).filter(r=>r.kind==='part')
    assert.ok(rows(bytes).length>0)
    const corrupt=join(temporary,'corrupt.rer');await writeFile(corrupt,bytes.replace('Restored treatment note','Changed treatment note'),{mode:0o600})
    // Each pair owns independent stores. Keep all CLI cases with at most two children.
    // Checksum damage is a transfer failure (1); restore policy conflicts remain 4.
    await Promise.all([
      command(restored,['import','--input',old,'--yes','--no-queue']),
      command(erased,['import','--input',corrupt,'--yes','--no-queue'],1),
    ])
    await Promise.all([
      (async()=>{
        await command(restored,['export','--output',again,'--no-queue'])
        assert.deepEqual(rows(await readFile(again,'utf8')),rows(bytes))
        await command(restored,['import','--input',old,'--yes','--no-queue'],4)
      })(),
      (async()=>{
        h=await harness({root:source,...identity});await h.cmd('client.erase',{id:p.id},await h.signIn(h.auth.OWNER_EMAIL));await h.close();h=null
        await command(source,['export','--output',later,'--no-queue'])
      })(),
    ])
    await Promise.all([
      command(refused,['import','--input',old,'--journal',later,'--yes','--no-queue'],4),
      command(erased,['import','--input',later,'--yes','--no-queue']),
    ])
    const proxy=await getPlatformProxy({configPath:join(erased,'wrangler.jsonc'),persist:{path:join(erased,'.wrangler/state/v3')},remoteBindings:false})
    try { assert.equal((await proxy.env.DB.prepare('SELECT first_name FROM bm_clients WHERE id=?').bind(p.id).first()).first_name,'Erased') }
    finally { await proxy.dispose() }
  } finally { if(h)await h.close();await rm(temporary,{recursive:true,force:true}) }
})
