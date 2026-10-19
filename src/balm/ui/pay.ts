import { periodSuperbillForm } from './superbill-period'
// The patient's private page: what they owe across visits, paying it, saving a
// card for copays (after reading the clinic's authorization), and their receipts,
// statement and superbills as PDFs.
import { consentText } from '../payments/cards'
import { h, money, panel } from './shared'

const day = (iso: string, zone: string) => new Intl.DateTimeFormat('en-US', { timeZone: zone, month: 'short', day: 'numeric', year: 'numeric' }).format(new Date(iso))
const card = (brand: unknown, last4: unknown) => `${String(brand ?? 'card').replace(/^./, c => c.toUpperCase())} ending ${h(last4)}`

export function payPage(d: any) {
  const base = `/pay/${h(d.token)}`, zone = d.clinic.time_zone, l = d.ledger, due = Math.max(l.patientBalanceCents, 0)
  const notices = (d.justPaid ? `<div class="notice" role="status">${d.justPaid.status === 'succeeded' ? `<strong>Thank you.</strong> Your payment of ${money(d.justPaid.amount)} was received. Receipt ${h(d.justPaid.receipt)} is below.` : 'Your payment is being processed. This page shows it once Stripe confirms it.'}</div>` : '')
    + (d.justSaved === 'saved' && d.card ? `<div class="notice" role="status"><strong>Your card is saved.</strong> ${card(d.card.brand, d.card.last4)} is on file with ${h(d.clinic.clinic_name)}.</div>` : '')
  const pay = due <= 0 ? '<p>Nothing to pay right now.</p>' : d.block ? `<p>${h(d.block)}</p><p>Please pay at the clinic.</p>`
    : due > 0 ? `<form method="post" action="${base}?do=pay"><label>Amount to pay ($)<input name="amount" type="text" inputmode="decimal" required value="${(due / 100).toFixed(2)}" maxlength="12"></label><button type="submit">Pay by card</button></form><p class="help">You pay on Stripe’s secure page; ${h(d.clinic.clinic_name)} never sees your card number.</p>`
      : '<p>Nothing to pay right now.</p>'
  const cardForm = d.block ? '' : `<form method="post" action="${base}?do=card"><p class="help">${h(consentText(d.clinic.clinic_name))}</p><label class="check"><input type="checkbox" name="consent" value="on" required><span>I agree, and I want to save a card.</span></label><button type="submit"${d.purpose === 'card' ? '' : ' class="secondary"'}>${d.card ? 'Replace my card' : 'Save a card'}</button></form>`
  const cardPanel = panel('Card on file', (d.card ? `<p>${card(d.card.brand, d.card.last4)}, expires ${String(d.card.exp_month).padStart(2, '0')}/${h(d.card.exp_year)}.</p>` : (d.block ? '<p>No card on file.</p>' : '<p>No card on file. Saving one lets the clinic charge your copay when you check in, with a receipt each time.</p>')) + (d.card && cardForm ? `<details><summary>Replace my card</summary>${cardForm}</details>` : cardForm))
  const statement = panel('Statement', (l.lines.length ? `<div class="table"><table class="ledger"><thead><tr><th>Date</th><th>Description</th><th>Charges</th><th>Payments / adjustments</th><th>Balance</th></tr></thead><tbody>${l.lines.map((x: any) => `<tr><td>${h(day(x.at, zone))}</td><td>${h(x.description)}</td><td data-label="Charge">${x.chargeCents ? money(x.chargeCents) : ''}</td><td data-label="Payment / adjustment">${x.paymentCents ? money(x.paymentCents) : ''}</td><td data-label="Balance">${money(x.balanceCents)}</td></tr>`).join('')}</tbody></table></div>` : '<p class="empty">No charges yet.</p>')
    + `<p><a href="${base}/statement.pdf">Download this statement (PDF)</a></p>`, 'full')
  const external = (d.externalReceipts ?? []).map((r: any) => `<li>${h(r.kind === 'refund' ? 'Recorded external refund' : 'External payment')} · ${money(r.amount_cents)} · <a href="${base}/receipts/${h(r.id)}.pdf">Receipt ${h(r.receipt_number)}</a></li>`).join('')
  const issued = (d.issuedStatements ?? []).map((i: any) => `<li><a href="${base}/statements/${h(i.id)}.pdf">Statement ${h(day(i.due_on, 'UTC'))} · ${money(i.amount_cents)}</a></li>`).join('')
  const receipts = d.payments.filter((p: any) => p.status === 'succeeded')
  const papers = panel('Receipts and superbills', (external ? `<h3>External transaction receipts</h3><ul>${external}</ul>` : '') + (issued ? `<h3>Issued statements</h3><ul>${issued}</ul>` : '') + periodSuperbillForm(base + '/superbill.pdf') + (receipts.length ? `<ul class="plain">${receipts.map((p: any) => `<li>${h(day(p.succeeded_at, zone))} · ${money(p.amount_cents)} · ${card(p.card_brand, p.card_last4)} · <a href="${base}/receipts/${h(p.id)}.pdf">Receipt R-${String(p.receipt_number).padStart(6, '0')}</a></li>`).join('')}</ul>` : '<p class="empty">No card payments yet.</p>')
    + (d.superbills.length ? `<h3>Superbills for your insurer</h3><ul class="plain">${d.superbills.map((x: any) => `<li><a href="${base}/superbills/${h(x.invoiceId)}.pdf">Superbill for your visit on ${h(x.serviceDate.split(',').slice(1, 3).join(',').trim())}</a></li>`).join('')}</ul>` : ''))
  const summary = panel(l.patientBalanceCents < 0 ? `Credit ${money(-l.patientBalanceCents)}` : `Balance due ${money(due)}`, pay + (l.insurancePendingCents ? `<p>${money(l.insurancePendingCents)} is pending insurance. It is excluded from the amount you can pay.</p>` : ''))
  return `<h1>${h(d.client.first_name)} ${h(d.client.last_name)}</h1><p>Your account with ${h(d.clinic.clinic_name)}${d.clinic.address ? `, ${h(d.clinic.address)}` : ''}.</p>${notices}<div class="grid">${d.purpose === 'card' ? cardPanel + summary : summary + cardPanel}${statement}${papers}</div>`
}
