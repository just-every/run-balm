import assert from 'node:assert/strict'
import {mkdir} from 'node:fs/promises'
import {chromium} from '@playwright/test'
import {harness} from './harness.mjs'
import {statementCyclesJourney} from './statement-cycles-journey.mjs'
const output=process.env.BALM_UI_SCREENSHOTS
assert.ok(output);await mkdir(output,{recursive:true})
const h=await harness({browserHttps:true})
let browser
try {
 browser=await chromium.launch({headless:true,args:['--use-mock-keychain','--password-store=basic']})
 const context=await browser.newContext({ignoreHTTPSErrors:true})
 for(const [pattern,path,type] of [['**/rer-theme.css','public/rer-theme.css','text/css'],['**/fonts/fonts.css','public/fonts/fonts.css','text/css'],['**/brand/mark.svg','public/brand/mark.svg','image/svg+xml']])await context.route(pattern,r=>r.fulfill({path,contentType:type}))
 await context.route('**/fonts/inter/*.woff2',r=>r.fulfill({path:'public'+new URL(r.request().url()).pathname,contentType:'font/woff2'}))
 const page=await context.newPage()
 const signIn=async value=>{const [name,...parts]=value.split('=');await context.clearCookies();await context.addCookies([{name,value:parts.join('='),url:h.origin,secure:true}])}
 const capture=async(name,path,selector,cookie)=>{
  await signIn(cookie)
  for(const width of [1440,390]) {
   await page.setViewportSize({width,height:1000});await page.goto(h.origin+path)
   await page.locator(selector).first().scrollIntoViewIfNeeded()
   assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),name+' fits '+width)
   // Text-labelled controls are used throughout these screens; report any
   // remaining icon-only controls to keep the tooltip requirement visible.
   const controls=await page.locator('button,a[role=button]').evaluateAll(elements=>elements.filter(e=>!e.textContent.trim()).map(e=>({label:e.getAttribute('aria-label'),tooltip:e.getAttribute('data-tooltip')})))
   assert.ok(controls.every(c=>c.tooltip),JSON.stringify(controls))
   await page.screenshot({path:output+'/'+name+'-'+width+'.png'})
  }
 }
 await statementCyclesJourney(h,{
  issued:async({clients,desk,cookie,batch})=>{
   await capture('cycles','/app/invoices','#statement-cycles',desk.cookie)
   await capture('delivery','/app/clients/'+clients[1].id,'#statement-delivery',desk.cookie)
   await capture('portal','/portal/home','#statements',cookie)
   await capture('settings','/app/clinic','form[action*="pay.cycle.settings"]',h.owner)
   await signIn(desk.cookie);await page.goto(h.origin+'/app/clients/'+clients[1].id)
   const section=page.locator('#statement-delivery')
   await section.getByText('Record statement preference',{exact:true}).click()
   const form=section.locator('form[action*="pay.cycle.preference"]')
   await form.locator('[name=evidence]').fill('Patient confirmed monthly postal preference at the desk')
   await form.locator('[name=authorized]').check()
   await form.getByRole('button',{name:'Save statement preference',exact:true}).click()
   await page.locator('#statement-delivery').waitFor()
   assert.equal((await h.send('/api/balm/clients/'+clients[1].id,undefined,desk.cookie)).value.billing.cycle.preference.channel,'mail')
   await page.goto(h.origin+'/app/invoices')
   const download=page.locator('a[href="/api/balm/statement-batches/'+batch.id+'.pdf"]')
   await Promise.all([page.waitForEvent('download'),download.click()])
  },
  returned:async({clients,desk})=>capture('returned','/app/clients/'+clients[1].id,'#statement-delivery',desk.cookie)
 })
 console.log('PASS statement cycle screens and real preference form at 1440 and 390')
} finally {await browser?.close();await h.close()}
