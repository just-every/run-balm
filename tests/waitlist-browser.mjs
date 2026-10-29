import assert from 'node:assert/strict'
import {mkdir} from 'node:fs/promises'
import {chromium} from '@playwright/test'
import {harness} from './harness.mjs'
import {clinic} from './clinic.mjs'

const output=process.env.BALM_UI_SCREENSHOTS
assert.ok(output,'Set the external screen directory')
await mkdir(output,{recursive:true})
const browser=await chromium.launch({headless:true,...(process.env.BALM_CHROMIUM?{executablePath:process.env.BALM_CHROMIUM}:{}),args:['--no-sandbox','--use-mock-keychain','--password-store=basic']})
const h=await harness({browserHttps:true})
let context
try{
 await h.finishSetup()
 const {service,practitioners:[priya]}=await clinic(h)
 await h.cmd('settings.save',{clinicName:'Riverside Physio',timeZone:'America/New_York',confirmTimeZone:true})
 const patient=await h.cmd('client.save',{firstName:'Synthetic',lastName:'Waiting',dateOfBirth:'1990-01-01',email:['synthetic-balm-511','patient.example'].join('@')})
 const source=await h.cmd('client.save',{firstName:'Synthetic',lastName:'Opening'})
 context=await browser.newContext({ignoreHTTPSErrors:true,viewport:{width:1440,height:1000}})
 for(const [pattern,path,type] of [['**/rer-theme.css','public/rer-theme.css','text/css'],['**/fonts/fonts.css','public/fonts/fonts.css','text/css'],['**/brand/mark.svg','public/brand/mark.svg','image/svg+xml']])await context.route(pattern,r=>r.fulfill({path,contentType:type}))
 await context.route('**/fonts/**/*.woff2',r=>r.fulfill({path:'public'+new URL(r.request().url()).pathname,contentType:'font/woff2'}))
 const login=async()=>{const [name,...parts]=h.owner.split('=');await context.addCookies([{name,value:parts.join('='),url:h.origin,secure:true}])}
 await login()
 const page=await context.newPage()
 const capture=async(name,target)=>{
  for(const width of [1440,390]){
   await page.setViewportSize({width,height:1100})
   await target.scrollIntoViewIfNeeded();await page.evaluate(()=>document.fonts.ready)
   console.log(name+' width='+width)
   await page.screenshot({path:output+'/'+name+'-'+width+'.png'})
  }
  await page.setViewportSize({width:1440,height:1100})
 }
 const fits=async()=>{
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'screen fits')
  const small=await page.locator('form[action*="waitlist.add"] label, form[action*="waitlist.add"] legend, form[action*="waitlist.add"] .help').evaluateAll(els=>els.filter(el=>el.getClientRects().length&&parseFloat(getComputedStyle(el).fontSize)<13).map(el=>el.textContent))
  assert.deepEqual(small,[],'preference controls use readable text')
  const icons=await page.locator('button,a,label[for]').evaluateAll(els=>els.filter(el=>el.getClientRects().length&&!el.textContent.trim()&&el.querySelector('svg')).map(el=>({label:el.getAttribute('aria-label'),tooltip:!!el.querySelector('[role=tooltip]')})))
  assert.ok(icons.every(i=>i.label&&i.tooltip),'icon-only controls have named tooltips')
 }
 await page.goto(h.origin+'/app/waitlist')
 let form=page.locator('form[action*="waitlist.add"]')
 await form.locator('[name=clientId]').selectOption(patient.id)
 await form.locator('[name=practitionerId]').selectOption(priya.id)
 await form.locator('[name=serviceId]').selectOption(service.id)
 await form.locator('[name=earliestDate]').fill('2099-03-01')
 await form.locator('[name=latestDate]').fill('2099-03-31')
 for(let d=1;d<7;d++)await form.locator('[name=weekday_'+d+']').uncheck()
 await form.locator('[name=timeFrom]').fill('09:00');await form.locator('[name=timeUntil]').fill('09:45')
 await fits();await capture('waitlist-preference-entry',form)
 await Promise.all([page.waitForNavigation(),form.getByRole('button',{name:'Add to waitlist',exact:true}).click()])
 const waiting=(await h.state()).waitlist.entries.find(e=>e.client_id===patient.id)
 assert.deepEqual([JSON.parse(waiting.preferred_weekdays),waiting.preferred_start_minute,waiting.preferred_end_minute],[[0],540,585],'the native form saves its selected weekday and times')
 assert.match(await page.locator('main').innerText(),/Sunday · 09:00 to 09:45/)
 await fits();await capture('waitlist-saved-preferences',page.getByRole('heading',{name:'Waiting (1)',exact:true}))
 // The client file uses the same native entry form.
 await page.goto(h.origin+'/app/clients/'+patient.id)
 await page.getByText('Add to the waitlist',{exact:true}).click()
 form=page.locator('form[action*="waitlist.add"]')
 assert.equal(await form.locator('[name=timeFrom]').count(),1)
 await fits();await capture('client-waitlist-entry',form)
 const patientTwo=await h.cmd('client.save',{firstName:'Synthetic',lastName:'Second turn',dateOfBirth:'1990-01-01',email:['synthetic-balm-512','patient.example'].join('@')})
 const patientThree=await h.cmd('client.save',{firstName:'Synthetic',lastName:'Third turn',dateOfBirth:'1990-01-01',email:['synthetic-balm-513','patient.example'].join('@')})
 for(const clientId of [patientTwo.id,patientThree.id])await h.cmd('waitlist.add',{clientId,practitionerId:priya.id,serviceId:service.id,earliestDate:'2099-03-01',latestDate:'2099-03-31',weekdays:[0],timeFrom:'09:00',timeUntil:'09:45'})
 const visit=await h.cmd('appointment.book',{clientId:source.id,practitionerId:priya.id,serviceId:service.id,date:'2099-03-08',time:'09:00'})
 await h.cmd('appointment.cancel',{id:visit.appointmentId,reason:'Synthetic browser opening'})
 const mail=h.mail.findLast(m=>m.subject.startsWith('A time opened up'))
 const path=new URL(mail.text.match(/https?:\/\/\S+\/offer\/[\w-]+/)[0]).pathname
 await context.clearCookies();await page.goto(h.origin+path)
 assert.match(await page.locator('main').innerText(),/A time opened up/)
 await fits();await capture('waitlist-matching-offer',page.getByRole('heading',{name:'A time opened up',exact:true}))
 assert.match(await page.locator('main').innerText(),/Held for you until/)
 const expired=new Date(Date.now()-60000).toISOString()
 await h.db.prepare("UPDATE bm_offers SET hold_until=? WHERE status='open'").bind(expired).run()
 await h.db.prepare('UPDATE bm_offer_recipients SET expires_at=? WHERE activated_at IS NOT NULL').bind(expired).run()
 await page.reload()
 assert.match(await page.locator('main').innerText(),/Your hold has expired/)
 assert.equal(await page.getByRole('button',{name:'Book this time',exact:true}).count(),0)
 await fits();await capture('waitlist-expired-hold',page.getByRole('heading',{name:'Your hold has expired',exact:true}))
 await (await h.mf.getWorker()).scheduled({scheduledTime:Date.now(),cron:'* * * * *'})
 const next=h.mail.findLast(m=>m.to.includes(['synthetic-balm-512','patient.example'].join('@'))&&m.subject.startsWith('A time opened up'))
 assert.ok(next,'the second patient receives the next turn')
 await page.goto(new URL(next.text.match(/https?:\/\/\S+\/offer\/[\w-]+/)[0]).href)
 assert.match(await page.locator('main').innerText(),/Held for you until/)
 await fits();await capture('waitlist-next-turn',page.getByRole('heading',{name:'A time opened up',exact:true}))
 await Promise.all([page.waitForNavigation(),page.getByRole('button',{name:'Book this time',exact:true}).click()])
 assert.match(await page.locator('main').innerText(),/You're booked/)
 assert.equal((await h.state()).appointments.filter(a=>a.client_id===patientTwo.id&&a.status==='booked').length,1)
 await login();await page.goto(h.origin+'/app/waitlist')
 assert.match(await page.locator('main').innerText(),/Booked from an offer/)
 await fits();await capture('waitlist-booked-history',page.getByRole('heading',{name:'Booked or removed',exact:true}))
 assert.ok(h.mail.some(m=>m.to.includes(['synthetic-balm-513','patient.example'].join('@'))&&m.subject.includes('has been taken')),'the third patient receives the taken notice')
 console.log('PASS ordered email expiry, second-patient acceptance, third-patient taken notice; native waitlist preferences, patient-file entry, matching DST offer and one booking; browser assertions at 1440; screens at 1440 and 390')
}finally{await context?.close();await h.close();await browser.close()}
