import { chartFixture } from './chart-template-journey.mjs'
// The tablet visit uses the production HTTP handlers, D1 and native sessions.
// Only the mail provider is faked by the shared harness.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdir } from 'node:fs/promises'
import { chromium } from '@playwright/test'
import { harness } from './harness.mjs'
import { clinic, pastVisit, visitDate } from './clinic.mjs'

const daily = chartFixture()
const interventions = [{code:'97110',minutes:33,parameters:'Synthetic step-ups and balance work, 3 sets of 10 with verbal cues'}]
const sections = {
  diagnosis: daily.sections.diagnosis,
  response: daily.sections.response,
  subjective: 'Walking confidence improved; no falls since the prior visit.',
  objective: 'Step-ups and balance work, 33 minutes; fewer verbal cues.',
  assessment: 'Improving gait stability and activity tolerance.',
  goals: 'Progressing toward independent community walking.',
  plan: 'Continue the balance program twice weekly.',
}
const editor = page => page.locator('form[data-actor-id]').filter({ has: page.getByRole('button', { name: 'Save draft', exact: true }) }).first()
const fill = async (form, values) => { for (const [key,value] of Object.entries(values)) await form.locator(`[name="section_${key}"]`).fill(value) }
const openEditor = async page => { await page.getByText('Edit draft', { exact: true }).first().click(); return editor(page) }
const save = form => form.getByRole('button', { name: 'Save draft', exact: true }).click()
const capture = async (page, name) => {
  const dir = process.env.BALM_UI_SCREENSHOTS
  if (!dir) return
  await mkdir(dir,{recursive:true})
  for (const width of [1440,390]) {
    await page.setViewportSize({width,height:1000})
    await page.locator('[data-note-draft-state]').first().scrollIntoViewIfNeeded()
    await page.screenshot({path:dir+'/'+name+'-'+width+'.png'})
  }
  await page.setViewportSize({width:820,height:1180})
}
const state = (form, value) => form.locator(`[data-note-draft-state="${value}"]`).waitFor()

