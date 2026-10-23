// UI receipts use actual Worker pages, native sign-in, D1 and forms. CMS alone
// is faked at its network edge; the shared harness provisions its code fixtures.
import assert from 'node:assert/strict'
import {mkdir} from 'node:fs/promises'
import {test} from 'node:test'
import {chromium} from '@playwright/test'
import {harness} from './harness.mjs'
import {codeSetEdge} from './code-sets-journey.mjs'

async function browserContext(h){
 const browser=await chromium.launch({headless:true,args:['--use-mock-keychain','--password-store=basic']})
 const context=await browser.newContext({ignoreHTTPSErrors:true})
 for(const [pattern,path,contentType] of [['**/rer-theme.css','public/rer-theme.css','text/css'],['**/fonts/fonts.css','public/fonts/fonts.css','text/css'],['**/brand/mark.svg','public/brand/mark.svg','image/svg+xml']])await context.route(pattern,r=>r.fulfill({path,contentType}))
 await context.route('**/fonts/inter/*.woff2',r=>r.fulfill({path:'public'+new URL(r.request().url()).pathname,contentType:'font/woff2'}))
 const signIn=async(cookie)=>{await context.clearCookies();const [name,...value]=cookie.split('=');await context.addCookies([{name,value:value.join('='),url:h.origin,secure:true}])}
 await signIn(h.owner)
 return {browser,context,page:await context.newPage(),signIn}
}
async function receipt(page,name,width,locator){
 await locator.scrollIntoViewIfNeeded()
 assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),name+' fits '+width)
 if(process.env.BALM_UI_SCREENSHOTS)await page.screenshot({path:`${process.env.BALM_UI_SCREENSHOTS}/${name}-${width}.png`})
}
const submit=async(page,form,name)=>{await Promise.all([page.waitForNavigation(),form.getByRole('button',{name,exact:true}).click()])}

