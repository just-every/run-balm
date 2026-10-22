import assert from 'node:assert/strict'
import {execFileSync} from 'node:child_process'
import {mkdir} from 'node:fs/promises'
import {chromium} from '@playwright/test'
import {harness} from './harness.mjs'
import {coProviderEstimateJourney} from './estimate-contributors-journey.mjs'
import {payerEstimateJourney,payerEstimatePdf} from './payer-estimate-journey.mjs'

const head=execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim()
assert.equal(execFileSync('git',['status','--porcelain'],{encoding:'utf8'}).trim(),'','browser journey uses a committed candidate')
const root=process.env.BALM_UI_SCREENSHOTS
if(root)await mkdir(root,{recursive:true})
const h=await harness({browserHttps:true})
let browser
try{
 const aggregate=await coProviderEstimateJourney(h),payer=await payerEstimateJourney(h)
 browser=await chromium.launch({headless:true,args:['--use-mock-keychain','--password-store=basic']})
 const context=await browser.newContext({ignoreHTTPSErrors:true})
 for(const [pattern,path,type] of [['**/rer-theme.css','public/rer-theme.css','text/css'],['**/fonts/fonts.css','public/fonts/fonts.css','text/css'],['**/brand/mark.svg','public/brand/mark.svg','image/svg+xml']])await context.route(pattern,r=>r.fulfill({path,contentType:type}))
 await context.route('**/fonts/inter/*.woff2',r=>r.fulfill({path:'public'+new URL(r.request().url()).pathname,contentType:'font/woff2'}))
 const cookie=async value=>{const [name,...parts]=value.split('=');await context.clearCookies();await context.addCookies([{name,value:parts.join('='),url:h.origin,secure:true}])}
 const page=await context.newPage()
 const capture=async(name,selector)=>{for(const width of [1440,390]){await page.setViewportSize({width,height:1000});await page.locator(selector).first().scrollIntoViewIfNeeded();assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),name+' fits '+width);if(root)await page.screenshot({path:root+'/'+name+'-'+width+'.png'})}}
 await cookie(h.owner)
 const today=new Date().toISOString().slice(0,10),through=new Date(Date.now()+7*86400000).toISOString().slice(0,10)
 const referral=await h.cmd('case.open',{clientId:aggregate.patient.id,receivedOn:today,referringFirst:'Synthetic',referringLast:'Referrer',diagnosis:'M25.561 knee pain'})
 const request=await h.cmd('estimate.request',{clientId:aggregate.patient.id,coverageKind:'self_pay',coverageAttestation:'Patient elected self-pay for care with a contributing provider',deliveryMethod:'portal',attest:true})
 const clientPath='/app/clients/'+aggregate.patient.id
 await page.goto(h.origin+clientPath)
 const preparation=page.locator('form').filter({has:page.locator('input[name=requestId][value="'+request.id+'"]')})
 await preparation.locator('[name=referralId]').selectOption(referral.id)
 await preparation.locator('[name=fromOn]').fill(today)
 await preparation.locator('[name=throughOn]').fill(through)
 await preparation.locator('[name=estimate_service_0]').selectOption(aggregate.service.id)
 await preparation.locator('[name=estimate_quantity_0]').fill('1')
 await preparation.locator('[name=estimate_code_0]').fill('97161')
 await preparation.getByText('Add a contributing provider’s written quote',{exact:true}).click()
 for(const [key,value] of Object.entries({name:'Lakeview Imaging',npi:'1245319599',taxId:'98-7654321',address:'200 Main St, Austin TX 78701',sourceReference:'synthetic-balm-6',receivedOn:today,diagnosisCodes:'M25.561',line_0_name:'Knee imaging',line_0_code:'73721',line_0_quantity:'2',line_0_price:'300.00'}))await preparation.locator('[name="contributor_0_'+key+'"]').fill(value)
 await preparation.locator('[name=contributor_0_attest]').check();await preparation.locator('[name=attest]').check()
 await capture('PAY-007-contributor-form','input[name=contributor_0_name]')
 await preparation.getByRole('button',{name:'Prepare estimate for review',exact:true}).click()
 let file=(await h.send('/api/balm/clients/'+aggregate.patient.id,undefined,h.owner)).value
 const draft=file.estimates.drafts.find(d=>d.request_id===request.id)
 assert.ok(draft,'real form prepares an aggregate draft')
 const draftSelector='article:has(form input[name=id][value="'+draft.id+'"])'
 await capture('PAY-007-contributor-review',draftSelector)
 const issuance=page.locator('form').filter({has:page.locator('input[name=id][value="'+draft.id+'"]')})
 await issuance.locator('[name=attest]').check()
 await issuance.getByRole('button',{name:'Issue original estimate',exact:true}).click()
 file=(await h.send('/api/balm/clients/'+aggregate.patient.id,undefined,h.owner)).value
 const issued=file.estimates.issued.find(e=>e.request_id===request.id)
 assert.ok(issued);assert.equal(issued.contributors[0].name,'Lakeview Imaging')
 await capture('PAY-007-contributor-issued','article:has(a[href="/api/balm/estimates/'+issued.id+'.pdf"])')
 await cookie(aggregate.portal);await page.goto(h.origin+'/portal/home')
 await page.locator('a[href="/portal/estimates/'+issued.id+'.pdf"]').waitFor()
 await capture('PAY-007-contributor-portal','#statements')
 await cookie(h.owner);await page.goto(h.origin+'/app/clients/'+payer.patient.id)
 await page.getByText('Record a payer estimate',{exact:true}).click()
 const upload=page.locator('form[action*="estimate.aeob.prepare"]')
 await upload.locator('[name=policyId]').selectOption(payer.policy.id)
 await upload.locator('[name=sourceReference]').fill('synthetic-balm-5')
 await upload.locator('[name=sourceDate]').fill(today)
 await upload.locator('[name=matchEvidence]').fill('Matched Maya Payer, birth date and current member ID on the original')
 await upload.locator('[name=attachment]').setInputFiles({name:'synthetic-balm-5.pdf',mimeType:'application/pdf',buffer:payerEstimatePdf('Maya Payer','SYNTHETIC-BALM-4')})
 await upload.locator('[name=attest]').check()
 await capture('PAY-007-payer-upload','#payer-estimates')
 await upload.getByRole('button',{name:'Prepare payer original',exact:true}).click()
 const sources=(await h.send('/api/balm/clients/'+payer.patient.id,undefined,h.owner)).value.aeobs
 const source=sources.find(s=>s.source_reference==='synthetic-balm-5')
 assert.ok(source,'real multipart upload preserves a payer original')
 const download=page.locator('a[href="/api/balm/aeobs/'+source.id+'.pdf"]')
 await Promise.all([page.waitForEvent('download'),download.click()])
 const publish=page.locator('form').filter({has:page.locator('input[name=id][value="'+source.id+'"]')})
 await publish.locator('[name=portalConsent]').fill('Patient requested their original in the portal at the desk')
 await publish.locator('[name=attest]').check()
 await capture('PAY-007-payer-review','article:has(form input[name=id][value="'+source.id+'"])')
 await publish.getByRole('button',{name:'Publish payer original',exact:true}).click()
 await capture('PAY-007-payer-published','article:has(a[href="/api/balm/aeobs/'+source.id+'.pdf"])')
 await cookie(payer.portal);await page.goto(h.origin+'/portal/home')
 await page.locator('a[href="/portal/aeobs/'+source.id+'.pdf"]').waitFor()
 await capture('PAY-007-payer-portal','#statements')
 console.log('PASS PAY-007 real forms at 1440/390 head='+head+' run=sx-balm-c29-estimate-browser')
}finally{await browser?.close();await h.close()}
