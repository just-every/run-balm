import { terminalSettings, terminalCheckIn } from './card-terminal'
import { cardRefundsPanel } from './card-refunds'
import { patientCyclePanel } from './statement-cycles'
import { periodSuperbillForm } from './superbill-period'
// Patient payments in the staff pages: Stripe and NPIs in Clinic, check-in with
// the copay on the day view, and a client file's ledger, card, links and codes.
import { cptText } from '../payments/codes'
import { desk, dollarsField, empty, entry, field, form, h, hidden, money, panel, result, stamp, status, usDate, when, zoneOf } from './shared'

const card = (c: any) => `${String(c.brand ?? 'card').replace(/^./, (x: string) => x.toUpperCase())} ending ${h(c.last4)}`
const receipt = (n: unknown) => 'R-' + String(n).padStart(6, '0')

export function clinicPayments(s: any) {
  const p = s.payments, st = p?.stripe
  if (!st) return ''
  let body: string
  if (st.managed) body = `<p>${h(st.block)}</p>`
  else if (st.connected) {
    const c = st.connected
    body = `<p>${status(c.livemode ? 'Live mode' : 'Test mode')} Connected to <strong>${h(c.account)}</strong> (${h(c.accountId)}) by ${h(c.connectedBy)} ${stamp(s, c.connectedAt)}.</p>`
      + `<p class="help">${c.webhook ? 'Stripe tells Balm about each payment and saved card as it happens.' : 'This install has no public https address, so Stripe cannot call it back: Balm checks each payment and saved card when the patient returns to their link.'}${c.livemode ? '' : ' Test mode takes Stripe’s test cards only (4242 4242 4242 4242).'}</p>`
      + `<details><summary>Disconnect Stripe</summary><p>Saved cards stay in your Stripe account but Balm stops charging them until you connect the same account again.</p>${form('pay.stripe.disconnect', '/app/clinic', '<label class="check"><input type="checkbox" required><span>Disconnect this Stripe account.</span></label>', 'Disconnect Stripe', true)}</details>`
  } else body = '<p>Connect your clinic’s own Stripe account to save patients’ cards with their consent, charge copays at check-in and let patients pay balances from a link. Money goes straight to your Stripe account; Balm never sees card numbers.</p>'
    + form('pay.stripe.connect', '/app/clinic', field('secretKey', 'Stripe secret key', '', 'password', 'required autocomplete="off" spellcheck="false" placeholder="sk_live_… or sk_test_…"')
      + '<p class="help">In the Stripe Dashboard: Developers → API keys. A test-mode key (sk_test_…) lets you try everything with Stripe’s test cards first. Balm keeps the key sealed and never shows it again.</p>', 'Connect Stripe')
  const texts = `<p class="help">${p.smsBlock ? 'Pay links go by email until texting is set up (see Automatic visit reminders above).' : 'Pay links can also go by text.'}</p>`
  const npis = p.npis.length ? `<ul class="plain">${p.npis.map((x: any) => `<li>${form('pay.npi.save', '/app/clinic', hidden('staffId', x.id) + field('npi', `${x.name}: NPI`, x.npi, 'text', 'inputmode="numeric" maxlength="10" pattern="\\d{10}"'), 'Save NPI', true)}</li>`).join('')}</ul>` : empty('Add a practitioner first.')
  return terminalSettings(s) + panel('Online payments', body + texts) + panel('Billing identifiers', `<p>Each practitioner’s 10-digit NPI and the clinic’s tax ID (in Clinic details) print on superbills patients submit to their insurer. A practitioner whose provider number (in Staff) is their NPI has it filled in here already.</p>${npis}`)
}

