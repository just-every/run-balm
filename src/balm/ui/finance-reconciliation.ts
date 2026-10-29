import { check, empty, entry, field, form, h, hidden, money, panel, select, status, textarea } from './shared'

/** Recorded evidence review on the existing Reports surface. Every action is labelled. */
export function financeReconciliation(s: any) {
  const v = s.payoutReconciliation
  if (!v) return ''
  const path = '/app/reports?payoutMonth='+encodeURIComponent(v.month)
  const original = field('occurredOn','Original transaction date','','date','required')+textarea('evidence','Original evidence','','required maxlength="500"')
  const patient = select('clientId','Patient',s.clients.map((c:any)=>[c.id,c.first_name+' '+c.last_name]))
  const sources = `<details><summary>Record settlement or portion</summary><h3>Settlement observation</h3>`+form('finance.observation.record',path,
    patient+select('kind','Settlement kind',[['card','Card settlement'],['eft','EFT deposit']])+field('amount','Recorded amount (USD)','','number','required min="0.01" step="0.01"')
    +field('reference','Settlement reference','','text','required maxlength="120"')+field('sourceReference','Original charge or EFT trace','','text','required maxlength="120"')+original,'Record settlement')
    +'<h3>Allocated source original</h3>'+form('finance.source.record',path,patient+select('kind','Source kind',[['payout','Allocated payout portion'],['charge','Charge original'],['accounting','Accounting original']])
    +field('amount','Recorded net or original amount (USD)','','number','required min="0.01" step="0.01"')+field('fee','Recorded portion fee (USD)','0.00','number','required min="0" step="0.01"')
    +field('reference','Unique source reference','','text','required maxlength="120"')+field('sourceReference','Original charge reference','','text','required maxlength="120"')+original
    +check('confirm','I reviewed this allocated original; recording it moves no money.'),'Record source original')+'</details>'
  const record = '<details><summary>Record whole payout</summary>'+form('finance.payout.record',path,
    field('accountReference','Practice processor account','','text','required maxlength="120"')+field('payoutReference','Whole payout reference','','text','required maxlength="120"')
    +field('gross','Whole gross (USD)','','number','required min="0.01" step="0.01"')+field('fee','Whole fees (USD)','','number','required min="0" step="0.01"')
    +field('net','Whole net payout (USD)','','number','required min="0" step="0.01"')+original
    +check('confirm','I reviewed this whole payout original; this is a recorded comparison only.'),'Record whole payout')+'</details>'
  const payouts = v.payouts.map((p:any)=>entry(p.payout_reference,
    `<p>Account: ${h(p.account_reference)} · ${h(p.occurred_on)}. Gross ${money(p.gross_cents)} · fees ${money(p.fee_cents)} · net ${money(p.net_cents)}.</p><p>${h(p.evidence)}</p>`
    +'<details><summary>Link existing portion</summary>'+form('finance.payout.link',path,hidden('payoutId',p.id)+hidden('accountReference',p.account_reference)+hidden('payoutReference',p.payout_reference)
      +select('sourceId','Recorded payout portion',v.sources.map((x:any)=>[x.id,`${x.first_name} ${x.last_name} · ${x.reference} · net ${money(x.amount_cents)} · fees ${money(x.fee_cents)}`]))
      +select('observationId','Recorded card settlement',v.observations.map((x:any)=>[x.id,`${x.reference} · ${x.source_reference} · ${money(x.amount_cents)}`]))
      +check('confirm','I checked the patient, original charge and this account and payout association.'),'Link portion')+'</details>')).join('')
  const reviews = [...v.reviews].reverse().map((r:any)=>{
    const p=r.payload.payout,t=r.payload.totals
    return entry('Comparison · '+p.payout_reference, status(r.approved_at?'Preparation approved':'Preparation only')
      +`<p>Account: ${h(p.account_reference)}. Linked gross ${money(t.grossCents)} · fees ${money(t.feeCents)} · net ${money(t.netCents)}.</p>`
      +`<p>Unallocated gross ${money(t.unallocatedGrossCents)} · fees ${money(t.unallocatedFeeCents)} · net ${money(t.unallocatedNetCents)}.</p>`
      +`<p>Linked settlements ${money(t.settlementCents)} · charge originals ${money(t.chargeCents)} · accounting originals ${money(t.accountingCents)}.</p>`
      +'<ul>'+r.payload.explanations.map((x:string)=>`<li>${h(x)}</li>`).join('')+'</ul>'
      +'<details><summary>Cited originals and approval</summary><p>Whole payout: '+h(p.payout_reference)+' · '+h(p.evidence)+'</p><ul>'
      +r.payload.portions.map((x:any)=>`<li>Portion ${h(x.source.reference)} · ${h(x.source.evidence)}. Settlement ${h(x.settlement.reference)} · ${h(x.settlement.evidence)}.</li>`).join('')
      +r.payload.relatedOriginals.filter((x:any)=>x.kind!=='payout').map((x:any)=>`<li>${h(x.kind)}: ${h(x.reference)} · ${h(x.evidence)}</li>`).join('')+'</ul>'
      +`<p>Comparison digest: <code>${h(r.sha256)}</code></p>`
      +(r.approved_at?`<p>Preparation approved ${h(r.approved_at)}. This historical approval grants no execution authority.</p>`:form('finance.payout.approve',path,hidden('id',r.id)+hidden('sha256',r.sha256)+check('confirm','Approve only this exact preparation; no payment or request is authorized.'),'Approve preparation'))+'</details>')
  }).join('')
  return panel('Recorded payout comparisons','<p>Compare owner-recorded originals. This does not verify Stripe or a bank, correct allocations, change balances, send a request or execute a refund.</p>'
    +`<form method="get" action="/app/reports#finance-reconciliation">${field('payoutMonth','Payout month',v.month,'month','required')}<button type="submit">Show payout month</button></form>`
    +sources+record+(payouts||empty('No whole payout recorded for this month.'))
    +form('finance.reconcile.prepare',path,hidden('month',v.month),'Prepare cited comparisons')+(reviews||empty('No saved payout comparison.')),'full','finance-reconciliation')
}
