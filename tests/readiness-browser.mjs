import assert from 'node:assert/strict'
import { mkdir } from 'node:fs/promises'
import { chromium } from '@playwright/test'
import { harness } from './harness.mjs'
import { readinessFacts } from './readiness-fixture.mjs'

let h, browser
try {
 h=await harness({readiness:false,browserHttps:true})
 await h.finishSetup()
 await h.cmd('settings.save',{clinicName:'Synthetic readiness clinic',timeZone:'America/Chicago'})
 browser=await chromium.launch({headless:true,...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH?{executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH}:{}),args:['--no-sandbox','--use-mock-keychain','--password-store=basic']})
 const context=await browser.newContext({ignoreHTTPSErrors:true})
 for(const [pattern,path,contentType] of [['**/rer-theme.css','public/rer-theme.css','text/css'],['**/fonts/fonts.css','public/fonts/fonts.css','text/css'],['**/brand/mark.svg','public/brand/mark.svg','image/svg+xml']])await context.route(pattern,r=>r.fulfill({path,contentType}))
 await context.route('**/fonts/inter/*.woff2',r=>r.fulfill({path:'public'+new URL(r.request().url()).pathname,contentType:'font/woff2'}))
 const [name,...value]=h.owner.split('=')
 await context.addCookies([{name,value:value.join('='),url:h.origin,secure:true}])
 const page=await context.newPage(),directory=process.env.BALM_UI_SCREENSHOTS??'.cache/readiness-screens'
 await mkdir(directory,{recursive:true})
 async function capture(name){
  for(const width of [1440,390]){
   await page.setViewportSize({width,height:1000})
   await page.locator('#readiness').evaluate(el=>el.scrollIntoView({block:'start',behavior:'instant'}))
   assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),name+' fits '+width)
   const icons=await page.locator('button,a,[role=button]').evaluateAll(items=>items.filter(el=>el.getClientRects().length&&!/[\p{L}\p{N}]/u.test(el.textContent??'')).map(el=>({label:el.getAttribute('aria-label'),tooltip:!!el.querySelector('[role=tooltip]')})))
   assert.ok(icons.every(i=>i.label&&i.tooltip),'visible icon controls have tooltips')
   await page.screenshot({path:directory+'/'+name+'-'+width+'.png'})
   await page.locator('#readiness').evaluate(el=>el.scrollIntoView({block:'end',behavior:'instant'}))
   await page.screenshot({path:directory+'/'+name+'-tail-'+width+'.png'})
  }
 }
 await page.goto(h.origin+'/app/clinic')
 await assert.equal(await page.locator('#readiness [role=status]').textContent(),'Integration readiness is incomplete.')
 await capture('readiness-incomplete')
 await page.locator('#readiness summary').filter({hasText:'Record readiness review'}).click()
 const review=page.locator('form[action*="readiness.save"]')
 for(const [key,value] of Object.entries(readinessFacts))if(key!=='attest')await review.locator(`[name=${key}]`).fill(value)
 await review.locator('[name=attest]').check()
 await capture('readiness-review')
 await review.getByRole('button',{name:'Save readiness review'}).click()
 await page.locator('#readiness summary').filter({hasText:'Record signed BAA'}).click()
 const baa=page.locator('form[action*="readiness.baa.record"]')
 await baa.locator('[name=processor]').selectOption('mail')
 for(const [key,value] of Object.entries({provider:'synthetic-balm-910 mail account',plan:'synthetic-balm-911 covered edition',reference:'synthetic-balm-912 signed agreement',signedOn:'2026-09-01'}))await baa.locator(`[name=${key}]`).fill(value)
 await baa.locator('[name=attest]').check()
 await capture('readiness-baa')
 await baa.getByRole('button',{name:'Record BAA',exact:true}).click()
 assert.equal(await page.locator('#readiness [role=status]').textContent(),'Integration readiness check passed.')
 await capture('readiness-passed')
 const exported=await context.request.get(h.origin+'/api/balm/readiness.json')
 assert.equal(exported.status(),200)
 const record=await exported.json()
 assert.equal(record.ready,true)
 assert.equal(record.record.risk_analysis,readinessFacts.riskAnalysis)
 assert.equal(record.baas[0].reference,'synthetic-balm-912 signed agreement')
 await page.locator('#readiness').getByRole('button',{name:'Revoke BAA'}).click()
 assert.equal(await page.locator('#readiness [role=status]').textContent(),'Integration readiness is incomplete.')
 await capture('readiness-revoked')
 console.log('HIPAA-001 browser: readiness forms, export, revocation and tooltip audit passed at 1440 and 390')
}finally{if(browser)await browser.close();if(h)await h.close()}
