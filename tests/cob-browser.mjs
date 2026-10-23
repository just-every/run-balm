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
 browser=await chromium.launch({headless:true,args:['--use-mock-keychain','--password-store=basic']})
 const context=await browser.newContext({ignoreHTTPSErrors:true})
 for(const [pattern,path,type] of [['**/rer-theme.css','public/rer-theme.css','text/css'],['**/fonts/fonts.css','public/fonts/fonts.css','text/css'],['**/brand/mark.svg','public/brand/mark.svg','image/svg+xml']])await context.route(pattern,r=>r.fulfill({path,contentType:type}))
 await context.route('**/fonts/inter/*.woff2',r=>r.fulfill({path:'public'+new URL(r.request().url()).pathname,contentType:'font/woff2'}))
 const page=await context.newPage()
 let activeCookie
 const signIn=async cookie=>{if(activeCookie===cookie)return;const [name,...parts]=cookie.split('=');await context.clearCookies();await context.addCookies([{name,value:parts.join('='),url:h.origin,secure:true}]);activeCookie=cookie}
 const capture=async(name,selector)=>{
  const target=page.locator(selector).first();await target.scrollIntoViewIfNeeded()
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1),false)
  await page.screenshot({path:output+'/'+name+'.png',fullPage:false})
 }
 const ledgerProof=async(phase,{c,biller})=>{
  await signIn(biller.cookie)
  for(const width of [1440,390]){
   await page.setViewportSize({width,height:1000});await page.goto(h.origin+'/app/clients/'+c.patient.id,{waitUntil:'networkidle'})
   await page.locator('#billing').getByRole('heading',{name:'Billing and payments'}).waitFor()
   const collect=page.locator('#billing').getByRole('heading',{name:'Collect the balance'})
   assert.equal(await collect.count(),phase==='released'?1:0)
   await capture('cob-'+phase+'-'+width,'#billing')
  }
 }
 const data=await cobJourney(h,process.env.BALM_COB_VALIDATION,{
  held:args=>ledgerProof('held',args),released:args=>ledgerProof('released',args),
  copay:async({c,biller})=>{
   await signIn(biller.cookie)
   for(const width of [1440,390]){
    await page.setViewportSize({width,height:1000});await page.goto(h.origin+'/app/clients/'+c.patient.id)
    await page.getByText('Record a copay received',{exact:true}).click()
    const form=page.locator('form[action*="name=payment.record"]')
    assert.equal(await form.locator('[name=amount]').inputValue(),'5.00')
    await capture('cob-copay-'+width,'form[action*="name=payment.record"]')
   }
  },
  paperPrepare:async({paperClaim,biller,eob})=>{
   await signIn(biller.cookie);await page.setViewportSize({width:1440,height:1000})
   await page.goto(h.origin+'/app/insurance',{waitUntil:'networkidle'})
   const form=page.locator('form[action*="insurance.cob.paper.prepare"]').filter({has:page.locator(`input[name="claimId"][value="${paperClaim.id}"]`)})
   await form.locator('..').locator('summary').click()
   await form.locator('input[type="file"]').setInputFiles({name:'primary-eob.pdf',mimeType:'application/pdf',buffer:eob})
   await form.locator('input[name="attest"]').check()
   await form.getByRole('button',{name:'Prepare CMS-1500 and EOB packet'}).click()
   await page.getByRole('link',{name:'Print CMS-1500'}).first().waitFor()
   const state=await h.cmd('insurance.cob.read',{},biller.cookie),packet=state.packets.find(p=>p.claim_id===paperClaim.id)
   assert.ok(packet);assert.equal(packet.submitted_at,null)
   for(const width of [1440,390]){await page.setViewportSize({width,height:1000});await capture('cob-paper-prepared-'+width,'#cob')}
   return packet
  },
  paperSubmit:async({packet,biller})=>{
   await signIn(biller.cookie);await page.setViewportSize({width:390,height:1000})
   await page.goto(h.origin+'/app/insurance',{waitUntil:'networkidle'})
   const form=page.locator('form[action*="insurance.cob.paper.submit"]').filter({has:page.locator(`input[name="id"][value="${packet.id}"]`)})
   await form.locator('input[name="reference"]').fill('synthetic-balm-28')
   await form.locator('input[name="attest"]').check()
   await form.getByRole('button',{name:'Record actual paper submission'}).click()
   await page.waitForLoadState('networkidle')
   const state=await h.cmd('insurance.cob.read',{},biller.cookie),saved=state.packets.find(p=>p.id===packet.id)
   assert.ok(saved.submitted_at);assert.equal(saved.reference,'synthetic-balm-28')
   await capture('cob-paper-submitted-390','#cob')
  }
 })
 await signIn(data.biller.cookie)
 for(const width of [1440,390]){
  await page.setViewportSize({width,height:1000});await page.goto(h.origin+'/app/insurance',{waitUntil:'networkidle'})
  await page.locator('#cob').getByRole('heading',{name:'Coordination of benefits'}).waitFor()
  await capture('cob-'+width,'#cob')
  await page.goto(h.origin+'/api/balm/insurance/paper/'+data.packet.id,{waitUntil:'networkidle'})
  assert.match(await page.textContent('body'),/CMS-1500/)
  await page.screenshot({path:output+`/cms1500-${width}.png`,fullPage:false})
  if(width===1440){await page.pdf({path:output+'/cms1500-print.pdf',format:'Letter',preferCSSPageSize:true,printBackground:true})}
 }
 console.log('INS-013 forms and 1440/390 browser journey passed HEAD='+head)
}finally{await browser?.close();await h.close()}
