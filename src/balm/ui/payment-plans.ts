import { desk, empty, field, form, h, hidden, money, panel, stamp, status, usDate } from './shared'

const authorizationFields = (patient: string, purpose: string) =>
  field('authorizedBy', 'Patient who authorized this', patient, 'text', 'required maxlength="200"')
  + field('authorizedOn', 'Date the patient authorized this', '', 'date', 'required')
  + field('evidence', 'Where the patient’s authorization is recorded', '', 'text', 'required maxlength="1000" placeholder="Signed agreement on file, or dated conversation and agreed terms"')
  + `<label class="check"><input type="checkbox" name="authorized" required><span>I have recorded the patient’s explicit authorization for ${h(purpose)}.</span></label>`

export function clientPaymentPlans(s: any, f: any) {
  if (!desk(s) || !f.billing) return ''
  const b = f.billing, path = `/app/clients/${f.client.id}`, clientId = hidden('clientId', f.client.id), patient = `${f.client.first_name} ${f.client.last_name}`
  const plans = (b.plans ?? []).map((p: any) => `<article><h3>${money(p.amount_cents)} monthly · ${h(p.months)} months ${status(p.status)}</h3>
    <p>First charge ${h(usDate(p.first_due, 'UTC'))}. Each charge is limited to the remaining patient balance. Future charges can be stopped here.</p>
    <details><summary>Recorded patient authorization</summary><p>${h(p.authorization_text)}</p><p>${h(p.authorized_by)} · ${h(usDate(p.authorized_on, 'UTC'))} · ${h(p.authorization_evidence)}<br>Recorded by ${h(p.created_by)} ${stamp(s, p.created_at)}</p></details>
    <ul class="plain">${p.installments.map((i: any) => `<li>${h(usDate(i.due_on, 'UTC'))} · ${money(i.amount_cents ?? p.amount_cents)} · ${status(i.status)}${i.outcome ? `<br><span class="help">${h(i.outcome)}</span>` : ''}${i.payment_status === 'succeeded' ? ` · <a href="/api/balm/receipts/${h(i.payment_id)}.pdf">Receipt R-${String(i.receipt_number).padStart(6, '0')}</a>` : ''}</li>`).join('')}</ul>
    ${p.status === 'active' ? form('pay.plan.stop', path, clientId + hidden('id', p.id) + field('reason', 'Reason to stop future charges', '', 'text', 'required maxlength="500"'), 'Stop payment plan', true) : ''}</article>`).join('')
  const create = !b.plans?.some((p: any) => p.status === 'active') && b.card && !b.stripe.block && b.ledger.patientBalanceCents > 0
    ? `<details><summary>Create monthly payment plan</summary><p>Agree the monthly amount, number of months and first charge date with the patient before recording their authorization. Balm charges only their current balance, to this saved card. A declined or uncertain installment goes to a person for review.</p>${form('pay.plan.create', path,
      clientId + field('amount', 'Monthly charge ($)', '', 'text', 'required inputmode="decimal" placeholder="95.00"') + field('months', 'Number of months', '3', 'number', 'required min="1" max="60"') + field('firstDue', 'First charge date', '', 'date', 'required') + authorizationFields(patient, 'the monthly card charges and dates above'), 'Create authorized plan')}</details>` : ''
  const reminders = (b.reminders ?? []).map((r: any) => `<article><h3>${r.statement_mode === 1 ? 'Periodic statements' : 'Balance reminder emails'} every ${h(r.every_days)} days ${status(r.status)}</h3><p>Next scheduled date ${h(usDate(r.next_on, 'UTC'))}. Stops when the patient balance is paid or a person stops it.${r.statement_mode === 1 ? ' Each scheduled statement is preserved in the patient portal as issued.' : ''}</p>
    <details><summary>Reminder authorization and history</summary><p>${h(r.consented_by)} · ${h(usDate(r.consented_on, 'UTC'))} · ${h(r.consent_evidence)}</p><ul class="plain">${r.notices.map((n: any) => `<li>${h(usDate(n.due_on, 'UTC'))} · ${status(n.status)}${n.outcome ? ` · ${h(n.outcome)}` : ''}</li>`).join('')}</ul></details>
    ${r.status === 'active' ? form('pay.reminders.stop', path, clientId + hidden('id', r.id) + field('reason', 'Reason to stop reminders', '', 'text', 'required maxlength="500"'), r.statement_mode === 1 ? 'Stop periodic statements' : 'Stop balance reminders', true) : ''}</article>`).join('')
  const setup = !b.reminders?.some((r: any) => r.status === 'active') && b.hasEmail && b.ledger.patientBalanceCents > 0
    ? `<details><summary>Schedule balance reminders</summary><p>Emails name the clinic and ask the patient to sign in to their portal. Record the patient’s opt-in first.</p>${form('pay.reminders.save', path, clientId + field('everyDays', 'Days between reminders', '30', 'number', 'required min="1" max="365"') + field('firstDue', 'First reminder date', '', 'date', 'required') + authorizationFields(patient, 'these scheduled balance emails'), 'Schedule authorized reminders')}</details>` : ''
  const statements = !b.reminders?.some((r: any) => r.status === 'active') && b.hasEmail && b.ledger.patientBalanceCents > 0
    ? `<details><summary>Schedule periodic statements</summary><p>With the patient’s opt-in, Balm preserves a statement in their portal on each scheduled date and sends a generic email asking them to sign in. Statements stop when the balance is paid or a person stops the schedule. One active reminder or statement schedule is allowed per patient.</p>${form('pay.statements.save', path, clientId + field('everyDays', 'Days between statements', '30', 'number', 'required min="1" max="365"') + field('firstDue', 'First statement date', '', 'date', 'required') + authorizationFields(patient, 'these periodic statements and their notification emails'), 'Schedule authorized statements')}</details>` : ''
  return panel('Payment plans', (plans || empty('No payment plan.')) + create)
    + panel('Balance reminders', (reminders || empty('No scheduled balance reminders.')) + setup + statements)
}

