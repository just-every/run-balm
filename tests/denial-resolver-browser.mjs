import assert from 'node:assert/strict'
import {execFileSync} from 'node:child_process'
import {mkdir} from 'node:fs/promises'
import {chromium} from '@playwright/test'
import {harness} from './harness.mjs'
import {denialJourney} from './denial-resolver-journey.mjs'
const head=execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim()
assert.equal(execFileSync('git',['status','--porcelain'],{encoding:'utf8'}).trim(),'')
const root=process.env.BALM_UI_SCREENSHOTS
assert.ok(root);await mkdir(root,{recursive:true})
const browser=await chromium.launch({headless:true,...(process.env.BALM_CHROMIUM?{executablePath:process.env.BALM_CHROMIUM}:{}),args:['--no-sandbox','--use-mock-keychain','--password-store=basic']})
try{
 const h=await harness({browserHttps:true});let context
 try{
  context=await browser.newContext({ignoreHTTPSErrors:true,viewport:{width:1440,height:1000}})
  for(const [pattern,path,type] of [['**/rer-theme.css','public/rer-theme.css','text/css'],['**/fonts/fonts.css','public/fonts/fonts.css','text/css'],['**/brand/mark.svg','public/brand/mark.svg','image/svg+xml']])await context.route(pattern,r=>r.fulfill({path,contentType:type}))
  await context.route('**/fonts/inter/*.woff2',r=>r.fulfill({path:'public'+new URL(r.request().url()).pathname,contentType:'font/woff2'}))
  const page=await context.newPage()
  await denialJourney(h,{capture:async(state,c,packet)=>{
   const value=state==='rejected'?h.owner:c.biller.cookie,[name,...parts]=value.split('=')
   await context.clearCookies();await context.addCookies([{name,value:parts.join('='),url:h.origin,secure:true}])
   await page.setViewportSize({width:1440,height:1000});await page.goto(h.origin+'/app/cases');await page.reload()
   const card=page.locator('#case-'+c.referral.id)
   assert.equal(await card.count(),1)
   if(packet){
    const appeal=page.locator('#appeal-'+packet.id)
    assert.match(await appeal.innerText(),/synthetic-balm-2/)
    assert.match(await appeal.innerText(),state==='paid'?/Resolved after payment/:state==='approved'?/Approved, not sent · awaiting payment/:/Prepared · awaiting payment/)
    assert.equal(await appeal.getByRole('link',{name:'Download appeal evidence',exact:true}).count(),1)
   }else assert.match(await card.innerText(),/A3:21/)
   for(const width of [1440,390]){
    await page.setViewportSize({width,height:1000})
    await (packet?page.locator('#appeal-'+packet.id):card).scrollIntoViewIfNeeded()
    assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'fits '+width)
    const icons=await page.locator('button,a,label[for]').evaluateAll(els=>els.filter(el=>el.getBoundingClientRect().width&&el.getBoundingClientRect().height&&!el.textContent.trim()&&el.querySelector('svg')).map(el=>({label:el.getAttribute('aria-label'),tooltip:!!el.querySelector('[role=tooltip]')})))
    assert.ok(icons.every(el=>el.tooltip),'icon-only controls have tooltips: '+JSON.stringify(icons))
    await page.screenshot({path:root+'/AGENT-004-'+state+'-'+width+'.png'})
   }
  }})
  console.log('PASS AGENT-004 four states at 1440 and 390 head='+head)
 }finally{await context?.close();await h.close()}
}finally{await browser.close()}
