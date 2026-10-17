import { hostDateAt } from '../availability/timezone'
import { localTime } from '../domain/invoices'
import { seriesForm, seriesResult } from './series'
import { waitlistForm } from './waitlist'
import { notesPanel } from './notes'
import { planResult, plansPanel } from './plans'
import { billingPanels } from './payments'
import { emptyFolder, icons } from './icons'
import { avatar, cancelForm, clientName, desk, empty, entry, field, form, h, hidden, money, owner, panel, practitioners, result, rows, select, services, stamp, status, usDate, when, zoneOf } from './shared'

const clientFields = (c?: any) => `<div class="pair">${field('firstName', 'First name', c?.first_name, 'text', 'required maxlength="80"')}${field('lastName', 'Last name', c?.last_name, 'text', 'required maxlength="80"')}</div>`
  + `<div class="pair">${field('dateOfBirth', 'Date of birth', c?.date_of_birth ?? '', 'date')}${field('phone', 'Mobile', c?.phone ?? '', 'text', 'maxlength="40"')}</div>${field('email', 'Email', c?.email ?? '', 'email', 'maxlength="254"')}`

export function clientList(s: any) {
  const list = rows(s, 'clients').map(c => `<li>${avatar(clientName(c))}<a href="/app/clients/${h(c.id)}">${h(clientName(c))}</a>${c.created_via === 'import' ? status('Imported') : ''}${c.date_of_birth ? ` <span class="help">born ${h(c.date_of_birth)}</span>` : ''}</li>`).join('')
  const intro = desk(s) ? 'Every client of the clinic. Opening a file is recorded in its access audit.' : 'Clients you have appointments with. Opening a file is recorded in its access audit.'
  const none = desk(s) ? `<div class="empty-state">${emptyFolder}<p>No clients yet. They appear when someone books online, when you add one, or after a move-in.</p><p class="links"><a href="/book">Share your booking page /book</a>${owner(s) ? '<a href="/app/import">Move in from Cliniko</a>' : ''}</p></div>`
    : `<div class="empty-state">${emptyFolder}<p>No clients yet. Clients appear here once they are booked with you.</p></div>`
  return `<h1>Clients</h1><p>${intro}</p><div class="clients-grid">${panel('Client files', list ? `<ul class="client-list">${list}</ul>` : none)}${desk(s) ? panel('Add a client', form('client.save', '/app/clients', clientFields(), 'Add client')) : ''}</div>`
}

export function bookingResult(notice: any) {
  const r = result(notice)
  if (!r?.token || r.seriesId || !r.appointmentId) return ''
  const mail = r.mail === 'sent' ? 'The intake link was emailed to the client.' : r.mail === 'no_email' ? 'The client has no email address: give them this link yourself.' : 'Mail is not configured: give the client this link yourself.'
  return `<div class="notice" role="status"><strong>Appointment booked.</strong> ${h(mail)} Private intake link (shown once): <a href="/intake/${h(r.token)}">/intake/${h(r.token)}</a></div>`
}

