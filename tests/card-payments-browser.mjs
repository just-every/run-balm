import assert from 'node:assert/strict'
import { mkdir } from 'node:fs/promises'
import { chromium } from '@playwright/test'
import { harness } from './harness.mjs'
import { clinic } from './clinic.mjs'
import { fakeProviders } from './fakes/stripe.mjs'
import { cardPaymentsJourney, checkInResponsibilityJourney } from './card-payments-journey.mjs'

const output=process.env.BALM_UI_SCREENSHOTS
assert.ok(output,'Set a screenshot directory')
const live=!!process.env.STRIPE_SECRET_KEY
if(live)assert.ok(process.env.STRIPE_SECRET_KEY.includes('_test_'),'A held Stripe test key is required')
const stripe=live?{calls:[]}:fakeProviders()
await mkdir(output,{recursive:true})
const provider=async request=>{
 stripe.calls.push({method:request.method,path:new URL(request.url).pathname.replace(/^\/v1/,'')})
 const body=request.method==='POST'?await request.arrayBuffer():null
 if(body)assert.ok(!/(Ava|ava%40|M25[.]561|Therapy.follow-up)/.test(new TextDecoder().decode(body)),'Stripe receives amounts and opaque patient references only')
 const response=await fetch(request.url,{method:request.method,headers:request.headers,...(body?{body}:{}),redirect:'manual'})
 if(!response.ok){
  const value=await response.clone().json().catch(()=>({})),message=String(value.error?.message ?? 'HTTP '+response.status).replaceAll(process.env.STRIPE_SECRET_KEY,'[redacted]').replace(/(?:sk|rk)_(?:test|live)_[A-Za-z0-9_*….-]+/g,'[redacted]')
  console.log('Stripe refusal '+response.status+' '+new URL(request.url).pathname+': '+message)
 }
 return response
}
const h=await harness({browserHttps:true,outbound:live?provider:stripe.handler})
let browser,page
try{
 await h.finishSetup()
 const {service,practitioners:[priya]}=await clinic(h),reception=await h.staff('Rosa','reception')
 await h.cmd('pay.stripe.connect',{secretKey:live?process.env.STRIPE_SECRET_KEY:'synthetic-balm-1'})
 const client=await h.cmd('client.save',{firstName:'Ava',lastName:'Ng',dateOfBirth:'1992-06-15',email:'ava@client.example'})
 browser=await chromium.launch({headless:true,...(process.env.BALM_CHROMIUM_PATH?{executablePath:process.env.BALM_CHROMIUM_PATH}:{}),args:['--no-sandbox','--use-mock-keychain','--password-store=basic']})
 const context=await browser.newContext({ignoreHTTPSErrors:true})
 for(const [pattern,path,type] of [['**/rer-theme.css','public/rer-theme.css','text/css'],['**/fonts/fonts.css','public/fonts/fonts.css','text/css'],['**/brand/mark.svg','public/brand/mark.svg','image/svg+xml']])await context.route(pattern,r=>r.fulfill({path,contentType:type}))
 await context.route('**/fonts/inter/*.woff2',r=>r.fulfill({path:'public'+new URL(r.request().url()).pathname,contentType:'font/woff2'}))
 page=await context.newPage()
 const signIn=async cookie=>{await context.clearCookies();if(cookie){const [name,...parts]=cookie.split('=');await context.addCookies([{name,value:parts.join('='),url:h.origin,secure:true}])}}
 const submit=async form=>{await Promise.all([page.waitForNavigation(),form.getByRole('button',{name:/./}).first().click()])}
 const screen=async(name,path,selector,cookie)=>{
  await signIn(cookie)
  for(const width of [1440,390]){
   await page.setViewportSize({width,height:1000});await page.goto(h.origin+path)
   const target=page.locator(selector).first();await target.evaluate(el=>{for(let p=el.parentElement;p;p=p.parentElement)if(p.tagName==='DETAILS')p.open=true});await target.scrollIntoViewIfNeeded()
   assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),name+' fits '+width+' '+JSON.stringify(await page.locator('body *').evaluateAll(items=>items.filter(el=>el.getBoundingClientRect().right>innerWidth+1&&el.getClientRects().length).slice(-8).map(el=>({tag:el.tagName,cls:el.className,text:el.textContent?.slice(0,70)})))))
   const controls=await page.locator('button,a,[role=button]').evaluateAll(items=>items.filter(el=>{if(!el.getClientRects().length)return false;const clone=el.cloneNode(true);clone.querySelectorAll('[role=tooltip]').forEach(t=>t.remove());return !/[\p{L}\p{N}]/u.test(clone.textContent??'')}).map(el=>({label:el.getAttribute('aria-label'),tooltip:!!el.querySelector('[role=tooltip]')})))
   assert.ok(controls.every(c=>c.label&&c.tooltip),name+' named tooltips '+JSON.stringify(controls))
   if(name==='terminal-pending'||name==='responsibility-pending'||name==='responsibility-overdue-schedule'){
    const control=page.getByRole('link',{name:'Previous day',exact:true}),tip=control.getByRole('tooltip')
    await page.mouse.move(0,0);await control.blur()
    await control.evaluate(el=>{window.tooltipObservation=new Promise(resolve=>el.addEventListener('pointerenter',()=>{const values=[],tip=el.querySelector('[role=tooltip]');setTimeout(()=>values.push(getComputedStyle(tip).opacity),100);setTimeout(()=>{values.push(getComputedStyle(tip).opacity);resolve(values)},450)},{once:true}))})
    await control.hover();assert.deepEqual(await page.evaluate(()=>window.tooltipObservation),['0','1'])
    await page.mouse.move(0,0);await control.focus();assert.equal(await tip.evaluate(el=>getComputedStyle(el).visibility),'visible');await page.screenshot({path:output+'/calendar-tooltip-'+width+'.png'});await control.blur();await target.scrollIntoViewIfNeeded()
   }
   await page.screenshot({path:output+'/'+name+'-'+width+'.png'})
  }
  if(name==='refund-prepare'){
   const form=page.locator(selector);await form.locator('[name=paymentId]').selectOption({index:1});await form.locator('[name=amount]').fill('30.00');await form.locator('[name=reason]').fill('Synthetic duplicate copay');await submit(form)
  }
  if(name==='refund-approval'){
   const form=page.locator(selector);await form.locator('[name=attest]').check();await submit(form)
  }
  if(name==='terminal-pending')await submit(page.locator(selector))
  if(name==='responsibility-overdue-file'){
   const recovery=page.locator(selector).first(),form=recovery.locator('form').filter({has:page.getByRole('button',{name:'Check Stripe status',exact:true})})
   await submit(form)
   assert.ok(await page.locator(selector).count(),'original pending payment remains recoverable after a status check')
  }
  if(name==='refund-portal'||name==='terminal-portal'){
   const receipt=page.locator(name==='refund-portal'?'a[href^="/portal/refund-receipts/"]':'a[href^="/portal/receipts/"]').first()
   await Promise.all([page.waitForEvent('download'),receipt.click()])
  }
 }
 let locationId
 if(live){
  const r=await fetch('https://api.stripe.com/v1/terminal/locations',{method:'POST',headers:{authorization:'Bearer '+process.env.STRIPE_SECRET_KEY,'content-type':'application/x-www-form-urlencoded','stripe-version':'2026-09-30.endive'},body:new URLSearchParams({display_name:'Synthetic Balm clinic','address[line1]':'123 Test Street','address[city]':'San Francisco','address[state]':'CA','address[postal_code]':'94103','address[country]':'US'})})
  const v=await r.json();assert.ok(r.ok,v.error?.message);locationId=v.id
 }
 const checkout=async(started,source,cardNumber)=>{
  assert.equal(started.status,303,started.text)
  await page.goto(started.location)
  await page.waitForTimeout(1500)
  const linkSave=page.getByRole('checkbox',{name:/Save my information with Link/});if(await linkSave.count())await linkSave.uncheck()
  const email=page.getByRole('textbox',{name:'Email',exact:true});if(await email.count()&&await email.isEditable())await email.fill('synthetic-balm-'+client.id+'@example.com')
  await page.getByLabel('Card number',{exact:true}).fill(cardNumber ?? (source.startsWith('/intake')?'4000051230000072':'4242424242424242'))
  await page.getByLabel('Expiration',{exact:false}).fill('1234')
  await page.locator('#cardCvc,input[autocomplete=cc-csc]').first().fill('123')
  const name=page.getByLabel('Cardholder name',{exact:false});if(await name.count()&&await name.isEditable())await name.fill('Synthetic Balm')
  const country=page.locator('#billingCountry');if(await country.count()&&await country.isEnabled())await country.selectOption('US')
  const postal=page.locator('#billingPostalCode');if(await postal.count()&&await postal.isEditable())await postal.fill('94103')
  await page.getByRole('button',{name:'Save',exact:true}).click()
  await page.waitForURL(url=>url.origin===h.origin,{timeout:60000})
  const returnUrl=new URL(page.url())
  return h.send(returnUrl.pathname+returnUrl.search,undefined,source.startsWith('/portal')?(await context.cookies(h.origin)).map(c=>c.name+'='+c.value).join('; '):'')
 }
 const startCard=async(source,cookie)=>{
  await signIn(cookie);await page.goto(h.origin+source)
  const form=source.startsWith('/intake')?page.locator('form[action="?do=card"]'):page.locator('form').filter({has:page.locator('input[name="name"][value="payment.card"]')})
  const details=form.locator('xpath=..');if(await details.getAttribute('open')===null)await details.locator('summary').click()
  await form.locator('input[name="consent"]').check()
  await form.getByRole('button',{name:'Continue to Stripe'}).click()
  await page.waitForURL(url=>url.hostname==='checkout.stripe.com',{timeout:60000})
  return {status:303,location:page.url()}
 }
 const checkin=async(appointmentId,day,cookie)=>{
  await screen('saved-card-checkin','/app?date='+day,'form[action*="pay.checkin"]',cookie)
  const form=page.locator('form[action*="pay.checkin"]').filter({has:page.locator('input[name="appointmentId"][value="'+appointmentId+'"]')}).filter({has:page.locator('input[name="charge"]')})
  await submit(form)
  await screen('saved-card-paid','/app?date='+day,'a[href^="/api/balm/receipts/"]',cookie)
 }
 const collect=async(appointmentId,day,cookie)=>{
  await screen('terminal-collect','/app?date='+day,'form[action*="pay.terminal.collect"]',cookie)
  await submit(page.locator('form[action*="pay.terminal.collect"]').filter({has:page.locator('input[name="appointmentId"][value="'+appointmentId+'"]')}))
  return h.db.prepare('SELECT * FROM bm_card_payments WHERE appointment_id=? AND kind=\'copay\' ORDER BY created_at DESC LIMIT 1').bind(appointmentId).first()
 }
 const cardSaved=async(source,setup)=>console.log(JSON.stringify({proof:source,checkout:setup.id,setupIntent:(await h.db.prepare('SELECT setup_intent FROM bm_cards WHERE id=?').bind(setup.card_id).first()).setup_intent,card:setup.card_id}))
 const refunded=async({payment,approved,setup,portalSetup})=>console.log(JSON.stringify({proof:'cards-and-refund',account:payment.stripe_account_id,intakeSetup:setup.id,intakeIntent:(await h.db.prepare('SELECT setup_intent FROM bm_cards WHERE id=?').bind(setup.card_id).first()).setup_intent,portalSetup:portalSetup.id,portalIntent:(await h.db.prepare('SELECT setup_intent FROM bm_cards WHERE id=?').bind(portalSetup.card_id).first()).setup_intent,charge:payment.payment_intent,originalCharge:approved.charge_id,refund:approved.provider_refund_id}))
 const collectResponsibility=async(input,day,cookie,method)=>{
  await page.setViewportSize({width:1440,height:1000});await signIn(cookie);await page.goto(h.origin+'/app?date='+day)
  const name=method==='saved'?'pay.checkin.collect':'pay.terminal.collect'
  const form=page.locator('form[action*="'+name+'"]').filter({has:page.locator('input[name="invoiceId"][value="'+input.invoiceId+'"]')})
  await form.evaluate(el=>{for(let p=el.parentElement;p;p=p.parentElement)if(p.tagName==='DETAILS')p.open=true})
  await form.locator('[name=purpose]').selectOption(input.purpose);await form.locator('[name=amount]').fill(input.amount);await form.locator('[name=confirm]').check()
  const id=await form.locator('[name=paymentId]').inputValue()
  await submit(form)
  return h.db.prepare('SELECT * FROM bm_card_payments WHERE id=?').bind(id).first()
 }
 if(!live){
  const result=await checkInResponsibilityJourney({h,stripe,service,priya,reception},{screen,collectResponsibility})
  console.log('PASS PAY-002 patient responsibility: saved coinsurance, Terminal balance, exact ledger, patient receipts and icon tooltips at 1440 and 390')
 }else{
 const result=await cardPaymentsJourney({h,service,priya,reception,client},{screen,checkout,startCard,locationId,checkin,collect,refunded,cardSaved})
 console.log('PASS PAY-002 at 1440 and 390: intake, portal, approval, ledger, reports, Terminal pending and paid; named icon tooltips checked')
 console.log(JSON.stringify({account:result.payment.stripe_account_id,intakeSetup:result.setup.id,intakeIntent:(await h.db.prepare('SELECT setup_intent FROM bm_cards WHERE id=?').bind(result.setup.card_id).first()).setup_intent,portalSetup:result.portalSetup.id,portalIntent:(await h.db.prepare('SELECT setup_intent FROM bm_cards WHERE id=?').bind(result.portalSetup.card_id).first()).setup_intent,originalCharge:result.refund.charge_id,charge:result.payment.payment_intent,refund:result.refund.provider_refund_id,reader:result.terminal.reader_id,terminalIntent:result.terminal.payment_intent,terminalReceipt:result.terminal.receipt_number}))
 const responsibility=await checkInResponsibilityJourney({h,stripe,service,priya,reception},{screen,collectResponsibility,locationId,saveResponsibilityCard:async(started,path,declined)=>checkout(started,path,declined?'4000000000000341':'4242424242424242')})
 const collections=await h.db.prepare("SELECT id,collection_purpose,amount_cents,payment_intent,receipt_number FROM bm_card_payments WHERE client_id=? AND status='succeeded' ORDER BY created_at,id").bind(responsibility.patient.id).all()
 assert.deepEqual(collections.results.map(row=>[row.collection_purpose,row.amount_cents]).sort((a,b)=>a[0].localeCompare(b[0])||a[1]-b[1]),[['balance',200],['balance',400],['coinsurance',400],['coinsurance',1600]])
 const verified=[]
 for(const row of collections.results){
  const response=await provider(new Request('https://api.stripe.com/v1/payment_intents/'+encodeURIComponent(row.payment_intent),{headers:{authorization:'Bearer '+process.env.STRIPE_SECRET_KEY,'stripe-version':'2026-09-30.endive'}}))
  assert.equal(response.status,200)
  const intent=await response.json()
  assert.equal(intent.status,'succeeded');assert.equal(intent.livemode,false);assert.equal(intent.currency,'usd')
  assert.equal(intent.amount,row.amount_cents);assert.equal(intent.amount_received,row.amount_cents);assert.equal(intent.metadata.balm_payment,row.id)
  verified.push({...row,requestId:response.headers.get('request-id')})
 }
 console.log(JSON.stringify({proof:'live-checkin-responsibility',collections:verified,patientBalanceCents:0}))
 console.log('PASS PAY-002 live Stripe test mode: coinsurance and balance by saved card and simulated Terminal, exact cents, decline, replay, reservations, ledger and report parity, patient-only fixed receipts, and native screens at 1440 and 390. Physical reader operation remains unproved.')
 }
}catch(error){if(page)await page.screenshot({path:output+'/failed.png',fullPage:true}).catch(()=>{});throw error}finally{await browser?.close();await h.close()}
