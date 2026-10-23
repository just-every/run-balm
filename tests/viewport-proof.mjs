import assert from 'node:assert/strict'
import {mkdir} from 'node:fs/promises'
import {chromium} from '@playwright/test'

/** Optional viewport receipts on real Worker pages; identities are synthetic test sign-ins. */
export async function viewportProof(h,scenes){
 if(!process.env.BALM_UI_SCREENSHOTS)return
 await mkdir(process.env.BALM_UI_SCREENSHOTS,{recursive:true})
 const browser=await chromium.launch({headless:true,args:['--use-mock-keychain','--password-store=basic']})
 try{
  const context=await browser.newContext({ignoreHTTPSErrors:true})
  for(const [pattern,path,type] of [['**/rer-theme.css','public/rer-theme.css','text/css'],['**/fonts/fonts.css','public/fonts/fonts.css','text/css']])await context.route(pattern,r=>r.fulfill({path,contentType:type}))
  await context.route('**/fonts/inter/*.woff2',r=>r.fulfill({path:'public'+new URL(r.request().url()).pathname,contentType:'font/woff2'}))
  await context.route('**/brand/mark.svg',r=>r.fulfill({path:'public/brand/mark.svg',contentType:'image/svg+xml'}))
  const page=await context.newPage()
  for(const {name,path,cookie,selector,open} of scenes){
   await context.clearCookies()
   if(cookie){const [key,...value]=cookie.split('=');await context.addCookies([{name:key,value:value.join('='),url:h.origin,secure:true}])}
   const response=await page.goto(h.origin+path)
   assert.equal(response.status(),200,name)
   if(open)await page.getByText(open,{exact:true}).first().click()
   for(const width of [1440,390]){
    await page.setViewportSize({width,height:1000})
    if(selector)await page.locator(selector).first().evaluate(el=>el.scrollIntoView({block:'start'}))
    assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),name+' fits '+width)
    await page.screenshot({path:process.env.BALM_UI_SCREENSHOTS+'/'+name+'-'+width+'.png'})
    if(name==='PAY-007-schedule'){
     for(const label of ['Previous day','Next day']){
      const control=page.getByRole('link',{name:label,exact:true}),tip=control.getByRole('tooltip')
      await page.mouse.move(0,0);await control.blur()
      await control.evaluate(el=>{
       window.tooltipObservation=new Promise(resolve=>el.addEventListener('pointerenter',()=>{
        const results=[];const tip=el.querySelector('[role=tooltip]')
        setTimeout(()=>results.push(getComputedStyle(tip).opacity),100)
        setTimeout(()=>{results.push(getComputedStyle(tip).opacity);resolve(results)},400)
       },{once:true}))
      })
      await control.hover()
      assert.deepEqual(await page.evaluate(()=>window.tooltipObservation),['0','1'],'hover tooltip appears after its short delay')
      await page.mouse.move(0,0);await control.focus()
      assert.equal(await tip.evaluate(el=>getComputedStyle(el).visibility),'visible','keyboard focus shows the tooltip immediately')
      await page.screenshot({path:process.env.BALM_UI_SCREENSHOTS+'/'+name+'-'+label.replace(' ','-')+'-'+width+'.png'})
      await control.blur()
     }
    }
   }
  }
 }finally{await browser.close()}
}
