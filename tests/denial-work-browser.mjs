import assert from 'node:assert/strict'
import {execFileSync} from 'node:child_process'
import {mkdir} from 'node:fs/promises'
import {chromium} from '@playwright/test'
import {denialWorkJourney} from './denial-work-journey.mjs'
const head=execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim()
assert.equal(execFileSync('git',['status','--porcelain'],{encoding:'utf8'}).trim(),'')
const root=process.env.BALM_UI_SCREENSHOTS;assert.ok(root);await mkdir(root,{recursive:true})
let browser,context,page
const open=async(h,cookie)=>{
 if(!browser){
  browser=await chromium.launch({headless:true,args:['--use-mock-keychain','--password-store=basic']})
  context=await browser.newContext({ignoreHTTPSErrors:true})
  for(const [pattern,path,type]of [['**/rer-theme.css','public/rer-theme.css','text/css'],['**/fonts/fonts.css','public/fonts/fonts.css','text/css'],['**/brand/mark.svg','public/brand/mark.svg','image/svg+xml']])await context.route(pattern,r=>r.fulfill({path,contentType:type}))
  await context.route('**/fonts/inter/*.woff2',r=>r.fulfill({path:'public'+new URL(r.request().url()).pathname,contentType:'font/woff2'}))
  page=await context.newPage()
 }
 const [name,...parts]=cookie.split('=');await context.clearCookies();await context.addCookies([{name,value:parts.join('='),url:h.origin,secure:true}])
 await page.goto(h.origin+'/app/insurance')
}
const capture=async(name,selector)=>{
 for(const width of [1440,390]){
  await page.setViewportSize({width,height:1000})
  await page.locator(selector).first().evaluate(el=>el.scrollIntoView({block:'start',behavior:'instant'}))
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),name+' fits '+width)
  await page.screenshot({path:root+'/'+name+'-'+width+'.png'})
 }
}
try{
 await denialWorkJourney({browserHttps:true,
  onDenied:async(h,d)=>{
   await open(h,d.biller.cookie)
   await capture('INS-008-denied-queue','#claim-work')
   const filters=page.locator('#claim-work form[method=get]')
   await filters.locator('[name=payerId]').selectOption(d.payer.id)
   await filters.locator('[name=age]').selectOption('0-30')
   await filters.locator('[name=reason]').selectOption('carc_4')
   await filters.getByRole('button',{name:'Filter claims',exact:true}).click()
   assert.ok(page.url().includes('reason=carc_4'))
   await capture('INS-008-filtered','#claim-work')
   await page.getByText('Record a payer filing instruction',{exact:true}).click()
   const rule=page.locator('form[action*="insurance.filing.save"]')
   await rule.locator('[name=payerId]').selectOption(d.payer.id)
   await rule.locator('[name=kind]').selectOption('correction')
   await rule.locator('[name=basis]').selectOption('adjudication_date')
   await rule.locator('[name=days]').fill('30');await rule.locator('[name=effectiveFrom]').fill(d.date)
   await rule.locator('[name=source]').fill('Horizon payer manual, corrected claims section, reviewed at the billing desk')
   await capture('INS-008-filing-instruction','form[action*="insurance.filing.save"]')
   await rule.getByRole('button',{name:'Record payer instruction',exact:true}).click()
   await page.getByText('Record payer decision date',{exact:true}).first().click()
   const decision=page.locator('form[action*="insurance.filing.date"]').first()
   await decision.locator('[name=adjudicationOn]').fill(d.date)
   await decision.locator('[name=source]').fill('Date printed on the payer EOB original')
   await decision.getByRole('button',{name:'Record decision date',exact:true}).click()
   await capture('INS-008-deadlines','#claim-work .claim-work-item')
  },
  recordActions:async(h,d)=>{
   await open(h,d.biller.cookie)
   for(const [kind,source]of [['followup','Payer phone confirmation: modifier correction requested'],['appeal_sent','Payer portal receipt: clinical appeal submitted outside Balm']]){
    await page.getByText('Record completed billing work',{exact:true}).first().click()
    const form=page.locator('form[action*="insurance.claim.action"]').first()
    await form.locator('[name=kind]').selectOption(kind);await form.locator('[name=on]').fill(d.date);await form.locator('[name=source]').fill(source)
    await capture('INS-008-'+kind,'form[action*="insurance.claim.action"]')
    await form.getByRole('button',{name:'Record completed work',exact:true}).click()
   }
  },
  onPaid:async(h,d)=>{
   await open(h,d.biller.cookie)
   await page.getByText('Other claim histories',{exact:true}).click()
   await page.getByText('Claim action history',{exact:true}).last().click()
   await capture('INS-008-paid-history','#claim-work')
   await page.goto(h.origin+'/app/clients/'+d.patient.id)
   await capture('INS-008-paid-claim','#claim-'+d.replacement.id)
  }
 })
 console.log('PASS INS-008 denied KX through corrected gateway submission and paid ERA; queue filters, payer limits, completed actions and history at 1440/390 head='+head)
}finally{await browser?.close()}
