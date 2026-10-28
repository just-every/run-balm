import {smsAuth,quietPolicy} from './sms-quiet-journey.mjs'
import {fakeProviders} from './fakes/stripe.mjs'
import assert from 'node:assert/strict'
import {execFileSync} from 'node:child_process'
import {mkdir} from 'node:fs/promises'
import {chromium} from '@playwright/test'
import {harness} from './harness.mjs'
import {communicationFixture} from './communication-journey.mjs'

const head=execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim()
const root=process.env.BALM_UI_SCREENSHOTS
assert.ok(root);await mkdir(root,{recursive:true})
const browser=await chromium.launch({headless:true,...(process.env.BALM_CHROMIUM?{executablePath:process.env.BALM_CHROMIUM}:{}),args:['--no-sandbox','--use-mock-keychain','--password-store=basic']})
const sms=fakeProviders()
const h=await harness({browserHttps:true,auth:smsAuth,outbound:sms.handler})
let context
try {
 const c=await communicationFixture(h)
 await h.cmd('message.send',{clientId:c.patient.id,recipient:c.priya.id,body:'Shoulder secure conversation',delivery:'shown'},c.priya.cookie)
 context=await browser.newContext({ignoreHTTPSErrors:true,viewport:{width:1440,height:1000}})
 for(const [pattern,path,type] of [['**/rer-theme.css','public/rer-theme.css','text/css'],['**/fonts/fonts.css','public/fonts/fonts.css','text/css'],['**/brand/mark.svg','public/brand/mark.svg','image/svg+xml']])await context.route(pattern,r=>r.fulfill({path,contentType:type}))
 await context.route('**/fonts/**/*.woff2',r=>r.fulfill({path:'public'+new URL(r.request().url()).pathname,contentType:'font/woff2'}))
 const login=async cookie=>{const [name,...parts]=cookie.split('=');await context.clearCookies();await context.addCookies([{name,value:parts.join('='),url:h.origin,secure:true}])}
 const page=await context.newPage()
 const fonts=await context.newCDPSession(page)
 await fonts.send('DOM.enable');await fonts.send('CSS.enable')
 const capture=async(name,width,anchor='#communications')=>{
  await page.setViewportSize({width,height:1000})
  await page.locator(anchor).scrollIntoViewIfNeeded()
  await page.evaluate(()=>document.fonts.ready)
  if(width===1440){
   const {root:document}=await fonts.send('DOM.getDocument')
   const {nodeId}=await fonts.send('DOM.querySelector',{nodeId:document.nodeId,selector:anchor.startsWith('#')?anchor+' h2':'h1'})
   console.log(name+' rendered fonts '+JSON.stringify((await fonts.send('CSS.getPlatformFontsForNode',{nodeId})).fonts.map(f=>({family:f.familyName,custom:f.isCustomFont,glyphs:f.glyphCount}))))
  }
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),name+' fits '+width)
  const icons=await page.locator('button,a,label[for]').evaluateAll(els=>els.filter(el=>el.getBoundingClientRect().width&&el.getBoundingClientRect().height&&!el.textContent.trim()&&el.querySelector('svg')).map(el=>({label:el.getAttribute('aria-label'),tooltip:!!el.querySelector('[role=tooltip]')})))
  assert.ok(icons.every(el=>el.tooltip),'icon-only controls have tooltips: '+JSON.stringify(icons))
  await page.screenshot({path:root+'/'+name+'-'+width+'.png'})
 }
 await login(c.priya.cookie);await page.goto(h.origin+'/app/clients/'+c.patient.id+'#communications')
 await page.getByText('Log a call',{exact:true}).click()
 const form=page.locator('form[action*="call.log"]')
 await form.locator('[name=recipient]').selectOption(c.priya.id)
 await form.locator('[name=direction]').selectOption('incoming')
 await form.locator('[name=occurredAt]').fill('2000-01-02T10:30')
 await form.locator('[name=disposition]').fill('Shoulder exercise question; clinician returned call')
 for(const width of [1440,390])await capture('COMM-003-call-entry',width)
 await page.setViewportSize({width:1440,height:1000})
 await Promise.all([page.waitForNavigation({waitUntil:'domcontentloaded'}),form.getByRole('button',{name:'Save call record',exact:true}).click()])
 await page.locator('[name=communicationQuery]').fill('Shoulder')
 await Promise.all([page.waitForNavigation({waitUntil:'domcontentloaded'}),page.locator('#communications').getByRole('button',{name:'Search history',exact:true}).click()])
 assert.ok(page.url().includes('communicationQuery=Shoulder'))
 const section=page.locator('#communications')
 assert.match(await section.innerText(),/2 matching records/)
 assert.match(await section.innerText(),/Shoulder exercise question; clinician returned call/)
 assert.match(await section.innerText(),/Shoulder secure conversation/)
 assert.match(await section.innerText(),/Priya/)
 for(const width of [1440,390])await capture('COMM-003-search-results',width)
 await login(c.reception.cookie);await page.goto(h.origin+'/app/clients/'+c.patient.id+'?communicationQuery=Shoulder#communications')
 assert.match(await section.innerText(),/0 matching records/)
 assert.doesNotMatch(await section.innerText(),/Shoulder exercise question|Shoulder secure conversation/)
 for(const width of [1440,390])await capture('COMM-003-front-desk-scope',width)
 // Shared chrome already supplies delayed-hover and immediate-focus tooltips.
 const icon=page.locator('button,a,label[for]').filter({has:page.locator('[role=tooltip]')}).first()
 if(await icon.count()){
  await icon.scrollIntoViewIfNeeded();await icon.hover();await page.waitForTimeout(350)
  assert.ok(await icon.locator('[role=tooltip]').isVisible())
  await page.mouse.move(0,0);await icon.focus();assert.ok(await icon.locator('[role=tooltip]').isVisible())
 }
 // COMM-002 uses the existing Settings and patient forms, with no inferred zone or legal default.
 await login(h.owner);await page.setViewportSize({width:1440,height:1000})
 await page.goto(h.origin+'/app/clinic#sms-quiet-hours')
 const policyForm=page.locator('form[action*="reminders.quiet_hours"]')
 assert.equal(await policyForm.locator('[name=intervals]').inputValue(),'')
 await policyForm.locator('[name=intervals]').fill(quietPolicy.intervals)
 await policyForm.locator('[name=source]').fill(quietPolicy.source)
 await policyForm.locator('[name=attest]').check()
 await Promise.all([page.waitForNavigation({waitUntil:'domcontentloaded'}),policyForm.getByRole('button',{name:'Record quiet hours',exact:true}).click()])
 assert.match(await page.locator('#sms-quiet-hours').innerText(),new RegExp(quietPolicy.source))
 for(const width of [1440,390])await capture('COMM-002-owner-quiet-policy',width,'#sms-quiet-hours')
 await page.setViewportSize({width:1440,height:1000})
 await page.goto(h.origin+'/app/clients/'+c.patient.id)
 await page.getByText('Edit details',{exact:true}).click()
 const patientForm=page.locator('form[action*="name=client.save"]')
 assert.equal(await patientForm.locator('[name=smsTimeZone]').inputValue(),'')
 await patientForm.locator('[name=smsTimeZone]').fill('America/New_York')
 await patientForm.locator('[name=phone]').fill('+13125550199')
 for(const width of [1440,390])await capture('COMM-002-patient-zone',width,'form[action*="name=client.save"]')
 await page.setViewportSize({width:1440,height:1000})
 await Promise.all([page.waitForNavigation({waitUntil:'domcontentloaded'}),patientForm.getByRole('button',{name:'Save details',exact:true}).click()])
 assert.equal((await h.send('/api/balm/clients/'+c.patient.id,undefined,h.owner)).value.client.sms_time_zone,'America/New_York')
 await h.cmd('reminders.consent',{clientId:c.patient.id,consent:true})
 await page.goto(h.origin+'/app/clinic')
 const schedule=page.locator('form[action*="reminders.settings"]')
 await schedule.locator('[name=sms]').check()
 await Promise.all([page.waitForNavigation({waitUntil:'domcontentloaded'}),schedule.getByRole('button',{name:'Save reminder schedule',exact:true}).click()])
 const tick=async at=>(await h.mf.getWorker()).scheduled({scheduledTime:Date.parse(at),cron:'* * * * *'})
 await tick('2099-03-01T05:00:00Z')
 assert.equal(sms.texts.length,0)
 await page.goto(h.origin+'/app/clients/'+c.patient.id+'#reminder-deliveries')
 assert.match(await page.locator('#reminder-deliveries').innerText(),/Deferred: patient-local quiet hours; no text provider attempt/)
 const sizes=await page.locator('#reminder-deliveries p, #reminder-deliveries label, #reminder-deliveries button').evaluateAll(els=>els.filter(el=>el.getBoundingClientRect().height).map(el=>parseFloat(getComputedStyle(el).fontSize)))
 assert.ok(sizes.every(size=>size>=13),'reminder screen text is at least 13px')
 for(const width of [1440,390])await capture('COMM-002-deferred-without-attempt',width,'#reminder-deliveries')
 await tick('2099-03-01T13:00:00Z');await tick('2099-03-01T13:01:00Z')
 assert.equal(sms.texts.length,1)
 await page.setViewportSize({width:1440,height:1000})
 await page.reload()
 assert.match(await page.locator('#reminder-deliveries').innerText(),/Accepted by text provider/)
 console.log('PASS COMM-002 native policy and patient-zone forms, visible deferral and one eligible attempt; screens 1440 and 390 head='+head)
 console.log('PASS COMM-003 actual call form, exact search results and hidden clinical results; screens 1440 and 390 head='+head)
} finally {await context?.close();await h.close();await browser.close()}
