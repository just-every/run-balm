import { accountEntriesPanel } from './account-entries'
import { clientRetentionPanel, retentionPreview } from './retention'
import { visitFeePanel } from './visit-policy'
import { clientPaymentPlans } from './payment-plans'
import { followupPanel } from './followups'
import { chartHistoryPanel } from './chart-history'
import { assignForm, episodeField, episodeLabel, episodesPanel } from './episodes'
import { alertBadges, clientAlertsPanel } from './alerts'
import { disclosuresPanel } from './disclosures'
import { careTeamPanel } from './care-team'
import { payerReference } from '../payments/ledger'
import { importedPanel } from './imported'
import { hostDateAt } from '../availability/timezone'
import { localTime } from '../domain/invoices'
import { seriesForm, seriesResult } from './series'
import { waitlistForm } from './waitlist'
import { notesPanel } from './notes'
import { measuresPanel } from './measures'
import { planResult, plansPanel } from './plans'
import { messagePanel } from './messages'
import { reminderPanel } from './reminders'
import { insurancePanels } from './insurance-file'
import { billingPanels } from './payments'
import { zoneLabel } from './time-zone'
import { avatar } from './shell'
import { check, cancelForm, clientName, desk, dollarsField, empty, entry, field, form, h, hidden, intakeChip, intakeLine, money, owner, panel, practitioners, result, rows, select, services, stamp, status, usDate, when, zoneOf } from './shared'

const clientFields = (c?: any) => `<div class="pair">${field('firstName', 'First name', c?.first_name, 'text', 'required maxlength="80"')}${field('lastName', 'Last name', c?.last_name, 'text', 'required maxlength="80"')}</div>`
  + `<div class="pair">${field('dateOfBirth', 'Date of birth', c?.date_of_birth ?? '', 'date')}${field('phone', 'Mobile', c?.phone ?? '', 'tel', 'maxlength="40" placeholder="+1 (312) 555-0100"')}</div>${field('email', 'Email', c?.email ?? '', 'email', 'maxlength="254"')}`

export function clientList(s: any) {
  const list = rows(s, 'clients').map(c => `<li>${avatar(clientName(c))}<a href="/app/clients/${h(c.id)}">${h(clientName(c))}</a>${c.date_of_birth ? ` <span class="help">born ${h(usDate(c.date_of_birth, zoneOf(s)))}</span>` : ''} ${c.created_via === 'import' ? status('Imported') : ''}</li>`).join('')
  const intro = desk(s) ? 'Every client of the clinic. Opening a file is recorded in its access audit.' : 'Clients you have appointments with. Opening a file is recorded in its access audit.'
  return `<h1>Clients</h1><p>${intro}</p><div class="grid">${panel('Client files', list ? `<ul class="plain client-list">${list}</ul>` : empty(desk(s) ? 'No clients yet. They appear when someone books online, when you add one, or after a move-in.' : 'No clients yet. Clients appear here once they are booked with you.'))}${desk(s) ? panel('Add a client', form('client.save', '/app/clients', clientFields(), 'Add client')) : ''}</div>`
}

export function bookingResult(s: any, notice: any) {
  const r = result(notice)
  if (!r?.appointmentId || r.seriesId || !r.intake) return ''
  const line = intakeLine(r, '', s.local, s.origin)
  return `<div class="notice" role="status"><strong>Appointment booked.</strong> ${h(line.text)}${line.link}</div>`
}

const priceOf = (s: any, a: any) => { const x = rows(s, 'services').find(x => x.id === a.service_id); return x ? money(x.price_cents) : '' }

