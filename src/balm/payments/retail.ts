import { audit, commit, guard, human, id, insist, integer, now, one, rows, sha256, stmt, text, type Actor, type Data } from '../domain/model'
import { clientVisible } from '../domain/clients'
import { dollars } from '../domain/invoices'
import { pdf } from './pdf'

function authorization(input: Data) {
  insist(!input.authorizerKind || input.authorizerKind==='patient', 'representative_authority_not_established', 403)
  const instant = (name: string) => {
    const value = text(input[name], name, 30)
    insist(/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{3})?Z$/.test(value) && Number.isFinite(Date.parse(value)), 'invalid_'+name)
    const normalized=new Date(value).toISOString()
    insist(normalized===value || normalized===value.replace('Z','.000Z'),'invalid_'+name)
    return normalized
  }
  const effectiveAt=instant('effectiveAt'), authorizedAt=instant('authorizedAt')
  insist(authorizedAt<=effectiveAt && Date.parse(effectiveAt)<=Date.now(),'authorization_must_precede_effective_change')
  insist(input.confirm===true||input.confirm==='on','confirm_patient_authorized_membership_change')
  return {effectiveAt,authorizedAt,method:text(input.authorizationMethod,'authorization_method',200),evidence:text(input.consentEvidence,'patient_authorization_evidence',500)}
}
const owner = (who: Actor) => { human(who); insist(who.role === 'owner', 'only_the_owner_records_retail', 403) }
export async function retailFor(db: D1Database, clientId: string) {
  return rows(db, `SELECT s.id,s.kind,s.label,s.service_id,s.units,s.amount_cents,s.tax_cents,s.gift_id,s.recorded_at,s.renewal_of,
    CASE WHEN EXISTS(SELECT 1 FROM bm_membership_cancellations c WHERE c.sale_id=s.id) THEN 'cancelled' ELSE COALESCE((SELECT e.state FROM bm_membership_events e WHERE e.sale_id=s.id AND NOT EXISTS(SELECT 1 FROM bm_membership_events n WHERE n.sale_id=e.sale_id AND n.previous_id=e.id)),'active') END AS membership_state,
    s.units-(SELECT COUNT(*) FROM bm_package_uses u WHERE u.sale_id=s.id)-COALESCE((SELECT units FROM bm_membership_settlements z WHERE z.sale_id=s.id),0) AS visits_left,
    COALESCE((SELECT amount_cents FROM bm_membership_settlements z WHERE z.sale_id=s.id),0) AS settled_cents,
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
  if(name==='pay.retail.membership'||name==='pay.retail.cancel'||name==='pay.retail.settle') {
    const sale=await one(db,"SELECT id,recorded_at,units,amount_cents,gift_id FROM bm_retail_sales WHERE id=? AND client_id=? AND kind='membership'",text(input.saleId,'membership',100),client.id)
    insist(sale,'membership_not_found',404)
    const auth=authorization(input)
    const latest=await one(db,"SELECT MAX(at) AS at FROM (SELECT COALESCE(effective_at,recorded_at) AS at FROM bm_membership_events WHERE sale_id=? UNION ALL SELECT used_at FROM bm_package_uses WHERE sale_id=?)",sale.id,sale.id)
    insist(auth.effectiveAt>=(latest?.at??sale.recorded_at),'membership_effective_time_precedes_latest_event',409)
    const left=(await one(db,'SELECT units-(SELECT COUNT(*) FROM bm_package_uses WHERE sale_id=s.id) AS n FROM bm_retail_sales s WHERE id=?',sale.id))!.n
    const notCancelled=()=>guard(db,'NOT EXISTS(SELECT 1 FROM bm_membership_cancellations WHERE sale_id=?)',sale.id)
    if(name==='pay.retail.cancel'||name==='pay.retail.settle') {
      const settling=name==='pay.retail.settle'
      if(settling) {
        insist(left>0,'membership_has_no_unused_visits',409)
        insist(!sale.gift_id,'gift_funded_settlement_requires_review',409)
        insist(!input.authorizerKind||input.authorizerKind==='patient','representative_authority_not_established',403)
        insist(input.cashReturned===true||input.cashReturned==='on','confirm_cash_refund_already_completed')
        const amount=integer(input.settlementAmountCents,'settlement_amount',1)
        insist(amount===Math.round(Number(sale.amount_cents)*left / Number(sale.units)),'refund_must_match_unused_purchase_value',409)
        const reference=text(input.settlementReference,'settlement_reference',120),evidence=text(input.settlementEvidence,'settlement_evidence',500)
        await commit(db,who,[guard(db,"NOT EXISTS(SELECT 1 FROM bm_retired_retail_references WHERE kind='settlement' AND digest=?)",await sha256(reference)),notCancelled(),guard(db,'NOT EXISTS(SELECT 1 FROM bm_membership_settlements WHERE sale_id=?)',sale.id),
          guard(db,'(SELECT units-(SELECT COUNT(*) FROM bm_package_uses WHERE sale_id=s.id) FROM bm_retail_sales s WHERE id=?)=?',sale.id,left),
          guard(db,"NOT EXISTS(SELECT 1 FROM bm_package_assignments x JOIN bm_appointments a ON a.id=x.appointment_id WHERE x.sale_id=? AND a.status='booked')",sale.id),
          stmt(db,'INSERT INTO bm_membership_settlements(sale_id,client_id,units,amount_cents,reference,evidence,recorded_at,recorded_by) VALUES(?,?,?,?,?,?,?,?)',sale.id,client.id,left,amount,reference,evidence,now(),who.email),
          stmt(db,'INSERT INTO bm_membership_cancellations(sale_id,client_id,effective_at,authorized_at,authorization_method,consent_evidence,reason,recorded_by,recorded_at,visits_left) VALUES(?,?,?,?,?,?,?,?,?,0)',sale.id,client.id,auth.effectiveAt,auth.authorizedAt,auth.method,auth.evidence,text(input.reason,'reason',500),who.email,now()),audit(db,who,'retail.unused_visits_settled',client.id,sale.id)])
        return {state:'cancelled',visitsLeft:0,settledVisits:left,refundedCents:amount,providerRefund:false}
      }
      insist(left===0,'resolve_unused_visits_before_cancellation',409)
      await commit(db,who,[notCancelled(),guard(db,'(SELECT units FROM bm_retail_sales WHERE id=?)=(SELECT COUNT(*) FROM bm_package_uses WHERE sale_id=?)',sale.id,sale.id),
        stmt(db,'INSERT INTO bm_membership_cancellations(sale_id,client_id,effective_at,authorized_at,authorization_method,consent_evidence,reason,recorded_by,recorded_at,visits_left) VALUES(?,?,?,?,?,?,?,?,?,0)',sale.id,client.id,auth.effectiveAt,auth.authorizedAt,auth.method,auth.evidence,text(input.reason,'reason',500),who.email,now()),audit(db,who,'retail.membership_cancelled',client.id,sale.id)])
      return {state:'cancelled',visitsLeft:0,providerCharge:false,externalBillingChanged:false}
    }
    const current=await one(db,'SELECT e.id,e.state FROM bm_membership_events e WHERE e.sale_id=? AND NOT EXISTS(SELECT 1 FROM bm_membership_events n WHERE n.sale_id=e.sale_id AND n.previous_id=e.id)',sale.id)
    const state=text(input.state,'membership_state',10)
    insist(['active','paused'].includes(state),'invalid_membership_state')
    insist(state!==(current?.state??'active'),'membership_state_unchanged',409)
    const key=id()
    await commit(db,who,[notCancelled(),guard(db,"COALESCE((SELECT e.id FROM bm_membership_events e WHERE e.sale_id=? AND NOT EXISTS(SELECT 1 FROM bm_membership_events n WHERE n.sale_id=e.sale_id AND n.previous_id=e.id)),'')=?",sale.id,current?.id??''),
      guard(db,'(SELECT units-(SELECT COUNT(*) FROM bm_package_uses WHERE sale_id=s.id) FROM bm_retail_sales s WHERE id=?)=?',sale.id,left),stmt(db,'INSERT INTO bm_membership_events(id,sale_id,client_id,state,previous_id,reason,consent_evidence,recorded_by,recorded_at,effective_at,authorized_at,authorization_method,visits_left) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)',key,sale.id,client.id,state,current?.id??null,text(input.reason,'reason',500),auth.evidence,who.email,now(),auth.effectiveAt,auth.authorizedAt,auth.method,left),audit(db,who,'retail.membership_'+state,client.id,sale.id)])
    return {id:key,state,providerCharge:false}
  }
  if (name === 'pay.retail.assign') {
    const sale = await one(db, "SELECT * FROM bm_retail_sales WHERE id=? AND client_id=? AND kind IN ('package','membership')", text(input.saleId,'sale',100), client.id)
    const visit = await one(db, "SELECT * FROM bm_appointments WHERE id=? AND client_id=? AND status='booked' AND coverage_choice IN ('self_pay','uninsured')", text(input.appointmentId,'visit',100), client.id)
    insist(sale && visit && visit.service_id===sale.service_id, 'cash_pay_package_and_service_must_match',409)
    await commit(db,who,[guard(db,'NOT EXISTS(SELECT 1 FROM bm_membership_cancellations WHERE sale_id=?)',sale.id),guard(db,"(SELECT units FROM bm_retail_sales WHERE id=?)>(SELECT COUNT(*) FROM bm_package_uses WHERE sale_id=?)+(SELECT COUNT(*) FROM bm_package_assignments x JOIN bm_appointments a ON a.id=x.appointment_id WHERE x.sale_id=? AND a.status='booked')",sale.id,sale.id,sale.id),guard(db,"COALESCE((SELECT e.state FROM bm_membership_events e WHERE e.sale_id=? AND NOT EXISTS(SELECT 1 FROM bm_membership_events n WHERE n.sale_id=e.sale_id AND n.previous_id=e.id)),'active')='active'",sale.id),guard(db,"EXISTS(SELECT 1 FROM bm_appointments WHERE id=? AND status='booked' AND client_id=? AND service_id=? AND coverage_choice IN ('self_pay','uninsured'))",visit.id,client.id,sale.service_id),
      stmt(db,'INSERT INTO bm_package_assignments(appointment_id,sale_id,client_id,assigned_by,assigned_at) VALUES(?,?,?,?,?)',visit.id,sale.id,client.id,who.email,now()),audit(db,who,'retail.package_assigned',client.id,visit.id)])
    return {assigned:true}
  }
  insist(name==='pay.retail.sell'||name==='pay.retail.renew','unknown_command',404)
  const renewal=name==='pay.retail.renew'?await one(db,"SELECT * FROM bm_retail_sales WHERE id=? AND client_id=? AND kind='membership'",text(input.saleId,'membership',100),client.id):null
  insist(name!=='pay.retail.renew'||renewal,'membership_not_found',404)
  const renewalAuthorization=renewal?authorization(input):null
  if(renewal) {
    insist(input.cashConfirm===true||input.cashConfirm==='on','confirm_new_renewal_cash_received')
    insist(!input.authorizerKind||input.authorizerKind==='patient','representative_authority_not_established',403)
    insist(input.kind==='membership'&&input.serviceId===renewal.service_id&&!input.giftId,'renewal_requires_separate_cash_membership_for_same_service',409)
    const latest=await one(db,'SELECT MAX(at) AS at FROM (SELECT recorded_at AS at FROM bm_retail_sales WHERE id=? UNION ALL SELECT used_at FROM bm_package_uses WHERE sale_id=? UNION ALL SELECT recorded_at FROM bm_membership_events WHERE sale_id=?)',renewal.id,renewal.id,renewal.id)
    insist(renewalAuthorization!.effectiveAt>=latest!.at,'membership_effective_time_precedes_latest_event',409)
  }
  insist((input.confirm===true||input.confirm==='on'),'confirm_cash_received_or_gift_redemption')
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
  const bytes=pdf({header:clinic.clinic_name,title:'Cash sale receipt',blocks:[{kind:'facts',rows:[['Patient',client.first_name+' '+client.last_name],['Item',label],['Kind',kind],['Amount',dollars(amount)],['Sales tax',dollars(tax)],['Total',dollars(amount+tax)],['Payment',gift?'Patient gift value redeemed':'Cash received outside Balm'],['Reference',reference],['Date',at],...(renewal?[['Renewal of receipt',renewal.id] as [string,string],['Patient authorization',renewalAuthorization!.authorizedAt] as [string,string]]:[]),...(units?[['Visits included',String(units)] as [string,string]]:[])]},{kind:'notes',lines:['No automatic renewal, expiry, transfer, refund or insurance billing. Product tax is the owner recorded rate; Balm does not determine tax law.']}]})
  const encoded=btoa(Array.from(bytes,b=>String.fromCharCode(b)).join(''))
  await commit(db,who,[guard(db,"NOT EXISTS(SELECT 1 FROM bm_retired_retail_references WHERE kind='sale' AND digest=?)",await sha256(reference)),...(renewal?[
    guard(db,"EXISTS(SELECT 1 FROM bm_retail_sales s WHERE s.id=? AND s.client_id=? AND s.kind='membership' AND s.service_id=? AND s.units=(SELECT COUNT(*) FROM bm_package_uses u WHERE u.sale_id=s.id)) AND NOT EXISTS(SELECT 1 FROM bm_retail_sales WHERE renewal_of=?) AND NOT EXISTS(SELECT 1 FROM bm_membership_cancellations WHERE sale_id=?)",renewal.id,client.id,service!.id,renewal.id,renewal.id)
  ]:[]),...(gift?[guard(db,`(SELECT amount_cents FROM bm_retail_sales WHERE id=? AND client_id=? AND kind='gift_card')-COALESCE((SELECT SUM(amount_cents+tax_cents) FROM bm_retail_sales WHERE gift_id=?),0)>=?`,gift.id,client.id,gift.id,amount+tax)]:[]),
    stmt(db,'INSERT INTO bm_retail_sales(id,client_id,kind,label,service_id,units,amount_cents,tax_cents,tax_basis_points,tax_state,tax_evidence,gift_id,reference,recorded_at,recorded_by,receipt_base64,renewal_of,renewal_authorization) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',key,client.id,kind,label,service?.id??null,units,amount,tax,rate,state,evidence,gift?.id??null,reference,at,who.email,encoded,renewal?.id??null,renewalAuthorization?JSON.stringify({...renewalAuthorization,reason:text(input.reason,'reason',500)}):null),audit(db,who,renewal?'retail.renewed':'retail.sold',client.id,key,kind)])
  return {id:key,totalCents:amount+tax,receiptUrl:'/api/balm/receipts/'+key+'.pdf'}
}
export async function packageAttendance(db: D1Database, who: Actor, visit: Data) {
  const assigned=await one(db,'SELECT s.* FROM bm_package_assignments a JOIN bm_retail_sales s ON s.id=a.sale_id WHERE a.appointment_id=?',visit.id)
  if(!assigned)return {statements:[],covered:false}
  insist(['self_pay','uninsured'].includes(visit.coverage_choice)&&assigned.client_id===visit.client_id&&assigned.service_id===visit.service_id,'package_visit_changed_review_again',409)
  return {covered:true,statements:[guard(db,'NOT EXISTS(SELECT 1 FROM bm_membership_cancellations WHERE sale_id=?)',assigned.id),guard(db,"COALESCE((SELECT e.state FROM bm_membership_events e WHERE e.sale_id=? AND NOT EXISTS(SELECT 1 FROM bm_membership_events n WHERE n.sale_id=e.sale_id AND n.previous_id=e.id)),'active')='active'",assigned.id),guard(db,'(SELECT COUNT(*) FROM bm_package_uses WHERE sale_id=?)<(SELECT units FROM bm_retail_sales WHERE id=?)',assigned.id,assigned.id),
    guard(db,"NOT EXISTS(SELECT 1 FROM bm_invoices WHERE appointment_id=? AND status='approved')",visit.id),
    stmt(db,'INSERT INTO bm_package_uses(appointment_id,sale_id,client_id,used_at) VALUES(?,?,?,?)',visit.id,assigned.id,visit.client_id,now()),audit(db,who,'retail.visit_used',visit.client_id,visit.id)]}
}

/** Patient notices contain immutable transition facts, never staff consent evidence. */
export async function retailNotices(db:D1Database,clientId:string) {
  const sales=await retailFor(db,clientId)
  const events=await rows(db,`SELECT sale_id,state,COALESCE(effective_at,recorded_at) AS effective_at,visits_left FROM bm_membership_events WHERE client_id=?
    UNION ALL SELECT sale_id,'cancelled',effective_at,visits_left FROM bm_membership_cancellations WHERE client_id=? ORDER BY effective_at`,clientId,clientId)
  return sales.filter(s=>['package','membership','gift_card'].includes(s.kind)).map(s=>({id:s.id,label:s.label,kind:s.kind,units:s.units,visitsLeft:s.visits_left,giftLeftCents:s.gift_left_cents,settledCents:s.settled_cents,state:s.membership_state,renewalOf:s.renewal_of,
    history:[{state:s.renewal_of?'renewed purchase':'purchased',effective_at:s.recorded_at,visits_left:s.units},...events.filter(e=>e.sale_id===s.id).map(({state,effective_at,visits_left})=>({state,effective_at,visits_left}))]}))
}
