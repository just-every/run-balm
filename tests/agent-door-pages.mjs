import assert from 'node:assert/strict'
import {chromium} from '@playwright/test'
import {mkdir} from 'node:fs/promises'
import {join} from 'node:path'

/** Render the actual disposable Worker; only its same-origin transport is bridged. */
export async function captureAgentPages({request,origin,cookie},paths) {
 const folder=process.env.BALM_AGENT_SCREENSHOTS
 if(folder)await mkdir(folder,{recursive:true})
 const browser=await chromium.launch({executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH,args:['--no-sandbox']})
 try {
  const context=await browser.newContext()
  await context.route('**/*',async route=>{
   const source=route.request(),url=new URL(source.url())
   if(url.origin!==origin)return route.abort()
   const response=await request(url.href,{method:source.method(),headers:{...source.headers(),cookie},...(source.postData()?{body:source.postData()}:{}),redirect:'manual'})
   const headers=Object.fromEntries(response.headers);delete headers['content-length'];delete headers['content-encoding']
   await route.fulfill({status:response.status,headers,body:Buffer.from(await response.arrayBuffer())})
  })
  for(const width of [1440,390]) {
   const page=await context.newPage();await page.setViewportSize({width,height:1000})
   for(const [name,path] of paths) {
    await page.goto(origin+path)
    assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'native door has no horizontal overflow at '+width)
    assert.ok(await page.locator('button').evaluateAll(nodes=>nodes.filter(n=>n.getBoundingClientRect().height).every(n=>n.getBoundingClientRect().height>=44)),'native visible controls are at least 44px at '+width)
    if(folder)await page.screenshot({path:join(folder,name+'-'+width+'.png'),fullPage:true})
   }
   await page.close()
  }
  await context.close()
 } finally {await browser.close()}
}