function appointments(s: any, f: any, notice: any) {
  const path = `/app/clients/${f.client.id}`, invoiced = new Set((f.invoices ?? []).filter((i: any) => i.status !== 'void').map((i: any) => i.appointment_id))
  const list = f.appointments.map((a: any) => entry(`${a.service} with ${a.practitioner}`, `<p>${when(s, a.start_at)}<br>${status(a.status)} ${a.patient_response && a.patient_response !== 'awaiting' ? status(a.patient_response) : ''} ${intakeChip(a)}<br>${episodeLabel(f, a.episodeId)}${(a.medicareOverlaps ?? []).map((o: any) => `<br><span class="help" data-medicare-overlap="${h(o.other)}">Overlaps another Medicare patient’s visit; booked anyway by ${h(o.by)} ${stamp(s, o.at)}</span>`).join('')}</p><div class="actions">`
    + (desk(s) || a.practitioner_id === s.actor.staffId ? assignForm(f, 'visit', a.id, a.episodeId, path) : '')
    + (a.status === 'booked' && desk(s) && Date.parse(a.start_at) > Date.now() ? form('reminder.prepare', path, hidden('appointmentId', a.id), 'Prepare reminder text', true) : '')
    + (a.status === 'attended' && desk(s) && !invoiced.has(a.id) ? form('invoice.prepare', path, hidden('appointmentId', a.id) + field('amount', f.insuredCharges?.[a.id] ? `Amount ($, blank for ${f.insuredCharges[a.id].payer}’s fee schedule: ${money(f.insuredCharges[a.id].cents)})` : `Amount ($, blank for the service price${priceOf(s, a) ? ` of ${priceOf(s, a)}` : ''})`, '', 'text', 'inputmode="decimal" maxlength="12" placeholder="95.00"') + (f.insuredCharges?.[a.id] ? '<p class="help">The insurance claim must charge the same total as this invoice.</p>' : ''), 'Prepare invoice') : '')
    + (a.status === 'booked' && (desk(s) || a.practitioner_id === s.actor.staffId) ? `<p><a href="/app?${h(new URLSearchParams({ view: 'day', date: hostDateAt(new Date(a.start_at), s.settings.time_zone), appt: a.id }))}">Move or change in the calendar</a></p>` + cancelForm('appointment.cancel', path, hidden('id', a.id), 'Cancel appointment', 'Cancel visit', clientName(f.client)) : '')
    + visitFeePanel(s, a, path) + '</div>', `visit-${a.id}`)).join('')
  const choices = practitioners(s).filter(p => desk(s) || p.id === s.actor.staffId)
  const book = services(s).length && choices.length ? `<details><summary>Book an appointment</summary>${form('appointment.book', path, hidden('clientId', f.client.id) + episodeField(f)
    + select('practitionerId', 'Practitioner', choices.map(p => [p.id, p.name])) + select('serviceId', 'Service', services(s).map(x => [x.id, `${x.name} · ${x.duration_minutes} min`]))
    + (rows(s, 'rooms').length ? select('roomId', 'Room', [['', 'No room'], ...rows(s, 'rooms').filter(r => r.active === undefined || r.active).map(r => [r.id, r.name])] as [unknown, unknown][], '', '') : '')
    + (rows(s, 'equipment').length ? select('equipmentId', 'Equipment', [['', 'No equipment'], ...rows(s, 'equipment').filter(r => r.active === undefined || r.active).map(r => [r.id, r.name])] as [unknown, unknown][], '', '') : '')
    + `<div class="pair">${field('date', 'Date', '', 'date', 'required')}${field('time', 'Start time', '', 'time', 'required step="300"')}</div><p class="help">In the clinic's time zone (${h(s.settings.time_zone)}): any start time in 5-minute steps inside the practitioner's hours. Online booking offers patients quarter-hour times.</p>` + check('acknowledgeMedicareOverlap', 'Book anyway if this overlaps another Medicare patient with this practitioner (one-on-one timed codes cannot be billed for both over the same minutes; overlapping Medicare treatment bills as group therapy, 97150). Your name is kept on both visits.', ''), 'Book appointment')}</details>`
    + `<details${result(notice)?.preview ? ' open' : ''}><summary>Book recurring visits</summary>${seriesForm(s, path, { clientId: f.client.id, plans: f.plans })}</details>`
    + (f.client.email ? `<details><summary>Add to the waitlist</summary>${waitlistForm(s, path, hidden('clientId', f.client.id))}</details>` : '') : ''
  return panel('Appointments', seriesResult(s, notice, path) + (list || empty('No appointments yet.')) + book)
}

