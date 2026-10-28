import { check, empty, field, form, h, hidden, money, panel, select, services, usDate, zoneOf } from './shared'

/** Owner cash recording uses the same commands as the patient ledger. */
export function retailPanel(s:any,f:any) {
 if(!f.billing?.retailSalesAllowed)return ''
 const path='/app/clients/'+f.client.id,client=hidden('clientId',f.client.id),sales=f.billing.retail??[]
 const common=()=>client+field('label','Item description','','text','required maxlength="120"')
   +field('amountCents','Price before tax (USD cents)','','number','required min="1" max="10000000"')
   +field('reference','Unique cash receipt or redemption reference','','text','required maxlength="120"')
 const gift=()=>select('giftId','Payment source',[['','Cash already received'],...sales.filter((x:any)=>x.kind==='gift_card'&&x.gift_left_cents>0).map((x:any)=>[x.id,x.label+' · '+money(x.gift_left_cents)+' left'])],'','')
 const confirm=check('confirm','I confirm cash already received or the selected patient gift redemption.')
 const taxRule=f.billing.retailTaxRules?.[0]
 const forms=['package','membership','product','gift_card'].filter(kind=>kind!=='product'||s.actor.role==='owner'||taxRule).map(kind=>{
  const label=kind==='gift_card'?'Gift value':kind==='product'?'Product':kind==='package'?'Visit package':'Finite membership'
  const fields=common()+hidden('kind',kind)
    +(['package','membership'].includes(kind)?select('serviceId','Cash-pay service',services(s).map((x:any)=>[x.id,x.name]))+field('units','Included visits','','number','required min="1" max="1000"'):'')
    +(kind==='product'?field('taxState','Tax state (two-letter code)',taxRule?.state??'','text','required pattern="[A-Z]{2}" maxlength="2"'+(taxRule?' readonly':''))+field('taxBasisPoints','Owner-verified sales tax (basis points)',taxRule?.rate??'','number','required min="0" max="10000"'+(taxRule?' readonly':''))+field('taxEvidence','Source supporting this tax rate',taxRule?.evidence??'','text','required maxlength="500"'+(taxRule?' readonly':'')):'')
    +(kind!=='gift_card'?gift():'')+confirm
  return `<details><summary>Record ${label.toLowerCase()}</summary>${form('pay.retail.sell',path,fields,'Record '+label.toLowerCase())}</details>`
 }).join('')
 const authorizationFields=()=>field('reason','Reason for this change','','text','required maxlength="500"')
  +field('effectiveAt','Effective time (UTC, ISO format)',new Date().toISOString(),'text','required')
  +field('authorizedAt','Patient authorization time (UTC, ISO format)','','text','required')
  +field('authorizationMethod','How patient authorization was obtained','','text','required maxlength="200"')
  +field('consentEvidence','Specific transition authorized by the patient','','text','required maxlength="500"')
  +check('confirm','I attest to specific patient authorization for this transition, separate from intake, treatment or card consent. External billing is unchanged.')
 const list=sales.map((sale:any)=>{
  const remaining=['package','membership'].includes(sale.kind)?`${sale.visits_left} of ${sale.units} visits left`:sale.kind==='gift_card'?money(sale.gift_left_cents)+' gift value left':''
  const visits=f.appointments.filter((v:any)=>!v.package_assigned&&v.status==='booked'&&v.service_id===sale.service_id&&['self_pay','uninsured'].includes(v.coverage_choice))
  const assign=remaining&&sale.visits_left>0&&visits.length?form('pay.retail.assign',path,client+hidden('saleId',sale.id)+select('appointmentId','Matching cash-pay visit',visits.map((v:any)=>[v.id,usDate(v.start_at,zoneOf(s))])),'Assign visit',true):''
  const membership=s.actor.role==='owner'&&sale.kind==='membership'&&sale.membership_state!=='cancelled'&&sale.visits_left>0?'<details><summary>Change membership status</summary>'+form('pay.retail.membership',path,client+hidden('saleId',sale.id)+hidden('state',sale.membership_state==='paused'?'active':'paused')+authorizationFields(),sale.membership_state==='paused'?'Resume membership':'Pause membership',true)+'</details>':''
  const settle=s.actor.role==='owner'&&sale.kind==='membership'&&sale.membership_state!=='cancelled'&&sale.visits_left>0?'<details><summary>'+(sale.gift_id?'Restore unused gift value':'Record unused-visit settlement')+'</summary>'+form(sale.gift_id?'pay.retail.gift_settle':'pay.retail.settle',path,client+hidden('saleId',sale.id)+authorizationFields()+field('settlementAmountCents',sale.gift_id?'Value returned to original gift (USD cents)':'Cash already refunded (USD cents)',Math.round(sale.amount_cents*sale.visits_left / sale.units),'number','required min="1"')+field('settlementReference',sale.gift_id?'Unique gift restoration reference':'Completed external cash refund reference','','text','required maxlength="120"')+field('settlementEvidence',sale.gift_id?'Evidence supporting this authorized gift restoration':'Evidence of completed cash refund','','text','required maxlength="500"')+check(sale.gift_id?'restoreGift':'cashReturned',sale.gift_id?'I approve returning this exact unused value to the original patient gift; no cash or provider refund.':'I confirm this exact cash refund has already been completed outside Balm.'),sale.gift_id?'Restore original gift value':'Record settlement',true)+'</details>':''
  const cancel=s.actor.role==='owner'&&sale.kind==='membership'&&sale.membership_state!=='cancelled'&&sale.visits_left===0?'<details><summary>Cancel exhausted membership</summary>'+form('pay.retail.cancel',path,client+hidden('saleId',sale.id)+authorizationFields(),'Record cancellation',true)+'</details>':''
  const renew=s.actor.role==='owner'&&sale.kind==='membership'&&sale.membership_state!=='cancelled'&&sale.visits_left===0&&!sales.some((x:any)=>x.renewal_of===sale.id)?'<details><summary>Record authorized renewal</summary>'+form('pay.retail.renew',path,common()+hidden('saleId',sale.id)+hidden('kind','membership')+hidden('serviceId',sale.service_id)+field('units','New included visits','','number','required min="1" max="1000"')+authorizationFields()+check('cashConfirm','Cash for this new purchase has already been received.'),'Record renewal',true)+'</details>':''
  return `<li>${h(sale.label)} · ${h(remaining)}${sale.kind==='membership'?' · '+h(sale.membership_state):''} · <a href="/api/balm/receipts/${h(sale.id)}.pdf">Original receipt</a>${assign}${membership}${settle}${cancel}${renew}</li>`
 }).join('')
 return panel('Cash sales and visit packages',`<p>Record cash already received. Finite memberships and packages cover only the named service. No automatic renewal, expiry, transfer, refund or provider charge. Record a later cash purchase separately; pausing preserves unused visits. Product tax uses your verified rate.</p>${list?'<ul class="plain">'+list+'</ul>':empty('No cash sales recorded.')}${forms}`,'','retail')
}
