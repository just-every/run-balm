import { check, desk, empty, field, form, h, hidden, money, panel, select, stamp, status, textarea, usDate } from './shared'

export function statementCyclePanel(s: any) {
  if(!desk(s)||!s.payments?.cycles)return ''
  const {cycles}=s.payments.cycles,path='/app/invoices'
  return panel('Statement cycles', '<p>Run one cycle per calendar month for recorded patient preferences. Held accounts and accounts awaiting insurance are excluded. Email contains a portal notice; mail stays prepared until its mailing is recorded.</p>'
    + form('pay.cycle.run',path,field('cycleOn','Cycle month','', 'date','required')+check('confirm','Issue fixed statements and send the authorized email notices.'),'Run statement cycle')
    +(cycles.length?'<ul class="plain">'+cycles.map((c:any)=>`<li>${h(usDate(c.cycle_on,'UTC'))} · ${h(c.patients)} statements · ${money(c.total_cents)} · <a href="/api/balm/statement-batches/${h(c.id)}.pdf">Print mail batch</a> · <a href="/api/balm/statement-batches/${h(c.id)}.csv">Vendor file</a></li>`).join('')+'</ul>':empty('No statement cycles yet.'))
,'full','statement-cycles')
}

export function patientCyclePanel(s: any,f: any) {
  if(!desk(s)||!f.billing?.cycle)return ''
  const {preference:p,deliveries}=f.billing.cycle,path='/app/clients/'+f.client.id,client=hidden('clientId',f.client.id)
  const originals=(f.billing.statements??[]).map((x:any)=>`<li>${h(usDate(x.due_on,'UTC'))} · ${money(x.amount_cents)} · <a href="/api/balm/issued-statements/${h(x.id)}.pdf">Original statement</a></li>`).join('')
  const mailed=deliveries.filter((d:any)=>d.channel==='mail'&&d.outcome==='prepared')
  return panel('Statement delivery',`${p?.returned_at?'<p role="status">Returned mail: verify and correct the address before releasing the hold.</p>':''}${p?`<p>${status(p.hold?'On hold':p.channel)} · preference recorded ${stamp(s,p.recorded_at)}</p>`:empty('No recorded statement preference.')}
    <details><summary>Record statement preference</summary>${form('pay.cycle.preference',path,client+select('channel','Delivery preference',[['email','Email notice and portal'],['mail','Mail']],p?.channel??'email')+textarea('address','Mailing address',p?.address??'','maxlength="300" rows="3"')+check('hold','Hold statement cycles',p?.hold?'checked':'')+field('evidence','Where the patient’s preference is recorded','','text','required maxlength="1000"')+check('authorized','I have recorded the patient’s authorization for monthly statements by this delivery preference.'),'Save statement preference')}</details>
    ${originals?'<h3>Issued originals</h3><ul class="plain">'+originals+'</ul>':''}
    ${deliveries.length?'<h3>Delivery ledger</h3><ul class="plain">'+deliveries.map((d:any)=>`<li>${h(d.channel)} · ${status(d.outcome)} · ${h(usDate(d.occurred_at,s.settings.time_zone))} · ${money(d.amount_cents)}<br>Batch ${h(d.cycle_id)}</li>`).join('')+'</ul>':''}
    ${mailed.map((d:any)=>`<details><summary>Mail outcome for ${h(usDate(d.due_on,'UTC'))}</summary>${['mailed','returned'].map(outcome=>form('pay.cycle.'+outcome,path,client+hidden('statementId',d.statement_id)+field('occurredOn',outcome==='mailed'?'Date mailed':'Date returned','','date','required')+field('reference','Postal or clinic reference','','text','required maxlength="200"'),outcome==='mailed'?'Record completed mailing':'Record returned mail')).join('')}</details>`).join('')}`,'full','statement-delivery')
}

export function statementCycleSettings(s: any) {
 if(s.actor.role!=='owner'||!s.payments?.cycles)return ''
 return panel('Statement cycles',form('pay.cycle.settings','/app/clinic',field('minimumCents','Minimum statement balance (cents)',s.payments.cycles.settings.minimum_cents,'number','required min="0"'),'Save statement minimum'))
}
