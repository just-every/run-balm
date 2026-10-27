import { retailObligations } from './retail'
import {isPayerPayment} from '../payments/ledger'
import { biller } from '../domain/role-access'
import { anonymousFinancialFacts } from '../retention/accounting'
// Owner-only financial reports (REPORT-002), read from the same records as each
// patient's ledger (src/balm/payments/ledger.ts): approved invoices are charges,
// posted payments and approved adjustments reduce them, and an invoice with a claim
// still open at the payer is owed by that payer, otherwise by the patient.
// Balm sees no bank account and no Stripe payouts: deposits are the money Balm
// recorded, grouped the way it reaches the bank, for the owner to compare.
import { hostDateAt } from '../availability/timezone'
import { csvCell } from '../domain/disclosures'
import { audit, commit, human, insist, need, type Actor, type Data } from '../domain/model'
import { reportRange } from './range'

export const financialKinds = ['summary', 'aging-payer', 'aging-patient', 'deposits', 'retail'] as const
export type FinancialKind = typeof financialKinds[number]
export const agingBuckets = ['0-30', '31-60', '61-90', '91-120', 'over-120'] as const

const bucket = (days: number) => days <= 30 ? '0-30' : days <= 60 ? '31-60' : days <= 90 ? '61-90' : days <= 120 ? '91-120' : 'over-120'
const emptyBuckets = () => Object.fromEntries(agingBuckets.map(b => [b, 0])) as Record<typeof agingBuckets[number], number>