/** The day view's check-in: one action checks the patient in and charges their copay to the card on file. */
export function checkInActions(s: any, a: any, back: string) {
  return savedCardCheckIn(s, a, back) + terminalCheckIn(s, a, back)
}
function savedCardCheckIn(s: any, a: any, back: string) {
  const v = s.payments?.visits?.[a.id]
  if (!v || a.status !== 'booked' && !v.checkedInAt) return ''
  const block = s.payments.stripe?.block, chargeable = desk(s) && !block && v.card && v.copayCents > 0
  const copayLabel = chargeable ? `${money(v.copayCents)} copay to ${card(v.card)}` : ''
  if (v.checkedInAt) {
    const c = v.copay
    const paid = c?.status === 'succeeded' ? `${status(`Copay ${money(c.amount)} paid`)} <a href="/api/balm/receipts/${h(c.id)}.pdf">Receipt ${h(receipt(c.receipt))}</a>` : ''
    const failed = c && ['failed', 'requires_action'].includes(c.status) ? `<p class="help">Copay not charged: ${h(c.failure ?? 'the card was declined')}</p>` : ''
    const retry = chargeable && (!c || ['failed', 'requires_action'].includes(c.status)) ? form('pay.copay.charge', back, hidden('appointmentId', a.id), `Charge ${copayLabel}`, true) : ''
    return `<p>${status(`Checked in ${new Intl.DateTimeFormat('en-US', { timeZone: s.settings.time_zone, hour: 'numeric', minute: '2-digit', timeZoneName: 'short' }).format(new Date(v.checkedInAt))}`)} ${paid}</p>${failed}${retry}`
  }
  if (!(desk(s) || a.practitioner_id === s.actor.staffId)) return ''
  const why = !desk(s) ? '' : block ? block : !(v.copayCents > 0) ? 'No copay is set for this patient (set it in their file).' : !v.card ? 'No card on file: collect the copay at the desk, or send the patient a card link from their file.' : ''
  return chargeable ? `<div class="actions">${form('pay.checkin', back, hidden('appointmentId', a.id) + hidden('charge', 'on'), `Check in and charge ${copayLabel}`)}${form('pay.checkin', back, hidden('appointmentId', a.id), 'Check in without charging', true)}</div>`
    : `${form('pay.checkin', back, hidden('appointmentId', a.id), 'Check in')}${why ? `<p class="help">${h(why)}</p>` : ''}`
}

function linkResult(s: any, notice: any) {
  const r = result(notice)
  if (!r?.purpose || !r.delivery) return ''
  const what = r.purpose === 'card' ? 'card form' : 'statement and pay link'
  return r.url ? `<div class="notice" role="status"><strong>Patient link ready.</strong> Hand the patient this screen or open the ${what} for them now (shown once): <a href="${h(r.url)}">${h(r.url)}</a></div>`
    : r.delivered === 'suppressed' ? `<div class="notice" role="status">Email is suppressed on this install, so nothing reached the patient. Use <strong>${r.purpose === 'card' ? 'Open the card form here' : 'Open the pay page here'}</strong> instead.</div>`
    : `<div class="notice" role="status">The ${what} went to the patient by ${r.delivery === 'text' ? 'text' : 'email'}.</div>`
}

function codesPanel(s: any, f: any, path: string) {
  const codes = f.billing?.codes ?? {}
  const visits = f.appointments.filter((a: any) => a.status !== 'cancelled' && (desk(s) || a.practitioner_id === s.actor.staffId)).slice(0, 12)
  const list = visits.map((a: any) => {
    const c = codes[a.id] ?? { cpt: [], icd10: [] }
    return entry(`${a.service} · ${usDate(a.start_at, zoneOf(s))}`, `<p>${when(s, a.start_at)} with ${h(a.practitioner)}<br>CPT: ${c.cpt.length ? h(cptText(c.cpt)) : a.note_billed ? 'billed from the signed note (its units go on the invoice and superbill)' : '—'}<br>ICD-10: ${c.icd10.length ? h(c.icd10.join(', ')) : a.note_billed ? '— (add the note’s diagnosis codes here for the superbill)' : '—'}</p>`
      + `<details><summary>${c.cpt.length || c.icd10.length ? 'Change codes' : 'Add codes'}</summary>${form('pay.codes.save', path, hidden('appointmentId', a.id)
        + field('cpt', 'CPT codes with units and modifiers', cptText(c.cpt), 'text', 'placeholder="97110 GP x2, 97140 GP x1" maxlength="400"')
        + field('icd10', 'ICD-10 diagnoses, primary first', c.icd10.join(', '), 'text', 'placeholder="M25.561, M54.50" maxlength="300"')
        + '<p class="help">These print on the visit’s superbill. CPT units billed from a signed note take their place.</p>', 'Save codes')}</details>`, `codes-${a.id}`)
  }).join('')
  return panel('Visit codes', list || empty('No visits yet.'), '', desk(s) ? '' : 'billing')
}

