import assert from 'node:assert/strict'
import {mkdir} from 'node:fs/promises'
import {chromium} from '@playwright/test'
import {harness} from './harness.mjs'
import {retailJourney} from './retail-journey.mjs'
const output=process.env.BALM_UI_SCREENSHOTS
assert.ok(output);await mkdir(output,{recursive:true})
const h=await harness({browserHttps:true})
let browser
try{
 browser=await chromium.launch({headless:true,args:['--use-mock-keychain','--password-store=basic']})
 const context=await browser.newContext({ignoreHTTPSErrors:true})
 for(const [pattern,path,type] of [['**/rer-theme.css','public/rer-theme.css','text/css'],['**/fonts/fonts.css','public/fonts/fonts.css','text/css'],['**/brand/mark.svg','public/brand/mark.svg','image/svg+xml']])await context.route(pattern,r=>r.fulfill({path,contentType:type}))
 await context.route('**/fonts/inter/*.woff2',r=>r.fulfill({path:'public'+new URL(r.request().url()).pathname,contentType:'font/woff2'}))
 const page=await context.newPage()
 await retailJourney(h,async({patient,cookie,today,from})=>{
  for(const [name,path,selector,session] of [['retail-ledger','/app/clients/'+patient.id,'#billing',h.owner],['retail-portal','/portal/home','#statements',cookie],['retail-reports','/app/reports?from='+from+'&to='+today,'#report-financial-summary',h.owner]]){
   const [key,...value]=session.split('=');await context.clearCookies();await context.addCookies([{name:key,value:value.join('='),url:h.origin,secure:true}])
   for(const width of [1440,390]){
    await page.setViewportSize({width,height:1000});await page.goto(h.origin+path)
    const target=page.locator(selector);await target.first().scrollIntoViewIfNeeded()
    assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),name+' fits '+width)
    const controls=await page.locator('button,a[role=button]').evaluateAll(elements=>elements.filter(e=>!e.textContent.trim()).map(e=>({label:e.getAttribute('aria-label'),tooltip:e.getAttribute('data-tooltip')})))
    assert.ok(controls.every(c=>c.tooltip),JSON.stringify(controls))
    if(name==='retail-portal'){
     const receipt=page.locator('a[href^="/portal/receipts/"]').first()
     assert.ok(await receipt.count());await Promise.all([page.waitForEvent('download'),receipt.click()])
    }
    await page.screenshot({path:output+'/'+name+'-'+width+'.png'})
   }
  }
 })
 console.log('PASS cash sale ledger, portal receipt download and financial reports at 1440 and 390; icon-only control audit passed')
}finally{await browser?.close();await h.close()}
