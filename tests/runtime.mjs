if (process.argv.includes('--owned-clean-start')) {
  await ownedCleanStart()
  process.exit(0)
}

import {queuedEntrypoint} from '@runeditrun/rer/queued-entry';
const queued=await queuedEntrypoint(import.meta.url,'verify:runtime');if(queued!==null)process.exit(queued);
import assert from 'node:assert/strict'
import { execFileSync, spawn } from 'node:child_process'
import { createServer } from 'node:net'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const socket = createServer()
await new Promise(resolve => socket.listen(0, '127.0.0.1', resolve))
const port = socket.address().port
await new Promise(resolve => socket.close(resolve))
// The installed homepage reads the claim state from D1: run the emitted Worker
// on its own migrated store, never the checkout's local data.
const persist = await mkdtemp(join(tmpdir(), 'foundation-runtime-'))
execFileSync(process.execPath, ['node_modules/wrangler/bin/wrangler.js', 'd1', 'migrations', 'apply', 'foundation', '--local', '--persist-to', persist, '--config', 'dist/server/wrangler.json'], { stdio: 'pipe', env: { ...process.env, CI: '1', WRANGLER_SEND_METRICS: 'false' } })
const worker = spawn(process.execPath, ['node_modules/wrangler/bin/wrangler.js', 'dev', '--inspector-port', '0', '--local', '--persist-to', persist, '--ip', '127.0.0.1', '--config', 'dist/server/wrangler.json', '--port', String(port)], { stdio: ['ignore', 'pipe', 'pipe'] })
let output = ''
worker.stdout.on('data', chunk => { output += chunk })
worker.stderr.on('data', chunk => { output += chunk })
const origin = `http://127.0.0.1:${port}`
try {
  let ready = false
  for (let attempt = 0; attempt < 120; attempt++) {
    if (worker.exitCode !== null) throw new Error(output)
    try { ready = (await fetch(`${origin}/health`)).ok } catch {}
    if (ready) break
    await new Promise(resolve => setTimeout(resolve, 250))
  }
  assert.ok(ready, output)
  const health = await (await fetch(`${origin}/health`)).json()
  assert.equal(health.status, 'ok')
  assert.equal(health.ok, true)
  assert.deepEqual(Object.keys(health.deployment ?? {}).sort(), ['fingerprint', 'sourceSha', 'versionId'])
  const document = await fetch(origin)
  assert.equal(document.status, 200)
  const branding = JSON.parse(await readFile(new URL('../src/branding.json', import.meta.url)))
  assert.ok((await document.text()).includes(branding.name))
  for (const path of ['/missing', '/health/extra', '/api', '/api/missing']) {
    assert.equal((await fetch(`${origin}${path}`)).status, 404, path)
  }
  console.log('HTTP-001 passed against emitted local Worker: health, the installed homepage, HTTP and document 404s')
} finally {
  worker.kill('SIGTERM')
  await new Promise(resolve => worker.exitCode !== null ? resolve() : worker.once('exit', resolve))
  await rm(persist, { recursive: true, force: true })
}


/** OWN-001: a committed clean checkout, real CLI lifecycle and local clinic loop.
 * The runner has installed the pinned tools and populated its package cache.
 * Observe install/setup/dev and every descendant at the OS socket edge, including requests
 * whose failures application code catches. No network payloads or CLI links are
 * retained. Run on Linux with strace in the nightly/release tier, never push Verify.
 */