function appointments(s: any, f: any, notice: any) {
  const path = `/app/clients/${f.client.id}`, invoiced = new Set((f.invoices ?? []).filter((i: any) => i.status !== 'void').map((i: any) => i.appointment_id))
  const list = f.appointments.map((a: any) => `<article class="entry appt-row"><p class="when">${when(s, a.start_at)}</p><div><h3>${h(a.service)} with ${h(a.practitioner)}</h3><p class="chips">${status(a.status)} ${a.intake_received ? status('Intake received') : status('No intake yet')}</p></div><div class="actions">`
    + (a.status === 'booked' && desk(s) && Date.parse(a.start_at) > Date.now() ? form('reminder.prepare', path, hidden('appointmentId', a.id), 'Prepare reminder text', true) : '')
    + (a.status === 'attended' && desk(s) && !invoiced.has(a.id) ? form('invoice.prepare', path, hidden('appointmentId', a.id) + field('amountCents', 'Amount in cents (blank for the service price)', '', 'number', 'min="0" step="1"'), 'Prepare invoice') : '')
    + (a.status === 'booked' && (desk(s) || a.practitioner_id === s.actor.staffId) ? `<p><a href="/app?${h(new URLSearchParams({ view: 'day', date: hostDateAt(new Date(a.start_at), s.settings.time_zone), appt: a.id }))}">Move or change in the calendar</a></p>` + cancelForm('appointment.cancel', path, hidden('id', a.id), 'Cancel appointment', 'Cancel visit', clientName(f.client)) : '')
    + '</div></article>').join('')
  const choices = practitioners(s).filter(p => desk(s) || p.id === s.actor.staffId)
  const book = services(s).length && choices.length ? `<details><summary>Book an appointment</summary>${form('appointment.book', path, hidden('clientId', f.client.id)
    + select('practitionerId', 'Practitioner', choices.map(p => [p.id, p.name])) + select('serviceId', 'Service', services(s).map(x => [x.id, `${x.name} · ${x.duration_minutes} min`]))
    + (rows(s, 'rooms').length ? select('roomId', 'Room', [['', 'No room'], ...rows(s, 'rooms').filter(r => r.active === undefined || r.active).map(r => [r.id, r.name])] as [unknown, unknown][], '', '') : '')
    + `<div class="pair">${field('date', 'Date', '', 'date', 'required')}${field('time', 'Start time', '', 'time', 'required step="300"')}</div><p class="help">In the clinic's time zone (${h(s.settings.time_zone)}), inside the practitioner's hours.</p>`, 'Book appointment')}</details>`
    + `<details${result(notice)?.preview ? ' open' : ''}><summary>Book recurring visits</summary>${seriesForm(s, path, { clientId: f.client.id })}</details>`
    + (f.client.email ? `<details><summary>Add to the waitlist</summary>${waitlistForm(s, path, hidden('clientId', f.client.id))}</details>` : '') : ''
  return panel('Appointments', seriesResult(s, notice, path) + (list || empty('No appointments yet.')) + book)
}

function intake(s: any, f: any) {
  if (f.intake === null) return panel('Intake forms', '<p>Intake answers are clinical: only the client’s practitioner and the owner read them.</p>')
  return panel('Intake forms', f.intake.map((r: any) => entry(`${r.formTitle} (version ${r.formNumber})`, `<p>Received ${stamp(s, r.submittedAt)}</p><dl class="answers">${r.questions.map((q: any) => `<dt>${h(q.label)}</dt><dd>${r.answers[q.id] === true ? 'Yes' : r.answers[q.id] === false ? 'No' : h(r.answers[q.id] ?? '—')}</dd>`).join('')}</dl>`)).join('') || '<p class="empty">No intake form received yet.</p>')
}

export function invoiceEntry(s: any, i: any, path: string) {
  const v = i.snapshot, outstanding = i.amount_cents - i.paid_cents
  const title = i.number ? `Invoice INV-${String(i.number).padStart(6, '0')}` : 'Prepared invoice'
  let actions = ''
  if (i.status === 'draft' && desk(s)) actions += form('invoice.approve', path, hidden('id', i.id) + '<label class="check"><input type="checkbox" required><span>I reviewed this exact invoice.</span></label>', 'Approve and number invoice')
  if (i.status === 'approved' && desk(s)) {
    actions += `<p><a href="/api/balm/invoices/${h(i.id)}.html">Download invoice</a></p>`
    if (outstanding > 0) actions += `<details><summary>Record a payment received</summary>${form('payment.record', path, hidden('invoiceId', i.id) + field('amountCents', 'Amount received in cents', outstanding, 'number', 'required min="1" step="1"') + field('reference', 'Payment reference (unique)', '', 'text', 'required maxlength="120"'), 'Record payment')}</details>`
    if (!i.payments.length && owner(s)) actions += `<details><summary>Void this invoice</summary>${form('invoice.void', path, hidden('id', i.id) + field('reason', 'Reason', '', 'text', 'required maxlength="300"'), 'Void invoice', true)}</details>`
  }
  return entry(title, `<p>${status(i.status)} ${i.status === 'approved' ? status(outstanding > 0 ? `${money(outstanding)} outstanding` : 'Paid') : ''}</p><p>${h(v.client.name)} · ${h(v.service.name)} · ${h(v.serviceDate)}<br>${h(v.practitioner.name)}${v.practitioner.providerNumber ? ` (provider ${h(v.practitioner.providerNumber)})` : ''} · <strong>${money(i.amount_cents)}</strong></p>`
    + `<p class="help">Prepared by ${h(i.prepared_by)} (${h(i.prepared_role)}) ${stamp(s, i.prepared_at)}${i.approved_by ? ` · approved by ${h(i.approved_by)} ${stamp(s, i.approved_at)}` : ''}${i.void_reason ? ` · void: ${h(i.void_reason)}` : ''}</p>`
    + (v.procedures ? `<p>CPT ${v.procedures.map((p: any) => `${h(p.code)} × ${h(p.units)}`).join(', ')} <span class="help">(units by the 8-minute rule, from the signed note)</span></p>` : '')
    + (i.payments.length ? `<ul class="plain">${i.payments.map((p: any) => `<li>${money(p.amount_cents)} · ${p.card_payment_id ? 'card payment through Stripe' : h(p.reference)} · ${stamp(s, p.recorded_at)}</li>`).join('')}</ul>` : '') + actions)
}