export async function codeSetsBrowserJourney(h,edge,options={}){
 if(process.env.BALM_UI_SCREENSHOTS)await mkdir(process.env.BALM_UI_SCREENSHOTS,{recursive:true})
 const {browser,page,signIn}=await browserContext(h)
 try {
  for(const width of [1440,390]){
   await page.setViewportSize({width,height:1000});await signIn(h.owner)
   await page.goto(h.origin+'/app/clinic')
   let panel=page.locator('#clinical-codes');await panel.waitFor()
   assert.ok((await panel.locator('[data-code-status]').count())>0,'loaded release status is visible')
   await receipt(page,'CODE-001-release-status',width,panel)
   await panel.locator('[data-code-cpt] > summary').click()
   const cpt=panel.locator('[data-code-cpt] form')
   await cpt.locator('[name=version]').fill(`synthetic-balm-${width}`)
   await cpt.locator('[name=effectiveOn]').fill('2026-01-01')
   await cpt.locator('[name=mappingSeparator]').selectOption('comma')
   await cpt.locator('[name=mappingCode]').fill('Procedure')
   await cpt.locator('[name=mappingDescription]').fill('Licensed description')
   await cpt.locator('[name=mappingTimed]').fill('Timed service')
   await cpt.locator('[name=cptFile]').setInputFiles({name:`synthetic-balm-${width}.csv`,mimeType:'text/csv',buffer:Buffer.from(`Procedure,Licensed description,Timed service\n97110,Synthetic test-only descriptor ${width},1\n97161,Synthetic test-only evaluation ${width},0\nG0001,Synthetic owner-reviewed timing,0\n`)})
   await cpt.locator('[name=licenseBasis]').fill('Synthetic test-only license acknowledgment for browser proof')
   await cpt.locator('[name=licenseAcknowledged]').check()
   await receipt(page,'CODE-001-licensed-import',width,cpt)
   await submit(page,cpt,'Import licensed CPT file')
   await page.locator('[data-code-update-result]').filter({hasText:'Code release loaded'}).waitFor()
   await receipt(page,'CODE-001-import-changes',width,page.locator('[data-code-update-result]'))
   await page.goto(h.origin+'/app/clinic');panel=page.locator('#clinical-codes')
   await panel.locator('[data-code-synonym] > summary').click()
   const synonym=panel.locator('[data-code-synonym] form'),term=`synthetic-balm-browser-${width}`
   await synonym.locator('[name=kind]').selectOption('icd10');await synonym.locator('[name=code]').fill('M25.561');await synonym.locator('[name=term]').fill(term)
   await submit(page,synonym,'Save search synonym')
   await page.locator('[data-code-synonym-result]').waitFor()
   await page.goto(h.origin+'/app/clinic');panel=page.locator('#clinical-codes')
   await panel.locator('[data-code-search-form] > summary').click()
   let search=panel.locator('[data-code-search-form] form')
   await search.locator('[name=date]').fill('2026-09-30');await search.locator('[name=query]').fill(term)
   await submit(page,search,'Search codes')
   assert.match(await page.locator('[data-code-results]').textContent(),/M25\.561/)
   await receipt(page,'CODE-001-synonym-search',width,page.locator('[data-code-results]'))
   await page.goto(h.origin+'/app/clinic');panel=page.locator('#clinical-codes')
   await panel.locator('[data-code-search-form] > summary').click();search=panel.locator('[data-code-search-form] form')
   await search.locator('[name=date]').fill('2026-09-30');await search.locator('[name=query]').fill('M25')
   await submit(page,search,'Search codes')
   const results=page.locator('[data-code-results]')
   assert.match(await results.textContent(),/Header: choose a billable child/)
   assert.match(await results.textContent(),/M25\.561/);assert.match(await results.textContent(),/M25\.562/)
   await receipt(page,'CODE-001-header-children',width,results)
   await page.goto(h.origin+'/app/clinic');panel=page.locator('#clinical-codes')
   await panel.locator('[data-code-update="ptp"] > summary').click()
   const update=panel.locator('[data-code-update="ptp"] form'),release=edge.ptp[1]
   await update.locator('[name=version]').fill(release.version);await update.locator('[name=effectiveOn]').fill(release.effectiveOn)
   await update.locator('[name=filesText]').fill(release.files.map(f=>f.url).join('\n'))
   await update.locator('[name=licenseBasis]').fill('Synthetic test-only CMS/AMA license acknowledgment')
   await update.locator('[name=licenseAcknowledged]').check()
   await receipt(page,'CODE-001-cms-update',width,update)
   await submit(page,update,'Check CMS files and update')
   await page.locator('[data-code-update-result]').filter({hasText:'unchanged'}).waitFor()
   await receipt(page,'CODE-001-unchanged-update',width,page.locator('[data-code-update-result]'))
   if(options.picker){
    await signIn(options.picker.cookie);await page.goto(h.origin+options.picker.path)
    if(options.picker.open)await page.getByText(options.picker.open,{exact:true}).first().click()
    const picker=page.locator(`[data-code-picker][data-code-target="${options.picker.targetName}"]`).first()
    await picker.locator('[data-code-query]').fill('M25');await picker.locator('[data-code-find]').click()
    await picker.getByRole('button',{name:'M25 · Show billable children',exact:true}).click()
    await picker.getByRole('button',{name:'Add M25.561',exact:true}).click()
    assert.match(await picker.locator('[data-code-feedback]').textContent(),/M25\.561 added/)
    await receipt(page,'CODE-001-clinician-picker',width,picker)
    const draft=picker.locator('xpath=ancestor::form[1]')
    await draft.locator('[name=charge_code_0]').selectOption('G0001')
    await receipt(page,'CODE-001-hcpcs-charge-choice',width,draft.locator('[name=charge_code_0]'))
    await submit(page,draft,'Save draft')
    const file=(await h.send(options.picker.path.replace('/app/clients/','/api/balm/clients/'),undefined,options.picker.cookie)).value
    assert.ok(file.notes.some(n=>n.revisions[0].charges.some(c=>c.code==='G0001'&&c.timed===false&&c.timingRelease&&c.release)))
   }
  }
 }finally{await browser.close()}
}

/** Pass a fresh, unseeded public harness to prove first-install missing state.
 * This intentionally never deletes production tables to manufacture the state. */
async function dailyCloseCodes(page,h,phase){
 await page.goto(h.origin+'/app')
 const warnings=page.locator('[data-close-category="codeSets"]')
 assert.ok((await h.state()).dailyClose.codeSets.length>0)
 for(const width of [1440,390]){
  await page.setViewportSize({width,height:1000})
  await receipt(page,'CODE-001-daily-close-'+phase,width,warnings)
  const control=page.locator('.control-tip').first(),tip=control.getByRole('tooltip')
  await control.scrollIntoViewIfNeeded();await control.focus();assert.equal(await tip.isVisible(),true)
  await receipt(page,'CODE-001-calendar-focus-tooltip',width,control)
  await control.evaluate(el=>el.blur());await page.mouse.move(0,0);await control.hover()
  await page.waitForTimeout(100);assert.equal(await tip.isVisible(),false)
  await page.waitForTimeout(250);assert.equal(await tip.isVisible(),true)
  await receipt(page,'CODE-001-calendar-hover-tooltip',width,control)
 }
}

