import { desk, field, form, h, hidden, money, owner, panel, select, stamp, status } from './shared'

export function cardRefundsPanel(s: any, f: any) {
  if (!desk(s) || !f.billing?.cardRefunds) return ''
  const path = `/app/clients/${f.client.id}`, canApprove = owner(s) || s.actor.staffKind === 'biller'
  const entries = f.billing.cardRefunds.map((r: any) => `<article><h3>${money(r.amount_cents)} ${status(r.status)}</h3><p>${h(r.reason)}</p>
    <p class="help">Original Stripe payment ${h(r.payment_intent)} · practice account ${h(r.account_id)}<br>Prepared by ${h(r.prepared_by)} ${stamp(s,r.prepared_at)}${r.approved_at ? `<br>Approved by ${h(r.approved_by)} ${stamp(s,r.approved_at)}` : ''}</p>
    ${r.status === 'prepared' && canApprove ? form('pay.refund.approve',path,hidden('id',r.id)+hidden('sha256',r.sha256)+'<label class="check"><input type="checkbox" name="attest" required><span>I reviewed the actual original Stripe payment and current patient and practice account binding. I approve this exact amount and reason, returned only to the original payment method.</span></label>','Approve and refund') : ''}
    ${['attempted','uncertain'].includes(r.status) ? `<p>The processor outcome needs review. Balm will read the original attempt and will not send another refund.</p>${canApprove ? form('pay.refund.reconcile',path,hidden('id',r.id)+field('providerRefundId','Stripe refund ID (optional if located automatically)','','text','maxlength="150"'),'Read original Stripe outcome') : ''}` : ''}
    ${r.status === 'confirmed' ? `<p><a href="/api/balm/refund-receipts/${h(r.id)}.pdf">Download Stripe refund receipt</a></p>` : ''}</article>`).join('')
  const choices: [string,string][] = [['','Choose the original succeeded payment'],...(f.billing.payments ?? []).filter((p: any)=>p.status==='succeeded' && p.payment_intent && p.amount_cents>p.refunded_cents).map((p: any)=>[p.id,`${p.payment_intent} · ${money(p.amount_cents-p.refunded_cents)} refundable`])]
  return panel('Stripe refunds','<style>.stripe-refunds{overflow-wrap:anywhere}.stripe-refunds select{min-width:0;max-width:100%}.stripe-refunds button{white-space:normal;line-height:1.35;padding:10px 16px;max-width:100%}</style><p>Prepare a refund of an original succeeded Stripe payment. The owner or biller reviews the original processor facts and approves the exact action. Refunds return to the original payment method.</p>'+entries
    +form('pay.refund.prepare',path,hidden('clientId',f.client.id)+select('paymentId','Original Stripe payment',choices)+field('amount','Refund amount ($)','','text','required inputmode="decimal" maxlength="12"')+field('reason','Refund reason','','text','required maxlength="500"'),'Prepare refund for approval'),'stripe-refunds')
}

/** Patient portal and private link read fragment: caller supplies patient-scoped rows. */
export function patientCardRefunds(refunds: any[], receiptBase: string) {
  const entries = refunds.filter(r=>r.status==='confirmed').map(r=>`<li>${money(r.amount_cents)} refunded to the original payment method · <a href="${h(receiptBase)}/${h(r.id)}.pdf">Stripe refund receipt</a></li>`).join('')
  return entries ? panel('Card refunds',`<ul class="plain">${entries}</ul>`) : ''
}