test('MOBILE-001: tablet visit, disconnected draft/reconnect, missing session, lost response, conflict, home program and payment', { timeout: 120000 }, async () => {
  const h = await harness({ browserHttps: true })
  let browser
  try {
    await h.finishSetup()
    const { service } = await clinic(h)
    const clinician = await h.cmd('staff.save', { name: 'Jordan Parker', email: h.auth.OWNER_EMAIL, role: 'practitioner', profession: 'Physical therapist', credentials: 'PT, DPT', active: true })
    await h.cmd('hours.save', { practitionerId: clinician.id, hours: [0,1,2,3,4,5,6].map(weekday => ({ weekday, start:'00:00',end:'24:00' })) })
    await h.cmd('service.save', { id: service.id, name: 'Balance rehabilitation', durationMinutes:45, priceCents:9500, noteTemplate:'pt.daily' })
    const client = await h.cmd('client.save', { firstName:'Elena',lastName:'Martinez',dateOfBirth:'1971-09-22' })
    const visit = await pastVisit(h, client.id, clinician, service.id)
    const file = async () => (await h.send('/api/balm/clients/'+client.id,undefined,h.owner)).value
    browser = await chromium.launch({ headless:true, args:['--use-mock-keychain','--password-store=basic'] })
    const context = await browser.newContext({ viewport:{width:820,height:1180},ignoreHTTPSErrors:true })
    const [name,...value] = h.owner.split('=')
    const cookie = {name,value:value.join('='),url:h.origin,secure:true,httpOnly:true,sameSite:'Lax'}
    await context.addCookies([cookie])
    await context.route('**/brand/mark.svg',r=>r.fulfill({path:'public/brand/mark.svg',contentType:'image/svg+xml'}))
    await context.route('**/rer-theme.css',r=>r.fulfill({path:'public/rer-theme.css',contentType:'text/css'}))
    await context.route('**/fonts/fonts.css',r=>r.fulfill({path:'public/fonts/fonts.css',contentType:'text/css'}))
    await context.route('**/fonts/inter/*.woff2',r=>r.fulfill({path:'public'+new URL(r.request().url()).pathname,contentType:'font/woff2'}))
    const page = await context.newPage()
    await page.goto(`${h.origin}/app?date=${await visitDate(h,visit)}&appt=${visit}`)
    await page.locator('#visit').getByRole('button',{name:'Check in',exact:true}).click()
    await page.locator('#visit').getByRole('button',{name:'Mark attended',exact:true}).click()
    await page.getByRole('link',{name:'Open the note',exact:true}).click()
    let form = await openEditor(page)
    await fill(form, sections)
    for (const [index,goal] of daily.clinical.goals.entries()) {
      await form.getByText(`Goal ${index + 1}`,{exact:true}).click()
      await form.locator(`[name=goal_${index}_term]`).selectOption(goal.term)
      await form.locator(`[name=goal_${index}_text]`).fill(goal.text)
      await form.locator(`[name=goal_${index}_target]`).fill(goal.target)
      await form.locator(`[name=goal_${index}_deadline]`).fill(goal.deadline)
      await form.locator(`[name=goal_${index}_status]`).selectOption(goal.status)
    }
    await form.locator('[name=precautions]').fill(daily.clinical.precautions)
    await form.locator('[name=charge_code_0]').selectOption(interventions[0].code)
    await form.locator('[name=charge_minutes_0]').fill(String(interventions[0].minutes))
    await form.locator('[name=charge_parameters_0]').fill(interventions[0].parameters)
    await form.locator('[name=totalTimedMinutes]').fill('33')
    await form.locator('[name=totalTreatmentMinutes]').fill('33')
    await context.setOffline(true)
    await save(form)
    await state(form,'queued')
    await capture(page,'mobile-queued')
    assert.equal(await form.locator('[name=section_subjective]').inputValue(),sections.subjective)
    assert.equal((await file()).notes[0].revisions[0].number,0)
    const laterPlan = 'Continue twice weekly, with the home balance program reviewed after reconnection.'
    await form.locator('[name=section_plan]').fill(laterPlan)
    // Reconnection under an missing session cannot silently submit the clinical draft.
    await context.clearCookies()
    await context.setOffline(false)
    await state(form,'auth')
    await capture(page,'mobile-auth')
    await context.addCookies([cookie])
    await page.evaluate(() => window.dispatchEvent(new Event('online')))
    await state(form,'auth')
    await save(form)
    await state(form,'unsaved')
    assert.equal((await file()).notes[0].revisions[0].number,1)
    assert.equal((await file()).notes[0].revisions[0].sections.find(s=>s.id==='plan').text,sections.plan)
    assert.equal(await form.locator('[name=section_plan]').inputValue(),laterPlan)
    await capture(page,'mobile-later-edits')
    await save(form)
    try {
    await page.getByText(sections.subjective,{exact:true}).first().waitFor()
    } catch (error) {
      console.log('Draft status:',await page.locator('[data-note-draft-state]').first().textContent())
      console.log('Saved revision:',(await file()).notes[0].revisions[0].number)
      throw error
    }
    let note = (await file()).notes[0]
    assert.equal(note.revisions[0].number,2)
    assert.equal(note.status,'draft')
    // The server commits, then the return packet disappears. Same request replay is once-only.
    form = await openEditor(page)
    const improved = {...sections, subjective:'Walking 20 minutes without a rest; no increased knee pain.'}
    await fill(form, improved)
    let dropped = false
    await page.route('**/api/balm/command',async route => {
      if (!dropped) { dropped=true;await route.fetch();await route.abort('failed') }
      else await route.continue()
    })
    await save(form);await state(form,'queued')
    assert.equal((await file()).notes[0].revisions[0].number,3)
    await page.evaluate(() => window.dispatchEvent(new Event('online')))
    await page.getByText(improved.subjective,{exact:true}).first().waitFor()
    assert.equal((await file()).notes[0].revisions[0].number,3)
    await page.unroute('**/api/balm/command')
    // A newer clinical revision is never overwritten by a queued stale editor.
    form = await openEditor(page)
    await h.cmd('note.amend',{id:note.id,revision:3,clinical:daily.clinical,charges:interventions,totalTimedMinutes:33,totalTreatmentMinutes:33,sections:{...improved,assessment:'Current review: independent gait on level surfaces.'}},h.owner)
    await form.locator('[name=section_subjective]').fill('Unsaved stale editor text')
    await save(form);await state(form,'conflict')
    await capture(page,'mobile-conflict')
    assert.equal(await form.locator('[name=section_subjective]').inputValue(),'Unsaved stale editor text')
    assert.equal((await file()).notes[0].revisions[0].number,4)
    let warned = false
    page.once('dialog',dialog=>{warned = dialog.type()==='beforeunload';return dialog.accept()})
    await page.reload()
    assert.ok(warned,'closing or reloading warns before discarding unsaved clinical work')
    assert.equal((await page.request.get(h.origin+'/api/balm/clients/'+client.id)).headers()['cache-control'],'no-store')
    await page.getByText('Review and sign',{exact:true}).click()
    const sign = page.locator('form[action*="name=note.sign"]')
    await sign.locator('[name=signature]').fill('Jordan Parker')
    await sign.locator('[name=credentials]').fill('PT, DPT')
    await sign.locator('[name=attest]').check()
    await sign.getByRole('button',{name:'Sign note',exact:true}).click()
    assert.equal((await file()).notes[0].status,'signed')
    await page.getByText('Assign an exercise',{exact:true}).click()
    const program = page.locator('form[action*="name=exercise.assign"]')
    await program.locator('[name=title]').fill('Standing balance by a counter')
    await program.locator('[name=instructions]').fill('Stand by a stable counter, 3 sets of 10 seconds daily. Stop if dizzy.')
    await program.getByRole('button',{name:'Assign exercise',exact:true}).click()
    assert.equal((await file()).homeExercises.length,1)
    const approve = page.locator('form[action*="name=invoice.approve"]')
    await approve.locator('input[type=checkbox]').check()
    await approve.getByRole('button',{name:'Approve and number invoice',exact:true}).click()
    await page.getByText('Record a payment received',{exact:true}).click()
    const payment = page.locator('form[action*="name=payment.record"]')
    await payment.locator('[name=amount]').fill('95.00')
    await payment.locator('[name=reference]').fill('check-1092')
    await payment.getByRole('button',{name:'Record payment',exact:true}).click()
    assert.equal((await file()).billing.ledger.balanceCents,0)
    assert.equal((await file()).appointments.find(a=>a.id===visit).status,'attended')
    if (process.env.BALM_UI_SCREENSHOTS) for (const width of [1440,390]) {
      await page.setViewportSize({width,height:1000})
      await page.getByRole('heading',{name:/Invoice INV-/}).first().scrollIntoViewIfNeeded()
      await page.screenshot({path:process.env.BALM_UI_SCREENSHOTS+'/mobile-complete-'+width+'.png'})
    }
    await page.setViewportSize({width:390,height:844})
    assert.ok(await page.getByRole('heading',{name:'Treatment notes',exact:true}).count())
  } finally { if(browser) await browser.close();await h.close() }
})

test('SCHED-006: clinic settings, portal follow-up and a cross-origin embedded booking work in the browser', {timeout:120_000}, async()=>{
  await (await import('./self-service-browser.mjs')).selfServiceBrowser()
})


test('SEC-001: staff enroll and recover through real browser forms, then change idle policy and revoke a device', {timeout:90000}, async()=>{
 const {staffSecurityBrowser}=await import('./staff-security-browser.mjs')
 await staffSecurityBrowser()
})
