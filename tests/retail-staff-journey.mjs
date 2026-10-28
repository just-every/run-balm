import assert from 'node:assert/strict'
import {clinic,pastVisit} from './clinic.mjs'

/** Named finite grants add sale recording without granting membership or clinical powers. */
export async function retailStaffJourney(h,{screen=async()=>{}}={}) {
 await h.finishSetup()
 const {service,practitioners:[priya]}=await clinic(h,['RetailSalesClinician'])
 const desk=await h.staff('RetailSalesDesk','reception'),biller=await h.staff('RetailSalesBiller','biller'),other=await h.staff('RetailSalesOther','reception')
 const patient=await h.cmd('client.save',{firstName:'Synthetic',lastName:'Delegated retail',dateOfBirth:'1950-01-01'})
 const sale={clientId:patient.id,kind:'package',serviceId:service.id,units:5,amountCents:40000,label:'synthetic-balm-delegated-package',reference:'synthetic-balm-delegated-package',confirm:true}
 for(const session of [desk.cookie,biller.cookie,other.cookie,priya.cookie])await h.cmd('pay.retail.sell',sale,session,403)
 const grant=staffId=>({staffId,expiresAt:new Date(Date.now()+3600_000).toISOString(),reason:'synthetic-balm-owner-approved-finite-cash-sales',confirm:true})
 await h.cmd('pay.retail.authorize',grant(desk.id),desk.cookie,403)
 await h.cmd('pay.retail.authorize',grant(priya.id),h.owner,403)
 await h.cmd('pay.retail.authorize',{...grant(desk.id),confirm:false},h.owner,400)
 await h.cmd('pay.retail.authorize',{...grant(desk.id),expiresAt:'1990-01-01T00:00:00Z'},h.owner,400)
 await h.cmd('pay.retail.authorize',{...grant(desk.id),expiresAt:new Date(Date.now()+8*86400_000).toISOString()},h.owner,400)
 await h.cmd('pay.retail.authorize',grant(desk.id))
 await h.cmd('pay.retail.authorize',grant(biller.id))
 const packageSale=await h.cmd('pay.retail.sell',sale,desk.cookie)
 await h.cmd('pay.retail.sell',sale,desk.cookie,409)
 const member=await h.cmd('pay.retail.sell',{...sale,kind:'membership',units:1,amountCents:2000,label:'synthetic-balm-delegated-membership',reference:'synthetic-balm-delegated-membership'},biller.cookie)
 const gift=await h.cmd('pay.retail.sell',{clientId:patient.id,kind:'gift_card',amountCents:5000,label:'synthetic-balm-delegated-gift',reference:'synthetic-balm-delegated-gift',confirm:true},desk.cookie)
 const productInput={clientId:patient.id,kind:'product',amountCents:1000,label:'synthetic-balm-delegated-brace',reference:'synthetic-balm-delegated-brace',giftId:gift.id,taxBasisPoints:825,taxState:'TX',taxEvidence:'synthetic-balm-owner-tax-evidence',confirm:true}
 await h.cmd('pay.retail.sell',productInput,biller.cookie,403)
 await h.cmd('pay.retail.authorize',{...grant(biller.id),taxRules:[{state:'TX',rate:825,evidence:'synthetic-balm-owner-tax-evidence'}]})
 for(const override of [{taxBasisPoints:0},{taxState:'AZ'},{taxEvidence:'synthetic-balm-unreviewed-source'}])await h.cmd('pay.retail.sell',{...productInput,...override},biller.cookie,403)
 const product=await h.cmd('pay.retail.sell',productInput,biller.cookie)
 assert.equal(product.totalCents,1083)
 const approval=(await h.db.prepare('SELECT a.* FROM bm_retail_sales s JOIN bm_retail_staff_approvals a ON a.id=s.staff_approval_id WHERE s.id=?').bind(product.id).first())
 assert.equal(approval.staff_id,biller.id)
 assert.deepEqual(JSON.parse(approval.tax_rules),[{state:'TX',rate:825,evidence:'synthetic-balm-owner-tax-evidence'}])
 await assert.rejects(h.db.prepare("UPDATE bm_retail_staff_approvals SET tax_rules='[]' WHERE id=?").bind(approval.id).run(),/original_record_is_immutable/)

 const visit=await pastVisit(h,patient.id,priya,service.id,h.owner,4,{coverageChoice:'self_pay',deliveryMethod:'paper'})
 await h.cmd('pay.retail.assign',{clientId:patient.id,saleId:packageSale.id,appointmentId:visit},desk.cookie)
 await h.cmd('appointment.attend',{id:visit},priya.cookie)
 const file=async session=>(await h.send('/api/balm/clients/'+patient.id,undefined,session)).value
 const billing=(await file(biller.cookie)).billing
 assert.equal(billing.retailSalesAllowed,true)
 assert.equal(billing.retail.find(s=>s.id===packageSale.id).visits_left,4)
 assert.equal(billing.retail.find(s=>s.id===gift.id).gift_left_cents,3917)
 assert.equal(billing.ledger.chargesCents,43083);assert.equal(billing.ledger.paymentsCents,43083);assert.equal(billing.ledger.balanceCents,0)
 for(const key of [packageSale.id,member.id,gift.id,product.id])assert.equal((await h.send('/api/balm/receipts/'+key+'.pdf',undefined,biller.cookie)).status,200)
 for(const name of ['pay.retail.membership','pay.retail.cancel','pay.retail.renew','pay.retail.settle'])await h.cmd(name,{clientId:patient.id,saleId:member.id,confirm:true},biller.cookie,403)
 assert.ok((await h.send('/app/clients/'+patient.id,undefined,desk.cookie)).text.includes('name=pay.retail.sell'))
 const delegatedDevice=await h.signIn((await h.db.prepare('SELECT email FROM bm_staff WHERE id=?').bind(desk.id).first()).email)
 const device=(await h.send('/auth/security',undefined,delegatedDevice,{accept:'application/json'})).value.currentSessionId
 assert.equal((await h.send('/auth/security/revoke',{sessionId:device},h.owner)).status,200)
 await h.cmd('pay.retail.sell',{...sale,reference:'synthetic-balm-revoked-staff-device'},delegatedDevice,401)
 await screen({patient,desk,biller,service})
 await h.cmd('pay.retail.authorize',{staffId:desk.id,revoke:true})
 assert.equal((await file(desk.cookie)).billing.retailSalesAllowed,false)
 assert.ok(!(await h.send('/app/clients/'+patient.id,undefined,desk.cookie)).text.includes('name=pay.retail.sell'))
 const second={...sale,reference:'synthetic-balm-revoked-delegate-sale'}
 await h.cmd('pay.retail.sell',second,desk.cookie,403)
 await h.cmd('pay.retail.assign',{clientId:patient.id,saleId:member.id,appointmentId:visit},desk.cookie,403)
 await h.db.prepare("UPDATE bm_retail_staff_grants SET expires_at='1990-01-01T00:00:00Z' WHERE staff_id=?").bind(biller.id).run()
 await h.cmd('pay.retail.sell',second,biller.cookie,403)
 await h.cmd('pay.retail.authorize',grant(biller.id))
 await h.cmd('staff.save',{id:biller.id,name:'RetailSalesBiller',email:(await h.db.prepare('SELECT email FROM bm_staff WHERE id=?').bind(biller.id).first()).email,role:'biller',active:false})
 await h.cmd('pay.retail.sell',second,biller.cookie,403)
 const recorded=(await h.db.prepare("SELECT subject_id,actor_role FROM bm_audit WHERE action='retail.sold' AND client_id=? ORDER BY rowid").bind(patient.id).all()).results
 assert.deepEqual(recorded.map(r=>[r.subject_id,r.actor_role]),[[packageSale.id,'reception'],[member.id,'biller'],[gift.id,'reception'],[product.id,'biller']])
 assert.equal((await h.db.prepare('SELECT COUNT(*) n FROM bm_retail_sales WHERE client_id=?').bind(patient.id).first()).n,4)
 return {patient,desk,biller,member,grant}
}
