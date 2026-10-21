import assert from 'node:assert/strict'
import { mkdir } from 'node:fs/promises'
import { Miniflare, convertV4MiniflareOptions } from 'miniflare'
import { createServer } from 'node:net'
import { chromium } from '@playwright/test'
import { harness } from './harness.mjs'
import { clinic, pastVisit } from './clinic.mjs'
import { portalLogin } from './portal-billing.mjs'

/** Real browser, production Worker/D1/auth; the external website is a static network fixture. */
export async function selfServiceBrowser() {
  const h=await harness({browserHttps:true})
  let browser, website
  try {
    await h.finishSetup()
    const {service,practitioners:[priya]}=await clinic(h)
    const patient=await h.cmd('client.save',{firstName:'Marisol',lastName:'Diaz',dateOfBirth:'1980-03-07',email:'marisol@patient.example'})
    await pastVisit(h,patient.id,priya,service.id)
    await h.cmd('hours.save',{practitionerId:priya.id,hours:[1,2,3,4,5].map(weekday=>({weekday,start:'09:00',end:'17:00'}))})
    const patientCookie=await portalLogin(h,'marisol@patient.example')
    const from=new Date(Date.now()+3*86400_000+10*3600_000).toISOString().slice(0,10)
    const bookUrl=h.origin+`/book?serviceId=${service.id}&practitionerId=${priya.id}&from=${from}`
    const socket=createServer();await new Promise(r=>socket.listen(0,'127.0.0.1',r));const port=socket.address().port;await new Promise(r=>socket.close(r))
    const hostHtml=`<!doctype html><html lang="en"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Riverside clinic website</title><h1>Riverside clinic</h1><iframe title="Book at Riverside" src="${bookUrl}" style="width:100%;height:900px;border:0"></iframe></html>`
    website=new Miniflare(convertV4MiniflareOptions({host:'127.0.0.1',port,https:true,modules:true,compatibilityDate:'2026-09-08',script:`export default {fetch(){return new Response(${JSON.stringify(hostHtml)},{headers:{'content-type':'text/html'}})}}`}))
    await website.ready
    const hostOrigin=`https://localhost:${port}`
    browser=await chromium.launch({headless:true,args:['--use-mock-keychain','--password-store=basic']})
    const context=await browser.newContext({viewport:{width:1440,height:1000},ignoreHTTPSErrors:true})
    await context.route('**/brand/mark.svg',r=>r.fulfill({path:'public/brand/mark.svg',contentType:'image/svg+xml'}))
    await context.route('**/rer-theme.css',r=>r.fulfill({path:'public/rer-theme.css',contentType:'text/css'}))
    await context.route('**/fonts/fonts.css',r=>r.fulfill({path:'public/fonts/fonts.css',contentType:'text/css'}))
    await context.route('**/fonts/inter/*.woff2',r=>r.fulfill({path:'public'+new URL(r.request().url()).pathname,contentType:'font/woff2'}))
    const addCookie=async cookie=>{const [name,...value]=cookie.split('=');await context.addCookies([{name,value:value.join('='),url:h.origin,secure:true,httpOnly:true,sameSite:'Lax'}])}
    await addCookie(h.owner)
    const page=await context.newPage()
    const diagnostics=[]
    page.on('console',m=>{if(m.type()==='error')diagnostics.push(m.text().replace(/https?:\/\/[^\s"']+/g,'[url]'))})
    const capture=async(name,selector,scope=page)=>{
      if(process.env.BALM_UI_SCREENSHOTS)await mkdir(process.env.BALM_UI_SCREENSHOTS,{recursive:true})
      for(const width of [1440,390]){
        await page.setViewportSize({width,height:1000})
        if(selector)await scope.locator(selector).first().scrollIntoViewIfNeeded()
        if(scope!==page)assert.ok(await scope.locator('html').evaluate(e=>e.scrollWidth<=e.clientWidth+1),'SCHED-006 iframe fits viewport')
        assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'SCHED-006 '+name+' fits viewport')
        if(process.env.BALM_UI_SCREENSHOTS)await page.screenshot({path:`${process.env.BALM_UI_SCREENSHOTS}/SCHED-006-${name}-${width}.png`})
      }
      await page.setViewportSize({width:1440,height:1000})
    }
    await page.goto(h.origin+'/app/clinic')
    const serviceForm=page.locator('form[action*="name=service.save"]').filter({has:page.locator(`input[name=id][value="${service.id}"]`)})
    await serviceForm.locator('..').getByText('Edit service',{exact:true}).click()
    await serviceForm.locator('[name=name]').fill('Follow-up therapy')
    await serviceForm.locator('[name=selfBookNoticeMinutes]').fill('180')
    await capture('service-rules','form[action*="name=service.save"]')
    await serviceForm.getByRole('button',{name:'Save service',exact:true}).click()
    const embed=page.locator('form[action*="name=booking.embed.save"]')
    await embed.locator('[name=origins]').fill(hostOrigin)
    await capture('embed-settings','form[action*="name=booking.embed.save"]')
    await embed.getByRole('button',{name:'Save allowed websites',exact:true}).click()
    assert.ok((await h.state()).settings.booking_embed_origins.includes(hostOrigin))
    await context.clearCookies();await addCookie(patientCookie)
    await page.goto(h.origin+'/portal/home')
    await page.getByRole('link',{name:'Book a follow-up',exact:true}).click()
    await capture('portal-choose')
    await page.locator('[name=serviceId]').selectOption(service.id)
    await page.locator('[name=practitionerId]').selectOption(priya.id)
    await page.locator('[name=from]').fill(from)
    await page.getByRole('button',{name:'Show available times',exact:true}).click()
    await page.locator('[name=start]').selectOption({index:5})
    const bookedStart=await page.locator('[name=start]').inputValue()
    await capture('portal-slots','select[name=start]')
    await page.getByRole('button',{name:'Book my follow-up',exact:true}).click()
    await page.waitForURL(/portal\/home/)
    let booked=(await h.state()).appointments.find(a=>a.client_id===patient.id&&a.start_at===bookedStart)
    assert.ok(booked)
    await capture('portal-booked','#visits')
    await page.locator(`a[href="/portal/appointments/${booked.id}/move"]`).click()
    await page.locator('[name=start]').selectOption({index:12})
    const movedStart=await page.locator('[name=start]').inputValue()
    await capture('portal-move','select[name=start]')
    await page.getByRole('button',{name:'Move my appointment',exact:true}).click()
    await page.waitForURL(/portal\/home/)
    assert.equal((await h.state()).appointments.find(a=>a.id===booked.id).start_at,movedStart)
    await capture('portal-moved','#visits')
    const mail=h.mail.findLast(m=>m.to.includes('marisol@patient.example')&&m.text.includes('/visit/'))
    const visit=new URL(mail.text.match(/https?:\/\/[^\s]+\/visit\/[A-Za-z0-9_-]+/)[0]).pathname
    await page.goto(h.origin+visit)
    await page.getByText('Choose a new appointment time',{exact:true}).click()
    await capture('reminder-move','select[name=start]')
    await page.getByText('Cancel this appointment',{exact:true}).click()
    const reminderCancel=page.locator('form').filter({has:page.locator('[name=action][value=cancel]')})
    await reminderCancel.locator('[name=reason]').fill('Patient requested a later week')
    await reminderCancel.locator('[name=confirm]').check()
    await capture('reminder-cancel','form:has(input[value=cancel])')
    await page.locator('[name=start]').selectOption({index:20})
    const reminderStart=await page.locator('[name=start]').inputValue()
    await page.getByRole('button',{name:'Move my appointment',exact:true}).click()
    await page.waitForURL(/portal/)
    assert.equal((await h.state()).appointments.find(a=>a.id===booked.id).start_at,reminderStart)
    await page.goto(h.origin+'/portal/home')
    await page.getByText('Cancel this visit',{exact:true}).first().click()
    const cancellation=page.locator('form').filter({has:page.locator('[name=name][value="appointment.cancel"]')}).first()
    await cancellation.locator('[name=reason]').fill('Travel changed; contact me about a later week')
    await cancellation.locator('[name=confirm]').check()
    await capture('portal-cancel','form:has(input[value="appointment.cancel"])')
    await cancellation.getByRole('button',{name:'Cancel my appointment',exact:true}).click()
    await page.waitForURL(/portal\/home/)
    assert.equal((await h.state()).appointments.find(a=>a.id===booked.id).status,'cancelled')
    await capture('portal-cancelled','#visits')
    // Embed uses a real cross-origin frame. The host cannot read its patient form.
    await page.goto(hostOrigin+'/appointments')
    const frame=page.frameLocator('iframe')
    await frame.locator('a.slot').first().waitFor({timeout:5000}).catch(()=>{throw new Error('Embedded booking failed: '+diagnostics.join('; '))})
    await frame.locator('a.slot').nth(7).click()
    await frame.locator('[name=firstName]').fill('Marisol')
    await frame.locator('[name=lastName]').fill('Diaz')
    await frame.locator('[name=dateOfBirth]').fill('1980-03-07')
    await frame.locator('[name=email]').fill('marisol@patient.example')
    await frame.locator('[name=privacy]').check()
    assert.equal(await page.evaluate(()=>{try{return document.querySelector('iframe').contentDocument?.body?.textContent ?? null}catch{return null}}),null)
    await capture('embedded-booking','form[action="/book#details"]',frame)
    const count=(await h.state()).appointments.filter(a=>a.client_id===patient.id).length
    await frame.getByRole('button',{name:'Book this appointment',exact:true}).click()
    await page.waitForURL(url=>url.origin===h.origin)
    assert.equal((await h.state()).appointments.filter(a=>a.client_id===patient.id).length,count+1,'SCHED-006 embedded booking commits and leaves the frame before private intake')
    assert.equal(page.frames().length,1)
    await capture('embedded-complete')
  } finally {if(browser)await browser.close();if(website)await website.dispose();await h.close()}
}