function intake(s: any, f: any) {
  if (f.intake === null) return panel('Intake forms', '<p>Intake answers are clinical: only the client’s practitioner and the owner read them.</p>')
  return panel('Intake forms', f.intake.map((r: any) => entry(`${r.formTitle} (version ${r.formNumber})`, `<p>Received ${stamp(s, r.submittedAt)}</p><dl class="answers">${r.questions.map((q: any) => `<dt>${h(q.label)}</dt><dd>${r.answers[q.id] === true ? 'Yes' : r.answers[q.id] === false ? 'No' : h(r.answers[q.id] ?? '—')}</dd>`).join('')}</dl>`, `intake-${r.id}`)).join('') || '<p class="empty">No intake form received yet.</p>')
}

export function invoiceEntry(s: any, i: any, path: string) {
  const v = i.snapshot, outstanding = i.amount_cents - i.paid_cents - (i.adjusted_cents ?? 0)
  const title = i.number ? `Invoice INV-${String(i.number).padStart(6, '0')}` : i.status === 'void' ? 'Earlier invoice preparation' : 'Prepared invoice'
  let actions = ''
  if (i.status === 'draft' && desk(s)) actions += form('invoice.approve', path, hidden('id', i.id) + '<label class="check"><input type="checkbox" required><span>I reviewed this exact invoice.</span></label>', 'Approve and number invoice')
  if (i.status === 'draft' && desk(s)) actions += `<details><summary>Prepare again from the current visit</summary><p>Use this after signing the visit note or correcting its details. The earlier preparation is retained, and the new draft needs your review and approval.</p>${form('invoice.prepare', path, hidden('appointmentId', i.appointment_id) + hidden('replacesId', i.id) + field('amount', 'Amount ($)', dollarsField(i.amount_cents), 'text', 'required inputmode="decimal" maxlength="12"'), 'Re-prepare invoice')}</details>`
  if (i.status === 'approved' && desk(s)) {
    actions += `<p><a href="/api/balm/invoices/${h(i.id)}.html">Download invoice</a></p>`
    if (outstanding > 0) actions += `<details><summary>Record a payment received</summary>${form('payment.record', path, hidden('invoiceId', i.id) + field('amount', 'Amount received ($)', dollarsField(outstanding), 'text', 'required inputmode="decimal" maxlength="12" placeholder="95.00"') + field('reference', 'Payment reference (unique)', '', 'text', 'required maxlength="120"'), 'Record payment')}</details>`
    if (!i.payments.length && !i.adjusted_cents && owner(s)) actions += `<details><summary>Void this invoice</summary>${form('invoice.void', path, hidden('id', i.id) + field('reason', 'Reason', '', 'text', 'required maxlength="300"'), 'Void invoice', true)}</details>`
  }
  return entry(title, `<p>${status(i.status)} ${i.attendance_started && i.status === 'draft' ? status('Started at attendance · awaiting review') : ''} ${i.status === 'approved' ? status(outstanding > 0 ? `${money(outstanding)} outstanding` : 'Paid') : ''}</p><p>${h(v.client.name)} · ${h(v.service.name)} · ${h(v.serviceDate)}<br>${h(v.practitioner.name)}${v.practitioner.providerNumber ? ` (provider ${h(v.practitioner.providerNumber)})` : ''} · <strong>${money(i.amount_cents)}</strong></p>`
    + `<p class="help">Prepared by ${h(i.prepared_by)} (${h(i.prepared_role)}) ${stamp(s, i.prepared_at)}${i.approved_by ? ` · approved by ${h(i.approved_by)} ${stamp(s, i.approved_at)}` : ''}${i.void_reason ? ` · void: ${h(i.void_reason)}` : ''}</p>`
    + (v.procedures ? `<p>CPT ${v.procedures.map((p: any) => `${h(p.code)} × ${h(p.units)}`).join(', ')} <span class="help">(units by ${h(v.timedUnitBasis?.method === 'ama' ? 'AMA/CPT per-service' : v.timedUnitBasis?.method === null ? 'CMS calculation pending payer method selection' : 'CMS 8-minute rule')}, from the signed note)</span></p>` : '')
    + (i.adjusted_cents ? `<p>Adjustments: ${money(i.adjusted_cents)}</p>` : '')
    + (i.payments.length ? `<ul class="plain">${i.payments.map((p: any) => `<li>${money(p.amount_cents)} · ${p.card_payment_id ? 'card payment through Stripe' : h(p.reference.startsWith('era:') ? 'Payer payment · ' + payerReference(p.reference) : p.reference)} · ${stamp(s, p.recorded_at)}</li>`).join('')}</ul>` : '') + actions, `invoice-${i.id}`)
}

