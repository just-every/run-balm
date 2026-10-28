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
  const payment = terminal.payments.find((p: any) => p.appointment_id === visit.id && !p.collection_purpose)
  if (payment && payment.state !== 'canceled' && info.canCollect !== false) {
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
  if (info.canCollect === false || !terminal.reader || s.payments.stripe?.block || Number(info.copayCents) < 50 || !['booked', 'attended'].includes(visit.status)
    || info.copay && !['failed', 'expired'].includes(info.copay.status)) return ''
  const amount = money(info.copayCents)
  return form('pay.terminal.collect', back, hidden('appointmentId', visit.id) + hidden('paymentId', crypto.randomUUID())
    + hidden('amount', dollarsField(info.copayCents)), info.checkedInAt ? `Collect ${amount} copay on terminal` : `Check in and collect ${amount} on terminal`, true)
}

/** Invoice-specific collection is separate from the visit's configured copay. */
export function responsibilityCheckIn(s: any, visit: any, back: string) {
 const info=s.payments?.visits?.[visit.id],terminal=s.payments?.terminal
 if(!desk(s)||!info)return ''
 const records=(info.pendingCollections??[]).filter((p:any)=>p.collection_purpose || info.canCollect === false).map((p:any)=>collectionRecovery(p,back)+(p.terminal_payment && !p.livemode && terminal?.reader?.device_type?.startsWith('simulated') ? form('pay.terminal.simulate',back,hidden('paymentId',p.id),'Present test card in Stripe',true):'')).join('')+(info.collectionPayments??[]).map((p:any)=>{
  const label=p.collection_purpose==='coinsurance'?'Coinsurance':'Patient balance'
  if(p.status==='succeeded')return `<p>${status(label+' '+money(p.amount_cents)+' paid')} · <a href="/api/balm/receipts/${h(p.id)}.pdf">Receipt R-${h(String(p.receipt_number).padStart(6,'0'))}</a></p>`
  return `<p>${status(label+' '+p.status)} ${h(p.failure??'')}</p>`
 }).join('')
 if(!info.checkedInAt || info.canCollect === false || !['booked','attended'].includes(visit.status) || s.payments.stripe?.block)return records
 const choices=(info.collections??[]).map((i:any)=>{
  const fields=()=>hidden('appointmentId',visit.id)+hidden('invoiceId',i.id)+hidden('paymentId',crypto.randomUUID())
   +`<label>Collection<select name="purpose"><option value="balance">Outstanding patient responsibility</option>${i.coinsurance_cents>=50?'<option value="coinsurance">Adjudicated coinsurance</option>':''}</select></label>`
   +field('amount','Amount to collect ($)',dollarsField(i.balance_cents),'text','required inputmode="decimal"')
   +check('confirm','I confirm this selected amount with the patient, separately from the copay.')
  return `<details class="checkin-collection"><summary><span>Collect patient responsibility · INV-${h(String(i.number).padStart(6,'0'))}</span></summary><p>Available ${money(i.balance_cents)}${i.coinsurance_cents>=50?' · adjudicated coinsurance up to '+money(i.coinsurance_cents):''}. Payments, credits and pending collections are deducted.</p>`
   +(info.card?form('pay.checkin.collect',back,fields(),'Collect on saved card',true):'<p>No saved card.</p>')
   +(terminal?.reader?form('pay.terminal.collect',back,fields(),'Collect on terminal',true):'')+'</details>'
 }).join('')
 return records+choices
}

/** Persistent recovery reads the original payment; it never creates a new charge. */
export function collectionRecovery(p: any, back: string) {
 const label=p.collection_purpose==='coinsurance'?'Coinsurance':p.kind==='copay'?'Terminal copay':'Patient balance'
 const fields=hidden('paymentId',p.id)
 const actions=p.terminal_payment
  ?form('pay.terminal.sync',back,fields,'Check Stripe status',true)
   +form('pay.terminal.cancel',back,fields+check('confirm','Cancel the original payment before collecting again.'),'Cancel terminal payment',true)
   +(!p.payment_intent?`<details><summary>Locate an uncertain payment</summary>${form('pay.terminal.sync',back,fields+field('intentId','Original Stripe PaymentIntent ID','','text','required'), 'Read original intent',true)}</details>`:'')
  :form('pay.checkin.collect',back,fields+hidden('appointmentId',p.appointment_id)+hidden('invoiceId',p.invoice_id)+hidden('purpose',p.collection_purpose)+hidden('amount',dollarsField(p.amount_cents)),'Check Stripe status',true)
 return `<div class="entry collection-recovery" data-payment-id="${h(p.id)}"><p>${status(label+' pending')} · ${money(p.amount_cents)}. Check the original Stripe payment before collecting again.</p>${actions}</div>`
}