function auditPanel(s: any, f: any) {
  if (!f.audit) return ''
  return panel('Access audit', `<p>Every opening of this file, every read of intake answers and notes, every change and every download, newest first. Your own view of this page is recorded too.</p><div class="table"><table><thead><tr><th>When</th><th>Who</th><th>Action</th><th>Detail</th></tr></thead><tbody>${f.audit.map((a: any) => `<tr><td>${stamp(s, a.at)}</td><td>${h(a.actor_email)}<br><span class="help">${h(a.actor_role)}</span></td><td>${h(a.action)}</td><td>${h(String(a.detail ?? '').replace(/\d{4}-\d\d-\d\dT\d\d:\d\d(:\d\d(\.\d+)?)?Z/g, iso => localTime(iso, zoneOf(s))))}</td></tr>`).join('')}</tbody></table></div>`, 'full')
}

export function clientFilePage(s: any, f: any, notice: any) {
  const c = f.client, path = `/app/clients/${c.id}`
  const fact = (icon: string, text: string) => `<li>${icon}<span>${text}</span></li>`
  const details = `<ul class="facts-list">${c.date_of_birth ? fact(icons.calendar, `Born ${h(usDate(c.date_of_birth, zoneOf(s)))}`) : ''}${c.email ? fact(icons.mail, h(c.email)) : ''}${c.phone ? fact(icons.phone, h(c.phone)) : ''}${fact(icons.clock, `Added ${stamp(s, c.created_at)} (${h(c.created_via)})`)}</ul>`
    + (desk(s) ? `<details><summary>Edit details</summary>${form('client.save', path, hidden('id', c.id) + hidden('version', c.version) + clientFields(c), 'Save details')}</details>` : '')
    + (owner(s) ? `<details><summary>Erase this client</summary><p>Only a client with no appointments, intake, notes, invoices, card payments, card on file or import history can be erased. Health records are retained.</p>${form('client.erase', '/app/clients', hidden('id', c.id) + '<label class="check"><input type="checkbox" required><span>I understand this erases the client’s personal details.</span></label>', 'Erase client', true)}</details>` : '')
  const billing = billingPanels(s, f, notice)
  const invoices = f.invoices ? panel('Invoices', f.invoices.map((i: any) => invoiceEntry(s, i, path)).join('') || empty('No invoices yet. Mark an appointment attended, then prepare its invoice.')) : ''
  // Facts on the left; the visits, notes and money of the file on the right; the audit under both.
  return `<a class="back" href="/app/clients">All clients</a><div class="file-title">${avatar(clientName(c), 'big')}<h1>${h(c.first_name)} ${h(c.last_name)}</h1></div>${bookingResult(notice)}${planResult(notice)}${billing.notice}`
    + `<div class="file"><div class="file-side">${panel('Details', details)}${plansPanel(s, f)}${billing.side}</div><div class="file-main">${appointments(s, f, notice)}${intake(s, f)}${notesPanel(s, f, notice.ask)}${invoices}${billing.main}</div></div>${auditPanel(s, f)}`
}
