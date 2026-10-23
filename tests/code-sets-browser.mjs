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
 await page.screenshot({path:`${process.env.BALM_UI_SCREENSHOTS}/${name}-${width}.png`})
}
const submit=async(page,form,name)=>{await Promise.all([page.waitForNavigation(),form.getByRole('button',{name,exact:true}).click()])}

export async function codeSetsBrowserJourney(h,edge,options={}){
 await mkdir(process.env.BALM_UI_SCREENSHOTS,{recursive:true})
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
   await cpt.locator('[name=cptFile]').setInputFiles({name:`synthetic-balm-${width}.csv`,mimeType:'text/csv',buffer:Buffer.from(`Procedure,Licensed description,Timed service\n97110,Synthetic test-only descriptor ${width},1\n97161,Synthetic test-only evaluation ${width},0\n`)})
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
   }
  }
 }finally{await browser.close()}
}

/** Pass a fresh, unseeded public harness to prove first-install missing state.
 * This intentionally never deletes production tables to manufacture the state. */
export async function codeSetsMissingBrowser(h){
 await mkdir(process.env.BALM_UI_SCREENSHOTS,{recursive:true})
 const {browser,page}=await browserContext(h)
 try{await page.goto(h.origin+'/app/clinic');const panel=page.locator('#clinical-codes');assert.match(await panel.textContent(),/Missing/);for(const width of [1440,390]){await page.setViewportSize({width,height:1000});await receipt(page,'CODE-001-missing-release',width,panel)}}finally{await browser.close()}
}

test('CODE-001: owner imports licensed data, saves synonyms, finds billable children and repeats a CMS update through real forms at desktop and phone widths',{skip:!process.env.BALM_UI_SCREENSHOTS},async()=>{
 const edge=codeSetEdge(),h=await harness({browserHttps:true,codeSetEdge:edge})
 try{
  await h.finishSetup()
  const {clinic,pastVisit}=await import('./clinic.mjs')
  const {service,practitioners:[clinician]}=await clinic(h,['synthetic-balm-90'])
  const patient=await h.cmd('client.save',{firstName:'synthetic-balm-90',lastName:'synthetic-balm-91'})
  const visit=await pastVisit(h,patient.id,clinician,service.id)
  await h.cmd('note.write',{clientId:patient.id,appointmentId:visit,template:'pt.daily',sections:[]},clinician.cookie)
  await codeSetsBrowserJourney(h,edge,{picker:{cookie:clinician.cookie,path:'/app/clients/'+patient.id,targetName:'section_diagnosis',open:'Edit draft'}})
 }finally{await h.close()}
})


test('CODE-001: first installation names missing releases and older public imports name overdue updates at desktop and phone widths',{skip:!process.env.BALM_UI_SCREENSHOTS},async()=>{
 const edge=codeSetEdge(),h=await harness({browserHttps:true,codeSetEdge:edge,codeSets:false})
 try{
  await h.finishSetup();await h.cmd('settings.save',{clinicName:'synthetic-balm-92',timeZone:'Australia/Brisbane'})
  await codeSetsMissingBrowser(h)
  await h.cmd('codes.update',{...edge.ptp[0],licenseAcknowledged:true,licenseBasis:'Synthetic test-only CMS/AMA license acknowledgment'})
  const {browser,page}=await browserContext(h)
  try{await page.goto(h.origin+'/app/clinic');const panel=page.locator('#clinical-codes');assert.match(await panel.textContent(),/Update due/);for(const width of [1440,390]){await page.setViewportSize({width,height:1000});await receipt(page,'CODE-001-overdue-release',width,panel)}}finally{await browser.close()}
 }finally{await h.close()}
})
