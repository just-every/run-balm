import assert from 'node:assert/strict'
import {mkdir} from 'node:fs/promises'
import {execFileSync} from 'node:child_process'
import {chromium} from '@playwright/test'
import {harness} from './harness.mjs'
import {authenticatorCode} from './staff-second-step.mjs'
import {pathToFileURL} from 'node:url'
export async function staffSecurityBrowser(){
const head=execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim()
const root=process.env.BALM_UI_SCREENSHOTS
if(root)await mkdir(root,{recursive:true})
const h=await harness({autoMfa:false,browserHttps:true})
let browser
try{
 browser=await chromium.launch({headless:true,args:['--use-mock-keychain','--password-store=basic']})
 const context=await browser.newContext({ignoreHTTPSErrors:true})
 for(const [pattern,path,type] of [['**/rer-theme.css','public/rer-theme.css','text/css'],['**/fonts/fonts.css','public/fonts/fonts.css','text/css'],['**/brand/mark.svg','public/brand/mark.svg','image/svg+xml']])await context.route(pattern,r=>r.fulfill({path,contentType:type}))
 await context.route('**/fonts/inter/*.woff2',r=>r.fulfill({path:'public'+new URL(r.request().url()).pathname,contentType:'font/woff2'}))
 const cookie=async value=>{const [name,...parts]=value.split('=');await context.clearCookies();await context.addCookies([{name,value:parts.join('='),url:h.origin,secure:true}])}
 const page=await context.newPage()
 const capture=async(name,selector)=>{for(const width of [1440,390]){await page.setViewportSize({width,height:1000});if(selector)await page.locator(selector).first().scrollIntoViewIfNeeded();assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),name+' fits viewport');if(root)await page.screenshot({path:root+'/'+name+'-'+width+'.png',mask:[page.locator('[data-mfa-secret]'),page.locator('input[name=code]')]})}}
 await cookie(h.owner)
 await page.goto(h.origin+'/app')
 await page.waitForURL(/\/auth\/security$/)
 await capture('SEC-001-first-entry')
 await page.getByRole('button',{name:'Set up authenticator',exact:true}).click()
 const secret=await page.locator('[data-mfa-secret] code').textContent()
 await capture('SEC-001-authenticator','input[name=code]')
 await page.locator('[name=code]').fill(authenticatorCode(secret))
 await page.getByRole('button',{name:'Verify second step',exact:true}).click()
 const recovery=await page.locator('[data-mfa-secret] code').allTextContents()
 assert.equal(recovery.length,10)
 await page.getByRole('link',{name:'Open Balm',exact:true}).click()
 await page.locator('input[name=confirm]').check()
 await page.getByRole('button',{name:'Finish setup',exact:true}).click()
 await page.locator('[name=clinicName]').fill('Synthetic secure clinic')
 await page.locator('[name=timeZone]').selectOption('America/New_York')
 await page.getByRole('button',{name:'Save and open the schedule',exact:true}).click()
 await page.waitForURL(/\/app$/)
 const original=await h.send('/auth/security',undefined,h.owner,{accept:'application/json'})
 assert.equal(original.status,200)
 const another=await h.signIn(h.auth.OWNER_EMAIL)
 await cookie(another)
 await page.goto(h.origin+'/app')
 await page.waitForURL(/\/auth\/security$/)
 await capture('SEC-001-second-step')
 await page.locator('[name=code]').fill('invalid')
 await page.getByRole('button',{name:'Verify second step',exact:true}).click()
 await page.getByRole('alert').waitFor()
 await capture('SEC-001-code-refused')
 await page.getByRole('link',{name:'Back to staff security',exact:true}).click()
 await page.locator('[name=code]').fill(recovery[0])
 await page.getByRole('button',{name:'Verify second step',exact:true}).click()
 await page.waitForURL(/\/app$/)
 await page.goto(h.origin+'/auth/security')
 const policy=page.locator('form[action="/auth/security/policy"]')
 await policy.locator('[name=idleMinutes]').fill('1')
 await policy.locator('[name=requireAll]').check()
 await capture('SEC-001-browser-policy','form[action="/auth/security/policy"]')
 await policy.getByRole('button',{name:'Save session policy',exact:true}).click()
 const revoke=page.locator('form[action="/auth/security/revoke"]').filter({has:page.locator('input[name=sessionId][value="'+original.value.currentSessionId+'"]')})
 await revoke.getByRole('button',{name:'Sign out this device',exact:true}).click()
 await h.state(h.owner,401)
 assert.equal((await h.send('/auth/security',undefined,another,{accept:'application/json'})).value.policy.idle_minutes,1)
 return {head}
}finally{await browser?.close();await h.close()}

}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){assert.equal(execFileSync('git',['status','--porcelain'],{encoding:'utf8'}).trim(),'');const {head}=await staffSecurityBrowser();console.log('PASS SEC-001 browser enrollment/recovery/policy/revocation head='+head)}
