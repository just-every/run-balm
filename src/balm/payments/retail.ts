import { audit, commit, guard, human, id, insist, integer, now, one, rows, stmt, text, type Actor, type Data } from '../domain/model'
import { clientVisible } from '../domain/clients'
import { dollars } from '../domain/invoices'
import { pdf } from './pdf'

const owner = (who: Actor) => { human(who); insist(who.role === 'owner', 'only_the_owner_records_retail', 403) }
export async function retailFor(db: D1Database, clientId: string) {
  return rows(db, `SELECT s.id,s.kind,s.label,s.service_id,s.units,s.amount_cents,s.tax_cents,s.gift_id,s.recorded_at,
    s.units-(SELECT COUNT(*) FROM bm_package_uses u WHERE u.sale_id=s.id) AS visits_left,
    CASE WHEN s.kind='gift_card' THEN s.amount_cents-COALESCE((SELECT SUM(x.amount_cents+x.tax_cents) FROM bm_retail_sales x WHERE x.gift_id=s.id),0) ELSE 0 END AS gift_left_cents
    FROM bm_retail_sales s WHERE s.client_id=? ORDER BY s.recorded_at,s.id`, clientId)
}
export async function retailReceipt(db: D1Database, key: string) {
  const sale = await one(db, 'SELECT receipt_base64 FROM bm_retail_sales WHERE id=?', key)
  insist(sale, 'receipt_not_found', 404)
  return { name: 'receipt-'+key+'.pdf', bytes: Uint8Array.from(atob(sale.receipt_base64), c=>c.charCodeAt(0)) }
}
export async function retailCommand(db: D1Database, who: Actor, name: string, input: Data) {
  owner(who)
  const client = await clientVisible(db, who, input.clientId)
  if (name === 'pay.retail.assign') {
    const sale = await one(db, "SELECT * FROM bm_retail_sales WHERE id=? AND client_id=? AND kind IN ('package','membership')", text(input.saleId,'sale',100), client.id)
    const visit = await one(db, "SELECT * FROM bm_appointments WHERE id=? AND client_id=? AND status='booked' AND coverage_choice IN ('self_pay','uninsured')", text(input.appointmentId,'visit',100), client.id)
    insist(sale && visit && visit.service_id===sale.service_id, 'cash_pay_package_and_service_must_match',409)
    await commit(db,who,[guard(db,"EXISTS(SELECT 1 FROM bm_appointments WHERE id=? AND status='booked' AND client_id=? AND service_id=? AND coverage_choice IN ('self_pay','uninsured'))",visit.id,client.id,sale.service_id),
      stmt(db,'INSERT INTO bm_package_assignments(appointment_id,sale_id,client_id,assigned_by,assigned_at) VALUES(?,?,?,?,?)',visit.id,sale.id,client.id,who.email,now()),audit(db,who,'retail.package_assigned',client.id,visit.id)])
    return {assigned:true}
  }
  insist(name==='pay.retail.sell','unknown_command',404)
  insist(input.confirm===true,'confirm_cash_received_or_gift_redemption')
  const kind=text(input.kind,'sale_kind',20)
  insist(['package','membership','product','gift_card'].includes(kind),'invalid_sale_kind')
  const amount=integer(input.amountCents,'amount',1,10_000_000),rate=integer(input.taxBasisPoints??0,'tax_rate',0,10000)
  insist(kind==='product'||rate===0,'only_product_sales_tax_is_supported')
  const state=kind==='product'?text(input.taxState,'tax_state',2):''
  insist(kind!=='product'||/^[A-Z]{2}$/.test(state),'enter_state_abbreviation')
  const evidence=kind==='product'?text(input.taxEvidence,'tax_basis',500):''
  const tax=Math.round(amount*rate/10000),units=['package','membership'].includes(kind)?integer(input.units,'visits',1,1000):0
  const service=units?await one(db,'SELECT id FROM bm_services WHERE id=?',text(input.serviceId,'service',100)):null
  insist(!units||service,'service_not_found',404)
  const key=id(),at=now(),label=text(input.label,'sale_label',120),reference=text(input.reference,'cash_reference',120)
  const gift=input.giftId?await one(db,"SELECT * FROM bm_retail_sales WHERE id=? AND client_id=? AND kind='gift_card'",text(input.giftId,'gift',100),client.id):null
  insist(!input.giftId||gift&&kind!=='gift_card','gift_must_belong_to_patient_and_cannot_buy_a_gift',409)
  const clinic=(await one(db,'SELECT clinic_name FROM bm_settings WHERE id=1'))!
  const bytes=pdf({header:clinic.clinic_name,title:'Cash sale receipt',blocks:[{kind:'facts',rows:[['Patient',client.first_name+' '+client.last_name],['Item',label],['Kind',kind],['Amount',dollars(amount)],['Sales tax',dollars(tax)],['Total',dollars(amount+tax)],['Payment',gift?'Patient gift value redeemed':'Cash received outside Balm'],['Reference',reference],['Date',at],...(units?[['Visits included',String(units)] as [string,string]]:[])]},{kind:'notes',lines:['No automatic renewal, expiry, transfer, refund or insurance billing. Product tax is the owner recorded rate; Balm does not determine tax law.']}]})
  const encoded=btoa(Array.from(bytes,b=>String.fromCharCode(b)).join(''))
  await commit(db,who,[...(gift?[guard(db,`(SELECT amount_cents FROM bm_retail_sales WHERE id=? AND client_id=? AND kind='gift_card')-COALESCE((SELECT SUM(amount_cents+tax_cents) FROM bm_retail_sales WHERE gift_id=?),0)>=?`,gift.id,client.id,gift.id,amount+tax)]:[]),
    stmt(db,'INSERT INTO bm_retail_sales(id,client_id,kind,label,service_id,units,amount_cents,tax_cents,tax_basis_points,tax_state,tax_evidence,gift_id,reference,recorded_at,recorded_by,receipt_base64) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',key,client.id,kind,label,service?.id??null,units,amount,tax,rate,state,evidence,gift?.id??null,reference,at,who.email,encoded),audit(db,who,'retail.sold',client.id,key,kind)])
  return {id:key,totalCents:amount+tax,receiptUrl:'/api/balm/receipts/'+key+'.pdf'}
}
export async function packageAttendance(db: D1Database, who: Actor, visit: Data) {
  const assigned=await one(db,'SELECT s.* FROM bm_package_assignments a JOIN bm_retail_sales s ON s.id=a.sale_id WHERE a.appointment_id=?',visit.id)
  if(!assigned)return {statements:[],covered:false}
  insist(['self_pay','uninsured'].includes(visit.coverage_choice)&&assigned.client_id===visit.client_id&&assigned.service_id===visit.service_id,'package_visit_changed_review_again',409)
  return {covered:true,statements:[guard(db,'(SELECT COUNT(*) FROM bm_package_uses WHERE sale_id=?)<(SELECT units FROM bm_retail_sales WHERE id=?)',assigned.id,assigned.id),
    guard(db,"NOT EXISTS(SELECT 1 FROM bm_invoices WHERE appointment_id=? AND status='approved')",visit.id),
    stmt(db,'INSERT INTO bm_package_uses(appointment_id,sale_id,client_id,used_at) VALUES(?,?,?,?)',visit.id,assigned.id,visit.client_id,now()),audit(db,who,'retail.visit_used',visit.client_id,visit.id)]}
}
