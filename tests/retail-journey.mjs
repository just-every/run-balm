import assert from 'node:assert/strict'
import {clinic,pastVisit} from './clinic.mjs'
import {portalLogin} from './portal-billing.mjs'
export async function retailJourney(h,proof=async()=>{}){
 await h.finishSetup()
 const {service,practitioners:[priya]}=await clinic(h)
 await h.cmd('settings.save',{clinicName:'Riverside Therapy',timeZone:'Australia/Brisbane',taxId:'12-3456789',practiceNpi:'1234567893',address:'100 Main St'})
 await h.cmd('pay.npi.save',{staffId:priya.id,npi:'1245319599'})
 const patient=await h.cmd('client.save',{firstName:'Synthetic',lastName:'Retail',email:'retail@patient.example',dateOfBirth:'1980-01-01'})
 const other=await h.cmd('client.save',{firstName:'Synthetic',lastName:'Other',email:'other@patient.example',dateOfBirth:'1980-01-01'})
 const sale={clientId:patient.id,confirm:true,kind:'package',label:'Five cash visits',serviceId:service.id,units:5,amountCents:40000,reference:'synthetic-balm-package'}
 const reception=await h.staff('RetailDesk','reception')
 await h.cmd('pay.retail.sell',sale,reception.cookie,403)
 await h.cmd('pay.retail.sell',{...sale,confirm:false},h.owner,400)
 const packageSale=await h.cmd('pay.retail.sell',sale)
 await h.cmd('pay.retail.sell',sale,h.owner,409)
 const invoiceIds=[]
 for(const hours of [2,5]){
  const visit=await pastVisit(h,patient.id,priya,service.id,h.owner,hours,{coverageChoice:'self_pay',deliveryMethod:'paper'})
  await h.cmd('pay.retail.assign',{clientId:patient.id,saleId:packageSale.id,appointmentId:visit})
  await h.cmd('pay.codes.save',{appointmentId:visit,cpt:'97110 GP x3',icd10:'M25.561'},priya.cookie)
  await h.cmd('appointment.attend',{id:visit},priya.cookie)
  await h.cmd('appointment.attend',{id:visit},priya.cookie,409)
  await h.cmd('invoice.prepare',{appointmentId:visit,amountCents:9500},h.owner,409)
  const invoice=await h.cmd('invoice.prepare',{appointmentId:visit})
  assert.equal(invoice.snapshot.amountCents,0)
  await h.cmd('invoice.approve',{id:invoice.id})
  invoiceIds.push(invoice.id)
 }
 const gift=await h.cmd('pay.retail.sell',{clientId:patient.id,confirm:true,kind:'gift_card',label:'Patient gift value',amountCents:10000,reference:'synthetic-balm-gift'})
 const product={clientId:patient.id,confirm:true,kind:'product',label:'Brace',amountCents:5000,taxBasisPoints:825,taxState:'TX',taxEvidence:'Owner verified applicable product rate',giftId:gift.id,reference:'synthetic-balm-brace'}
 const brace=await h.cmd('pay.retail.sell',product)
 assert.equal(brace.totalCents,5413)
 await h.cmd('pay.retail.sell',{...product,reference:'synthetic-balm-overdraw'},h.owner,409)
 await h.cmd('pay.retail.sell',{...product,clientId:other.id,reference:'synthetic-balm-foreign'},h.owner,409)
 const file=(await h.send('/api/balm/clients/'+patient.id,undefined,h.owner)).value
 assert.equal(file.billing.retail.find(s=>s.id===packageSale.id).visits_left,3)
 assert.equal(file.billing.retail.find(s=>s.id===gift.id).gift_left_cents,4587)
 assert.equal(file.billing.ledger.balanceCents,0)
 assert.equal(file.billing.ledger.chargesCents,45413)
 assert.equal(file.billing.ledger.paymentsCents,45413)
 const cookie=await portalLogin(h,'retail@patient.example'),foreign=await portalLogin(h,'other@patient.example')
 const shown=await h.cmd('pay.link.create',{clientId:patient.id,purpose:'balance',delivery:'shown'})
 const foreignShown=await h.cmd('pay.link.create',{clientId:other.id,purpose:'balance',delivery:'shown'})
 const payPath=new URL(shown.url).pathname,foreignPayPath=new URL(foreignShown.url).pathname
 const portal=await h.send('/portal/home',undefined,cookie)
 assert.equal(portal.status,200)
 for(const id of [packageSale.id,gift.id,brace.id]){
  const path='/portal/receipts/'+id+'.pdf'
  assert.ok(portal.text.includes(path))
  const original=await h.send(path,undefined,cookie)
  assert.equal(original.status,200);assert.match(original.text,/^%PDF/)
  assert.equal((await h.send(path,undefined,foreign)).status,404)
  assert.equal((await h.send(path)).status,303)
  const staff=await h.send('/api/balm/receipts/'+id+'.pdf',undefined,h.owner)
  assert.equal(staff.status,200);assert.equal(staff.text,original.text)
  assert.equal((await h.send(payPath+'/receipts/'+id+'.pdf')).text,original.text)
  assert.equal((await h.send(foreignPayPath+'/receipts/'+id+'.pdf')).status,404)
 }
 const receipt=await h.send('/portal/receipts/'+brace.id+'.pdf',undefined,cookie)
 assert.ok(receipt.text.includes('$4.13'));assert.ok(receipt.text.includes('$54.13'))
 for(const id of invoiceIds)assert.equal((await h.send('/portal/superbills/'+id+'.pdf',undefined,cookie)).status,200)
 const statement=await h.send('/portal/statement.pdf',undefined,cookie)
 assert.equal(statement.status,200);assert.ok(statement.text.includes('Brace'));assert.ok(statement.text.includes('Five cash visits'))
 const dates=file.billing.retail.map(s=>new Date(Date.parse(s.recorded_at)+10*3600000).toISOString().slice(0,10)).sort()
 const today=dates.at(-1)
 const report=(await h.send('/api/balm/reports/financial?from='+dates[0]+'&to='+today,undefined,h.owner)).value
 assert.equal(report.summary.chargesCents,45413)
 assert.equal(report.summary.paymentsCents,45413)
 assert.equal(report.summary.arCents,0)
 assert.equal(report.deposits.total.receivedCents,50000)
 assert.equal(report.deposits.total.postedCents,45413)
 assert.equal(report.deposits.total.creditCents,4587)
 assert.equal(file.billing.ledger.chargesCents,report.summary.chargesCents)
 const after=await h.send('/portal/receipts/'+brace.id+'.pdf',undefined,cookie)
 await h.cmd('settings.save',{clinicName:'Updated clinic',timeZone:'Australia/Brisbane'})
 assert.equal((await h.send('/portal/receipts/'+brace.id+'.pdf',undefined,cookie)).text,after.text)
 const review=await h.cmd('retention.preview',{clientId:patient.id},h.owner,409)
 assert.ok(review)
 // Finite membership: pause is reversible and never consumes or forfeits a visit.
 const membership=await h.cmd('pay.retail.sell',{...sale,kind:'membership',units:1,amountCents:5000,label:'Finite wellness membership',reference:'synthetic-balm-member-1'})
 const memberVisit=await pastVisit(h,patient.id,priya,service.id,h.owner,8,{coverageChoice:'self_pay',deliveryMethod:'paper'})
 await h.cmd('pay.retail.assign',{clientId:patient.id,saleId:membership.id,appointmentId:memberVisit})
 const change={clientId:patient.id,saleId:membership.id,state:'paused',reason:'Patient requested a pause',consentEvidence:'Patient authorized reversible pause; all unused visits retained',effectiveAt:new Date().toISOString(),authorizedAt:new Date(Date.now()-120000).toISOString(),authorizationMethod:'Patient request received in person',confirm:true}
 await h.cmd('pay.retail.membership',change,reception.cookie,403)
 await h.cmd('pay.retail.membership',{...change,confirm:false},h.owner,400)
 for(const missing of ['effectiveAt','authorizedAt','authorizationMethod','consentEvidence'])await h.cmd('pay.retail.membership',{...change,[missing]:undefined},h.owner,400)
 for(const authorizedAt of ['2020-99-99T03:04:00Z','2020-02-30T03:04:00Z','2020-01-02T25:04:00Z','2020-01-02T03:99:00Z'])await h.cmd('pay.retail.membership',{...change,authorizedAt},h.owner,400)
 await h.cmd('pay.retail.membership',{...change,effectiveAt:'2999-01-01T00:00:00.000Z'},h.owner,400)
 const mailBeforeTransitions=h.mail.length
 await h.cmd('pay.retail.membership',change)
 await h.cmd('pay.retail.membership',change,h.owner,409)
 await h.cmd('appointment.attend',{id:memberVisit},priya.cookie,409)
 let membershipFile=(await h.send('/api/balm/clients/'+patient.id,undefined,h.owner)).value
 assert.equal(membershipFile.billing.retail.find(x=>x.id===membership.id).visits_left,1)
 assert.equal(membershipFile.billing.retail.find(x=>x.id===membership.id).membership_state,'paused')
 const later=await h.cmd('pay.retail.sell',{...sale,kind:'membership',units:1,amountCents:5000,label:'Later independent membership',reference:'synthetic-balm-member-2'})
 const independent=(await h.send('/api/balm/clients/'+patient.id,undefined,h.owner)).value.billing.retail
 assert.deepEqual(independent.filter(x=>[membership.id,later.id].includes(x.id)).map(x=>[x.id,x.membership_state,x.visits_left]).sort(),[[membership.id,'paused',1],[later.id,'active',1]].sort(),'a later purchase neither resumes nor merges the paused entitlement')
 await h.cmd('pay.retail.cancel',change,h.owner,409)
 const resume={...change,effectiveAt:new Date().toISOString(),state:'active',consentEvidence:'Patient specifically authorized resuming the remaining visit'}
 await h.cmd('pay.retail.membership',resume)
 assert.equal(h.mail.length,mailBeforeTransitions,'recording transitions creates no outbound notice')
 const events=(await h.db.prepare('SELECT * FROM bm_membership_events WHERE sale_id=? ORDER BY rowid').bind(membership.id).all()).results
 assert.deepEqual(events.map(x=>[x.state,x.visits_left]),[['paused',1],['active',1]])
 for(const [i,terms] of [change,resume].entries()){assert.equal(events[i].effective_at,terms.effectiveAt);assert.equal(events[i].authorized_at,terms.authorizedAt);assert.equal(events[i].authorization_method,terms.authorizationMethod);assert.equal(events[i].consent_evidence,terms.consentEvidence);assert.equal(events[i].recorded_by,h.auth.OWNER_EMAIL)}
 await assert.rejects(h.db.prepare("UPDATE bm_membership_events SET reason='changed' WHERE id=?").bind(events[0].id).run(),/original_record_is_immutable/)
 await h.cmd('appointment.attend',{id:memberVisit},priya.cookie)
 membershipFile=(await h.send('/api/balm/clients/'+patient.id,undefined,h.owner)).value
 assert.equal(membershipFile.billing.retail.find(x=>x.id===membership.id).visits_left,0)
 const exhausted=await pastVisit(h,patient.id,priya,service.id,h.owner,11,{coverageChoice:'self_pay',deliveryMethod:'paper'})
 await h.cmd('pay.retail.assign',{clientId:patient.id,saleId:membership.id,appointmentId:exhausted},h.owner,409)
 await h.cmd('pay.retail.cancel',{...resume,effectiveAt:new Date().toISOString()},reception.cookie,403)
 await h.cmd('pay.retail.cancel',{...resume,clientId:other.id},h.owner,404)
 const cancellation=await h.cmd('pay.retail.cancel',{...resume,effectiveAt:new Date().toISOString(),consentEvidence:'Patient specifically authorized cancellation after the final visit'})
 assert.deepEqual(cancellation,{state:'cancelled',visitsLeft:0,providerCharge:false,externalBillingChanged:false})
 await h.cmd('pay.retail.cancel',{...resume,effectiveAt:new Date().toISOString()},h.owner,409)
 await h.cmd('pay.retail.membership',{...resume,state:'paused',effectiveAt:new Date().toISOString()},h.owner,409)
 const laterVisit=exhausted
 await h.cmd('pay.retail.assign',{clientId:patient.id,saleId:later.id,appointmentId:laterVisit})
 await h.cmd('appointment.attend',{id:laterVisit},priya.cookie)
 for(const member of [membership,later]){
  const original=await h.send('/portal/receipts/'+member.id+'.pdf',undefined,cookie)
  assert.equal(original.status,200)
  assert.equal((await h.send('/portal/receipts/'+member.id+'.pdf',undefined,foreign)).status,404)
 }
 assert.equal((await h.send('/portal/receipts/'+brace.id+'.pdf',undefined,cookie)).text,after.text)
 const final=(await h.send('/api/balm/clients/'+patient.id,undefined,h.owner)).value.billing.retail
 assert.equal(final.find(x=>x.id===membership.id).membership_state,'cancelled')
 assert.equal(final.find(x=>x.id===membership.id).visits_left,0)
 assert.equal(final.find(x=>x.id===later.id).membership_state,'active')
 assert.equal(final.find(x=>x.id===later.id).visits_left,0)
 // An explicit renewal buys new entitlements once; the exhausted original stays fixed.
 const renewalTerms={...resume,saleId:later.id,kind:'membership',label:'Authorized renewed membership',serviceId:service.id,units:2,amountCents:7001,reference:'synthetic-balm-renewal',cashConfirm:true,effectiveAt:new Date().toISOString()}
 await h.cmd('pay.retail.renew',renewalTerms,reception.cookie,403)
 await h.cmd('pay.retail.renew',{...renewalTerms,clientId:other.id},h.owner,404)
 await h.cmd('pay.retail.renew',{...renewalTerms,saleId:membership.id},h.owner,409)
 await h.cmd('pay.retail.renew',{...renewalTerms,saleId:packageSale.id},h.owner,404)
 await h.cmd('pay.retail.renew',{...renewalTerms,cashConfirm:false},h.owner,400)
 await h.cmd('pay.retail.renew',{...renewalTerms,confirm:false},h.owner,400)
 await h.cmd('pay.retail.renew',{...renewalTerms,authorizerKind:'guardian'},h.owner,403)
 for(const missing of ['effectiveAt','authorizedAt','authorizationMethod','consentEvidence','reason'])await h.cmd('pay.retail.renew',{...renewalTerms,[missing]:undefined},h.owner,400)
 const sourceOriginal=(await h.send('/portal/receipts/'+later.id+'.pdf',undefined,cookie)).text
 const attempts=await Promise.all([renewalTerms,{...renewalTerms,reference:'synthetic-balm-concurrent-renewal'}].map(input=>h.send('/api/balm/command',{name:'pay.retail.renew',input},h.owner)))
 assert.deepEqual(attempts.map(r=>r.status).sort(),[200,409],'competing renewals create exactly one receipt')
 const renewed=attempts.find(r=>r.status===200).value.result
 assert.equal((await h.send('/portal/receipts/'+later.id+'.pdf',undefined,cookie)).text,sourceOriginal)
 await h.cmd('pay.retail.renew',{...renewalTerms,saleId:renewed.id,reference:'synthetic-balm-unconsumed-renewal'},h.owner,409)
 await h.cmd('pay.retail.renew',{...renewalTerms,reference:'synthetic-balm-renewal-repeat'},h.owner,409)
 const renewedFile=(await h.send('/api/balm/clients/'+patient.id,undefined,h.owner)).value
 assert.deepEqual(renewedFile.billing.retail.filter(x=>[later.id,renewed.id].includes(x.id)).map(x=>[x.id,x.visits_left,x.renewal_of]).sort(),[[later.id,0,null],[renewed.id,2,later.id]].sort())
 const renewalOriginal=await h.send('/portal/receipts/'+renewed.id+'.pdf',undefined,cookie)
 assert.equal(renewalOriginal.status,200);assert.ok(renewalOriginal.text.includes('$70.01'));assert.ok(renewalOriginal.text.includes(later.id))
 assert.equal((await h.send('/portal/receipts/'+renewed.id+'.pdf',undefined,foreign)).status,404)
 const noticed=await h.send('/portal/home',undefined,cookie)
 assert.ok(noticed.text.includes('Authorized renewed membership'))
 assert.ok(noticed.text.includes('2 of 2 visits left'))
 assert.ok(noticed.text.includes('renewed purchase'))
 assert.ok(noticed.text.includes('cancelled'))
 assert.ok(noticed.text.includes('paused'))
 assert.ok(!noticed.text.includes(renewalTerms.consentEvidence),'internal consent evidence is not a patient notice')
 assert.ok(!(await h.send('/portal/home',undefined,foreign)).text.includes('Authorized renewed membership'))
 const obligations=(await h.send('/api/balm/reports/financial?from='+dates[0]+'&to='+today,undefined,h.owner)).value
 assert.deepEqual(obligations.retail.rows.filter(r=>r.purchases).map(r=>[r.kind,r.state,r.purchases,r.visitsSold,r.visitsUsed,r.visitsLeft,r.unearnedCents,r.renewals]),[
  ['package','active',1,5,2,3,24000,0],['membership','active',1,2,0,2,7001,1],['membership','exhausted',1,1,1,0,0,0],['membership','cancelled',1,1,1,0,0,0]
 ])
 assert.equal(obligations.retail.giftLiabilityCents,4587)
 assert.equal(obligations.retail.unearnedCents,31001)
 assert.equal(obligations.retail.visitsLeft,5)
 assert.equal(obligations.summary.chargesCents,62414)
 assert.equal(obligations.summary.paymentsCents,62414)
 assert.equal(obligations.deposits.total.receivedCents,67001)
 const csv=await h.send('/api/balm/reports/financial/retail.csv?from='+dates[0]+'&to='+today,undefined,h.owner)
 assert.equal(csv.status,200);assert.ok(csv.text.includes('"membership","active","1","2","0","2","70.01","1"'));assert.ok(csv.text.includes('"gift_card","held","","","","","45.87",""'))
 assert.equal((await h.send('/api/balm/reports/financial?from='+today+'&to='+today,undefined,reception.cookie)).status,403)
 const renewalFacts=await h.db.prepare('SELECT renewal_authorization FROM bm_retail_sales WHERE id=?').bind(renewed.id).first()
 assert.equal(JSON.parse(renewalFacts.renewal_authorization).authorizedAt,renewalTerms.authorizedAt)
 assert.equal(JSON.parse(renewalFacts.renewal_authorization).evidence,renewalTerms.consentEvidence)
 // A retained anonymous receipt from an older release must not invent visit dates.
 await h.db.prepare("INSERT INTO bm_destroyed_retail(id,kind,units,amount_cents,tax_cents,recorded_at) VALUES(?,'membership',4,1234,0,'1990-01-02T03:00:00.000Z')").bind(crypto.randomUUID()).run()
 const incomplete=(await h.send('/api/balm/reports/financial?from='+today+'&to='+today,undefined,h.owner)).value.retail
 assert.equal(incomplete.incompleteHistory,1)
 assert.equal(incomplete.unearnedCents,31001)
 const legacyPage=await h.send('/app/reports?from='+today+'&to='+today,undefined,h.owner)
 assert.ok(legacyPage.text.includes('These obligation totals are incomplete'))
 assert.ok((await h.db.prepare("SELECT action FROM bm_audit WHERE subject_id=? AND action='retail.renewed'").bind(renewed.id).all()).results.length===1)
 await assert.rejects(h.db.prepare("UPDATE bm_retail_sales SET renewal_of=NULL WHERE id=?").bind(renewed.id).run(),/original_record_is_immutable/)
 assert.equal(h.outboundRequests.filter(x=>/stripe|quickbooks|payer/.test(x.origin)).length,0,'cash sales and membership transitions create no provider charge or billing handoff')
 await proof({patient,cookie,today,from:dates[0],service,priya})
}