export async function financialReports(db: D1Database, who: Actor, input: Data) {
  human(who)
  insist(who.role === 'owner' || biller(who), 'role_cannot_do_this', 403)
  const r = await reportRange(db, input), local = (iso: unknown) => hostDateAt(new Date(String(iso)), r.zone)
  const inRange = (iso: unknown) => { const d = local(iso); return d >= r.from && d <= r.to }
  const before = (iso: unknown) => Date.parse(String(iso)) < Date.parse(r.end)
  const [invoices, payments, adjustments, cards, remittances, visits, accountEntries] = (await db.batch<Data>([
    db.prepare(`SELECT i.id,i.client_id,i.amount_cents,a.start_at,c.first_name||' '||c.last_name AS client,
      (SELECT h.payer FROM bm_invoice_insurance_hold h WHERE h.invoice_id=i.id) AS open_payer
      FROM bm_invoices i JOIN bm_appointments a ON a.id=i.appointment_id JOIN bm_clients c ON c.id=i.client_id WHERE i.status='approved'`),
    db.prepare('SELECT invoice_id,amount_cents,reference,recorded_at,card_payment_id,account_entry_id FROM bm_invoice_payments'),
    db.prepare('SELECT invoice_id,amount_cents,reason,recorded_at FROM bm_invoice_adjustments'),
    db.prepare("SELECT id,amount_cents,applied_cents,succeeded_at FROM bm_card_payments WHERE status='succeeded'"),
    db.prepare(`SELECT m.id,m.payer_id,m.trace,m.amount_cents,m.imported_at,y.name AS payer FROM bm_insurance_imports m JOIN bm_payers y ON y.id=m.payer_id WHERE m.kind='835' ORDER BY m.imported_at,m.id`),
    db.prepare("SELECT start_at FROM bm_appointments WHERE status='attended'"),
    db.prepare("SELECT id,credit_id,kind,amount_cents,reference,posted_at FROM bm_posted_account_entries WHERE kind IN ('credit','refund')"),
  ])).map(x => x.results)
  const refunds = (await db.prepare("SELECT r.id,r.payment_id,r.amount_cents,r.confirmed_at,r.provider_refund_id,COALESCE((SELECT SUM(a.amount_cents) FROM bm_card_refund_allocations a WHERE a.refund_id=r.id),0) AS allocated_cents FROM bm_card_refunds r WHERE r.status='confirmed'").all<Data>()).results
  const retail=await db.prepare("SELECT id,client_id,kind,amount_cents,tax_cents,gift_id,reference,recorded_at FROM bm_retail_sales UNION ALL SELECT id,NULL,kind,amount_cents,tax_cents,gift_id,'Destroyed receipt',recorded_at FROM bm_destroyed_retail").all<Data>()
  for(const sale of retail.results){
    const total=Number(sale.amount_cents)+Number(sale.tax_cents),gift=sale.kind==='gift_card'
    if(!gift){
      invoices.push({id:sale.id,client_id:sale.client_id,amount_cents:total,start_at:sale.recorded_at,client:'Cash sale',open_payer:null})
      payments.push({invoice_id:sale.id,amount_cents:total,reference:'retail:'+sale.id,recorded_at:sale.recorded_at,account_entry_id:sale.id,retail:true})
    }
  }
  const retailSettlements=await db.prepare(`SELECT sale_id,amount_cents,recorded_at,reference FROM bm_membership_settlements
    UNION ALL SELECT id,json_extract(settlement,'$.amount_cents'),json_extract(settlement,'$.recorded_at'),'Destroyed cash refund' FROM bm_destroyed_retail WHERE settlement IS NOT NULL`).all<Data>()
  for(const z of retailSettlements.results) {
    payments.push({invoice_id:z.sale_id,amount_cents:-Number(z.amount_cents),recorded_at:z.recorded_at,account_entry_id:z.sale_id,retail:true,reference:z.reference})
    adjustments.push({invoice_id:z.sale_id,amount_cents:Number(z.amount_cents),recorded_at:z.recorded_at,reason:'Unused membership settlement'})
  }
  const anonymous = await anonymousFinancialFacts(db)
  refunds.push(...anonymous[6])
  invoices.push(...anonymous[0])
  payments.push(...anonymous[1]); adjustments.push(...anonymous[2]); cards.push(...anonymous[3]); visits.push(...anonymous[4]); accountEntries.push(...anonymous[5])
  const kindOf = (p: Data) => p.account_entry_id ? 'desk' : isPayerPayment(p.reference) ? 'insurance' : p.card_payment_id ? 'card' : 'desk'

  // Charges by date of service; payments and adjustments by the date they were posted.
  const charged = invoices.filter(i => inRange(i.start_at))
  const posted = payments.filter(p => inRange(p.recorded_at)), adjusted = adjustments.filter(x => inRange(x.recorded_at))
  const sum = (list: Data[], pick: (x: Data) => boolean = () => true) => list.filter(pick).reduce((t, x) => t + Number(x.amount_cents), 0)
  const attended = visits.filter(v => inRange(v.start_at)).length

  // A/R as of the end of the last day: what each invoice served by then still owes,
  // aged from its date of service; owed by the payer while its claim is open.
  const byPayer = new Map<string, ReturnType<typeof emptyBuckets>>(), byPatient = new Map<string, { clientId: string; patient: string } & ReturnType<typeof emptyBuckets>>()
  const named = new Set<string>()
  for (const i of invoices) {
    if (!before(i.start_at)) continue
    const open = Number(i.amount_cents) - sum(payments, p => p.invoice_id === i.id && before(p.recorded_at)) - sum(adjustments, x => x.invoice_id === i.id && before(x.recorded_at))
    if (open <= 0) continue
    const age = Math.round((Date.parse(r.to) - Date.parse(local(i.start_at))) / 86400_000), b = bucket(age)
    if (i.open_payer) {
      const row = byPayer.get(i.open_payer) ?? emptyBuckets(); row[b] += open; byPayer.set(i.open_payer, row)
    } else {
      const row = byPatient.get(i.client_id) ?? { clientId: i.client_id, patient: i.client, ...emptyBuckets() }; row[b] += open; byPatient.set(i.client_id, row)
      named.add(i.client_id)
    }
  }
  const withTotal = <T extends Record<string, unknown>>(row: T) => ({ ...row, total: agingBuckets.reduce((t, b) => t + Number(row[b]), 0) })
  const payerRows = [...byPayer].map(([payer, row]) => withTotal({ payer, ...row })).sort((a, b) => a.payer.localeCompare(b.payer))
  const patientRows = [...byPatient.values()].map(withTotal).sort((a, b) => a.patient.localeCompare(b.patient) || a.clientId.localeCompare(b.clientId))
  const totalRow = (list: Data[]) => withTotal(Object.fromEntries(agingBuckets.map(b => [b, list.reduce((t, x) => t + Number(x[b]), 0)])))
  const arCents = totalRow(payerRows).total + totalRow(patientRows).total
  const chargesCents = sum(charged)

  // Deposits: each ERA check or EFT as the payer sent it, card payments by the day
  // Stripe took them (before Stripe's fees and payout timing), desk payments by day.
  const deposits: { date: string; source: string; reference: string; receivedCents: number; postedCents: number; creditCents: number; unpostedCents: number; refundedCents: number; interestCents?: number; recoupedCents?: number }[] = []
  for (const m of remittances.filter(m => inRange(m.imported_at))) {
    const postedCents = sum(payments, p => before(p.recorded_at) && (p.remittance_id === m.id || String(p.reference).startsWith(`era:${m.payer_id}:${m.trace}:`)))
    deposits.push({ date: local(m.imported_at), source: `ERA · ${m.payer}`, reference: String(m.trace), receivedCents: Number(m.amount_cents ?? 0), postedCents, creditCents: 0, unpostedCents: Number(m.amount_cents ?? 0) - postedCents, refundedCents: 0 })
  }
  const manualBatches=await db.prepare("SELECT b.*,p.name AS payer FROM bm_payer_payment_batches b JOIN bm_payers p ON p.id=b.payer_id WHERE b.status='closed' AND b.deposit_on>=? AND b.deposit_on<=? ORDER BY b.deposit_on,b.id").bind(r.from,r.to).all<Data>()
  for(const b of manualBatches.results)deposits.push({date:b.deposit_on,source:'Paper EOB · '+b.payer,reference:b.reference,receivedCents:b.amount_cents,postedCents:b.paid_cents-b.recouped_cents+b.interest_cents,creditCents:0,unpostedCents:0,refundedCents:0,interestCents:b.interest_cents,recoupedCents:b.recouped_cents})
  const days = (list: Data[], at: string) => { const map = new Map<string, Data[]>(); for (const x of list) if (inRange(x[at])) { const d = local(x[at]); map.set(d, [...(map.get(d) ?? []), x]) } return [...map].sort(([a], [b]) => a.localeCompare(b)) }
  for (const [date, list] of days(cards, 'succeeded_at')) {
    const ids = new Set(list.map(c => c.id)), received = sum(list), postedCents = sum(payments, p => ids.has(p.card_payment_id) && !String(p.reference).startsWith('stripe-refund:') && before(p.recorded_at)), creditCents = received - postedCents
    deposits.push({ date, source: 'Card payments (Stripe)', reference: `${list.length} payment${list.length === 1 ? '' : 's'}`, receivedCents: received, postedCents, creditCents, unpostedCents: received - postedCents - creditCents, refundedCents: 0 })
  }
  for (const refund of refunds.filter(v => inRange(v.confirmed_at))) {
    const amount = Number(refund.amount_cents), allocated = Number(refund.allocated_cents)
    deposits.push({ date: local(refund.confirmed_at), source: 'Stripe refund to original payment', reference: refund.provider_refund_id ?? 'Destroyed refund', receivedCents: -amount, postedCents: -allocated, creditCents: -(amount-allocated), unpostedCents: 0, refundedCents: amount })
  }
  for (const [date, list] of days(payments.filter(p => kindOf(p) === 'desk' && !p.account_entry_id), 'recorded_at')) {
    deposits.push({ date, source: 'Recorded at the desk', reference: `${list.length} payment${list.length === 1 ? '' : 's'}`, receivedCents: sum(list), postedCents: sum(list), creditCents: 0, unpostedCents: 0, refundedCents: 0 })
  }
  // An external credit is cash received once. Its later invoice allocations are
  // collections on their posting day, but never a second cash receipt. Held
  // credit and allocations reflect only facts posted by this report's end.
  for (const entry of accountEntries.filter(e => inRange(e.posted_at))) {
    const date = local(entry.posted_at), amount = Number(entry.amount_cents)
    if (entry.kind === 'credit') {
      const postedCents = sum(payments, p => p.account_entry_id === entry.id && before(p.recorded_at))
      const refundedCents = sum(accountEntries, e => e.kind === 'refund' && e.credit_id === entry.id && before(e.posted_at))
      deposits.push({ date, source: 'External credit receipt', reference: entry.reference || 'Destroyed receipt', receivedCents: amount,
        postedCents, creditCents: amount - postedCents - refundedCents, unpostedCents: 0, refundedCents: 0 })
    } else {
      deposits.push({ date, source: 'External unused-credit refund (not Stripe)', reference: entry.reference || 'Destroyed refund',
        receivedCents: -amount, postedCents: 0, creditCents: 0, unpostedCents: 0, refundedCents: amount })
    }
  }
  for(const sale of retail.results.filter(s=>inRange(s.recorded_at)&&!s.gift_id)){
    const amount=Number(sale.amount_cents)+Number(sale.tax_cents),gift=sale.kind==='gift_card'
    const redeemed=retail.results.filter(s=>s.gift_id===sale.id&&before(s.recorded_at)).reduce((t,s)=>t+Number(s.amount_cents)+Number(s.tax_cents),0)
    deposits.push({date:local(sale.recorded_at),source:gift?'Gift value purchased':'Cash sale',reference:sale.reference,receivedCents:amount,postedCents:gift?redeemed:amount,creditCents:gift?amount-redeemed:0,unpostedCents:0,refundedCents:0})
  }
  for(const z of retailSettlements.results.filter(z=>inRange(z.recorded_at)))deposits.push({date:local(z.recorded_at),source:'Membership cash refund recorded outside Balm',reference:z.sale_id,receivedCents:-Number(z.amount_cents),postedCents:-Number(z.amount_cents),creditCents:0,unpostedCents:0,refundedCents:Number(z.amount_cents)})
  deposits.sort((a, b) => a.date.localeCompare(b.date) || a.source.localeCompare(b.source))

  if (named.size) await commit(db, who, [...named].map(clientId => audit(db, who, 'report.financial_read', clientId)))
  return {
    from: r.from, to: r.to, timeZone: r.zone,
    retail:await retailObligations(db,r.end),
    summary: {
      chargesCents, charges: charged.length,
      paymentsCents: sum(posted), insurancePaymentsCents: sum(posted, p => kindOf(p) === 'insurance'), cardPaymentsCents: sum(posted, p => kindOf(p) === 'card'), deskPaymentsCents: sum(posted, p => kindOf(p) === 'desk'),
      adjustmentsCents: sum(adjusted), attendedVisits: attended,
      collectionsPerVisitCents: attended ? Math.round(sum(posted) / attended) : null,
      arCents, daysInAr: chargesCents ? Math.round(arCents / (chargesCents / r.days) * 10) / 10 : null,
    },
    agingByPayer: { rows: payerRows, total: totalRow(payerRows) },
    agingByPatient: { rows: patientRows, total: totalRow(patientRows) },
    deposits: { rows: deposits, total: { receivedCents: deposits.reduce((t, d) => t + d.receivedCents, 0), postedCents: deposits.reduce((t, d) => t + d.postedCents, 0), creditCents: deposits.reduce((t, d) => t + d.creditCents, 0), unpostedCents: deposits.reduce((t, d) => t + d.unpostedCents, 0), refundedCents: deposits.reduce((t, d) => t + d.refundedCents, 0), interestCents: deposits.reduce((t,d)=>t+(d.interestCents??0),0), recoupedCents: deposits.reduce((t,d)=>t+(d.recoupedCents??0),0) } },
  }
}

