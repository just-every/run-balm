import { check, empty, field, form, h, hidden, money, panel, select, services, usDate, zoneOf } from './shared'

/** Owner cash recording uses the same commands as the patient ledger. */
export function retailPanel(s:any,f:any) {
 if(s.actor.role!=='owner'||!f.billing)return ''
 const path='/app/clients/'+f.client.id,client=hidden('clientId',f.client.id),sales=f.billing.retail??[]
 const common=()=>client+field('label','Item description','','text','required maxlength="120"')
   +field('amountCents','Price before tax (USD cents)','','number','required min="1" max="10000000"')
   +field('reference','Unique cash receipt or redemption reference','','text','required maxlength="120"')
 const gift=()=>select('giftId','Payment source',[['','Cash already received'],...sales.filter((x:any)=>x.kind==='gift_card'&&x.gift_left_cents>0).map((x:any)=>[x.id,x.label+' · '+money(x.gift_left_cents)+' left'])],'','')
 const confirm=check('confirm','I confirm cash already received or the selected patient gift redemption.')
 const forms=['package','membership','product','gift_card'].map(kind=>{
  const label=kind==='gift_card'?'Gift value':kind==='product'?'Product':kind==='package'?'Visit package':'Finite membership'
  const fields=common()+hidden('kind',kind)
    +(['package','membership'].includes(kind)?select('serviceId','Cash-pay service',services(s).map((x:any)=>[x.id,x.name]))+field('units','Included visits','','number','required min="1" max="1000"'):'')
    +(kind==='product'?field('taxState','Tax state (two-letter code)','','text','required pattern="[A-Z]{2}" maxlength="2"')+field('taxBasisPoints','Owner-verified sales tax (basis points)','','number','required min="0" max="10000"')+field('taxEvidence','Source supporting this tax rate','','text','required maxlength="500"'):'')
    +(kind!=='gift_card'?gift():'')+confirm
  return `<details><summary>Record ${label.toLowerCase()}</summary>${form('pay.retail.sell',path,fields,'Record '+label.toLowerCase())}</details>`
 }).join('')
 const list=sales.map((sale:any)=>{
  const remaining=['package','membership'].includes(sale.kind)?`${sale.visits_left} of ${sale.units} visits left`:sale.kind==='gift_card'?money(sale.gift_left_cents)+' gift value left':''
  const visits=f.appointments.filter((v:any)=>!v.package_assigned&&v.status==='booked'&&v.service_id===sale.service_id&&['self_pay','uninsured'].includes(v.coverage_choice))
  const assign=remaining&&sale.visits_left>0&&visits.length?form('pay.retail.assign',path,client+hidden('saleId',sale.id)+select('appointmentId','Matching cash-pay visit',visits.map((v:any)=>[v.id,usDate(v.start_at,zoneOf(s))])),'Assign visit',true):''
  const membership=sale.kind==='membership'&&sale.visits_left>0?'<details><summary>Change membership status</summary>'+form('pay.retail.membership',path,client+hidden('saleId',sale.id)+hidden('state',sale.membership_state==='paused'?'active':'paused')+field('reason','Reason for this change','','text','required maxlength="500"')+field('consentEvidence','Patient authorization evidence','','text','required maxlength="500"')+check('confirm','The patient authorized this change; unused visits are preserved.'),sale.membership_state==='paused'?'Resume membership':'Pause membership',true)+'</details>':''
  return `<li>${h(sale.label)} · ${h(remaining)} · <a href="/api/balm/receipts/${h(sale.id)}.pdf">Original receipt</a>${assign}${membership}</li>`
 }).join('')
 return panel('Cash sales and visit packages',`<p>Record cash already received. Finite memberships and packages cover only the named service. No automatic renewal, expiry, transfer, refund or provider charge. Record a later cash purchase separately; pausing preserves unused visits. Product tax uses your verified rate.</p>${list?'<ul class="plain">'+list+'</ul>':empty('No cash sales recorded.')}${forms}`,'','retail')
}