export function paymentReviewPanel(s: any) {
  if (!desk(s) || !s.payments?.review) return ''
  const r = s.payments.review
  const accounts = r.accounts.map((a: any) => `<li><a href="/app/clients/${h(a.client_id)}">${h(a.first_name)} ${h(a.last_name)}</a> · ${money(a.balance_cents)} · ${h(a.age_days)} days</li>`).join('')
  const attention = r.attention.map((i: any) => `<li><a href="/app/clients/${h(i.client_id)}">${h(i.first_name)} ${h(i.last_name)}</a> · installment ${h(usDate(i.due_on, 'UTC'))} · ${h(i.failure ?? i.outcome ?? 'Check Stripe before taking any further payment')}</li>`).join('')
  const settings = s.actor.role === 'owner' ? form('pay.review.save', '/app/clinic', field('afterDays', 'Send balances to this human review list after (days)', r.afterDays, 'number', 'required min="1" max="3650"'), 'Save review age', true) : ''
  return panel('Balances for human review', `<p>Patient balances older than ${h(r.afterDays)} days appear here. Balm never sends accounts to collections.</p>${settings}${accounts ? `<ul class="plain">${accounts}</ul>` : empty('No aged balances need review.')}${attention ? `<h3>Payment plan charges to check</h3><ul class="plain">${attention}</ul>` : ''}`)
}

export function patientPaymentPlans(data: any) {
  const plans = data?.plans ?? [], reminders = data?.reminders ?? []
  if (!plans.length && !reminders.length) return ''
  const cards = plans.map((p: any) => `<article><h3>${money(p.amount_cents)} monthly for ${h(p.months)} months ${status(p.status)}</h3><p>${h(p.authorization_text)}</p><p>Authorization recorded for ${h(p.authorized_by)} on ${h(usDate(p.authorized_on, 'UTC'))}.</p>
    <ul class="plain">${p.installments.map((i: any) => `<li>${h(usDate(i.due_on, 'UTC'))} · ${money(i.amount_cents ?? p.amount_cents)} · ${status(i.status === 'review' ? 'Clinic is reviewing this payment' : i.status)}${i.payment_status === 'succeeded' ? ` · <a href="/portal/receipts/${h(i.payment_id)}.pdf">Receipt R-${String(i.receipt_number).padStart(6, '0')}</a>` : ''}</li>`).join('')}</ul>${p.stop_reason ? `<p>${h(p.stop_reason)}</p>` : ''}</article>`).join('')
  const notices = reminders.map((r: any) => `<p>${r.statement_mode === 1 ? 'Periodic statements with email notifications' : 'Balance reminder emails'} every ${h(r.every_days)} days · ${status(r.status)}${r.status === 'active' ? ` · next scheduled ${h(usDate(r.next_on, 'UTC'))}` : ''}.</p>`).join('')
  return panel('Your payment plans', cards + notices + '<p>Contact the clinic to stop future plan charges or balance reminders.</p>')
}