export type FinancialReports = Awaited<ReturnType<typeof financialReports>>
const dollars = (cents: unknown) => cents === null || cents === undefined ? '' : (Number(cents) / 100).toFixed(2)

/** One report as CSV; money in US dollars with two decimals. */
export function financialCsv(report: FinancialReports, kind: FinancialKind) {
  const table: unknown[][] = []
  const s = report.summary
  if (kind === 'summary') table.push(['measure', 'value'], ['charges_usd', dollars(s.chargesCents)], ['charges_count', s.charges], ['payments_usd', dollars(s.paymentsCents)], ['insurance_payments_usd', dollars(s.insurancePaymentsCents)],
    ['card_payments_usd', dollars(s.cardPaymentsCents)], ['desk_payments_usd', dollars(s.deskPaymentsCents)], ['adjustments_usd', dollars(s.adjustmentsCents)], ['attended_visits', s.attendedVisits],
    ['collections_per_visit_usd', dollars(s.collectionsPerVisitCents)], ['ar_usd', dollars(s.arCents)], ['days_in_ar', s.daysInAr ?? ''])
  if (kind === 'aging-payer' || kind === 'aging-patient') {
    const section = kind === 'aging-payer' ? report.agingByPayer : report.agingByPatient, label = kind === 'aging-payer' ? 'payer' : 'patient'
    table.push([label, ...agingBuckets.map(b => `days_${b.replace('-', '_')}_usd`), 'total_usd'])
    for (const row of section.rows as Data[]) table.push([row[label], ...agingBuckets.map(b => dollars(row[b])), dollars(row.total)])
    table.push(['All', ...agingBuckets.map(b => dollars((section.total as Data)[b])), dollars(section.total.total)])
  }
  if (kind === 'deposits') {
    table.push(['date', 'source', 'reference', 'received_usd', 'posted_usd', 'credit_held_usd', 'unposted_usd', 'refunded_usd', 'interest_usd', 'recouped_usd'])
    for (const d of report.deposits.rows) table.push([d.date, d.source, d.reference, dollars(d.receivedCents), dollars(d.postedCents), dollars(d.creditCents), dollars(d.unpostedCents), dollars(d.refundedCents), dollars(d.interestCents??0), dollars(d.recoupedCents??0)])
    const t = report.deposits.total
    table.push(['', 'All', '', dollars(t.receivedCents), dollars(t.postedCents), dollars(t.creditCents), dollars(t.unpostedCents), dollars(t.refundedCents), dollars(t.interestCents), dollars(t.recoupedCents)])
  }
  if(kind==='retail') {
    table.push(['kind','state','purchases','visits_sold','visits_used','visits_settled','visits_left','unearned_usd','renewals'])
    for(const row of report.retail.rows)table.push([row.kind,row.state,row.purchases,row.visitsSold,row.visitsUsed,row.visitsSettled,row.visitsLeft,dollars(row.unearnedCents),row.renewals])
    table.push(['incomplete_historical_purchases',report.retail.incompleteHistory,'','','','','','',''])
    table.push(['gift_card','held','','','','','',dollars(report.retail.giftLiabilityCents),''])
  }
  return table.map(row => row.map(csvCell).join(',')).join('\r\n') + '\r\n'
}
