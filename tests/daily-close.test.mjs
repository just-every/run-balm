import {test} from 'node:test'
import assert from 'node:assert/strict'
import {run} from './harness.mjs'
import {fakeProviders} from './fakes/stripe.mjs'
const stripe=fakeProviders()
import {dailyCloseClinic} from './daily-close-clinic.mjs'

test('REPORT-004: daily close names every category, links its records, audits named patients, and clears only after the work is complete',()=>run(async h=>{
 assert.equal((await h.state()).dailyClose,null,'daily close waits for the clinic time zone')
 const c=await dailyCloseClinic(h),reception=await h.staff('Rosa','reception')
 const close=async()=>(await h.state()).dailyClose
 let current=await close()
 assert.equal(current.date,c.today)
 assert.equal(current.notes.length,1);assert.equal(current.charges.length,1);assert.equal(current.copays.length,1)
 assert.equal(current.claims.length,1);assert.equal(current.intakes.length,2);assert.equal(current.authorizations.length,1)
 assert.equal(current.plans.length,2);assert.ok(current.plans.some(i=>i.kind==='late_plan'));assert.ok(current.plans.some(i=>i.kind==='pending_plan'))
 const items=Object.values(current).filter(Array.isArray).flat()
 assert.ok(!JSON.stringify(current).includes('Private therapy narrative'))
 assert.ok(!items.some(i=>i.clientId===c.future.id),'future-only patient is outside today')
 for(const item of items){const url=new URL(item.href,h.origin),page=await h.send(url.pathname,undefined,h.owner);assert.equal(page.status,200);assert.ok(page.text.includes('id="'+decodeURIComponent(url.hash.slice(1))+'"'),'actionable anchor for '+item.kind)}
 const page=await h.send('/app',undefined,h.owner);assert.match(page.text,/data-daily-close/)
 for(const category of ['notes','plans','charges','copays','claims','intakes','authorizations'])assert.ok(page.text.includes('data-close-category="'+category+'"'))
 for(const clientId of new Set(items.map(i=>i.clientId))){const file=await h.send('/api/balm/clients/'+clientId,undefined,h.owner);assert.ok(file.value.audit.some(a=>a.action==='report.daily_close_read'))}
 for(const cookie of [reception.cookie,c.priya.cookie]){assert.equal((await h.state(cookie)).dailyClose,null);assert.ok(!(await h.send('/app',undefined,cookie)).text.includes('data-daily-close'))}
 const key=await h.cmd('agent.create',{label:'Report assistant'});const agent=await h.send('/api/balm/agent/context',undefined,'',{authorization:'Bearer '+key.token});assert.equal(agent.status,200);assert.equal(agent.value.dailyClose,null)
 const before=await close();await c.certify(c.latePlan);await c.certify(c.pendingPlan)
 assert.equal((await close()).plans.length,0);assert.equal((await close()).copays.length,before.copays.length)
 await c.signNote(c.noCharge.id,c.otherVisit);assert.equal((await close()).notes.length,0)
 const charge=await h.cmd('invoice.prepare',{appointmentId:c.otherVisit});assert.equal((await close()).charges.length,0)
 await h.cmd('invoice.approve',{id:charge.id})
 await h.cmd('payment.record',{invoiceId:c.invoice.id,amountCents:3000,reference:'COPAY-CHECK-001'});assert.equal((await close()).copays.length,0)
 const claim=await h.cmd('insurance.claim.prepare',{appointmentId:c.visit,policyId:c.policy.id});assert.equal(claim.status,'ready');assert.equal((await close()).claims.length,1)
 const batch=await h.cmd('insurance.batch.prepare',{claimIds:[claim.id]});await h.send('/api/balm/insurance/837P/'+batch.id,undefined,h.owner)
 assert.equal((await close()).claims[0].kind,'unsent_claim');assert.match((await close()).claims[0].label,/not sent by Balm/)
 await h.cmd('insurance.batch.submit',{id:batch.id});assert.equal((await close()).claims.length,0)
 await c.intake(c.patient.id);await c.intake(c.noCharge.id);assert.equal((await close()).intakes.length,0)
 await h.cmd('insurance.authorization.save',{id:c.authorization.id,policyId:c.policy.id,number:'AUTH12',...c.coverage,visits:12,version:1});assert.equal((await close()).authorizations.length,0)
 // Paying the whole visit by card also collects its copay; the report must
 // recognize the posted card payment, without counting payer money or credit.
 await h.cmd('pay.copay.save',{clientId:c.noCharge.id,copay:'20.00'})
 assert.equal((await close()).copays.length,1)
 await h.cmd('pay.stripe.connect',{secretKey:'sk_test_'+'a'.repeat(24)})
 const card=await h.cmd('pay.link.create',{clientId:c.noCharge.id,purpose:'card',delivery:'shown'})
 const cardPath=new URL(card.url).pathname
 const checkout=await h.form(cardPath+'?do=card',{consent:'on'})
 const session=checkout.location.split('/').pop();stripe.complete(session)
 assert.equal((await h.send(cardPath+'?setup='+session)).status,200)
 await h.cmd('pay.invoice.charge',{invoiceId:charge.id})
 assert.equal((await close()).copays.length,0)
 current=await close();assert.ok(Object.values(current).filter(Array.isArray).every(a=>a.length===0))
 assert.match((await h.send('/app',undefined,h.owner)).text,/Daily close is clear/)
},{auth:{BALM_INSURANCE_ADAPTER_URL:'https://gateway.example/submit',BALM_INSURANCE_ADAPTER_TOKEN:'fixture-gateway-key'},outbound:async request=>{if(request.url==='https://gateway.example/submit')return Response.json({status:'submitted',reference:'fixture-batch-accepted'});return stripe.handler(request)}}))
