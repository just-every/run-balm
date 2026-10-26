import assert from 'node:assert/strict'
import { mock } from 'node:test'
import { mkdir } from 'node:fs/promises'
import { chromium } from '@playwright/test'
import { harness } from './harness.mjs'
import { fakeProviders } from './fakes/stripe.mjs'
import { quickbooksEdge, accountingMappings } from './fakes/quickbooks.mjs'
import { accountingDayFixture, accountingDay, accountingNow } from './accounting-day.mjs'

mock.timers.enable({ apis: ['Date'], now: accountingNow })
const stripe = fakeProviders(), qbo = quickbooksEdge()
let h, browser
try {
  h = await harness({ entry: 'tests/accounting-worker.ts', browserHttps: true, outbound: r => new URL(r.url).hostname === 'api.stripe.com' ? stripe.handler(r) : qbo.outbound(r) })
  const day = await accountingDayFixture(h, stripe)
  browser = await chromium.launch({ headless: true, args: ['--use-mock-keychain', '--password-store=basic'] })
  const context = await browser.newContext({ ignoreHTTPSErrors: true, locale: 'en-US' })
  for (const [pattern, path, contentType] of [['**/rer-theme.css','public/rer-theme.css','text/css'],['**/fonts/fonts.css','public/fonts/fonts.css','text/css'],['**/brand/mark.svg','public/brand/mark.svg','image/svg+xml']]) await context.route(pattern, r => r.fulfill({ path, contentType }))
  await context.route('**/fonts/inter/*.woff2', r => r.fulfill({ path: 'public' + new URL(r.request().url()).pathname, contentType: 'font/woff2' }))
  const [name, ...value] = h.owner.split('=')
  await context.addCookies([{ name, value: value.join('='), url: h.origin, secure: true }])
  const page = await context.newPage(), dir = process.env.BALM_UI_SCREENSHOTS ?? '.cache/accounting-screens'
  if (dir) await mkdir(dir, { recursive: true })
  const capture = async (name, selector = '#accounting') => {
    for (const width of [1440, 390]) {
      await page.setViewportSize({ width, height: 1000 })
      await page.locator(selector).first().evaluate(el => el.scrollIntoView({ block: 'start', behavior: 'instant' }))
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), name + ' fits ' + width)
      const icons = await page.locator('button,a,[role=button]').evaluateAll(items => items.filter(el => el.getClientRects().length && !/[\p{L}\p{N}]/u.test(el.textContent ?? '')).map(el => ({ label: el.getAttribute('aria-label'), tooltip: !!el.querySelector('[role=tooltip]') })))
      assert.ok(icons.every(i => i.label && i.tooltip), name + ' icon controls have tooltips')
      if (dir) {
        await page.screenshot({ path: `${dir}/${name}-${width}.png` })
        if ((await page.locator(selector).first().boundingBox()).height > 1000) {
          await page.locator(selector).first().evaluate(el => el.scrollIntoView({block:'end',behavior:'instant'}))
          await page.screenshot({path:`${dir}/${name}-tail-${width}.png`})
        }
      }
    }
  }
  assert.equal((await page.goto(h.origin + '/app/clinic')).status(), 200)
  await capture('accounting-connect')
  let form = page.locator('form[action*="accounting.connect"]')
  for (const [key, val] of Object.entries({ realmId: '123', clientId: 'synthetic-balm-8', clientSecret: 'synthetic-balm-9', refreshToken: 'synthetic-balm-10' })) await form.locator(`[name="${key}"]`).fill(val)
  await form.locator('[name=confirm]').check()
  await form.getByRole('button', { name: 'Connect QuickBooks' }).click()
  await capture('accounting-mappings')
  form = page.locator('form[action*="accounting.mapping"]')
  for (const [key, val] of Object.entries(accountingMappings)) await form.locator(`[name="${key}"]`).selectOption(val)
  await form.locator('[name=confirm]').check()
  await form.getByRole('button', { name: 'Approve mappings' }).click()
  form = page.locator('form[action*="accounting.prepare"]')
  await form.locator('[name=day]').fill(accountingDay)
  await form.getByRole('button', { name: 'Review day' }).click()
  await capture('accounting-review')
  form = page.locator('form[action*="accounting.sync"]').first()
  await form.locator('[name=confirm]').check()
  await form.getByRole('button', { name: 'Approve and sync' }).click()
  assert.equal(qbo.journals.size, 1)
  await capture('accounting-confirmed')
  form = page.locator('form[action*="accounting.prepare"]')
  await form.locator('[name=day]').fill(accountingDay)
  await form.getByRole('button', { name: 'Review day' }).click()
  assert.equal(qbo.journals.size, 1)
  await page.getByRole('status').filter({hasText:'QuickBooks matches this day'}).waitFor()
  await capture('accounting-up-to-date')
  await page.goto(h.origin + '/app/clients/' + day.cashClient.id)
  await page.getByText('Record a payment received', { exact: true }).first().click()
  form = page.locator('form[action*="payment.record"]').first()
  await form.locator('[name=amount]').fill('10.00')
  await form.locator('[name=paymentMethod]').selectOption('cash')
  await form.locator('[name=reference]').fill('synthetic-balm-20')
  await capture('accounting-cash-tender', 'form[action*="payment.record"]')
  await form.getByRole('button', {name:'Record payment',exact:true}).click()
  const late = await h.cmd('accounting.prepare', {day:accountingDay})
  assert.equal(late.sources,1)
  assert.ok(late.lines.every(l=>l.Description==='payment · cash' && l.Amount===10), 'cash selected on the built patient form reaches the journal once')
  console.log('PASS: native connection, mapping review, mixed-day approval, confirmed replay and cash tender at 1440 and 390; visible icon controls have tooltips.')
} finally { if (browser) await browser.close(); if (h) await h.close(); mock.timers.reset() }
