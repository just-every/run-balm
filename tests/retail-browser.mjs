import assert from 'node:assert/strict'
import {mkdir} from 'node:fs/promises'
import {chromium} from '@playwright/test'
import {clinic,pastVisit} from './clinic.mjs'
import {harness} from './harness.mjs'
import {retailJourney} from './retail-journey.mjs'
const output=process.env.BALM_UI_SCREENSHOTS
assert.ok(output);await mkdir(output,{recursive:true})
const h=await harness({browserHttps:true})
let browser
try{
 browser=await chromium.launch({headless:true,...(process.env.BALM_CHROMIUM_PATH?{executablePath:process.env.BALM_CHROMIUM_PATH}:{}),args:['--no-sandbox','--use-mock-keychain','--password-store=basic']})
 const context=await browser.newContext({ignoreHTTPSErrors:true})
 for(const [pattern,path,type] of [['**/rer-theme.css','public/rer-theme.css','text/css'],['**/fonts/fonts.css','public/fonts/fonts.css','text/css'],['**/brand/mark.svg','public/brand/mark.svg','image/svg+xml']])await context.route(pattern,r=>r.fulfill({path,contentType:type}))
 await context.route('**/fonts/inter/*.woff2',r=>r.fulfill({path:'public'+new URL(r.request().url()).pathname,contentType:'font/woff2'}))
 const page=await context.newPage()
 await retailJourney(h,async({patient,cookie,today,from})=>{
  for(const [name,path,selector,session] of [['retail-ledger','/app/clients/'+patient.id,'#retail',h.owner],['retail-portal','/portal/home','#statements',cookie],['retail-reports','/app/reports?from='+from+'&to='+today,'#report-financial-summary',h.owner]]){
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
    if(name==='retail-ledger') {
     const section=page.locator('#retail')
     for(const [kind,label] of [['package','visit package'],['membership','finite membership'],['gift_card','gift value'],['product','product']]) {
      const section=page.locator('#retail')
      await section.locator('summary').filter({hasText:new RegExp('^Record '+label+'$')}).click()
      const sale=section.locator('form').filter({has:page.locator('input[name=kind][value='+kind+']')})
      await sale.locator('[name=label]').fill('Browser '+kind+' '+width)
      await sale.locator('[name=amountCents]').fill('100')
      await sale.locator('[name=reference]').fill('synthetic-balm-browser-'+kind+'-'+width)
      if(['package','membership'].includes(kind))await sale.locator('[name=units]').fill('1')
      if(kind==='product') {
       await sale.locator('[name=taxState]').fill('TX')
       await sale.locator('[name=taxBasisPoints]').fill('825')
       await sale.locator('[name=taxEvidence]').fill('Owner reviewed synthetic product rate')
      }
      await sale.locator('[name=confirm]').check()
      await Promise.all([page.waitForResponse(r=>r.request().method()==='POST'&&r.url().includes('/app/action')),sale.getByRole('button',{name:'Record '+label,exact:true}).click()])
      await page.waitForLoadState('networkidle')
      await page.locator('#retail li').filter({hasText:'Browser '+kind+' '+width}).waitFor()
      if(kind==='membership')for(const action of ['Pause membership','Resume membership']) {
       const item=page.locator('#retail li').filter({hasText:'Browser '+kind+' '+width})
       await item.locator('summary').filter({hasText:'Change membership status'}).click()
       await item.locator('[name=reason]').fill('Synthetic patient request')
       await item.locator('[name=consentEvidence]').fill('Explicit synthetic patient authorization')
       await item.locator('[name=confirm]').check()
       await Promise.all([page.waitForResponse(r=>r.request().method()==='POST'&&r.url().includes('/app/action')),item.getByRole('button',{name:action,exact:true}).click()])
       await page.waitForLoadState('networkidle')
       const updated=(await h.send('/api/balm/clients/'+patient.id,undefined,h.owner)).value.billing.retail.find(x=>x.label==='Browser '+kind+' '+width)
       assert.equal(updated.membership_state,action==='Pause membership'?'paused':'active')
       assert.equal(updated.visits_left,1)
      }

     }
     await page.locator('#retail').scrollIntoViewIfNeeded()
    }
    await page.screenshot({path:output+'/'+name+'-'+width+'.png'})
   }
  }
 })
 // Render the digest-bound retail destruction inventory through its native form.
 const {service,practitioners:[priya]}=await clinic(h,['RetentionProof'])
 const aged=await h.cmd('client.save',{firstName:'Synthetic',lastName:'Retained retail',dateOfBirth:'1950-01-01'})
 const visit=await pastVisit(h,aged.id,priya,service.id,h.owner,17)
 await h.db.prepare("UPDATE bm_appointments SET start_at='1990-01-02T02:00:00.000Z',end_at='1990-01-02T02:45:00.000Z' WHERE id=?").bind(visit).run()
 await h.db.prepare("INSERT INTO bm_retail_sales(id,client_id,kind,label,units,amount_cents,tax_cents,tax_basis_points,tax_state,tax_evidence,reference,recorded_at,recorded_by,receipt_base64) VALUES(?,?,'gift_card','Synthetic old gift',0,1000,0,0,'','','synthetic-balm-browser-old','1990-01-02T03:00:00.000Z',?,?)").bind(crypto.randomUUID(),aged.id,h.auth.OWNER_EMAIL,btoa('%PDF-1.4 Synthetic historical original')).run()
 await h.cmd('retention.save',{state:'AZ',adultYears:6,minorYears:6,payerYears:0,majorityAge:18})
 const [key,...value]=h.owner.split('=');await context.clearCookies();await context.addCookies([{name:key,value:value.join('='),url:h.origin,secure:true}])
 for(const width of [1440,390]) {
  await page.setViewportSize({width,height:1000});await page.goto(h.origin+'/app/clients/'+aged.id)
  await page.getByRole('button',{name:'Review destruction list',exact:true}).click()
  await page.locator('#retention-review').waitFor()
  assert.ok(await page.locator('#retention-review').getByText('Retail receipts and visit entitlements: 1',{exact:true}).count())
  await page.locator('#retention-review').scrollIntoViewIfNeeded()
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1))
  await page.screenshot({path:output+'/retail-destruction-'+width+'.png'})
 }
 console.log('PASS cash sale ledger, portal receipt download and financial reports at 1440 and 390; icon-only control audit passed')
}finally{await browser?.close();await h.close()}
