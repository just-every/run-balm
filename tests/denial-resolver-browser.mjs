import assert from 'node:assert/strict'
import {execFileSync} from 'node:child_process'
import {mkdir} from 'node:fs/promises'
import {chromium} from '@playwright/test'
import {run} from './harness.mjs'
import {denialResolverJourney} from './denial-resolver-journey.mjs'
const root=process.env.BALM_UI_SCREENSHOTS
assert.ok(root);await mkdir(root,{recursive:true})
const head=execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim()
assert.equal(execFileSync('git',['status','--porcelain'],{encoding:'utf8'}).trim(),'')
const browser=await chromium.launch({headless:true,...(process.env.BALM_CHROMIUM?{executablePath:process.env.BALM_CHROMIUM}:{}),args:['--no-sandbox','--use-mock-keychain','--password-store=basic']})
let context
try{
 await run(async h=>{
  context=await browser.newContext({ignoreHTTPSErrors:true,viewport:{width:1440,height:1000}})
  for(const [pattern,path,type]of [['**/rer-theme.css','public/rer-theme.css','text/css'],['**/fonts/fonts.css','public/fonts/fonts.css','text/css'],['**/brand/mark.svg','public/brand/mark.svg','image/svg+xml']])await context.route(pattern,r=>r.fulfill({path,contentType:type}))
  await context.route('**/fonts/inter/*.woff2',r=>r.fulfill({path:'public'+new URL(r.request().url()).pathname,contentType:'font/woff2'}))
  const page=await context.newPage()
  const show=async(d,name)=>{
   const [key,...value]=d.biller.cookie.split('=');await context.clearCookies();await context.addCookies([{name:key,value:value.join('='),url:h.origin,secure:true}])
   await page.goto(h.origin+'/app/cases#case-'+d.referral.id)
   const card=page.locator('#case-'+d.referral.id)
   if(name==='prepared'){
    assert.match(await card.innerText(),/recorded authorization synthetic-balm-2/)
    assert.ok(await card.getByRole('button',{name:'Approve appeal packet',exact:true}).isVisible())
    assert.equal((await context.request.get(h.origin+'/api/balm/note-releases/'+d.release.id+'.pdf')).status(),200)
   }
   if(name==='approved')assert.match(await card.innerText(),/Appeal awaiting payment/)
   if(name==='paid')assert.match(await card.innerText(),/Appeal resolved: payment posted/)
   const icons=await page.locator('button,a,label[for]').evaluateAll(els=>els.filter(el=>el.getBoundingClientRect().width&&el.getBoundingClientRect().height&&!el.textContent.trim()&&el.querySelector('svg')).map(el=>!!el.querySelector('[role=tooltip]')))
   assert.ok(icons.every(Boolean),'icon-only controls have tooltips')
   for(const width of [1440,390]){
    await page.setViewportSize({width,height:1000});await card.scrollIntoViewIfNeeded()
    if(name==='prepared')await card.getByRole('button',{name:'Approve appeal packet',exact:true}).scrollIntoViewIfNeeded()
    assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'fits '+width)
    await page.screenshot({path:root+'/AGENT-004-'+name+'-'+width+'.png'})
   }
   await page.setViewportSize({width:1440,height:1000})
  }
  await denialResolverJourney(h,{rejected:d=>show(d,'rejected'),prepared:d=>show(d,'prepared'),approved:d=>show(d,'approved'),paid:d=>show(d,'paid')})
 },{browserHttps:true})
 console.log('PASS AGENT-004 browser proof at 1440 and 390 head='+head)
}finally{await context?.close();await browser.close()}
