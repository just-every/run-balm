import assert from 'node:assert/strict'
import {execFileSync} from 'node:child_process'
import {mkdir} from 'node:fs/promises'
import {chromium} from '@playwright/test'
import {harness} from './harness.mjs'
import {authorizationRequestFixture} from './authorization-request-journey.mjs'

const head=execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim()
assert.equal(execFileSync('git',['status','--porcelain'],{encoding:'utf8'}).trim(),'')
const root=process.env.BALM_UI_SCREENSHOTS
assert.ok(root);await mkdir(root,{recursive:true})
const browser=await chromium.launch({headless:true,...(process.env.BALM_CHROMIUM?{executablePath:process.env.BALM_CHROMIUM}:{}),args:['--no-sandbox','--use-mock-keychain','--password-store=basic']})
try{
 for(const width of [1440,390]){
  const h=await harness({browserHttps:true})
  let context
  try{
   const c=await authorizationRequestFixture(h);await c.sign()
   context=await browser.newContext({ignoreHTTPSErrors:true,viewport:{width,height:1000}})
   for(const [pattern,path,type] of [['**/rer-theme.css','public/rer-theme.css','text/css'],['**/fonts/fonts.css','public/fonts/fonts.css','text/css'],['**/brand/mark.svg','public/brand/mark.svg','image/svg+xml']])await context.route(pattern,r=>r.fulfill({path,contentType:type}))
   await context.route('**/fonts/inter/*.woff2',r=>r.fulfill({path:'public'+new URL(r.request().url()).pathname,contentType:'font/woff2'}))
   const cookie=async value=>{const [name,...parts]=value.split('=');await context.clearCookies();await context.addCookies([{name,value:parts.join('='),url:h.origin,secure:true}])}
   const page=await context.newPage()
   const capture=async(name,selector)=>{
    if(selector)await page.locator(selector).first().evaluate(el=>el.scrollIntoView({block:'start',behavior:'instant'}))
    assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),name+' fits '+width)
    const icons=await page.locator('button,a,label[for]').evaluateAll(els=>els.filter(el=>el.getBoundingClientRect().width&&el.getBoundingClientRect().height&&!el.textContent.trim()&&el.querySelector('svg')).map(el=>({label:el.getAttribute('aria-label'),tooltip:!!el.querySelector('[role=tooltip]')})))
    assert.ok(icons.every(el=>el.tooltip),'icon-only controls have tooltips: '+JSON.stringify(icons))
    await page.screenshot({path:root+'/'+name+'-'+width+'.png'})
   }
   await cookie(h.owner);await page.goto(h.origin+'/app/clients/'+c.patient.id)
   await page.getByText('Prepare a prior authorization request',{exact:true}).click()
   const prepare=page.locator('form[action*="insurance.authorization_request.prepare"]')
   await prepare.locator('[name=referralId]').selectOption(c.referral.id)
   await prepare.locator('[name=noteId]').selectOption(c.note.id)
   await prepare.locator('[name=planId]').selectOption(c.plan.id)
   await capture('INS-004-prepare','#authorization-requests')
   await prepare.getByRole('button',{name:'Prepare authorization packet',exact:true}).click()
   const request=(await h.send('/api/balm/clients/'+c.patient.id,undefined,h.owner)).value.insurance.authorizationRequests[0]
   assert.ok(request)
   assert.ok(await page.getByRole('link',{name:'Download fixed authorization packet'}).isVisible())
   await capture('INS-004-fixed-packet','#authorization-requests')
   await cookie(c.biller.cookie);await page.reload()
   assert.equal(await page.getByRole('link',{name:'Download fixed authorization packet'}).count(),0)
   await page.getByText('Record external submission',{exact:true}).click()
   const submit=page.locator('form[action*="insurance.authorization_request.submit"]')
   await submit.locator('[name=channel]').selectOption('payer_portal')
   await submit.locator('[name=submittedOn]').fill(c.today)
   await submit.locator('[name=reference]').fill('synthetic-balm-4')
   await submit.locator('[name=attest]').check()
   await capture('INS-004-record-submission','#authorization-requests')
   await submit.getByRole('button',{name:'Record submission',exact:true}).click()
   await page.getByText('Record payer approval',{exact:true}).click()
   const approval=page.locator('form[action*="insurance.authorization_request.decide"]').filter({has:page.locator('[name=decision][value=approved]')})
   for(const [name,value] of Object.entries({number:'synthetic-balm-6',startsOn:'2000-01-01',endsOn:'2099-12-31',visits:'2',lowRemainder:'2',decidedOn:c.today,reference:'synthetic-balm-5',reason:'Approved in the payer portal; reviewed written decision'}))await approval.locator('[name='+name+']').fill(value)
   await approval.locator('[name=bookingAction]').selectOption('block')
   await approval.locator('[name=attest]').check()
   await capture('INS-004-record-approval','#authorization-requests')
   await approval.getByRole('button',{name:'Record approval and create authorization',exact:true}).click()
   const file=(await h.send('/api/balm/clients/'+c.patient.id,undefined,c.biller.cookie)).value
   assert.equal(file.insurance.authorizationRequests[0].status,'approved')
   assert.equal(file.insurance.authorizations[0].remaining_visits,1)
   await capture('INS-004-approved','#authorization-requests')
   await page.getByRole('link',{name:'Open authorization created from this decision'}).click()
   await capture('INS-004-counted-authorization','#authorization-'+file.insurance.authorizations[0].id)
   await cookie(h.owner);await page.goto(h.origin+'/app/cases#case-'+c.referral.id)
   assert.match(await page.locator('#case-'+c.referral.id).innerText(),/Decision recorded: approved/)
   await capture('INS-004-referral','#case-'+c.referral.id)
   console.log('PASS INS-004 native prepare, submission, approval, counted authorization, referral and icon audit at '+width+' head='+head)
  }finally{await context?.close();await h.close()}
 }
}finally{await browser.close()}