export function billingPanels(s: any, f: any, notice: any) {
  const b = f.billing, path = `/app/clients/${f.client.id}`
  if (!b) return ''
  if (!desk(s)) return (b.balanceCents === undefined ? '' : panel('Patient balance', `<p>${money(b.balanceCents)} owed</p>`)) + codesPanel(s, f, path)
  const blocked = b.stripe.block, l = b.ledger
  const lines = l.lines.length ? `<div class="table"><table class="ledger"><thead><tr><th>Date</th><th>Description</th><th>Charges</th><th>Payments / adjustments</th><th>Balance</th></tr></thead><tbody>${l.lines.map((x: any) => `<tr><td>${stamp(s, x.at).replace(/ \d\d:\d\d:\d\d UTC/, '')}</td><td>${h(x.description)}</td><td data-label="Charge">${x.chargeCents ? money(x.chargeCents) : ''}</td><td data-label="Payment / adjustment">${x.paymentCents ? money(x.paymentCents) : ''}</td><td data-label="Balance">${money(x.balanceCents)}</td></tr>`).join('')}</tbody></table></div>` : empty('No charges or payments yet.')
  const balance = `<p><strong>${l.patientBalanceCents < 0 ? `Credit ${money(-l.patientBalanceCents)}` : `Patient balance ${money(l.patientBalanceCents)}`}</strong>${l.insurancePendingCents ? ` · ${money(l.insurancePendingCents)} pending insurance` : ''}${l.creditCents > 0 ? ` <span class="help">(${money(l.creditCents)} paid ahead, applied when the next invoice is approved)</span>` : ''} · <a href="/api/balm/statements/${h(f.client.id)}.pdf">Statement (PDF)</a></p>`
  const send = (purpose: 'balance' | 'card', label: string) => `<div class="actions">${b.hasEmail ? form('pay.link.create', path, hidden('clientId', f.client.id) + hidden('purpose', purpose) + hidden('delivery', 'email'), `Email ${label}`, true) : ''}`
    + (b.hasPhone && !b.smsBlock ? form('pay.link.create', path, hidden('clientId', f.client.id) + hidden('purpose', purpose) + hidden('delivery', 'text'), `Text ${label}`, true) : '')
    + form('pay.link.create', path, hidden('clientId', f.client.id) + hidden('purpose', purpose) + hidden('delivery', 'shown'), purpose === 'card' ? 'Open the card form here' : 'Open the pay page here', true) + '</div>'
    + (b.smsBlock && b.hasPhone ? `<p class="help">${h(b.smsBlock)}</p>` : '') + (b.hasEmail ? '' : '<p class="help">Add the patient’s email address to send links by email.</p>')
  const cardBlock = b.card ? `<p>${card(b.card)}, expires ${h(String(b.card.exp_month).padStart(2, '0'))}/${h(b.card.exp_year)} · saved ${stamp(s, b.card.saved_at)}</p><details><summary>Authorization the patient accepted ${stamp(s, b.card.consented_at)}</summary><p class="help">${h(b.card.consent_text)}</p></details>`
    + `<details><summary>Remove this card</summary>${form('pay.card.remove', path, hidden('clientId', f.client.id) + '<label class="check"><input type="checkbox" required><span>Remove the card from Balm and the clinic’s Stripe account.</span></label>', 'Remove card', true)}</details>`
    : '<p>No card on file.</p>'
  const charge = b.card && !blocked ? b.open.map((i: any) => `<p>Invoice INV-${String(i.number).padStart(6, '0')} · ${card(b.card)}</p>` + form('pay.invoice.charge', path, hidden('invoiceId', i.id), `Charge ${money(i.open_cents)} to saved card`, true)).join('') : ''
  const payments = b.payments.length ? `<ul class="plain">${b.payments.map((p: any) => `<li>${money(p.amount_cents)} · ${h(p.kind === 'copay' ? 'copay' : p.kind === 'link' ? 'paid from link' : 'card charge')} · ${p.card_brand ? card({ brand: p.card_brand, last4: p.card_last4 }) + ' · ' : ''}${status(p.status.replace('_', ' '))} ${stamp(s, p.succeeded_at ?? p.created_at)}`
    + (p.status === 'succeeded' ? ` · <a href="/api/balm/receipts/${h(p.id)}.pdf">Receipt ${h(receipt(p.receipt_number))}</a>${p.receipt_delivery === 'sent' && !s.local ? ' (emailed)' : ''}` : '') + (p.failure && p.status !== 'succeeded' ? `<br><span class="help">${h(p.failure)}</span>` : '') + '</li>').join('')}</ul>` : ''
  const links = b.links.length ? `<details><summary>Patient links (${b.links.length})</summary><ul class="plain">${b.links.map((x: any) => `<li>${h(x.purpose === 'card' ? 'Card form' : 'Statement and pay')} · ${h(x.delivery === 'shown' ? 'opened at the desk' : `${x.delivery}: ${x.delivery_result}`)} · ${stamp(s, x.created_at)}${x.opened_at ? ` · opened ${stamp(s, x.opened_at)}` : ''}</li>`).join('')}</ul></details>` : ''
  const superbills = b.superbills.length ? `<ul class="plain">${b.superbills.map((x: any) => `<li>INV-${String(x.number).padStart(6, '0')} · ${h(x.serviceDate)}<br>${x.missing.length ? `<span class="help">Needs ${h(x.missing.join(', '))}.</span>` : `<a href="/api/balm/superbills/${h(x.invoiceId)}.pdf">Superbill (PDF)</a>`}</li>`).join('')}</ul>` : empty('Superbills appear once a visit’s invoice is approved.')
  const copay = form('pay.copay.save', path, hidden('clientId', f.client.id) + field('copay', 'Copay per visit ($)', dollarsField(b.copayCents), 'text', 'inputmode="decimal" maxlength="10" placeholder="30.00"'), 'Save copay', true)
  return `${linkResult(s, notice)}` + panel('Billing and payments', `${periodSuperbillForm('/api/balm/period-superbills/' + f.client.id + '.pdf')}${balance}${lines}${blocked ? `<p class="help">${h(blocked)}</p>` : ''}${l.patientBalanceCents > 0 ? `<h3>Collect the balance</h3>${charge}${send('balance', `a ${money(l.patientBalanceCents)} pay link`)}` : ''}${payments ? `<h3>Card payments</h3>${payments}` : ''}${links}`, 'full', 'billing')
    + panel('Card on file and copay', `${cardBlock}${blocked ? '' : `<h3>${b.card ? 'Replace the card' : 'Save a card'}</h3><p class="help">The patient enters the card themselves and accepts the clinic’s authorization to charge copays and balances.</p>${send('card', 'a card form')}`}<h3>Copay</h3>${copay}`)
    + panel('Superbills', `<p>Per visit or inclusive date range, with CPT and ICD-10 codes, practice and rendering NPIs, fees, payments and the clinic’s tax ID, for the patient to submit to their insurer.</p>${superbills}`)
    + codesPanel(s, f, path) + patientCyclePanel(s, f) + cardRefundsPanel(s, f)
}

