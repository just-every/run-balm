import { check, desk, dollarsField, field, form, h, hidden, money, panel, stamp, status } from './shared'

/** Owner-only reader setup, alongside the clinic's existing Stripe connection. */
export function terminalSettings(s: any) {
  if (s.actor.role !== 'owner' || !s.payments?.terminal) return ''
  const stripe = s.payments.stripe, terminal = s.payments.terminal, reader = terminal.reader, path = '/app/clinic'
  if (stripe?.block) return panel('Card terminal', `<p>${h(stripe.block)}</p>`)
  return panel('Card terminal', `<p>Patients tap or insert their card on the clinic’s Stripe smart reader. Card numbers stay with Stripe.</p>
    ${reader ? `<p>${status(reader.livemode ? 'Live mode' : 'Test mode')} · ${h(reader.reader_id)} · ${status(reader.reader_status)} · checked ${stamp(s, reader.checked_at)}</p>` : '<p>No reader configured.</p>'}
    <details><summary>Use a registered Stripe reader</summary>${form('pay.terminal.configure', path,
      field('readerId', 'Reader ID from Stripe', reader?.reader_id ?? '', 'text', 'required placeholder="tmr_…" autocomplete="off"'), 'Use reader')}</details>
    <details><summary>Register a smart reader</summary><p class="help">Create the clinic location in Stripe’s Terminal dashboard first. Enter its location ID and the registration code shown on the reader. Use a WisePOS E or Stripe Reader S700 or S710 connected to the internet.</p>
      ${form('pay.terminal.configure', path, field('locationId', 'Stripe Terminal location ID', reader?.location_id ?? '', 'text', 'required placeholder="tml_…"')
        + field('registrationCode', 'Reader registration code', '', 'text', 'required autocomplete="off"'), 'Register reader')}</details>
    ${!stripe?.connected?.livemode ? `<details><summary>Create a Stripe test reader</summary><p class="help">This calls Stripe’s simulator in test mode. It does not prove a physical reader works.</p>
      ${form('pay.terminal.configure', path, hidden('simulated', 'on') + field('locationId', 'Stripe test Terminal location ID', '', 'text', 'required placeholder="tml_…"'), 'Create test reader')}</details>` : ''}`)
}

/** Call beside the existing check-in actions; all controls are labeled text. */
export function terminalCheckIn(s: any, visit: any, back: string) {
  const terminal = s.payments?.terminal, info = s.payments?.visits?.[visit.id]
  if (!desk(s) || !terminal || !info) return ''
  const payment = terminal.payments.find((p: any) => p.appointment_id === visit.id)
  if (payment && payment.state !== 'canceled') {
    const fields = hidden('paymentId', payment.id)
    if (payment.status === 'succeeded') return `<p>${status(`Terminal copay ${money(payment.amount_cents)} paid`)} <a href="/api/balm/receipts/${h(payment.id)}.pdf">Receipt R-${h(String(payment.receipt_number).padStart(6, '0'))}</a></p>`
    return `<div class="entry"><p>${status('Terminal payment pending')} · ${money(payment.amount_cents)}${payment.action_status ? ` · ${status(payment.action_status)}` : ''}</p>
      ${payment.failure ? `<p class="help">${h(payment.failure)}</p>` : '<p class="help">Ask the patient to tap or insert their card. Check Stripe status before collecting another payment.</p>'}
      ${form('pay.terminal.sync', back, fields, 'Check Stripe status', true)}
      ${!payment.livemode && terminal.reader?.device_type?.startsWith('simulated') ? form('pay.terminal.simulate', back, fields, 'Present test card in Stripe', true) : ''}
      <details><summary>Cancel terminal collection</summary>${form('pay.terminal.cancel', back, fields + check('confirm', 'Cancel this payment in Stripe before taking another payment.'), 'Cancel terminal payment', true)}</details>
      ${!payment.payment_intent ? `<details><summary>Locate an uncertain payment</summary><p class="help">Find the original intent in the clinic’s Stripe account using Balm payment ID ${h(payment.id)}. Balm checks its amount and patient reference before linking it.</p>${form('pay.terminal.sync', back, fields + field('intentId', 'Original Stripe PaymentIntent ID', '', 'text', 'required placeholder="pi_…"'), 'Read original intent', true)}</details>` : ''}
    </div>`
  }
  if (!terminal.reader || s.payments.stripe?.block || Number(info.copayCents) < 50 || !['booked', 'attended'].includes(visit.status)
    || info.copay && !['failed', 'expired'].includes(info.copay.status)) return ''
  const amount = money(info.copayCents)
  return form('pay.terminal.collect', back, hidden('appointmentId', visit.id) + hidden('paymentId', crypto.randomUUID())
    + hidden('amount', dollarsField(info.copayCents)), info.checkedInAt ? `Collect ${amount} copay on terminal` : `Check in and collect ${amount} on terminal`, true)
}
