import assert from 'node:assert/strict'
import {mkdir} from 'node:fs/promises'
import {execFileSync} from 'node:child_process'
import {chromium} from '@playwright/test'
import {harness} from './harness.mjs'
import {dailyCloseClinic} from './daily-close-clinic.mjs'
import {functionalAckFile} from './functional-ack-fixture.mjs'

const root=process.env.BALM_UI_SCREENSHOTS??'/tmp/balm-functional-ack'
await mkdir(root,{recursive:true})
const browser=await chromium.launch({headless:true,...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH?{executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH}:{}),args:['--no-sandbox','--use-mock-keychain','--password-store=basic']})
const h=await harness({browserHttps:true})
let context
try {
 const c=await dailyCloseClinic(h)
 const claim=await h.cmd('insurance.claim.prepare',{appointmentId:c.visit,policyId:c.policy.id}),batch=await h.cmd('insurance.batch.prepare',{claimIds:[claim.id]})
 const original=(await h.send('/api/balm/insurance/837P/'+batch.id,undefined,h.owner)).text
 const accepted=await functionalAckFile(original),rejected=(await functionalAckFile(original,true)).replaceAll('000000901','000000902')
 context=await browser.newContext({ignoreHTTPSErrors:true,viewport:{width:1440,height:1000}})
 for(const [pattern,path,type] of [['**/rer-theme.css','public/rer-theme.css','text/css'],['**/fonts/fonts.css','public/fonts/fonts.css','text/css'],['**/brand/mark.svg','public/brand/mark.svg','image/svg+xml']])await context.route(pattern,r=>r.fulfill({path,contentType:type}))
 await context.route('**/fonts/**/*.woff2',r=>r.fulfill({path:'public'+new URL(r.request().url()).pathname,contentType:'font/woff2'}))
 const [name,...value]=h.owner.split('=');await context.addCookies([{name,value:value.join('='),url:h.origin,secure:true}])
 const page=await context.newPage()
 await page.goto(h.origin+'/app/insurance#batches')
 const section=page.locator('[data-functional-ack]').first(),form=section.locator('form')
 const capture=async label=>{
  for(const width of [1440,390]){
   await page.setViewportSize({width,height:1000});await section.scrollIntoViewIfNeeded();await page.evaluate(()=>document.fonts.ready)
   await page.screenshot({path:root+'/'+label+'-'+width+'.png'})
  }
  await page.setViewportSize({width:1440,height:1000})
 }
 await section.getByText('Upload a 999 for this claim file',{exact:true}).click()
 await form.locator('[name=x12]').setInputFiles({name:'synthetic-balm-901.999',mimeType:'application/EDI-X12',buffer:Buffer.from(accepted)})
 assert.equal(await form.locator('[name=batchId]').inputValue(),batch.id)
 await capture('INS-006-upload')
 await Promise.all([page.waitForNavigation({waitUntil:'domcontentloaded'}),form.getByRole('button',{name:'Import 999 syntax result',exact:true}).click()])
 assert.match(await section.innerText(),/999 syntax: accepted/)
 assert.match(await section.innerText(),/does not establish payer acceptance, payment or actual submission/)
 await capture('INS-006-accepted')
 await section.getByText('Upload a 999 for this claim file',{exact:true}).click()
 await form.locator('[name=x12]').setInputFiles({name:'synthetic-balm-902.999',mimeType:'application/EDI-X12',buffer:Buffer.from(rejected)})
 await Promise.all([page.waitForNavigation({waitUntil:'domcontentloaded'}),form.getByRole('button',{name:'Import 999 syntax result',exact:true}).click()])
 assert.match(await section.innerText(),/999 syntax: rejected/);assert.match(await section.innerText(),/Invalid code value/);assert.match(await section.innerText(),/Source: IK4/)
 const links=section.getByRole('link',{name:'Download original 999',exact:true})
 assert.equal(await links.count(),2)
 const download=await context.request.get(h.origin+await links.last().getAttribute('href'))
 assert.equal(download.status(),200);assert.equal(await download.text(),rejected)
 assert.equal((await h.state()).dailyClose.claims.length,1)
 assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'insurance screen fits at the assertion width')
 const sizes=await section.locator('p,li,label,button,a,h4').evaluateAll(els=>els.filter(el=>el.getClientRects().length).map(el=>parseFloat(getComputedStyle(el).fontSize)))
 assert.ok(sizes.every(size=>size>=13),'999 text is at least 13px')
 const icons=await page.locator('button,a,[role=button]').evaluateAll(els=>els.filter(el=>el.getClientRects().length&&!/[\p{L}\p{N}]/u.test(el.textContent??'')).map(el=>({name:el.getAttribute('aria-label'),tooltip:!!el.querySelector('[role=tooltip]')})))
 assert.ok(icons.every(i=>i.name&&i.tooltip),'icon-only controls have named tooltips')
 const icon=page.locator('a,button').filter({has:page.locator('[role=tooltip]')}).first()
 if(await icon.count()){
  await icon.hover();await page.waitForTimeout(350);assert.ok(await icon.locator('[role=tooltip]').isVisible())
  await page.mouse.move(0,0);await icon.focus();assert.ok(await icon.locator('[role=tooltip]').isVisible())
 }
 await capture('INS-006-rejected')
 console.log('PASS INS-006 actual multipart 999 upload, syntax results, sourced reasons and original download at 1440; screens at 1440 and 390 head='+execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim())
} finally {await context?.close();await h.close();await browser.close()}
