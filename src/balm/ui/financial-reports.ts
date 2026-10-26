// The owner's financial reports under the same dates as the operational ones,
// clinic-wide, each with a CSV download.
import { empty, h, money, panel } from './shared'

const buckets = [['0-30', '0–30 days'], ['31-60', '31–60'], ['61-90', '61–90'], ['91-120', '91–120'], ['over-120', 'Over 120']] as const
const table = (heads: string[], body: string[][], recordRows = false) => `<div class="table"><table${recordRows ? ' class="ledger"' : ''}><thead><tr>${heads.map(x => `<th scope="col">${h(x)}</th>`).join('')}</tr></thead><tbody>${body.map((r, i) => `<tr${i === body.length - 1 ? ' class="total"' : ''}>${r.map((c, j) => `<td${recordRows ? ` data-label="${h(heads[j])}"` : ''}>${c}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`
const cents = (value: unknown) => value === null || value === undefined ? '—' : h(money(value))

export function financialSections(s: any) {
  const f = s.financial
  if (!f) return ''
  const link = (kind: string, label: string) => `<p><a class="button secondary" href="${h(`/api/balm/reports/financial/${kind}.csv?` + new URLSearchParams({ from: f.from, to: f.to }).toString())}" download>Download ${h(label)} CSV</a></p>`
  const m = f.summary
  const summary = table(['Measure', 'Value'], [
    ['Charges (by date of service)', `${cents(m.chargesCents)} · ${h(m.charges)} charges`], ['Payments posted', cents(m.paymentsCents)], ['· Insurance (ERA and paper EOB)', cents(m.insurancePaymentsCents)],
    ['· Card', cents(m.cardPaymentsCents)], ['· Desk', cents(m.deskPaymentsCents)], ['Adjustments', cents(m.adjustmentsCents)],
    ['Collections per attended visit', `${cents(m.collectionsPerVisitCents)} · ${h(m.attendedVisits)} visits`], ['Days in A/R', h(m.daysInAr ?? '—')], ['A/R at the end of the period', cents(m.arCents)]])
  const aging = (section: any, label: string, key: string) => section.rows.length
    ? table([label, ...buckets.map(([, title]) => title), 'Total'], [...section.rows.map((r: any) => [h(r[key]), ...buckets.map(([b]) => cents(r[b])), cents(r.total)]), ['All', ...buckets.map(([b]) => cents(section.total[b])), cents(section.total.total)]])
    : empty('Nothing outstanding.')
  const deposits = f.deposits.rows.length ? table(['Date', 'Source', 'Reference', 'Received', 'Posted (including interest)', 'Interest', 'Recouped', 'Held as credit', 'Not posted', 'Refunds'],
    [...f.deposits.rows.map((d: any) => [h(d.date), h(d.source), h(d.reference), cents(d.receivedCents), cents(d.postedCents), cents(d.interestCents??0), cents(d.recoupedCents??0), cents(d.creditCents), cents(d.unpostedCents), cents(d.refundedCents)]),
      ['', 'All', '', cents(f.deposits.total.receivedCents), cents(f.deposits.total.postedCents), cents(f.deposits.total.interestCents??0), cents(f.deposits.total.recoupedCents??0), cents(f.deposits.total.creditCents), cents(f.deposits.total.unpostedCents), cents(f.deposits.total.refundedCents)]], true) : empty('No money recorded in these dates.')
  return panel('Financial summary', `<p class="help">Whole clinic, ${h(f.from)} through ${h(f.to)}. Charges include approved visit invoices by date of service and cash sales on their recorded date; payments and adjustments count on the day they were posted. Days in A/R is A/R at the end of the period divided by average daily charges over the period.</p>` + summary + link('summary', 'summary'), 'full', 'report-financial-summary')
    + panel('A/R aging by payer', '<p class="help">Open balances on invoices whose claim is still open at the payer, aged from the date of service to the last day.</p>' + aging(f.agingByPayer, 'Payer', 'payer') + link('aging-payer', 'payer aging'), 'full', 'report-aging-payer')
    + panel('A/R aging by patient', '<p class="help">Open balances the patient owes, aged from the date of service to the last day.</p>' + aging(f.agingByPatient, 'Patient', 'patient') + link('aging-patient', 'patient aging'), 'full', 'report-aging-patient')
    + panel('Deposit reconciliation', '<p class="help">Money Balm recorded, grouped the way it reaches your bank: each ERA or paper EOB check or EFT (with interest and recoupments separate), card payments by the day Stripe took them, and desk payments by day. Balm does not read your bank or Stripe payouts; Stripe pays out later and keeps its fees, so compare these totals with your statements.</p>' + deposits + link('deposits', 'deposits'), 'full', 'report-deposits')
}
