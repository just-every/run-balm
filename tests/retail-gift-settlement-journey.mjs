import assert from 'node:assert/strict'
import {clinic,pastVisit} from './clinic.mjs'
import {portalLogin} from './portal-billing.mjs'

export async function giftSettlementJourney(h,{screen=async()=>{}}={}) {
 await h.finishSetup()
 const {service,practitioners:[priya]}=await clinic(h,['GiftSettlementClinician'])
 const biller=await h.staff('GiftSettlementBiller','biller')
 const patient=await h.cmd('client.save',{firstName:'Synthetic',lastName:'Gift settlement',dateOfBirth:'1950-01-01',email:h.auth.OWNER_EMAIL})
 const other=await h.cmd('client.save',{firstName:'Synthetic',lastName:'Foreign gift settlement',dateOfBirth:'1950-01-01',email:h.auth.OWNER_EMAIL.replace(/^./,'x')})
 const cookie=await portalLogin(h,h.auth.OWNER_EMAIL),foreign=await portalLogin(h,h.auth.OWNER_EMAIL.replace(/^./,'x'))
 const gift=await h.cmd('pay.retail.sell',{clientId:patient.id,kind:'gift_card',label:'synthetic-balm-settlement-gift',amountCents:10000,reference:'synthetic-balm-settlement-gift',confirm:true})
 const member=await h.cmd('pay.retail.sell',{clientId:patient.id,kind:'membership',serviceId:service.id,units:2,amountCents:6001,label:'synthetic-balm-gift-funded-membership',giftId:gift.id,reference:'synthetic-balm-gift-funded-membership',confirm:true})
 const visit=await pastVisit(h,patient.id,priya,service.id,h.owner,7,{coverageChoice:'self_pay',deliveryMethod:'paper'})
 await h.cmd('pay.retail.assign',{clientId:patient.id,saleId:member.id,appointmentId:visit})
 await h.cmd('appointment.attend',{id:visit},priya.cookie)
 const original=(await h.send('/portal/receipts/'+member.id+'.pdf',undefined,cookie)).text
 const at=new Date().toISOString(),input={clientId:patient.id,saleId:member.id,effectiveAt:at,authorizedAt:new Date(Date.now()-120000).toISOString(),authorizationMethod:'synthetic-balm-patient-request',consentEvidence:'synthetic-balm-explicit-original-gift-restoration',reason:'synthetic-balm-unused-membership-cancellation',confirm:true,restoreGift:true,settlementAmountCents:3001,settlementReference:'synthetic-balm-gift-restoration',settlementEvidence:'synthetic-balm-owner-reviewed-original-gift-and-patient-request'}
 for(const session of [biller.cookie,priya.cookie])await h.cmd('pay.retail.gift_settle',input,session,403)
 await h.cmd('pay.retail.gift_settle',{...input,clientId:other.id},h.owner,404)
 await h.cmd('pay.retail.gift_settle',{...input,authorizerKind:'guardian'},h.owner,403)
 await h.cmd('pay.retail.gift_settle',{...input,restoreGift:false},h.owner,400)
 await h.cmd('pay.retail.gift_settle',{...input,settlementAmountCents:3000},h.owner,409)
 await h.cmd('pay.retail.settle',{...input,cashReturned:true},h.owner,409)
 const from=new Date(Date.now()-2*86400_000).toISOString().slice(0,10),to=new Date(Date.now()+2*86400_000).toISOString().slice(0,10)
 const report=async()=>(await h.send('/api/balm/reports/financial?from='+from+'&to='+to,undefined,h.owner)).value
 const before=await report()
 await screen({patient,member,input,cookie})
 const concurrent=await Promise.all([input,{...input,settlementReference:'synthetic-balm-concurrent-gift-restoration'}].map(input=>h.send('/api/balm/command',{name:'pay.retail.gift_settle',input},h.owner)))
 assert.deepEqual(concurrent.map(r=>r.status).sort(),[200,409])
 assert.deepEqual(concurrent.find(r=>r.status===200).value.result,{state:'cancelled',visitsLeft:0,settledVisits:1,restoredGiftCents:3001,providerRefund:false})
 await h.cmd('pay.retail.gift_settle',input,h.owner,409)
 const file=(await h.send('/api/balm/clients/'+patient.id,undefined,h.owner)).value
 assert.equal(file.billing.retail.find(x=>x.id===gift.id).gift_left_cents,7000)
 assert.equal(file.billing.retail.find(x=>x.id===member.id).visits_left,0)
 assert.equal(file.billing.ledger.balanceCents,0);assert.equal(file.billing.ledger.chargesCents,6001);assert.equal(file.billing.ledger.paymentsCents,3000);assert.equal(file.billing.ledger.adjustmentsCents,3001)
 assert.equal((await h.send('/portal/receipts/'+member.id+'.pdf',undefined,cookie)).text,original)
 assert.equal((await h.send('/portal/receipts/'+member.id+'.pdf',undefined,foreign)).status,404)
 const portal=await h.send('/portal/home',undefined,cookie)
 assert.ok(portal.text.includes('Unused membership value returned to your original gift: $30.01.'))
 assert.ok(!portal.text.includes(input.consentEvidence))
 const settlement=await h.db.prepare('SELECT recorded_at FROM bm_membership_settlements WHERE sale_id=?').bind(member.id).first()
 const day=new Date(Date.parse(settlement.recorded_at)+10*3600000).toISOString().slice(0,10)
 const financial=await report()
 assert.equal(financial.retail.giftLiabilityCents,before.retail.giftLiabilityCents+3001)
 assert.equal(financial.deposits.total.receivedCents,before.deposits.total.receivedCents)
 assert.equal(financial.deposits.total.postedCents,before.deposits.total.postedCents-3001)
 assert.equal(financial.deposits.total.creditCents,before.deposits.total.creditCents+3001)
 assert.equal(financial.deposits.total.refundedCents,before.deposits.total.refundedCents,'restoring gift value invents no bank or provider refund')
 assert.ok(financial.deposits.rows.every(r=>r.creditCents>=0),'restoring gift value never invents an overdrawn gift deposit')
 assert.ok(file.retention.reasons.includes('unresolved_retail_entitlement'),'restored gift value still requires preservation')
 const spend={clientId:patient.id,kind:'product',label:'synthetic-balm-restored-gift-purchase',amountCents:7000,giftId:gift.id,taxBasisPoints:0,taxState:'TX',taxEvidence:'synthetic-balm-owner-reviewed-rate',reference:'synthetic-balm-restored-gift-purchase',confirm:true}
 const spends=await Promise.all([spend,{...spend,reference:'synthetic-balm-concurrent-gift-spend'}].map(input=>h.send('/api/balm/command',{name:'pay.retail.sell',input},h.owner)))
 assert.deepEqual(spends.map(r=>r.status).sort(),[200,409],'restored value can be spent once without overdraw')
 assert.equal((await h.send('/api/balm/clients/'+patient.id,undefined,h.owner)).value.billing.retail.find(x=>x.id===gift.id).gift_left_cents,0)
 assert.equal(h.outboundRequests.filter(r=>/stripe|quickbooks|payer/.test(r.origin)).length,0)
 return {patient,member,gift,input,day}
}
