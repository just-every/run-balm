import assert from 'node:assert/strict'
import {mkdir} from 'node:fs/promises'
import {chromium} from '@playwright/test'
import {clinic,pastVisit} from './clinic.mjs'
import {harness} from './harness.mjs'
import {retailJourney} from './retail-journey.mjs'
import {retailRetentionJourney} from './retail-retention-journey.mjs'
import {retailStaffJourney} from './retail-staff-journey.mjs'
import {giftSettlementJourney} from './retail-gift-settlement-journey.mjs'
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
 await retailJourney(h,async({patient,cookie,today,from,service,priya})=>{
  for(const [name,path,selector,session] of [['retail-ledger','/app/clients/'+patient.id,'#retail',h.owner],['retail-portal','/portal/home','#statements',cookie],['retail-reports','/app/reports?from='+from+'&to='+today,'#report-financial-summary',h.owner]]){
   const [key,...value]=session.split('=');await context.clearCookies();await context.addCookies([{name:key,value:value.join('='),url:h.origin,secure:true}])
   for(const width of [1440,390]){
    await page.setViewportSize({width,height:1000});await page.goto(h.origin+path)
    const target=page.locator(selector);await target.first().scrollIntoViewIfNeeded()
    assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),name+' fits '+width)
    const controls=await page.locator('button,a[role=button]').evaluateAll(elements=>elements.filter(e=>!e.textContent.trim()).map(e=>({label:e.getAttribute('aria-label'),tooltip:e.getAttribute('data-tooltip')})))
    assert.ok(controls.every(c=>c.tooltip),JSON.stringify(controls))
    if(name==='retail-portal'){
     if(width===1440){assert.ok(await page.locator('#retail-notices').getByText('Authorized renewed membership',{exact:true}).count());assert.ok(await page.locator('#retail-notices').getByText('2 of 2 visits left · active',{exact:true}).count())}
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
       await item.locator('form[action*="name=pay.retail.membership"]').locator('[name=reason]').fill('Synthetic patient request')
       await item.locator('form[action*="name=pay.retail.membership"]').locator('[name=consentEvidence]').fill('Explicit synthetic patient authorization')
       await item.locator('form[action*="name=pay.retail.membership"]').locator('[name=effectiveAt]').fill(new Date().toISOString())
       await item.locator('form[action*="name=pay.retail.membership"]').locator('[name=authorizedAt]').fill(new Date(Date.now()-120000).toISOString())
       await item.locator('form[action*="name=pay.retail.membership"]').locator('[name=authorizationMethod]').fill('Specific request in person')
       await item.locator('form[action*="name=pay.retail.membership"]').locator('[name=confirm]').check()
       await item.screenshot({path:output+'/retail-'+action.toLowerCase().split(' ')[0]+'-authorization-'+width+'.png'})
       await Promise.all([page.waitForResponse(r=>r.request().method()==='POST'&&r.url().includes('/app/action')),item.getByRole('button',{name:action,exact:true}).click()])
       await page.waitForLoadState('networkidle')
       const updated=(await h.send('/api/balm/clients/'+patient.id,undefined,h.owner)).value.billing.retail.find(x=>x.label==='Browser '+kind+' '+width)
       assert.equal(updated.membership_state,action==='Pause membership'?'paused':'active')
       assert.equal(updated.visits_left,1)
      }
      if(kind==='membership'){
       const created=(await h.send('/api/balm/clients/'+patient.id,undefined,h.owner)).value.billing.retail.find(x=>x.label==='Browser '+kind+' '+width)
       const visit=await pastVisit(h,patient.id,priya,service.id,h.owner,width===1440?14:17,{coverageChoice:'self_pay',deliveryMethod:'paper'})
       await h.cmd('pay.retail.assign',{clientId:patient.id,saleId:created.id,appointmentId:visit})
       await h.cmd('appointment.attend',{id:visit},priya.cookie)
       await page.reload()
       const item=page.locator('#retail li').filter({hasText:created.label})
       await item.locator('summary').filter({hasText:'Record authorized renewal'}).click()
       const renewal=item.locator('form[action*="name=pay.retail.renew"]')
       await renewal.locator('[name=label]').fill('Browser authorized renewal '+width)
       await renewal.locator('[name=amountCents]').fill('200')
       await renewal.locator('[name=units]').fill('2')
       await renewal.locator('[name=reference]').fill('synthetic-balm-browser-renewal-'+width)
       await renewal.locator('[name=reason]').fill('Specific new finite purchase requested')
       await renewal.locator('[name=consentEvidence]').fill('Patient specifically authorized two new cash visits')
       await renewal.locator('[name=effectiveAt]').fill(new Date().toISOString())
       await renewal.locator('[name=authorizedAt]').fill(new Date(Date.now()-120000).toISOString())
       await renewal.locator('[name=authorizationMethod]').fill('Patient request in person')
       await renewal.locator('[name=confirm]').check();await renewal.locator('[name=cashConfirm]').check()
       await renewal.screenshot({path:output+'/retail-renewal-'+width+'.png'})
       await Promise.all([page.waitForResponse(r=>r.request().method()==='POST'&&r.url().includes('/app/action')),renewal.getByRole('button',{name:'Record renewal',exact:true}).click()])
       await page.waitForLoadState('networkidle')
       if(width===1440)assert.equal((await h.send('/api/balm/clients/'+patient.id,undefined,h.owner)).value.billing.retail.find(x=>x.label==='Browser authorized renewal '+width).visits_left,2)
       const renewedItem=page.locator('#retail li').filter({hasText:'Browser authorized renewal '+width})
       await renewedItem.locator('summary').filter({hasText:'Record unused-visit settlement'}).click()
       const settlement=renewedItem.locator('form[action*="name=pay.retail.settle"]')
       await settlement.locator('[name=reason]').fill('Patient requested cancellation with unused visit refund')
       await settlement.locator('[name=consentEvidence]').fill('Specific patient authorization for full unused cash settlement')
       await settlement.locator('[name=effectiveAt]').fill(new Date().toISOString())
       await settlement.locator('[name=authorizedAt]').fill(new Date(Date.now()-120000).toISOString())
       await settlement.locator('[name=authorizationMethod]').fill('Patient request in person')
       await settlement.locator('[name=settlementReference]').fill('synthetic-balm-browser-refund-'+width)
       await settlement.locator('[name=settlementEvidence]').fill('Owner reviewed completed external cash refund')
       await settlement.locator('[name=confirm]').check();await settlement.locator('[name=cashReturned]').check()
       await settlement.screenshot({path:output+'/retail-settlement-'+width+'.png'})
       await Promise.all([page.waitForResponse(r=>r.request().method()==='POST'&&r.url().includes('/app/action')),settlement.getByRole('button',{name:'Record settlement',exact:true}).click()])
       await page.waitForLoadState('networkidle')
       if(width===1440)assert.match(await renewedItem.innerText(),/cancelled/)
       await item.locator('summary').filter({hasText:'Cancel exhausted membership'}).click()
       await item.locator('form[action*="name=pay.retail.cancel"]').locator('[name=reason]').fill('Patient requested closure after final visit')
       await item.locator('form[action*="name=pay.retail.cancel"]').locator('[name=consentEvidence]').fill('Patient specifically authorized cancellation')
       await item.locator('form[action*="name=pay.retail.cancel"]').locator('[name=effectiveAt]').fill(new Date().toISOString())
       await item.locator('form[action*="name=pay.retail.cancel"]').locator('[name=authorizedAt]').fill(new Date(Date.now()-120000).toISOString())
       await item.locator('form[action*="name=pay.retail.cancel"]').locator('[name=authorizationMethod]').fill('Specific request in person')
       await item.locator('form[action*="name=pay.retail.cancel"]').locator('[name=confirm]').check()
       await item.screenshot({path:output+'/retail-cancellation-authorization-'+width+'.png'})
       await Promise.all([page.waitForResponse(r=>r.request().method()==='POST'&&r.url().includes('/app/action')),item.getByRole('button',{name:'Record cancellation',exact:true}).click()])
       await page.waitForLoadState('networkidle')
       assert.match(await page.locator('#retail li').filter({hasText:created.label}).innerText(),/cancelled/)
      }

     }
     await page.locator('#retail').scrollIntoViewIfNeeded()
    }
    if(name==='retail-reports'){await page.locator('#report-retail').scrollIntoViewIfNeeded();await page.locator('#report-retail').screenshot({path:output+'/retail-obligations-'+width+'.png'})}
    await page.screenshot({path:output+'/'+name+'-'+width+'.png'})
   }
  }
 })
 await retailRetentionJourney(h,{screen:async patient=>{
  const [key,...value]=h.owner.split('=');await context.clearCookies();await context.addCookies([{name:key,value:value.join('='),url:h.origin,secure:true}])
  for(const width of [1440,390]) {
   await page.setViewportSize({width,height:1000});await page.goto(h.origin+'/app/clients/'+patient.id)
   await page.getByRole('button',{name:'Review eligible retail originals',exact:true}).click()
   await page.locator('#retention-review').waitFor()
   if(width===1440)assert.ok(await page.locator('#retention-review').getByText('Retail receipts and visit entitlements: 10',{exact:true}).count())
   await page.locator('#retention-review').scrollIntoViewIfNeeded()
   await page.screenshot({path:output+'/retail-scoped-destruction-'+width+'.png'})
  }
 }})
 await retailStaffJourney(h,{screen:async({patient,biller})=>{
  const [key,...value]=biller.cookie.split('=');await context.clearCookies();await context.addCookies([{name:key,value:value.join('='),url:h.origin,secure:true}])
  for(const width of [1440,390]) {
   await page.setViewportSize({width,height:1000});await page.goto(h.origin+'/app/clients/'+patient.id)
   const retail=page.locator('#retail');await retail.scrollIntoViewIfNeeded()
   await retail.locator('summary').filter({hasText:'Record product'}).click()
   if(width===1440){assert.equal(await retail.locator('form[action*="name=pay.retail.sell"]').count(),4);assert.equal(await retail.locator('form[action*="name=pay.retail.membership"]').count(),0)}
   await page.screenshot({path:output+'/retail-authorized-staff-'+width+'.png'})
  }
 }})
 await giftSettlementJourney(h,{screen:async({patient,member})=>{
  const [key,...value]=h.owner.split('=');await context.clearCookies();await context.addCookies([{name:key,value:value.join('='),url:h.origin,secure:true}])
  for(const width of [1440,390]) {
   await page.setViewportSize({width,height:1000});await page.goto(h.origin+'/app/clients/'+patient.id)
   const item=page.locator('#retail li').filter({hasText:'synthetic-balm-gift-funded-membership'})
   await item.locator('summary').filter({hasText:'Restore unused gift value'}).click()
   const form=item.locator('form[action*="name=pay.retail.gift_settle"]')
   if(width===1440){assert.equal(await form.locator('[name=settlementAmountCents]').inputValue(),'3001');assert.equal(await form.locator('[name=cashReturned]').count(),0)}
   await item.scrollIntoViewIfNeeded();await page.screenshot({path:output+'/retail-gift-restoration-'+width+'.png'})
  }
 }})
 // Render the digest-bound retail destruction inventory through its native form.
 const {service,practitioners:[priya]}=await clinic(h,['RetentionProof'])
 const aged=await h.cmd('client.save',{firstName:'Synthetic',lastName:'Retained retail',dateOfBirth:'1950-01-01'})
 const visit=await pastVisit(h,aged.id,priya,service.id,h.owner,17)
 await h.db.prepare("UPDATE bm_appointments SET start_at='1990-01-02T02:00:00.000Z',end_at='1990-01-02T02:45:00.000Z' WHERE id=?").bind(visit).run()
 await h.db.prepare("INSERT INTO bm_retail_sales(id,client_id,kind,label,units,amount_cents,tax_cents,tax_basis_points,tax_state,tax_evidence,reference,recorded_at,recorded_by,receipt_base64) VALUES(?,?,'product','Synthetic old product',0,1000,0,0,'','','synthetic-balm-browser-old','1990-01-02T03:00:00.000Z',?,?)").bind(crypto.randomUUID(),aged.id,h.auth.OWNER_EMAIL,btoa('%PDF-1.4 Synthetic historical original')).run()
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
