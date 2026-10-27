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
const h=await harness({browserHttps:true})
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
 const capture=async(name,width)=>{
  await page.setViewportSize({width,height:1000})
  await page.locator('#communications').scrollIntoViewIfNeeded()
  await page.evaluate(()=>document.fonts.ready)
  if(width===1440){
   const {root:document}=await fonts.send('DOM.getDocument')
   const {nodeId}=await fonts.send('DOM.querySelector',{nodeId:document.nodeId,selector:'#communications h2'})
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
 console.log('PASS COMM-003 actual call form, exact search results and hidden clinical results; screens 1440 and 390 head='+head)
} finally {await context?.close();await h.close();await browser.close()}