/** Audit actions in words; the stored code stays in the archive and the JSON door. */
const auditWords: Record<string, string> = {
  'file.viewed': 'Opened the file', 'intake.read': 'Read intake answers', 'note.read': 'Read a treatment note', 'note.measured': 'Recorded an objective measure', 'note.measure_removed': 'Removed an objective measure', 'plan.read': 'Read a plan of care',
  'message.thread_read': 'Read secure messages', 'message.read': 'Patient read secure messages', 'agent.context': 'Agent read clinic context',
  'paylink.opened_at_desk': 'Opened a pay page at the desk', 'paylink.sent': 'Sent a pay link', 'sms.consent_recorded': 'Text consent recorded', 'sms.consent_removed': 'Text consent removed',
}
const auditAction = (code: string) => auditWords[code] ?? (code.replace(/[._]/g, ' ').replace(/^\w/, c => c.toUpperCase()))
const auditDetail = (s: any, value: unknown) => h(String(value ?? '')
  .replace(/(-?\d+) cents\b/g, (_, cents) => money(Number(cents)))
  .replace(/\d{4}-\d\d-\d\dT\d\d:\d\d(:\d\d(\.\d+)?)?Z/g, iso => localTime(iso, zoneOf(s))))

function auditEntry(s: any, a: any) {
  const records = [...a.records].sort((x: any, y: any) => y.sequence - x.sequence)
  const actions = new Map<string, number>()
  for (const r of records) actions.set(r.action, (actions.get(r.action) ?? 0) + 1)
  const labels = [...actions].map(([action, count]) => `<span title="${h(action)}">${h(auditAction(action))}${count > 1 ? ` × ${count}` : ''}</span>`).join('<br>')
  const detail = records.length === 1 ? auditDetail(s, records[0].detail) : `<details><summary>${records.length} access records</summary><ul class="plain">${records.map((r: any) => `<li>${stamp(s, r.at)} · ${h(auditAction(r.action))}${r.subject_id ? ` · record ${h(r.subject_id)}` : ''}${r.detail ? `<br>${auditDetail(s, r.detail)}` : ''}</li>`).join('')}</ul></details>`
  return `<tr><td data-label="When">${stamp(s, a.at)}${a.first_at !== a.at ? `<br><span class="help">Since ${stamp(s, a.first_at)}</span>` : ''}</td><td data-label="Who">${h(a.actor_email)}<br><span class="help">${h(a.actor_role)}</span></td><td data-label="Action">${labels}</td><td data-label="Detail">${detail}</td></tr>`
}

function auditPanel(s: any, f: any) {
  if (!f.audit) return ''
  const pg = f.auditEntriesPage, path = `/app/clients/${f.client.id}`, shown = f.auditEntries.length
  const range = pg.before ? `Older activity, ${shown} entries shown` : `${shown} ${pg.older ? 'newest ' : ''}${shown === 1 ? 'entry' : 'entries'} · ${f.auditPage.total} underlying records`
  const pager = `<nav class="pager" aria-label="Access audit pages"><span class="help">${range}. Times are in ${h(zoneLabel(zoneOf(s)))}.</span>${pg.before ? `<a href="${h(path)}#audit">Newest entries</a>` : ''}${pg.older ? `<a href="${h(path)}?auditBefore=${h(pg.older)}#audit">Older entries</a>` : ''}</nav>`
  return panel('Access audit', `<p id="audit">Every opening, clinical read, change and download is kept. Consecutive reads by the same person are grouped until a change, another reader or a five-minute pause; expand an entry for each original time and record. Changes and downloads have their own entries. Newest first, ${pg.size} entries to a page. Your own view is recorded too.</p>${pager}<div class="table"><table class="audit-table"><thead><tr><th>When</th><th>Who</th><th>Action</th><th>Detail</th></tr></thead><tbody>${f.auditEntries.map((a: any) => auditEntry(s, a)).join('')}</tbody></table></div>${pg.older || pg.before ? pager : ''}`, 'full')
}