async function ownedCleanStart() {
  const { execFile } = await import('node:child_process')
  const { promisify } = await import('node:util')
  const { mkdir } = await import('node:fs/promises')
  const { once } = await import('node:events')
  const { chromium } = await import('@playwright/test')
  const { resolve } = await import('node:path')
  const exec = promisify(execFile)
  assert.equal(process.platform, 'linux', 'OWN-001 socket observation requires Linux and strace')
  await exec('strace', ['--version'])
  assert.equal((await exec('git', ['status', '--porcelain'])).stdout.trim(), '', 'run the committed candidate')
  const sha = (await exec('git', ['rev-parse', 'HEAD'])).stdout.trim()
  const temporary = await mkdtemp(join(tmpdir(), 'balm-owned-'))
  const checkout = join(temporary, 'checkout'), trace = join(temporary, 'connections')
  const cli = resolve('node_modules/@runeditrun/rer/global/rer.mjs')
  // Rer's documented small-CI-runner floor; no product or network gate changes.
  const env = { ...process.env, CI: 'true', RER_SERVERS_DISK_FLOOR_GIB: '4' }
  // This checkout owns its lifecycle, independently of a parent verification job.
  delete env.RER_LOCAL_OPERATION
  delete env.RER_LOCAL_STATE_PATH
  delete env.RER_JOB_POLICY
  let child, browser
  // Minimal containers may not reap orphaned grandchildren at PID 1. Give this
  // journey its own init role so the unmodified CLI can confirm child cleanup.
  // -D keeps the traced CLI as the wrapper's direct child, preserving ancestry.
  const reaper = `import ctypes, os, signal, subprocess, sys
if ctypes.CDLL(None, use_errno=True).prctl(36, 1, 0, 0, 0) != 0:
    raise OSError(ctypes.get_errno(), 'cannot establish child subreaper')
child = subprocess.Popen(sys.argv[1:])
def forward(signum, frame):
    try: os.kill(child.pid, signum)
    except ProcessLookupError: pass
signal.signal(signal.SIGTERM, forward)
signal.signal(signal.SIGINT, forward)
result = None
while True:
    try: pid, status = os.waitpid(-1, 0)
    except ChildProcessError: break
    if pid == child.pid: result = os.waitstatus_to_exitcode(status)
sys.exit(result if result is not None and result >= 0 else 1)
`
  const traced = args => spawn('python3', ['-c', reaper, 'strace', '-D', '-f', '--seccomp-bpf', '-qq', '-s', '0', '-e', 'trace=connect,sendto,sendmsg,sendmmsg', '-o', trace, process.execPath, cli, ...args], { cwd: checkout, env, stdio: ['ignore','pipe','pipe'] })
  const capture = child => {
    let output = ''
    child.stdout.on('data', data => { output += data })
    child.stderr.on('data', data => { output += data })
    return () => output
  }
  const assertLocal = async (label, requireActivity = true) => {
    const lines = (await readFile(trace, 'utf8')).split('\n').filter(line => /AF_INET6?/.test(line))
    if(requireActivity) assert.ok(lines.length, label + ': positive control observed real IP socket activity')
    // Both successful and refused connection attempts count. AF_UNIX is local;
    // destination-free sends use a socket whose connect is already in the trace.
    const foreign = lines.filter(line => !/inet_addr\("127\.[0-9.]+"\)|inet_pton\(AF_INET6, "(?:::1|::ffff:127\.[0-9.]+)"/.test(line))
    assert.deepEqual(foreign, [], label + ': no non-loopback network attempt')
    return lines.length
  }
  try {
    await mkdir(checkout)
    await exec('git', ['archive', '--format=tar', '--output=' + join(temporary,'source.tar'), sha])
    await exec('tar', ['-xf', join(temporary,'source.tar'), '-C', checkout])
    // No copied database, private settings, dependency links or build output.
    child = traced(['install'])
    capture(child)
    const installTimeout=setTimeout(()=>child.kill('SIGTERM'),300_000)
    const [installCode] = await once(child,'exit');clearTimeout(installTimeout);child=undefined
    assert.equal(installCode,0,'rer install from the runner’s pre-populated pinned dependency cache')
    const installConnections=await assertLocal('clean-checkout install', false)
    console.log('OWN-001: cached clean-checkout install passed; observing setup')
    child = traced(['setup', '--owner-email', 'owner@clinic.example', '--non-interactive'])
    const setupOutput = capture(child)
    const setupTimeout = setTimeout(() => child.kill('SIGTERM'), 300_000)
    const [setupCode] = await once(child, 'exit')
    clearTimeout(setupTimeout)
    child = undefined
    if(setupCode !== 0) {
      const log=await readFile(join(checkout,'.seed/installer/install.log'),'utf8').catch(()=>'')
      console.error(log.split('\n').filter(line=>/error|failed|exception|cause|cannot|ERR_|at /i.test(line) && !/token|secret|password|RER_OPEN/i.test(line)).map(line=>line.replace(/https?:\/\/\S+/g,'[url]')).slice(-30).join('\n'))
    }
    if(setupCode !== 0) console.error(setupOutput().split('\n').filter(line => /error|failed|cannot|ERR_/i.test(line) && !/token|secret|password|RER_OPEN/i.test(line)).map(line => line.replace(/https?:\/\/\S+/g,'[url]')).slice(-12).join('\n'))
    assert.equal(setupCode, 0, 'rer setup failed')
    assert.ok(setupOutput().length, 'setup command ran')
    const setupConnections = await assertLocal('clean-checkout setup')
    console.log('OWN-001: clean-checkout setup passed; observing dev and clinic loop')
    child = traced(['dev', '--foreground'])
    const output = capture(child)
    const deadline = Date.now() + 300_000
    while (!/RER_OPEN https?:\/\/\S+/.test(output()) && Date.now() < deadline && child.exitCode === null) await new Promise(r => setTimeout(r,250))
    const open = output().match(/RER_OPEN (https?:\/\/\S+)/)?.[1]
    if(!open) console.error(output().split('\n').filter(line=>!/(?:token|secret|password|RER_OPEN)/i.test(line)).map(line=>line.replace(/https?:\/\/\S+/g,'[url]')).slice(-30).join('\n'))
    assert.ok(open, 'rer dev must produce the documented owner entry')
    const origin = new URL(open).origin
    browser = await chromium.launch({headless:true,args:['--use-mock-keychain','--password-store=basic']})
    const context = await browser.newContext()
    const browserRequests = []
    await context.route('**/*', async route => {
      const request = route.request(), url = new URL(request.url())
      browserRequests.push(url.origin)
      if (url.origin !== origin) return route.abort()
      return route.continue()
    })
    const page = await context.newPage()
    page.on('websocket',socket=>{ const url=new URL(socket.url());url.protocol=url.protocol==='wss:'?'https:':'http:';browserRequests.push(url.origin) })
    await page.goto(open)
    await page.getByRole('button',{name:'Set up authenticator',exact:true}).click()
    const authenticatorSecret=await page.locator('[data-mfa-secret] code').textContent()
    const {authenticatorCode}=await import('./staff-second-step.mjs')
    await page.locator('[name=code]').fill(authenticatorCode(authenticatorSecret))
    await page.getByRole('button',{name:'Verify second step',exact:true}).click()
    await page.getByRole('link',{name:'Open Balm',exact:true}).click()
    await page.locator('input[name=confirm]').check()
    await page.getByRole('button',{name:'Finish setup',exact:true}).click()
    await page.locator('[name=clinicName]').fill('Synthetic Therapy Clinic')
    await page.locator('[name=timeZone]').selectOption('America/Chicago')
    await page.getByRole('button',{name:'Save and open the schedule',exact:true}).click()
    await page.waitForURL(/\/app$/)
    const send = async (path, body) => {
      const response = await context.request.fetch(origin + path, { method: body === undefined ? 'GET' : 'POST', headers: { origin }, ...(body === undefined ? {} : {data:body}), maxRedirects:0 })
      const text = await response.text()
      let value; try { value=JSON.parse(text) } catch { value=text }
      return {status:response.status(),text,value,headers:response.headers()}
    }
    const cmd = async (name,input) => {
      const result = await send('/api/balm/command',{name,input})
      assert.equal(result.status,200,name + ': '+result.text)
      return result.value.result
    }
    assert.equal((await send('/api/balm/state')).value.settings.time_zone,'America/Chicago','the browser saved the first-run clinic settings')
    const practitioner = await cmd('staff.save',{name:'Jordan Lee',email:'owner@clinic.example',role:'practitioner',profession:'Physical Therapist',discipline:'pt',active:true})
    const service = await cmd('service.save',{name:'Therapy visit',durationMinutes:45,priceCents:9500})
    await cmd('hours.save',{practitionerId:practitioner.id,hours:[0,1,2,3,4,5,6].map(weekday=>({weekday,start:'00:00',end:'24:00'}))})
    const from = new Date(Date.now()+3*86400_000).toISOString().slice(0,10)
    const choices = await send(`/book?serviceId=${service.id}&practitionerId=${practitioner.id}&from=${from}`)
    assert.equal(choices.status,200)
    const start=decodeURIComponent(choices.text.match(/start=([0-9T%A-Z.-]+Z)/)[1])
    const booking=await context.request.post(origin+'/book',{headers:{origin},form:{serviceId:service.id,practitionerId:practitioner.id,start,firstName:'Synthetic',lastName:'Patient',dateOfBirth:'1988-04-02',email:'synthetic@patient.example',privacy:'on'},maxRedirects:0})
    assert.equal(booking.status(),303)
    const intake=booking.headers().location
    assert.match(intake,/^\/intake\//)
    const form=await send(intake)
    const submitted=await context.request.post(origin+intake.split('?')[0],{headers:{origin},form:{formId:'intake-v1',q_reason:'Synthetic clinic loop',q_emergency:'Synthetic contact',q_consent:'yes',consentVersion:form.text.match(/name="consentVersion" value="([^"]+)"/)[1],consentAccepted:'on',signerName:'Synthetic Patient',signerRelationship:'patient',signatureTyped:'Synthetic Patient'},maxRedirects:0})
    assert.equal(submitted.status(),303)
    const state=(await send('/api/balm/state')).value
    const patient=state.clients.find(c=>c.first_name==='Synthetic')
    const zone='America/Chicago'
    let past=Date.now()-3*3600_000
    const clock=t=>new Intl.DateTimeFormat('en-GB',{timeZone:zone,hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).format(t)
    if(clock(past)>'21:00')past-=3*3600_000
    const visit=await cmd('appointment.book',{clientId:patient.id,practitionerId:practitioner.id,serviceId:service.id,date:new Intl.DateTimeFormat('en-CA',{timeZone:zone,year:'numeric',month:'2-digit',day:'2-digit'}).format(past),time:clock(past)})
    await cmd('appointment.attend',{id:visit.appointmentId})
    const note=await cmd('note.write',{clientId:patient.id,appointmentId:visit.appointmentId,body:'Synthetic initial note'})
    await cmd('note.amend',{id:note.id,revision:1,body:'Synthetic revised note'})
    const invoice=await cmd('invoice.prepare',{appointmentId:visit.appointmentId})
    await cmd('invoice.approve',{id:invoice.id})
    await cmd('payment.record',{invoiceId:invoice.id,amountCents:9500,reference:'synthetic-balm-1'})
    assert.equal((await send('/api/balm/state')).value.invoices.find(i=>i.id===invoice.id).paid_cents,9500)
    const file=(await send('/api/balm/clients/'+patient.id)).value
    assert.equal(file.intake[0].answers.reason,'Synthetic clinic loop')
    assert.deepEqual(file.notes[0].revisions.map(r=>[r.number,r.body]),[[2,'Synthetic revised note'],[1,'Synthetic initial note'],[0,'']])
    const issued=await send('/api/balm/invoices/'+invoice.id+'.html')
    assert.equal(issued.status,200);assert.match(issued.text,/INV-000001/)
    const shots=process.env.BALM_UI_SCREENSHOTS
    if(shots)await mkdir(shots,{recursive:true})
    for(const [name,path] of [['schedule','/app'],['patient','/app/clients/'+patient.id],['invoice','/app/invoices'],['booking','/book'],['intake',intake]]) {
      await page.goto(origin+path)
      for(const width of [1440,390]) {
        await page.setViewportSize({width,height:1000})
        assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),name+' fits '+width)
        if(shots)await page.screenshot({path:join(shots,'OWN-001-'+name+'-'+width+'.png')})
      }
    }
    assert.ok(browserRequests.length>0)
    assert.deepEqual([...new Set(browserRequests)],[origin],'all browser requests stay within this install')
    await browser.close();browser=undefined
    // Stop this journey's CLI by saved PID; its normal cleanup owns its workers.
    child.kill('SIGTERM')
    await once(child,'exit');child=undefined
    const devConnections=await assertLocal('clean-checkout dev and clinic loop')
    console.log(`OWN-001 clean start passed at ${sha}: rer install/setup/dev, booking/intake/note revision/invoice/payment; ${installConnections} install, ${setupConnections} setup and ${devConnections} dev/clinic local socket attempts; zero external attempts; browser at 1440/390. HIPAA-005 remains separate.`)
  } finally {
    if(browser)await browser.close()
    if(child && child.exitCode===null) { child.kill('SIGTERM');await once(child,'exit') }
    await rm(temporary,{recursive:true,force:true,maxRetries:3,retryDelay:100})
  }
}
