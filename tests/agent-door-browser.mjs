import assert from 'node:assert/strict'
import {chromium} from '@playwright/test'
import {mkdir} from 'node:fs/promises'
import {join} from 'node:path'

/** Browser leg of the declared public-door journey, using its real native session. */
export default async function({request,origin,cookie}) {
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
  const approvals=await request(origin+'/agents/api/approvals',{headers:{Cookie:cookie,Origin:origin}})
  assert.equal(approvals.status,200)
  const saved=await approvals.json()
  const paths=[['agents','/agents'],...((saved.approvals??[]).slice(0,1).map(a=>['approval','/agents/approvals/'+encodeURIComponent(a.id)])),['missing-approval','/agents/approvals/missing-native-record']]
  for(const width of [1440,390]) {
   const page=await context.newPage();await page.setViewportSize({width,height:1000})
   for(const [name,path] of paths) {
    await page.goto(origin+path)
    if(width===1440){assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'native door has no horizontal overflow at desktop');assert.ok(await page.locator('button').evaluateAll(nodes=>nodes.filter(n=>n.getBoundingClientRect().height).every(n=>n.getBoundingClientRect().height>=44)),'native visible controls are at least 44px')}
    if(folder)await page.screenshot({path:join(folder,name+'-'+width+'.png'),fullPage:true})
   }
   await page.close()
  }
  const paused=await request(origin+'/agents/api/pause',{method:'POST',headers:{Cookie:cookie,Origin:origin,'Content-Type':'application/json'},body:JSON.stringify({paused:true})});assert.equal(paused.status,200);await paused.body?.cancel()
  for(const width of [1440,390]){const page=await context.newPage();await page.setViewportSize({width,height:1000});await page.goto(origin+'/agents');if(folder)await page.screenshot({path:join(folder,'paused-'+width+'.png'),fullPage:true});await page.close()}
  const resumed=await request(origin+'/agents/api/pause',{method:'POST',headers:{Cookie:cookie,Origin:origin,'Content-Type':'application/json'},body:JSON.stringify({paused:false})});assert.equal(resumed.status,200);await resumed.body?.cancel()
  await context.close()
 } finally {await browser.close()}
}