export function clientFilePage(s: any, f: any, notice: any) {
  const c = f.client, path = `/app/clients/${c.id}`
  const details = `<p>${c.date_of_birth ? `Born ${h(usDate(c.date_of_birth, zoneOf(s)))}<br>` : ''}${c.email ? `${h(c.email)}<br>` : ''}${c.phone ? `${h(c.phone)}<br>` : ''}Added ${stamp(s, c.created_at)} (${h(c.created_via)})</p>`
    + (desk(s) ? `<details><summary>Edit details</summary>${form('client.save', path, hidden('id', c.id) + hidden('version', c.version) + clientFields(c), 'Save details')}</details>` : '')
    + (owner(s) ? `<details><summary>Erase this client</summary><p>Only a client with no appointments, intake, notes, invoices, card payments, card on file or import history can be erased. Health records are retained.</p>${form('client.erase', '/app/clients', hidden('id', c.id) + '<label class="check"><input type="checkbox" required><span>I understand this erases the client’s personal details.</span></label>', 'Erase client', true)}</details>` : '')
  const age = c.date_of_birth ? Math.floor((Date.now() - Date.parse(c.date_of_birth + 'T12:00:00Z')) / (365.2425 * 86400_000)) : null
  const payer = f.insurance?.policies?.[0]?.payer_name ?? (f.insurance ? 'Self-pay' : '')
  // CHART-013 care-team access alone: the notes, chart history and how this chart was opened.
  if (f.careAccess?.teamOnly) return `<header class="file-head">${avatar(clientName(c), 'lg')}<div><h1>${h(c.first_name)} ${h(c.last_name)}</h1></div></header><div class="grid">${careTeamPanel(s, f)}${chartHistoryPanel(s, f)}${notesPanel(s, f, notice.ask) + measuresPanel(s, f)}</div>`
  return `<header class="file-head">${avatar(clientName(c), 'lg')}<div><h1>${h(c.first_name)} ${h(c.last_name)}</h1><p class="help">${[age !== null ? `${age} · born ${usDate(c.date_of_birth, zoneOf(s))}` : '', payer].filter(Boolean).map(h).join(' · ')}</p></div></header>${alertBadges(f.alerts)}${bookingResult(s, notice)}${planResult(s, notice)}<div class="grid">${retentionPreview(s, notice)}${clientRetentionPanel(s, f)}${panel('Details', details)}${careTeamPanel(s, f)}${episodesPanel(s, f)}${appointments(s, f, notice)}${clientAlertsPanel(s, f, path)}${insurancePanels(s, f, notice)}${plansPanel(s, f)}${intake(s, f)}${intakeChartPanel({ ...s, file: f }, f.intakeDocuments)}${chartHistoryPanel(s, f)}${notesPanel(s, f, notice.ask) + measuresPanel(s, f)}${f.invoices ? panel('Invoices', f.invoices.map((i: any) => invoiceEntry(s, i, path)).join('') || empty('No invoices yet. Mark an appointment attended, then prepare its invoice.')) : ''}${importedPanel(f)}${billingPanels(s, f, notice)}${accountEntriesPanel(s, f)}${clientPaymentPlans(s, f)}${portalChartPanel(s, f)}${reminderPanel(s, f)}${followupPanel(s, f)}${messagePanel(s, f, notice)}${disclosuresPanel(s, f, path)}${auditPanel(s, f)}</div>`
}
import { portalChartPanel } from './portal-chart'
import { intakeChartPanel } from './intake-chart'
