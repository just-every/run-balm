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
 const report=(await h.send('/api/balm/reports/financial?from='+today+'&to='+today,undefined,h.owner)).value
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
 await proof({patient,cookie,today})
}
