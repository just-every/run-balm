import { patientPaymentPlans } from './payment-plans'
import { periodSuperbillForm } from './superbill-period'
import { localTime } from '../domain/invoices'
import { attachmentInput } from '../messages/attachments'
import { messageAttachments } from './messages'
import { h, hidden, money, select } from './shared'

export const patientForm = (name: string, fields: string, button: string, attrs = '') => `<form method="post" action="/portal/action">${hidden('name', name)}${fields}<button type="submit" ${attrs}>${h(button)}</button></form>`
const card = (id: string, title: string, body: string) => `<section id="${id}" class="card portal-section"><h2>${title}</h2>${body}</section>`

function exercises(d: any) {
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: d.clinic.time_zone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date())
  return d.exercises.map((e: any) => `<article class="exercise-row">${e.image ? `<img src="${h(e.image)}" alt="${h(e.title)} instruction image">` : ''}<div class="exercise-text"><h3>${h(e.title)}</h3><p class="reps">${h(e.sets)} sets × ${h(e.reps)} reps · ${h(e.frequency)}</p><p class="instructions">${h(e.instructions)}</p>${e.doneDates.length ? `<p class="completion">${e.doneDates.length} session${e.doneDates.length === 1 ? '' : 's'} logged · Last ${h(e.doneDates.at(-1))}</p>` : ''}</div><div class="row-actions">${e.doneDates.includes(today) ? '<span class="completed" role="status">✓ Done today</span>' : patientForm('exercise.done', hidden('id', e.id), 'Mark done')}</div></article>`).join('') || '<p>Your clinician has not assigned a home program yet.</p>'
}

function visits(d: any) {
  return d.upcoming.map((a: any) => `<article class="visit-item"><p class="eyebrow">Upcoming visit</p><h3>${h(localTime(a.start_at, d.clinic.time_zone))}</h3><p>${h(a.service)} with ${h(a.practitioner)}</p></article>`).join('') || '<p>No upcoming visits. Contact the clinic to arrange your next appointment.</p>'
}

function forms(d: any) {
  return d.intake.map((a: any) => `<article><h3>${h(a.service)}</h3><p>For ${h(localTime(a.startAt, d.clinic.time_zone))}</p>${patientForm('intake.open', hidden('appointmentId', a.appointmentId), 'Complete intake form')}</article>`).join('') || '<p>You have no intake forms to complete.</p>'
}

function statements(d: any) {
  const b = d.billing
  return `<p class="balance">${money(b.balanceCents)} <span>balance</span></p><p><a href="/portal/statement.pdf">Download statement PDF</a></p>`
    + (b.receipts.length ? `<h3>Receipts</h3><ul>${b.receipts.map((r: any) => `<li><a href="/portal/receipts/${h(r.id)}.pdf">Receipt ${h(r.receipt_number)} · ${money(r.amount_cents)}</a></li>`).join('')}</ul>` : '')
    + periodSuperbillForm('/portal/superbill.pdf')
    + (b.superbills.length ? `<h3>Superbills</h3><ul>${b.superbills.map((i: any) => `<li><a href="/portal/superbills/${h(i.id)}.pdf">Superbill for invoice ${h(i.number)}</a></li>`).join('')}</ul>` : '')
    + (b.block ? `<p>${h(b.block)}</p>` : patientForm('payment.open', hidden('purpose', 'balance'), 'Pay balance') + patientForm('payment.open', hidden('purpose', 'card'), 'Manage payment card'))
}

function messages(d: any) {
  const choices: [string, string][] = [...d.messageRecipients.map((r: any) => [r.id, r.name]), ['front_desk', 'Front desk — scheduling and billing']]
  return `<section class="card care" id="messages"><header class="care-header"><h2>Your care team</h2><p>Secure messages with ${h(d.clinic.clinic_name)}.</p></header><div class="thread">${d.messages.map((m: any) => `<article class="message ${m.sender === 'patient' ? 'self' : ''}"><span class="avatar" aria-hidden="true">${m.sender === 'patient' ? h(d.patient.firstName[0]) : 'B'}</span><div><h3 class="message-name">${h(m.authorName)}</h3><time>${h(localTime(m.sentAt, d.clinic.time_zone))}</time><p class="help">${m.route === 'front_desk' ? 'Front desk' : h(m.recipientName ?? 'Care team')}</p><p class="bubble">${h(m.body)}</p>${messageAttachments(m, '/portal/messages/attachments')}</div></article>`).join('') || '<p>No messages yet. Write to your clinic below.</p>'}</div><div class="composer"><form method="post" enctype="multipart/form-data" action="/portal/action">${hidden('name', 'message.send')}${select('recipient', 'Send to', choices, choices[0][0])}<label for="portal-message">Message your care team</label><textarea id="portal-message" name="body" required maxlength="10000" rows="4"></textarea>${attachmentInput}<button type="submit">Send secure message</button><p class="emergency">This inbox is not for emergencies. For an emergency, call 911. The clinic may not read messages immediately.</p></form></div></section>`
}

export function portalHomeContent(d: any) {
  return `<div class="columns"><div class="left">${card('visits', 'Your next visits', visits(d))}<section class="card program" id="program"><h2>Home exercise program</h2><p class="intro">Follow your clinician’s instructions. Mark each exercise done when you finish.</p>${exercises(d)}</section>${card('intake', 'Intake forms', forms(d))}${card('statements', 'Statements and payments', statements(d))}${patientPaymentPlans(d.paymentPlans)}${d.past.length ? card('past', 'Past visits', d.past.map((a: any) => `<article class="visit-item"><h3>${h(a.service)}</h3><p>${h(localTime(a.start_at, d.clinic.time_zone))} · ${h(a.status)}<br>${h(a.practitioner)}</p></article>`).join('')) : ''}</div>${messages(d)}</div>`
}
