import {pt} from './portal-language'
import {guardianPatientPanel,patientProfilePanel} from './portal-profile'
import { patientRecordPanel } from './portal-records'
import { patientPaymentPlans } from './payment-plans'
import { periodSuperbillForm } from './superbill-period'
import { localTime } from '../domain/invoices'
import { attachmentInput } from '../messages/attachments'
import { messageAttachments } from './messages'
import { h, hidden, money, select, usDate } from './shared'

export const patientForm = (name: string, fields: string, button: string, attrs = '') => `<form method="post" action="/portal/action">${hidden('name', name)}${fields}<button type="submit" ${attrs}>${h(button)}</button></form>`
const card = (id: string, title: string, body: string) => `<section id="${id}" class="card portal-section"><h2>${title}</h2>${body}</section>`

function exercises(d: any) {
  const today = new Intl.DateTimeFormat('en-CA', {timeZone:d.clinic.time_zone,year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date())
  return d.exercises.map((e:any)=>{
    const dosage=`${h(e.sets)} ${pt(d,'sets')} × ${h(e.reps)} ${pt(d,'reps')} · ${h(e.frequency)} · ${pt(d,'Hold')} ${h(e.holdSeconds??0)} ${pt(d,'seconds')}`
    const fields=hidden('id',e.id)+`<label>${pt(d,'Session date')}<input name="day" type="date" value="${h(today)}" max="${h(today)}" required></label><label>${pt(d,'Pain (0–10, optional)')}<input name="pain" type="number" min="0" max="10" step="1"></label>`
    return `<article class="exercise-row">${e.image?`<img src="${h(e.image)}" alt="${h(d.language==='es'&&e.titleEs?e.titleEs:e.title)} instruction image">`:''}<div class="exercise-text"><h3>${h(d.language==='es'&&e.titleEs?e.titleEs:e.title)}</h3><p class="reps">${dosage}</p><p class="instructions">${h(d.language==='es'&&e.instructionsEs?e.instructionsEs:e.instructions)}</p>${e.license?`<p class="help">${h(e.license)} · ${h(e.source)}</p>`:''}${e.doneDates.length?`<p class="completion">${e.doneDates.length} sessions logged · ${h(e.doneDates.at(-1))}</p>`:''}</div><div class="row-actions">${e.doneDates.includes(today)?`<span class="completed" role="status">✓ ${pt(d,'Done today')}</span>`:''}${patientForm('exercise.done',fields,pt(d,'Mark done'))}</div></article>`
  }).join('')||`<p>${pt(d,'Your clinician has not assigned a home program yet.')}</p>`
}

function visits(d: any) {
  const upcoming = d.upcoming.map((a: any) => `<article class="visit-item"><p class="eyebrow">Upcoming visit</p><h3>${h(localTime(a.start_at, d.clinic.time_zone))}</h3><p>${h(a.service)} with ${h(a.practitioner)}</p>`
    + (a.canMove ? `<p><a href="/portal/appointments/${h(encodeURIComponent(a.id))}/move">Move this visit</a></p>` : '')
    + (a.canCancel ? `<details class="confirm"><summary>Cancel this visit</summary>${patientForm('appointment.cancel', hidden('id', a.id) + '<label>Reason for cancellation<input name="reason" required maxlength="500"></label><label class="check"><input type="checkbox" name="confirm" value="on" required><span>Yes, cancel this appointment.</span></label>', 'Cancel my appointment')}</details>` : '')
    + (!a.canMove || !a.canCancel ? '<p class="help">If you cannot change or cancel this visit online, contact the clinic.</p>' : '') + '</article>').join('')
  return (upcoming || '<p>No upcoming visits.</p>') + '<p><a href="/portal/schedule">Book a follow-up</a></p>'
}

function forms(d: any) {
  return d.intake.map((a: any) => `<article><h3>${h(a.service)}</h3><p>For ${h(localTime(a.startAt, d.clinic.time_zone))}</p>${patientForm('intake.open', hidden('appointmentId', a.appointmentId), pt(d,'Complete intake form'))}</article>`).join('') || '<p>You have no intake forms to complete.</p>'
}

function statements(d: any) {
  const b = d.billing
  return `<p class="balance">${money(b.balanceCents)} <span>${pt(d,'balance')}</span></p><p><a href="/portal/statement.pdf">${pt(d,'Download statement PDF')}</a></p>`
    + (b.estimates?.length ? `<h3>Good Faith Estimates</h3><ul>${b.estimates.map((e:any)=>`<li><a href="/portal/estimates/${h(e.id)}.pdf">Estimate · ${money(e.total_cents)} · ${h(usDate(e.from_on,'UTC'))}</a>${e.disputeFlag?'<p>This practice’s billed charges are at least $400 above its estimated charges. Contact the clinic to review your bill; see the estimate for federal dispute information.</p>':''}</li>`).join('')}</ul>` : '')
    + (b.payerEstimates?.length ? `<h3>Payer estimates</h3><p>These are originals supplied by your payer. Contact the payer or clinic about the benefit details; an estimate is not a guarantee of payment.</p><ul>${b.payerEstimates.map((e:any)=>`<li><a href="/portal/aeobs/${h(e.id)}.pdf">${h(e.snapshot.payer)} · ${h(e.source_reference)} · ${h(usDate(e.source_date,'UTC'))}</a></li>`).join('')}</ul>` : '')
    + (b.issuedStatements?.length ? `<h3>Issued statements</h3><ul>${b.issuedStatements.map((i: any) => `<li><a href="/portal/statements/${h(i.id)}.pdf">Statement ${h(usDate(i.due_on, 'UTC'))} · ${money(i.amount_cents)}</a></li>`).join('')}</ul>` : '')
    + (b.receipts.length ? `<h3>Receipts</h3><ul>${b.receipts.map((r: any) => `<li><a href="/portal/receipts/${h(r.id)}.pdf">Receipt ${h(r.receipt_number)} · ${money(r.amount_cents)}</a></li>`).join('')}</ul>` : '')
    + periodSuperbillForm('/portal/superbill.pdf')
    + (b.superbills.length ? `<h3>Superbills</h3><ul>${b.superbills.map((i: any) => `<li><a href="/portal/superbills/${h(i.id)}.pdf">Superbill for invoice ${h(i.number)}</a></li>`).join('')}</ul>` : '')
    + (b.block ? `<p>${h(b.block)}</p>` : patientForm('payment.open', hidden('purpose', 'balance'), pt(d,'Pay balance')) + patientForm('payment.open', hidden('purpose', 'card'), pt(d,'Manage payment card')))
}

function messages(d: any) {
  const choices: [string, string][] = [...d.messageRecipients.map((r: any) => [r.id, r.name]), ['front_desk', 'Front desk — scheduling and billing']]
  return `<section class="card care" id="messages"><header class="care-header"><h2>${pt(d,'Your care team')}</h2><p>Secure messages with ${h(d.clinic.clinic_name)}.</p></header><div class="thread">${d.messages.map((m: any) => `<article class="message ${m.sender === 'patient' ? 'self' : ''}"><span class="avatar" aria-hidden="true">${m.sender === 'patient' ? h(d.patient.firstName[0]) : 'B'}</span><div><h3 class="message-name">${h(m.authorName)}</h3><time>${h(localTime(m.sentAt, d.clinic.time_zone))}</time><p class="help">${m.route === 'front_desk' ? 'Front desk' : h(m.recipientName ?? 'Care team')}</p><p class="bubble">${h(m.body)}</p>${messageAttachments(m, '/portal/messages/attachments')}</div></article>`).join('') || '<p>No messages yet. Write to your clinic below.</p>'}</div><div class="composer"><form method="post" enctype="multipart/form-data" action="/portal/action">${hidden('name', 'message.send')}${select('recipient', 'Send to', choices, choices[0][0])}<label for="portal-message">${pt(d,'Message your care team')}</label><textarea id="portal-message" name="body" required maxlength="10000" rows="4"></textarea>${attachmentInput}<button type="submit">${pt(d,'Send secure message')}</button><p class="emergency">${pt(d,'This inbox is not for emergencies. For an emergency, call 911. The clinic may not read messages immediately.')}</p></form></div></section>`
}

export function portalHomeContent(d: any) {
  return `<div class="columns"><div class="left">${guardianPatientPanel(d)}${card('visits', pt(d,'Your next visits'), visits(d))}<section class="card program" id="program"><h2>${pt(d,'Home exercise program')}</h2><p class="intro">${pt(d,'Follow your clinician’s instructions. Mark each exercise done when you finish.')}</p><p><a href="/portal/program.pdf">${pt(d,'Download printable program PDF')}</a></p>${exercises(d)}</section>${card('intake', pt(d,'Intake forms'), forms(d))}${card('statements', pt(d,'Statements and payments'), statements(d))}${patientPaymentPlans(d.paymentPlans)}${patientProfilePanel(d)}${patientRecordPanel(d)}${d.past.length ? card('past', pt(d,'Past visits'), d.past.map((a: any) => `<article class="visit-item"><h3>${h(a.service)}</h3><p>${h(localTime(a.start_at, d.clinic.time_zone))} · ${h(a.status)}<br>${h(a.practitioner)}</p></article>`).join('')) : ''}</div>${messages(d)}</div>`
}
