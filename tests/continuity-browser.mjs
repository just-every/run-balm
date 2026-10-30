import assert from 'node:assert/strict'
import { chromium } from '@playwright/test'
import { mkdir } from 'node:fs/promises'
import { harness } from './harness.mjs'
import { continuityFixture } from './continuity-journey.mjs'
import { portalLogin } from './portal-billing.mjs'

const h = await harness({ browserHttps: true })
let browser
try {
  const f = await continuityFixture(h), directory = process.env.BALM_UI_SCREENSHOTS
  if (directory) await mkdir(directory, { recursive: true })
  browser = await chromium.launch({ headless: true, ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH } : {}), args: ['--no-sandbox','--use-mock-keychain','--password-store=basic'] })
  const context = await browser.newContext({ ignoreHTTPSErrors: true })
  const [name, ...value] = f.priya.cookie.split('=')
  await context.addCookies([{ name, value: value.join('='), url: h.origin, secure: true }])
  for (const [pattern,path,type] of [['**/rer-theme.css','public/rer-theme.css','text/css'],['**/fonts/fonts.css','public/fonts/fonts.css','text/css']]) await context.route(pattern, r => r.fulfill({path,contentType:type}))
  await context.route('**/brand/mark.svg', r => r.fulfill({path:'public/brand/mark.svg',contentType:'image/svg+xml'}))
  const page = await context.newPage(), path = '/app/clients/' + f.patient.id + '#care-continuity'
  await page.setViewportSize({ width: 1440, height: 1100 })
  assert.equal((await page.goto(h.origin + path)).status(), 200)
  const section = page.locator('#care-continuity')
  const capture = async (stage, target = section) => {
    for (const width of [1440, 390]) {
      await page.setViewportSize({ width, height: 1100 })
      await target.scrollIntoViewIfNeeded()
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), 'continuity fits ' + width)
      if (directory) await page.screenshot({ path: directory + '/continuity-' + stage + '-' + width + '.png' })
    }
    await page.setViewportSize({ width: 1440, height: 1100 })
  }
  assert.match(await section.innerText(), /No date is booked or held/)
  await capture('prepare')
  const prepare = section.locator('form[action*="continuity.prepare"]')
  await prepare.locator('[name=seriesId]').selectOption(f.booked.seriesId)
  await Promise.all([page.waitForNavigation({waitUntil:'domcontentloaded'}), prepare.getByRole('button',{name:'Prepare replacement sequence',exact:true}).click()])
  assert.match(await section.innerText(), /Awaiting clinician review/)
  assert.match(await section.innerText(), /5 visits total, 0 used, 1 already reserved, 4 available/)
  const proposal = (await h.cmd('continuity.read',{clientId:f.patient.id},f.priya.cookie)).proposals[0]
  assert.deepEqual(proposal.payload.occurrences.map(o=>o.date),['2099-03-10','2099-03-15'])
  await section.getByText('Records used',{exact:true}).click()
  const sizes = await section.locator('p,label,button,li,summary').evaluateAll(els=>els.filter(el=>el.getClientRects().length).map(el=>parseFloat(getComputedStyle(el).fontSize)))
  assert.ok(sizes.every(size=>size>=13),'continuity text is at least 13px')
  const iconOnly = await page.locator('button,a,[role=button]').evaluateAll(els=>els.filter(el=>{if(!el.getClientRects().length)return false;const clone=el.cloneNode(true);clone.querySelectorAll('[role=tooltip]').forEach(t=>t.remove());return !/[\p{L}\p{N}]/u.test(clone.textContent??'')}).map(el=>({label:el.getAttribute('aria-label'),tip:!!el.querySelector('[role=tooltip]')})))
  assert.ok(iconOnly.every(c=>c.label&&c.tip),'visible icon controls have named tooltips')
  const tipControl=page.locator('a,button').filter({has:page.locator('[role=tooltip]')}).first()
  if(await tipControl.count()){
    await tipControl.hover();await page.waitForTimeout(400)
    assert.ok(await tipControl.locator('[role=tooltip]').isVisible())
    await page.mouse.move(0,0);await tipControl.focus()
    assert.ok(await tipControl.locator('[role=tooltip]').isVisible())
  }
  await capture('review')
  const approve=section.locator('form[action*="continuity.approve"]')
  await approve.locator('[name=confirm]').check()
  const appointments=(await h.state()).appointments.length,mail=h.mail.length
  await Promise.all([page.waitForNavigation({waitUntil:'domcontentloaded'}),approve.getByRole('button',{name:'Approve preparation',exact:true}).click()])
  assert.match(await section.innerText(),/Preparation approved/)
  assert.equal(await section.locator('form[action*="continuity.approve"]').count(),0)
  assert.equal((await h.state()).appointments.length,appointments)
  assert.equal(h.mail.length,mail)
  await capture('approved')
  const offerForm = section.locator('form[action*="continuity.offer"]')
  await offerForm.locator('[name=confirm]').check()
  await Promise.all([page.waitForNavigation({ waitUntil: 'domcontentloaded' }), offerForm.getByRole('button', { name: 'Offer dates in patient portal', exact: true }).click()])
  assert.match(await section.innerText(), /Portal offer expires/)
  assert.equal((await h.state()).appointments.length, appointments, 'a portal offer holds no booking')
  assert.equal(h.mail.length, mail, 'release sends no unsolicited notice')
  await capture('offered')
  const patientCookie = await portalLogin(h, ['synthetic-balm-204', 'patient.example'].join('@'))
  const [patientName, ...patientValue] = patientCookie.split('=')
  await context.addCookies([{ name: patientName, value: patientValue.join('='), url: h.origin, secure: true }])
  assert.equal((await page.goto(h.origin + '/portal/home#visits')).status(), 200)
  const offered = page.locator('[data-continuity-offer]')
  assert.match(await offered.innerText(), /Replacement visits/)
  assert.match(await offered.innerText(), /March 10|Mar 10|10 Mar|03\/10/)
  assert.equal(await offered.locator('li').count(), 2)
  await capture('patient-review', offered)
  await offered.locator('[name=confirm]').check()
  await Promise.all([page.waitForNavigation({ waitUntil: 'domcontentloaded' }), offered.getByRole('button', { name: 'Accept all replacement visits', exact: true }).click()])
  assert.match(await offered.innerText(), /All replacement visits are booked above/)
  assert.equal((await h.state()).appointments.length, appointments + 2)
  await capture('patient-booked', offered)
  console.log('PASS native continuity preparation, separate portal release and patient acceptance, exact dates and all-or-nothing bookings; screens 1440 and 390')
} finally { await browser?.close(); await h.close() }