export async function codeSetsMissingBrowser(h){
 if(process.env.BALM_UI_SCREENSHOTS)await mkdir(process.env.BALM_UI_SCREENSHOTS,{recursive:true})
 const {browser,page}=await browserContext(h)
 try{await page.goto(h.origin+'/app/clinic');const panel=page.locator('#clinical-codes');assert.match(await panel.textContent(),/Missing/);for(const width of [1440,390]){await page.setViewportSize({width,height:1000});await receipt(page,'CODE-001-missing-release',width,panel)}}finally{await browser.close()}
}

test('CODE-001: owner imports licensed data, saves synonyms, finds billable children and repeats a CMS update through real forms at desktop and phone widths',async()=>{
 const edge=codeSetEdge(),h=await harness({browserHttps:true,codeSetEdge:edge})
 try{
  await h.finishSetup()
  const {clinic,pastVisit}=await import('./clinic.mjs')
  const {service,practitioners:[clinician]}=await clinic(h,['Oliver'])
  await h.cmd('staff.save',{id:clinician.id,name:'Oliver Park',email:clinician.email,role:'practitioner',credentials:'PT',active:true})
  const patient=await h.cmd('client.save',{firstName:'Ava',lastName:'Sullivan'})
  const visit=await pastVisit(h,patient.id,clinician,service.id)
  await h.cmd('note.write',{clientId:patient.id,appointmentId:visit,template:'pt.daily',sections:[]},clinician.cookie)
  const {codeSetClaimAdapter}=await import('./code-sets-claims.mjs'),prepare=await codeSetClaimAdapter(h,{realistic:true})
  const claim=await prepare({date:'2026-10-01',diagnoses:['M25.561'],lines:[{code:'00530',units:1,modifiers:[]},{code:'0932T',units:1,modifiers:[]}],distinctServices:[{code1:'00530',code2:'0932T',modifier:'59',reason:'Separate clinically distinct services documented and reviewed by the treating clinician.',attested:true}]})
  assert.ok(claim.proposals.some(p=>p.modifier==='59'))
  const proof=await browserContext(h)
  try{for(const width of [1440,390]){await proof.page.setViewportSize({width,height:1000});await proof.page.goto(h.origin+'/app/insurance');const proposals=proof.page.locator('[data-code-proposals]');await receipt(proof.page,'CODE-001-modifier-proposal',width,proposals)}}finally{await proof.browser.close()}
  await codeSetsBrowserJourney(h,edge,{picker:{cookie:clinician.cookie,path:'/app/clients/'+patient.id,targetName:'section_diagnosis',open:'Edit draft'}})
 }finally{await h.close()}
})


test('CODE-001: first installation names missing releases and older public imports name overdue updates at desktop and phone widths',async()=>{
 const edge=codeSetEdge(),h=await harness({browserHttps:true,codeSetEdge:edge,codeSets:false})
 try{
  await h.finishSetup();await h.cmd('settings.save',{clinicName:'Riverside Physio',timeZone:'Australia/Brisbane'})
  await codeSetsMissingBrowser(h)
  const missing=await browserContext(h)
  try{await dailyCloseCodes(missing.page,h,'missing')}finally{await missing.browser.close()}
  const pending=await h.cmd('codes.update',{...edge.ptp[0],batchLimit:1,licenseAcknowledged:true,licenseBasis:'Synthetic test-only CMS/AMA license acknowledgment'})
  assert.equal(pending.status,'incomplete')
  const {browser,page}=await browserContext(h)
  try{
   await page.goto(h.origin+'/app/clinic');let panel=page.locator('#clinical-codes')
   const resume=panel.locator('form[action*="codes.update.continue"]')
   for(const width of [1440,390]){await page.setViewportSize({width,height:1000});await receipt(page,'CODE-001-incomplete-import',width,resume)}
   await submit(page,resume,'Continue code import')
   await page.locator('[data-code-update-result]').filter({hasText:'Code release loaded'}).waitFor()
   panel=page.locator('#clinical-codes');assert.match(await panel.textContent(),/Update due/)
   for(const width of [1440,390]){await page.setViewportSize({width,height:1000});await receipt(page,'CODE-001-overdue-release',width,panel)}
   assert.ok((await h.state()).dailyClose.codeSets.some(c=>c.kind==='ptp'&&c.stale&&!c.missing))
   await dailyCloseCodes(page,h,'overdue')
  }finally{await browser.close()}
 }finally{await h.close()}
})
