import { desk, field, form, h, hidden, money, owner, panel, select, stamp, status, usDate } from './shared'

/** Existing desk billing authority; approval is the owner's explicit second step. */
export function accountEntriesPanel(s: any, f: any) {
  if (!desk(s) || !f.billing?.account) return ''
  const { entries, credits } = f.billing.account, path = `/app/clients/${f.client.id}`
  const proposals = entries.map((e: any) => `<article><h3>${h(e.kind.replace('_', ' '))} · ${money(e.amount_cents)} ${status(e.posted_at ? 'Posted' : 'Needs approval')}</h3>
    <p>${h(e.reason)}<br>Reference ${h(e.reference)} · actual transaction date ${h(usDate(e.occurred_on, 'UTC'))}</p>
    <p class="help">Prepared by ${h(e.prepared_by)} ${stamp(s, e.prepared_at)}${e.posted_at ? `<br>Approved by ${h(e.approved_by)} ${stamp(s, e.posted_at)}` : ''}</p>
    ${e.posted_at && ['credit','refund'].includes(e.kind) ? `<p><a href="/api/balm/receipts/${h(e.id)}.pdf">${e.kind === 'refund' ? 'Recorded external refund' : 'External payment'} receipt</a></p>` : ''}
    ${!e.posted_at && owner(s) ? form('pay.entry.approve', path, hidden('id', e.id) + hidden('sha256', e.sha256)
      + '<label class="check"><input name="attest" type="checkbox" required><span>I approve this exact amount, reason, reference and transaction date. For external money, I confirm the receipt or refund has actually happened outside Balm.</span></label>', 'Approve this entry') : ''}</article>`).join('')
  const invoices: [string, string][] = [['', 'Choose for an adjustment or write-off'], ...(f.invoices ?? []).filter((i: any) => i.status === 'approved').map((i: any) => [i.id, `INV-${String(i.number).padStart(6,'0')} · ${money(i.amount_cents - i.paid_cents - i.adjusted_cents)} outstanding`])]
  const originalCredits: [string, string][] = [['', 'Choose for an external refund'], ...credits.map((c: any) => [c.id, `${c.reference} · ${money(c.remaining_cents)} unused`])]
  const fields = hidden('clientId', f.client.id)
    + select('kind', 'Entry type', [['adjustment','Invoice adjustment'],['write_off','Invoice write-off'],['credit','Money received outside Balm (credit)'],['refund','Record a completed external refund']])
    + select('invoiceId', 'Invoice (adjustments and write-offs)', invoices, '', '')
    + select('creditId', 'Original unused external credit (refunds)', originalCredits, '', '')
    + field('amount', 'Amount ($)', '', 'text', 'required inputmode="decimal" maxlength="12"')
    + field('reason', 'Reason', '', 'text', 'required maxlength="500"')
    + field('reference', 'Unique transaction or adjustment reference', '', 'text', 'required maxlength="120"')
    + field('occurredOn', 'Actual transaction date', '', 'date', 'required')
  const originals = (f.billing.statements ?? []).map((i: any) => `<li><a href="/api/balm/issued-statements/${h(i.id)}.pdf">Statement ${h(usDate(i.due_on, 'UTC'))} · ${money(i.amount_cents)}</a></li>`).join('')
  return panel('Adjustments and external transactions', '<p>Prepare an entry for the owner to review. Posted entries preserve every original charge and payment. An external credit records money already received; an external refund records unused money already returned. Balm sends no money and makes no Stripe refund here.</p>'
    + (proposals || '<p class="empty">No manual entries.</p>') + `<details><summary>Prepare an adjustment, credit or refund</summary>${form('pay.entry.prepare', path, fields, 'Prepare for approval')}</details>`)
    + (originals ? panel('Issued statements', `<p>Each issued statement keeps its original amount and PDF after later transactions.</p><ul class="plain">${originals}</ul>`) : '')
}
