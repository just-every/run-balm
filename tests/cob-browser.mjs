import assert from 'node:assert/strict'
import {mkdir} from 'node:fs/promises'
import {execFileSync} from 'node:child_process'
import {chromium} from '@playwright/test'
import {harness} from './harness.mjs'
import {cobJourney} from './cob-journey.mjs'
const output=process.env.BALM_UI_SCREENSHOTS
assert.ok(output);await mkdir(output,{recursive:true})
const head=execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim()
assert.equal(execFileSync('git',['status','--porcelain'],{encoding:'utf8'}).trim(),'')
const h=await harness({browserHttps:true,auth:{BALM_INSURANCE_ADAPTER_URL:'https://clearinghouse.clinic.example/x12',BALM_INSURANCE_ADAPTER_TOKEN:'synthetic-balm-30'},outbound:async request=>{assert.equal(request.url,'https://clearinghouse.clinic.example/x12');return Response.json({status:'submitted',reference:'synthetic-balm-31'})}})
let browser
try{
 const data=await cobJourney(h,process.env.BALM_COB_VALIDATION)
 browser=await chromium.launch({headless:true,args:['--use-mock-keychain','--password-store=basic']})
 const context=await browser.newContext({ignoreHTTPSErrors:true})
 for(const [pattern,path,type] of [['**/rer-theme.css','public/rer-theme.css','text/css'],['**/fonts/fonts.css','public/fonts/fonts.css','text/css'],['**/brand/mark.svg','public/brand/mark.svg','image/svg+xml']])await context.route(pattern,r=>r.fulfill({path,contentType:type}))
 await context.route('**/fonts/inter/*.woff2',r=>r.fulfill({path:'public'+new URL(r.request().url()).pathname,contentType:'font/woff2'}))
 const [name,...parts]=data.biller.cookie.split('=');await context.addCookies([{name,value:parts.join('='),url:h.origin,secure:true}])
 const page=await context.newPage()
 for(const width of [1440,390]){
  await page.setViewportSize({width,height:1000});await page.goto(h.origin+'/app/insurance',{waitUntil:'networkidle'})
  await page.locator('#cob').scrollIntoViewIfNeeded()
  await page.locator('#cob').getByRole('heading',{name:'Coordination of benefits'}).waitFor()
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1),false)
  await page.screenshot({path:output+`/cob-${width}.png`,fullPage:true})
  await page.goto(h.origin+'/api/balm/insurance/paper/'+data.packet.id,{waitUntil:'networkidle'})
  assert.match(await page.textContent('body'),/CMS-1500/)
  await page.screenshot({path:output+`/cms1500-${width}.png`,fullPage:true})
 }
 console.log('INS-013 1440/390 browser journey passed HEAD='+head)
}finally{await browser?.close();await h.close()}
