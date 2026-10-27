import { rows } from '../domain/model'

/** End-of-period obligations; cents are an allocation of recorded price, not a refund quote. */
export async function retailObligations(db:D1Database,end:string) {
 const sales=await rows(db,`SELECT id,kind,units,amount_cents,tax_cents,gift_id,recorded_at,renewal_of,NULL AS used_times,NULL AS membership_states,NULL AS cancelled_at,1 AS facts_complete FROM bm_retail_sales
  UNION ALL SELECT id,kind,units,amount_cents,tax_cents,gift_id,recorded_at,renewal_of,used_times,membership_states,cancelled_at,facts_complete FROM bm_destroyed_retail`)
 const uses=await rows(db,'SELECT sale_id,used_at FROM bm_package_uses')
 const events=await rows(db,'SELECT rowid AS sequence,sale_id,state,recorded_at FROM bm_membership_events ORDER BY rowid')
 const cancellations=await rows(db,'SELECT sale_id,recorded_at FROM bm_membership_cancellations')
 const before=(at:string)=>Date.parse(at)<Date.parse(end)
 const selected=sales.filter(s=>before(s.recorded_at))
 const summary=['package','membership'].flatMap(kind=>['active','paused','exhausted','cancelled'].map(state=>({kind,state,purchases:0,visitsSold:0,visitsUsed:0,visitsLeft:0,unearnedCents:0,renewals:0})))
 const incompleteHistory=selected.filter(s=>['package','membership'].includes(s.kind)&&!s.facts_complete).length
 for(const sale of selected.filter(s=>['package','membership'].includes(s.kind)&&s.facts_complete)) {
  const used=uses.filter(u=>u.sale_id===sale.id&&before(u.used_at)).length+JSON.parse(sale.used_times??'[]').filter(before).length
  const history=[...events.filter(e=>e.sale_id===sale.id),...JSON.parse(sale.membership_states??'[]')].filter(e=>before(e.recorded_at))
  const cancelled=cancellations.some(c=>c.sale_id===sale.id&&before(c.recorded_at))||(sale.cancelled_at&&before(sale.cancelled_at))
  const left=Math.max(0,Number(sale.units)-used)
  const state=cancelled?'cancelled':left===0?'exhausted':history.at(-1)?.state??'active'
  const row=summary.find(r=>r.kind===sale.kind&&r.state===state)!
  row.purchases++;row.visitsSold+=Number(sale.units);row.visitsUsed+=used;row.visitsLeft+=left
  row.unearnedCents+=Math.round(Number(sale.amount_cents)*left/Number(sale.units));row.renewals+=sale.renewal_of?1:0
 }
 const giftLiabilityCents=selected.filter(s=>s.kind==='gift_card').reduce((sum,s)=>sum+Number(s.amount_cents)-selected.filter(x=>x.gift_id===s.id).reduce((n,x)=>n+Number(x.amount_cents)+Number(x.tax_cents??0),0),0)
 return {rows:summary,incompleteHistory,giftLiabilityCents,unearnedCents:summary.reduce((n,r)=>n+r.unearnedCents,0),visitsLeft:summary.reduce((n,r)=>n+r.visitsLeft,0)}
}
