import assert from 'node:assert/strict'
import { mkdir } from 'node:fs/promises'
import { chromium } from '@playwright/test'
import { harness } from './harness.mjs'
import { readinessFacts, hostingProfile, recordTestBaa, readinessFixture } from './readiness-fixture.mjs'

let h, browser
try {
 h=await harness({readiness:false,browserHttps:true,patientMode:false,auth:{BALM_HOSTING_PROFILE:JSON.stringify(hostingProfile)}})
 await h.finishSetup()
 await h.cmd('settings.save',{clinicName:'Synthetic readiness clinic',timeZone:'America/Chicago'})
 browser=await chromium.launch({headless:true,...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH?{executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH}:{}),args:['--no-sandbox','--use-mock-keychain','--password-store=basic']})
 const context=await browser.newContext({ignoreHTTPSErrors:true})
 for(const [pattern,path,contentType] of [['**/rer-theme.css','public/rer-theme.css','text/css'],['**/fonts/fonts.css','public/fonts/fonts.css','text/css'],['**/brand/mark.svg','public/brand/mark.svg','image/svg+xml']])await context.route(pattern,r=>r.fulfill({path,contentType}))
 await context.route('**/fonts/inter/*.woff2',r=>r.fulfill({path:'public'+new URL(r.request().url()).pathname,contentType:'font/woff2'}))
 const [name,...value]=h.owner.split('=')
 await context.addCookies([{name,value:value.join('='),url:h.origin,secure:true}])
 const page=await context.newPage(),directory=process.env.BALM_UI_SCREENSHOTS??'.cache/readiness-screens'
 await mkdir(directory,{recursive:true})
 async function capture(name){
  for(const width of [1440,390]){
   await page.setViewportSize({width,height:1000})
   await page.locator('#readiness').evaluate(el=>el.scrollIntoView({block:'start',behavior:'instant'}))
   assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),name+' fits '+width)
   const icons=await page.locator('button,a,[role=button]').evaluateAll(items=>items.filter(el=>el.getClientRects().length&&!/[\p{L}\p{N}]/u.test(el.textContent??'')).map(el=>({label:el.getAttribute('aria-label'),tooltip:!!el.querySelector('[role=tooltip]')})))
   assert.ok(icons.every(i=>i.label&&i.tooltip),'visible icon controls have tooltips')
   await page.screenshot({path:directory+'/'+name+'-'+width+'.png'})
   await page.locator('#readiness').evaluate(el=>el.scrollIntoView({block:'end',behavior:'instant'}))
   await page.screenshot({path:directory+'/'+name+'-tail-'+width+'.png'})
  }
 }
 async function captureHosting(name){
  for(const width of [1440,390]){
   await page.setViewportSize({width,height:1000})
   await page.locator('#hosting').screenshot({path:directory+'/'+name+'-'+width+'.png'})
  }
  await page.setViewportSize({width:1440,height:1000})
 }
 async function changeMode(mode,id='',proof=''){
  const details=page.locator('#hosting details').filter({has:page.locator('form[action*="hosting.mode"]')})
  if(!await details.getAttribute('open'))await details.locator('summary').click()
  const form=page.locator('form[action*="hosting.mode"]')
  await form.locator('[name=mode]').selectOption(mode)
  await form.locator('[name=id]').selectOption(id)
  await form.locator('[name=reason]').fill('Synthetic native form journey only')
  await form.locator('[name=attest]').check()
  if(proof)await captureHosting(proof)
  await form.getByRole('button',{name:'Save patient mode',exact:true}).click()
 }
 await page.goto(h.origin+'/app/clinic')
 assert.equal((await h.send('/api/balm/readiness.json',undefined,h.owner)).value.hosting.records.length,0)
 await changeMode('demo','','hosting-demo-without-records-form')
 assert.match(await page.locator('#hosting [role=status]').textContent(),/Patient mode: demo.*permitted/,'a fresh owner can save Demo without hosting evidence')
 assert.equal((await h.send('/api/balm/readiness.json',undefined,h.owner)).value.hosting.mode,'demo')
 await captureHosting('hosting-demo-without-records')
 await changeMode('real')
 assert.match(await page.locator('#hosting [role=status]').textContent(),/Patient mode: demo/,'missing hosting evidence cannot activate real patients')
 assert.ok(await page.locator('[role=alert]').count(),'real-patient activation explains the missing hosting record')
 await changeMode('blocked')
 assert.match(await page.locator('#hosting [role=status]').textContent(),/Patient mode: blocked.*blocked/,'blocking patient creation also needs no hosting evidence')
 const modes=(await h.db.prepare("SELECT detail FROM bm_audit WHERE action='hosting.mode_changed' ORDER BY rowid").all()).results
 assert.deepEqual(modes.map(row=>row.detail.split(':')[0]),['demo','blocked'],'only completed mode changes are audited')
 await assert.equal(await page.locator('#readiness [role=status]').textContent(),'Integration readiness is incomplete.')
 await capture('readiness-incomplete')
 await page.locator('#readiness summary').filter({hasText:'Record readiness review'}).click()
 const review=page.locator('form[action*="readiness.save"]')
 for(const [key,value] of Object.entries(readinessFacts))if(key!=='attest')await review.locator(`[name=${key}]`).fill(value)
 await review.locator('[name=attest]').check()
 await capture('readiness-review')
 await review.getByRole('button',{name:'Save readiness review'}).click()
 await page.locator('#readiness summary').filter({hasText:'Record signed BAA'}).click()
 const baa=page.locator('form[action*="readiness.baa.record"]')
 await baa.locator('[name=processor]').selectOption('mail')
 for(const [key,value] of Object.entries({provider:'synthetic-balm-910 mail account',plan:'synthetic-balm-911 covered edition',reference:'synthetic-balm-912 signed agreement',signedOn:'2026-09-01'}))await baa.locator(`[name=${key}]`).fill(value)
 await baa.locator('[name=attest]').check()
 await capture('readiness-baa')
 await baa.getByRole('button',{name:'Record BAA',exact:true}).click()
 assert.equal(await page.locator('#readiness [role=status]').textContent(),'Integration readiness check passed.')
 await capture('readiness-passed')
 const exported=await context.request.get(h.origin+'/api/balm/readiness.json')
 assert.equal(exported.status(),200)
 const record=await exported.json()
 assert.equal(record.ready,true)
 assert.equal(record.record.risk_analysis,readinessFacts.riskAnalysis)
 assert.equal(record.baas[0].reference,'synthetic-balm-912 signed agreement')
 await page.locator('#readiness').getByRole('button',{name:'Revoke BAA'}).click()
 assert.equal(await page.locator('#readiness [role=status]').textContent(),'Integration readiness is incomplete.')
 await capture('readiness-revoked')
 await readinessFixture(h)
 const hostBaa=await recordTestBaa(h,'hosting'),backupBaa=await recordTestBaa(h,'backups')
 await page.setViewportSize({width:1440,height:1000})
 await page.goto(h.origin+'/app/clinic')
 assert.match(await page.locator('#hosting [role=status]').textContent(),/blocked/)
 await page.locator('#hosting summary').filter({hasText:'Record hosting evidence'}).click()
 const hosting=page.locator('form[action*="hosting.record"]')
 await hosting.locator('[name=provider]').selectOption('cloudflare')
 await hosting.locator('[name=baaId]').selectOption(hostBaa.id)
 await hosting.locator('[name=backupBaaId]').selectOption(backupBaa.id)
 for(const [key,value] of Object.entries({account:hostingProfile.account,deployment:hostingProfile.deployment,services:'workers\nd1\nr2',coveredServices:'workers\nd1',serviceEvidence:JSON.stringify({workers:'synthetic-balm-922',d1:'synthetic-balm-923',r2:'synthetic-balm-924'}),qualificationReference:'synthetic-balm-925',backupReceipt:'synthetic-balm-926',drillReceipt:'synthetic-balm-927'}))await hosting.locator(`[name=${key}]`).fill(value)
 await hosting.locator('[name=attest]').check()
 await captureHosting('hosting-incomplete-r2-form')
 await hosting.getByRole('button',{name:'Record hosting evidence',exact:true}).click()
 let hostState=(await h.send('/api/balm/readiness.json',undefined,h.owner)).value.hosting
 const omitted=hostState.records[0].id
 await changeMode('real',omitted)
 assert.match(await page.locator('#hosting [role=status]').textContent(),/blocked/)
 assert.match(await page.locator('body').textContent(),/owner must review Hosting and patient mode/)
 await captureHosting('hosting-r2-refused')
 await page.locator('#hosting summary').filter({hasText:'Record hosting evidence'}).click()
 for(const [key,value] of Object.entries({account:hostingProfile.account,deployment:hostingProfile.deployment,services:'workers\nd1\nr2',coveredServices:'workers\nd1\nr2',serviceEvidence:JSON.stringify({workers:'synthetic-balm-922',d1:'synthetic-balm-923',r2:'synthetic-balm-924'}),qualificationReference:'synthetic-balm-925',backupReceipt:'synthetic-balm-926',drillReceipt:'synthetic-balm-927'}))await hosting.locator(`[name=${key}]`).fill(value)
 await hosting.locator('[name=baaId]').selectOption(hostBaa.id)
 await hosting.locator('[name=backupBaaId]').selectOption(backupBaa.id)
 await hosting.locator('[name=attest]').check()
 await hosting.getByRole('button',{name:'Record hosting evidence',exact:true}).click()
 hostState=(await h.send('/api/balm/readiness.json',undefined,h.owner)).value.hosting
 const complete=hostState.records.find(r=>r.id!==omitted).id
 await changeMode('real',complete)
 assert.match(await page.locator('#hosting [role=status]').textContent(),/real.*permitted/)
 await captureHosting('hosting-recorded-mode')
 const hostingRecord=page.locator('#hosting details').filter({has:page.locator('form[action*="hosting.revoke"] [name=id][value="'+complete+'"]')})
 await hostingRecord.locator('summary').click()
 await hostingRecord.getByRole('button',{name:'Revoke hosting evidence',exact:true}).click()
 assert.match(await page.locator('#hosting [role=status]').textContent(),/Patient creation is blocked/)
 await captureHosting('hosting-revoked')
 console.log('HIPAA-005 native browser: hosting form, omitted R2 refusal, audited synthetic mode and revocation inspected at 1440 and 390')
 console.log('HIPAA-001 browser: readiness forms, export, revocation and tooltip audit passed at 1440 and 390')
}finally{if(browser)await browser.close();if(h)await h.close()}
