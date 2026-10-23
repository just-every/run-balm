import assert from 'node:assert/strict'
import {execFileSync} from 'node:child_process'
import {mkdir} from 'node:fs/promises'
import {chromium} from '@playwright/test'
import {harness} from './harness.mjs'
import {manualPayerJourney,payerEobPdf} from './manual-payer-journey.mjs'
const head=execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim()
assert.equal(execFileSync('git',['status','--porcelain'],{encoding:'utf8'}).trim(),'')
const root=process.env.BALM_UI_SCREENSHOTS
assert.ok(root);await mkdir(root,{recursive:true})
const h=await harness({browserHttps:true});let browser
try{
 const data=await manualPayerJourney(h)
 browser=await chromium.launch({headless:true,args:['--use-mock-keychain','--password-store=basic']})
 const context=await browser.newContext({ignoreHTTPSErrors:true})
 for(const [pattern,path,type] of [['**/rer-theme.css','public/rer-theme.css','text/css'],['**/fonts/fonts.css','public/fonts/fonts.css','text/css'],['**/brand/mark.svg','public/brand/mark.svg','image/svg+xml']])await context.route(pattern,r=>r.fulfill({path,contentType:type}))
 await context.route('**/fonts/inter/*.woff2',r=>r.fulfill({path:'public'+new URL(r.request().url()).pathname,contentType:'font/woff2'}))
 const cookie=async value=>{const [name,...parts]=value.split('=');await context.clearCookies();await context.addCookies([{name,value:parts.join('='),url:h.origin,secure:true}])}
 const page=await context.newPage()
 const capture=async(name,selector)=>{
  for(const width of [1440,390]){
   await page.setViewportSize({width,height:1000})
   if(selector)await page.locator(selector).first().evaluate(el=>el.scrollIntoView({block:'start',behavior:'instant'}))
   assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),name+' fits '+width)
   await page.screenshot({path:root+'/'+name+'-'+width+'.png'})
  }
 }
 await cookie(data.biller.cookie);await page.goto(h.origin+'/app/insurance')
 await page.getByText('Start a payer payment batch',{exact:true}).click()
 const start=page.locator('form[action*="insurance.payer_batch.prepare"]')
 await start.locator('[name=payerId]').selectOption(data.payer.id)
 await start.locator('[name=reference]').fill('synthetic-balm-15')
 await start.locator('[name=depositOn]').fill(data.today)
 await start.locator('[name=amount]').fill('84.00')
 await capture('INS-012-new-check','form[action*="insurance.payer_batch.prepare"]')
 await start.getByRole('button',{name:'Start payer batch',exact:true}).click()
 const batch=(await h.state(data.biller.cookie)).insurance.manualPayers.find(b=>b.reference==='synthetic-balm-15')
 const section=page.locator('#payer-batch-'+batch.id)
 await section.getByText('Add claim payment or denial',{exact:true}).click()
 const payment=section.locator('form[action*="insurance.payer_line.add"]').filter({has:page.locator('[name=kind][value=payment]')})
 await payment.locator('[name=claimId]').selectOption(data.claims[4].id)
 for(const [key,value]of Object.entries({billed:'95.00',allowed:'85.00',paid:'85.00',payerControl:'synthetic-balm-16',reason:'Payer correction on the original EOB',adj_0_reason:'45',adj_0_amount:'10.00',remarks:'N20'}))await payment.locator('[name='+key+']').fill(value)
 await payment.locator('[name=adj_0_group]').selectOption('CO')
 await capture('INS-012-payment-line','#payer-batch-'+batch.id+' form[action*="insurance.payer_line.add"]')
 await payment.getByRole('button',{name:'Add claim line',exact:true}).click()
 await section.getByText('Add interest or recoupment',{exact:true}).click()
 const recoup=section.locator('form[action*="insurance.payer_line.add"]').filter({has:page.locator('[name=kind][value=recoupment]')})
 await recoup.locator('[name=claimId]').selectOption(data.claims[2].id)
 await recoup.locator('[name=amount]').fill('2.00');await recoup.locator('[name=reason]').fill('Offset against the earlier paid claim')
 await recoup.getByRole('button',{name:'Add recoupment',exact:true}).click()
 await section.getByText('Attach the original EOB',{exact:true}).click()
 const upload=section.locator('form[action*="insurance.payer_eob.attach"]')
 await upload.locator('[name=attachment]').setInputFiles({name:'synthetic-balm-17.pdf',mimeType:'application/pdf',buffer:payerEobPdf})
 await upload.locator('[name=attest]').check()
 await capture('INS-012-original-scan','#payer-batch-'+batch.id+' form[action*="insurance.payer_eob.attach"]')
 await upload.getByRole('button',{name:'Attach scanned EOB',exact:true}).click()
 const close=section.locator('form[action*="insurance.payer_batch.close"]')
 await close.locator('[name=attest]').check();await close.getByRole('button',{name:'Close balanced batch and post',exact:true}).click()
 assert.equal((await h.state(data.biller.cookie)).insurance.manualPayers.find(b=>b.id===batch.id).status,'draft')
 await capture('INS-012-unbalanced','#payer-batch-'+batch.id)
 await section.getByText('Add interest or recoupment',{exact:true}).click()
 const interest=section.locator('form[action*="insurance.payer_line.add"]').filter({has:page.locator('[name=kind][value=interest]')})
 await interest.locator('[name=amount]').fill('1.00');await interest.locator('[name=reason]').fill('Interest on the corrected check')
 await interest.getByRole('button',{name:'Add interest',exact:true}).click()
 await close.locator('[name=attest]').check();await close.getByRole('button',{name:'Close balanced batch and post',exact:true}).click()
 assert.equal((await h.state(data.biller.cookie)).insurance.manualPayers.find(b=>b.id===batch.id).status,'closed')
 await capture('INS-012-closed','#payer-batch-'+batch.id)
 await page.goto(h.origin+'/app/clients/'+data.claims[2].patient.id)
 await capture('INS-012-reopened-ledger','#billing')
 await page.goto(h.origin+'/app/reports?from='+data.today+'&to='+data.today)
 await capture('INS-012-deposits','#report-deposits')
 await cookie(data.portal);await page.goto(h.origin+'/portal/home')
 await capture('INS-012-patient-balance','#statements')
 console.log('PASS INS-012 real check, claim line, scan, refused unbalanced close, interest, recoupment, close, ledger and deposits at 1440/390 head='+head)
}finally{await browser?.close();await h.close()}
