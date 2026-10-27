import assert from 'node:assert/strict'
import {mkdir} from 'node:fs/promises'
import {execFileSync} from 'node:child_process'
import {chromium} from '@playwright/test'
import {harness} from './harness.mjs'
import {outcomeReportFixture} from './outcome-report-journey.mjs'

const head=execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim()
assert.equal(execFileSync('git',['status','--porcelain'],{encoding:'utf8'}).trim(),'')
const root=process.env.BALM_UI_SCREENSHOTS
if(root)await mkdir(root,{recursive:true})
const browser=await chromium.launch({headless:true,...(process.env.BALM_CHROMIUM?{executablePath:process.env.BALM_CHROMIUM}:{}),args:['--no-sandbox','--use-mock-keychain','--password-store=basic']})
const h=await harness({browserHttps:true})
try{
 const c=await outcomeReportFixture(h)
 const context=await browser.newContext({ignoreHTTPSErrors:true,viewport:{width:1440,height:1000}})
 try{
  for(const [pattern,path,type] of [['**/rer-theme.css','public/rer-theme.css','text/css'],['**/fonts/fonts.css','public/fonts/fonts.css','text/css'],['**/brand/mark.svg','public/brand/mark.svg','image/svg+xml']])await context.route(pattern,r=>r.fulfill({path,contentType:type}))
  await context.route('**/fonts/inter/*.woff2',r=>r.fulfill({path:'public'+new URL(r.request().url()).pathname,contentType:'font/woff2'}))
  const [name,...parts]=h.owner.split('=');await context.addCookies([{name,value:parts.join('='),url:h.origin,secure:true}])
  const page=await context.newPage()
  await page.goto(h.origin+'/app/reports?'+c.query+'#report-outcomes')
  const section=page.locator('#report-outcomes')
  assert.match(await section.innerText(),/20 episodes in this cohort/)
  assert.equal(await section.locator('tbody tr').count(),2)
  assert.match(await section.locator('article').first().innerText(),/40 → 60 out of 80 · mean change \+20/)
  assert.match(await section.locator('article').first().innerText(),/7 paired of 10 episodes\. Missing baseline: 2\. Missing follow-up: 2\. Missing both: 1/)
  assert.deepEqual((await section.locator('tbody tr').first().locator('td').allTextContents()).slice(4),['10','7','2','2','1','40','60','20','0'])
  const filters=section.locator('details.outcome-filters')
  const applied=section.getByRole('group',{name:'Applied outcome filters'})
  assert.equal(await filters.count(),1,'outcome filters have one collapsed control')
  assert.equal(await filters.getAttribute('open'),null)
  assert.equal(await section.locator('input[name=from]').isVisible(),false,'date controls start collapsed')
  assert.equal(await section.locator('select[name=diagnosis]').isVisible(),false,'optional filters start collapsed')
  const toggle=filters.locator('summary')
  await toggle.focus();await toggle.press('Enter')
  assert.equal(await section.locator('input[name=from]').isVisible(),true,'keyboard opens filters')
  assert.equal(await section.locator('select[name=payerId]').isVisible(),true)
  await section.locator('select[name=outcomePractitionerId]').selectOption(c.priya.id)
  await section.locator('select[name=diagnosis]').selectOption('M25.561')
  await section.locator('select[name=payerId]').selectOption(c.payer.id)
  await section.getByRole('button',{name:'Run outcome report',exact:true}).click()
  assert.match(await section.innerText(),/10 episodes in this cohort/)
  assert.equal(await section.locator('tbody tr').count(),1)
  assert.equal(await filters.getAttribute('open'),null,'filters collapse again after applying')
  assert.equal(await section.locator('select[name=diagnosis]').isVisible(),false)
  assert.match(await applied.innerText(),/From: .*Through: .*Practitioner: Priya.*Diagnosis: M25.561.*Payer: Synthetic payer/s)
  assert.equal(await applied.getByRole('link').count(),3)
  const download=await section.getByRole('link',{name:'Download outcomes CSV'}).getAttribute('href')
  assert.ok(download.includes('diagnosis=M25.561')&&download.includes(c.payer.id)&&download.includes(c.priya.id))
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'report fits the desktop viewport')
  const icons=await page.locator('button,a,label[for]').evaluateAll(els=>els.filter(el=>el.getBoundingClientRect().width&&el.getBoundingClientRect().height&&!el.textContent.trim()&&el.querySelector('svg')).map(el=>({label:el.getAttribute('aria-label'),tooltip:!!el.querySelector('[role=tooltip]')})))
  assert.ok(icons.every(el=>el.tooltip),'icon-only controls have tooltips: '+JSON.stringify(icons))
  for(const width of [1440,390]){
   await page.setViewportSize({width,height:1000})
   await section.scrollIntoViewIfNeeded()
   if(root){
    await section.screenshot({path:root+'/REPORT-003-'+width+'.png'})
    await filters.locator('summary').click()
    await section.screenshot({path:root+'/REPORT-003-filters-'+width+'.png'})
    await filters.locator('summary').click()
   }
  }
  await page.setViewportSize({width:1440,height:1000})
  await applied.getByRole('link',{name:'Remove diagnosis filter: M25.561',exact:true}).click()
  assert.equal(new URL(page.url()).searchParams.has('diagnosis'),false)
  assert.equal(new URL(page.url()).searchParams.get('payerId'),c.payer.id)
  assert.equal(new URL(page.url()).searchParams.get('outcomePractitionerId'),c.priya.id)
  assert.equal(await applied.getByRole('link').count(),2)
  assert.match(await section.innerText(),/10 episodes in this cohort/)
  await applied.getByRole('link',{name:'Remove practitioner filter: Priya',exact:true}).click()
  assert.equal(new URL(page.url()).searchParams.has('outcomePractitionerId'),false)
  assert.equal(new URL(page.url()).searchParams.get('payerId'),c.payer.id)
  await applied.getByRole('link',{name:'Remove payer filter: Synthetic payer',exact:true}).click()
  assert.equal(new URL(page.url()).searchParams.has('payerId'),false)
  assert.equal(await applied.getByRole('link').count(),0)
  assert.match(await section.innerText(),/20 episodes in this cohort/)
  assert.equal(new URL(page.url()).searchParams.get('from'),new URLSearchParams(c.query).get('from'))
  assert.equal(new URL(page.url()).searchParams.get('to'),new URLSearchParams(c.query).get('to'))
  console.log('PASS REPORT-003 native filters, hand-counted results, CSV and responsive screens at 1440 and 390 head='+head)
 }finally{await context.close()}
}finally{await h.close();await browser.close()}
