import { localTime } from '../domain/invoices'
import { smsNotSetUp } from '../sms'
import { empty, entry, field, form, h, hidden, panel, select, stamp, status, when } from './shared'

export function reminderSettingsPanel(s: any) {
  const r = s.reminders
  if (!r) return ''
  return panel('Automatic visit reminders', '<p>Balm emails these reminders to patients itself, on this schedule, without an approval step. Moved visits get a new schedule; canceled visits stop their reminders. Patients confirm or ask for a new time from the email’s private link. (A reminder prepared under <a href="/app/invoices">Invoices and reminders</a> is different: Balm never sends that one; you download it and send it yourself.)</p>'
    + form('reminders.settings', '/app/clinic', field('leadMinutes', 'Minutes before the visit (up to three, separated by commas)', JSON.parse(r.reminder_leads).join(', '), 'text', 'placeholder="1440, 120"')
      + '<p class="help">1440 is one day; 120 is two hours. Leave empty to turn reminders off. Each time sends one reminder. A visit booked after one or more of these times has passed gets a single reminder at the next minute, never two at once, and the later times still send on schedule.</p>'
      + `<label class="check"><input type="checkbox" name="sms"${r.reminder_sms ? ' checked' : ''}${r.smsBlocked ? ' disabled' : ''}><span>Also text patients who have given consent</span></label>`
      + `<p class="help">${r.smsBlocked === smsNotSetUp ? `${h(r.smsBlocked)} <a href="https://run-balm.com/docs/deploy#the-settings">Texting settings in the deploy guide</a>.` : r.smsBlocked ? h(r.smsBlocked) : 'Texts use the clinic’s registered SMS provider. Record patient consent on their file.'}</p>`, 'Save reminder schedule'))
}

const deliveryLabels: Record<string, string> = { accepted: 'Accepted by mail provider; delivery not yet reported', delivered: 'Delivered to the receiving mail server', deferred: 'Delivery delayed', bounced: 'Delivery bounced', failed: 'Delivery failed', rejected: 'Delivery rejected', complained: 'Recipient reported spam', uncertain: 'Provider outcome unknown; contact the patient before resending', suppressed: 'Not sent: email is suppressed on this install', no_email: 'Not sent: no email address', unavailable: 'Not sent: mail provider is not configured' }
const mailKinds: Record<string, string> = { booking: 'Booking confirmation', intake: 'Booking confirmation and intake link', moved: 'Appointment changed', cancelled: 'Appointment canceled', reminder: 'Appointment reminder' }

export function reminderPanel(s: any, f: any) {
  const history = f.reminderHistory ?? [], mail = f.mailHistory ?? [], path = `/app/clients/${f.client.id}`
  const deliveries = mail.map((r: any) => entry(`${mailKinds[r.kind] ?? 'Appointment email'} · Email${r.lead_minutes ? ` · ${r.lead_minutes} minutes before` : ''}`, `<p>${stamp(s, r.created_at)}<br>${status(r.state)}</p><p class="help">${h(deliveryLabels[r.state] ?? r.state)}${r.delivery_at ? `<br>Provider event ${stamp(s, new Date(r.delivery_at).toISOString())}` : ''}</p>`)).join('')
  // Legacy email rows and SMS stay readable; current email attempts have the full provider history above.
  const list = history.filter((r: any) => r.channel !== 'email' || !mail.some((m: any) => m.id === r.id)).map((r: any) => entry(`${r.channel === 'email' ? 'Email' : 'Text'} reminder · ${r.lead_minutes} minutes before`, `<p>${when(s, r.start_at)}<br>${status(r.state === 'failed' && r.outcome?.startsWith('Not sent:') ? 'Not sent' : r.state)} · Due ${stamp(s, r.due_at)}${r.sent_at ? `<br>Submitted ${stamp(s, r.sent_at)}` : ''}</p><p class="help">${h(r.outcome)}</p>`)).join('')
  const consent = s.actor.role === 'owner' || s.actor.staffRole === 'reception' ? form('reminders.consent', path, hidden('clientId', f.client.id)
    + `<label class="check"><input type="checkbox" name="consent"${f.client.sms_reminder_consent ? ' checked' : ''}><span>The patient agreed to receive visit reminders by text</span></label>`, 'Save text consent', true) : ''
  return panel('Appointment email and reminder deliveries', (s.local ? '<p>Balm on this computer sends no email. Attempts are kept below as not sent.</p>' : '<p>Provider acceptance is separate from delivery. Delivered means the receiving mail server accepted the message; it does not prove the patient read it. Unknown submissions are never sent again automatically.</p>') + (deliveries + list || empty('No appointment email or reminder deliveries yet. Balm checks upcoming visits every minute.')) + consent)
}

export function visitReplyPage(data: any) {
  const a = data.appointment, s = { settings: { time_zone: a.time_zone } }
  return `<h1>Your appointment</h1><p>${h(a.clinic_name)}<br>${when(s, a.start_at)}</p>`
    + (a.patient_response === 'confirmed' ? '<div class="notice" role="status">Your visit is confirmed. The clinic can see your confirmation.</div>' : a.patient_response === 'change_requested' ? '<div class="notice" role="status">Your request for a new time is saved. The clinic will contact you; your current time stays booked until it is changed.</div>' : '<p>Let the clinic know in one reply.</p>')
    + (data.reschedule ? `<details><summary>Choose a new appointment time</summary>${data.reschedule.canMove ? `<p>Choose a time at least ${h(data.reschedule.policy.noticeHours)} hours ahead. Your visit and intake stay on the same record.</p><form method="post" action="/visit/${h(data.token)}">${hidden('action', 'move')}${select('start', 'Available appointment times', data.reschedule.slots.map((slot: any) => [slot.startAt, localTime(slot.startAt, a.time_zone)]))}<button type="submit">Move my appointment</button></form><p><a href="/visit/${h(data.token)}?from=${h(data.reschedule.next)}">Next week</a></p>` : `<p>Contact the clinic to change this visit inside the ${h(data.reschedule.policy.noticeHours)}-hour notice window.</p>`}</details>` : '')
    + `<form method="post" action="/visit/${h(data.token)}"><div class="actions"><button name="reply" value="confirmed">Confirm my visit</button><button class="secondary" name="reply" value="change_requested">Ask for a new time</button></div></form><p class="help">This private link works until your visit starts. If the clinic moves or cancels it, this link stops working.</p>`
}
