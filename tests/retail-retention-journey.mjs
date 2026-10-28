import assert from 'node:assert/strict'
import {clinic,pastVisit} from './clinic.mjs'

/** The public review and approval doors retire eligible retail groups only. */
export async function retailRetentionJourney(h,{screen=async()=>{}}={}) {
 await h.finishSetup()
 const {service,practitioners:[priya]}=await clinic(h,['RetailCustodyClinician'])
 const desk=await h.staff('RetailCustodyDesk','reception')
 const patient=await h.cmd('client.save',{firstName:'Synthetic',lastName:'Retail custody',dateOfBirth:'1950-01-01'})
 const visit=await pastVisit(h,patient.id,priya,service.id,h.owner,4,{coverageChoice:'self_pay',deliveryMethod:'paper'})
 await h.db.prepare("UPDATE bm_appointments SET start_at='1990-01-02T02:00:00.000Z',end_at='1990-01-02T02:45:00.000Z' WHERE id=?").bind(visit).run()
 const historical=async(kind,cents,at,extra={})=>{
  const key=crypto.randomUUID()
  await h.db.prepare(`INSERT INTO bm_retail_sales(id,client_id,kind,label,service_id,units,amount_cents,tax_cents,tax_basis_points,tax_state,tax_evidence,gift_id,reference,recorded_at,recorded_by,receipt_base64,renewal_of)
   VALUES(?,?,?,?,?,?,?,?,0,'','',?,?,?,?,?,?)`).bind(key,patient.id,kind,'synthetic-balm-private-original',kind==='membership'?service.id:null,kind==='membership'?1:0,cents,0,extra.giftId??null,'synthetic-balm-'+key,at,h.auth.OWNER_EMAIL,btoa('%PDF-1.4 synthetic-balm-private-original'),extra.renewalOf??null).run()
  return key
 }
 const old=await historical('membership',1000,'2000-01-02T03:00:00.000Z')
 await h.db.prepare('INSERT INTO bm_package_assignments VALUES(?,?,?,?,?)').bind(visit,old,patient.id,h.auth.OWNER_EMAIL,'2000-01-02T04:00:00.000Z').run()
 await h.db.prepare('INSERT INTO bm_package_uses VALUES(?,?,?,?)').bind(visit,old,patient.id,'2000-01-02T05:00:00.000Z').run()
 await h.db.prepare("UPDATE bm_appointments SET status='attended' WHERE id=?").bind(visit).run()
 const oldGift=await historical('gift_card',500,'2000-01-02T03:00:00.000Z')
 const redemption=await historical('product',500,'2001-01-02T03:00:00.000Z',{giftId:oldGift})
 const settledGift=await historical('gift_card',10000,'2000-01-02T03:00:00.000Z')
 const giftMember=await historical('membership',3001,'2000-01-02T04:00:00.000Z',{giftId:settledGift})
 await h.db.prepare("INSERT INTO bm_membership_settlements(sale_id,client_id,units,amount_cents,reference,evidence,recorded_at,recorded_by,tender,gift_id) VALUES(?,?,1,3001,'synthetic-balm-retired-gift-restoration','synthetic-balm-private-gift-evidence','2000-01-02T05:00:00.000Z',?,'gift',?)").bind(giftMember,patient.id,h.auth.OWNER_EMAIL,settledGift).run()
 await h.db.prepare("INSERT INTO bm_membership_cancellations(sale_id,client_id,effective_at,authorized_at,authorization_method,consent_evidence,reason,recorded_by,recorded_at,visits_left) VALUES(?,?,'2000-01-02T05:00:00.000Z','2000-01-02T04:30:00.000Z','synthetic-balm-patient-request','synthetic-balm-private-consent','synthetic-balm-private-reason',?,'2000-01-02T05:00:00.000Z',0)").bind(giftMember,patient.id,h.auth.OWNER_EMAIL).run()
 const spentRestoredGift=await historical('product',10000,'2001-01-02T03:00:00.000Z',{giftId:settledGift})
 const retired=[old,oldGift,redemption,settledGift,giftMember,spentRestoredGift]
 const connectedGift=await historical('gift_card',700,'2000-01-02T03:00:00.000Z')
 const recentRedemption=await h.cmd('pay.retail.sell',{clientId:patient.id,kind:'product',label:'synthetic-balm-recent-redemption',amountCents:700,taxBasisPoints:0,taxState:'TX',taxEvidence:'synthetic-balm-owner-tax-review',giftId:connectedGift,reference:'synthetic-balm-recent-redemption',confirm:true})
 const renewalSource=await historical('membership',900,'2000-01-02T03:00:00.000Z')
 const renewal=await historical('membership',800,new Date().toISOString(),{renewalOf:renewalSource})
 const live=await h.cmd('pay.retail.sell',{clientId:patient.id,kind:'membership',serviceId:service.id,units:2,amountCents:2000,label:'synthetic-balm-unresolved-membership',reference:'synthetic-balm-unresolved-membership',confirm:true})
 await h.cmd('retention.save',{state:'AZ',adultYears:6,minorYears:6,payerYears:0,majorityAge:18})
 const get=async()=> (await h.send('/api/balm/clients/'+patient.id,undefined,h.owner)).value
 const review=(await get()).retention
 assert.equal(review.eligible,false,'recent retail keeps full patient destruction unavailable')
 const ready=review.retail.groups.filter(g=>g.eligible)
 assert.deepEqual(ready.flatMap(g=>g.saleIds).sort(),retired.toSorted(),'recent unrelated retail does not retain expired retail originals')
 assert.equal(ready.find(g=>g.saleIds.includes(old)).eligibleAfter,'2006-01-02')
 assert.equal(ready.find(g=>g.saleIds.includes(oldGift)).eligibleAfter,'2007-01-02','gift redemption determines its whole connected retention group')
 const connected=review.retail.groups.find(g=>g.saleIds.includes(connectedGift))
 assert.deepEqual(connected.saleIds,[connectedGift,recentRedemption.id].sort());assert.equal(connected.eligible,false)
 assert.deepEqual(review.retail.groups.find(g=>g.saleIds.includes(renewalSource)).saleIds,[renewalSource,renewal].sort())
 assert.equal(review.retail.groups.find(g=>g.saleIds.includes(renewalSource)).eligible,false)
 const beforeResponse=await h.send('/api/balm/reports/financial?from=2000-01-02&to=2001-01-02',undefined,h.owner)
 assert.equal(beforeResponse.status,200);const before=beforeResponse.value
 assert.equal(before.summary.chargesCents,15401);assert.equal(before.summary.paymentsCents,12400);assert.equal(before.summary.adjustmentsCents,3001)
 assert.equal(before.deposits.total.receivedCents,13100);assert.equal(before.deposits.total.postedCents,12400);assert.equal(before.deposits.total.creditCents,700)
 assert.equal(before.retail.giftLiabilityCents,700)
 for(const session of [desk.cookie,priya.cookie]) {
  await h.cmd('retention.retail.preview',{clientId:patient.id},session,403)
  await h.cmd('retention.retail.destroy',{previewId:'synthetic-balm-unknown',digest:'synthetic-balm-unknown',confirm:true},session,403)
 }
 const preview=await h.cmd('retention.retail.preview',{clientId:patient.id})
 assert.deepEqual(preview.saleIds,retired.toSorted())
 assert.equal(preview.records.bm_retail_sales,6);assert.equal(preview.records.bm_clients,undefined)
 await h.cmd('retention.destroy',{...preview,confirm:true},h.owner,409)
 await h.cmd('retention.retail.destroy',{...preview,confirm:false},h.owner,400)
 await h.cmd('retention.retail.destroy',{...preview,digest:'synthetic-balm-wrong',confirm:true},h.owner,409)
 await h.cmd('retention.hold',{clientId:patient.id,reason:'synthetic-balm-legal-hold'})
 await h.cmd('retention.retail.preview',{clientId:patient.id},h.owner,409)
 await h.cmd('retention.retail.destroy',{...preview,confirm:true},h.owner,409)
 await h.cmd('retention.hold',{clientId:patient.id,release:true,reason:'synthetic-balm-hold-released'})
 await h.cmd('retention.retail.destroy',{...preview,confirm:true},h.owner,409)
 const fresh=await h.cmd('retention.retail.preview',{clientId:patient.id})
 await screen(patient)
 const result=await h.cmd('retention.retail.destroy',{...fresh,confirm:true})
 assert.equal(result.scope,'retail');assert.equal(result.destroyed,true)
 await h.cmd('retention.retail.destroy',{...fresh,confirm:true},h.owner,409)
 const file=await get()
 assert.equal(file.client.first_name,'Synthetic');assert.equal(file.appointments.length,1)
 assert.deepEqual(file.billing.retail.map(s=>s.id).sort(),[connectedGift,recentRedemption.id,renewalSource,renewal,live.id].sort())
 for(const key of retired)assert.equal((await h.send('/api/balm/receipts/'+key+'.pdf',undefined,h.owner)).status,404)
 assert.equal((await h.send('/api/balm/receipts/'+live.id+'.pdf',undefined,h.owner)).status,200)
 const anonymous=(await h.db.prepare('SELECT * FROM bm_destroyed_retail WHERE id IN (SELECT value FROM json_each(?))').bind(JSON.stringify(retired)).all()).results
 assert.equal(anonymous.length,6);assert.ok(!JSON.stringify(anonymous).includes(patient.id));assert.ok(!JSON.stringify(anonymous).includes('synthetic-balm-private-original'))
 const afterResponse=await h.send('/api/balm/reports/financial?from=2000-01-02&to=2001-01-02',undefined,h.owner)
 assert.equal(afterResponse.status,200);const after=afterResponse.value
 for(const field of ['summary','retail'])assert.deepEqual(after[field],before[field],field+' stays exact after selective destruction')
 assert.deepEqual(after.deposits.total,before.deposits.total)
 // Private receipt references are withdrawn; dated source rows and every cent survive.
 const anonymousDeposits=r=>r.deposits.rows.map(({reference,...facts})=>facts).sort((a,b)=>JSON.stringify(a).localeCompare(JSON.stringify(b)))
 assert.deepEqual(anonymousDeposits(after),anonymousDeposits(before))
 const invoice=await h.cmd('invoice.prepare',{appointmentId:visit})
 await h.cmd('invoice.prepare',{appointmentId:visit,amountCents:9500},h.owner,409)
 assert.equal(invoice.snapshot.amountCents,0,'a retired package original cannot make an already covered visit billable again')
 assert.equal(JSON.parse(anonymous.find(s=>s.id===giftMember).settlement).tender,'gift')
 await h.cmd('pay.retail.sell',{clientId:patient.id,kind:'membership',serviceId:service.id,units:1,amountCents:1000,label:'synthetic-balm-replayed-sale',reference:'synthetic-balm-'+old,confirm:true},h.owner,409)
 await h.cmd('retention.retail.preview',{clientId:patient.id},h.owner,409)
 return {patient,old,live,visit}
}
