import { empty, entry, field, form, h, hidden, panel, stamp, status, when } from './shared'

export function reminderSettingsPanel(s: any) {
  const r = s.reminders
  if (!r) return ''
  return panel('Automatic visit reminders', '<p>Balm emails reminders on this schedule, without an approval step. Moved visits get a new schedule; canceled visits stop their reminders. Patients confirm or ask for a new time from the email’s private link.</p>'
    + form('reminders.settings', '/app/clinic', field('leadMinutes', 'Minutes before the visit (up to three, separated by commas)', JSON.parse(r.reminder_leads).join(', '), 'text', 'placeholder="1440, 120"')
      + '<p class="help">1440 is one day; 120 is two hours. Leave empty to turn reminders off. Newly booked visits inside a lead time are reminded at the next minute.</p>'
      + `<label class="check"><input type="checkbox" name="sms"${r.reminder_sms ? ' checked' : ''}${r.smsBlocked ? ' disabled' : ''}><span>Also text patients who have given consent</span></label>`
      + `<p class="help">${h(r.smsBlocked ?? 'Texts use the clinic’s registered SMS provider. Record patient consent on their file.')}</p>`, 'Save reminder schedule'))
}

export function reminderPanel(s: any, f: any) {
  const history = f.reminderHistory ?? [], path = `/app/clients/${f.client.id}`
  const list = history.map((r: any) => entry(`${r.channel === 'email' ? 'Email' : 'Text'} reminder · ${r.lead_minutes} minutes before`, `<p>${when(s, r.start_at)}<br>${status(r.state)} · Due ${stamp(s, r.due_at)}${r.sent_at ? `<br>Sent ${stamp(s, r.sent_at)}` : ''}</p><p class="help">${h(r.outcome)}</p>`)).join('')
  const consent = s.actor.role === 'owner' || s.actor.staffRole === 'reception' ? form('reminders.consent', path, hidden('clientId', f.client.id)
    + `<label class="check"><input type="checkbox" name="consent"${f.client.sms_reminder_consent ? ' checked' : ''}><span>The patient agreed to receive visit reminders by text</span></label>`, 'Save text consent', true) : ''
  return panel('Reminder deliveries', '<p>Automatic email reminders and their send outcomes. A sent record means the provider accepted the message.</p>' + (list || empty('No scheduled reminder deliveries yet. Balm checks upcoming visits every minute.')) + consent)
}

export function visitReplyPage(data: any) {
  const a = data.appointment, s = { settings: { time_zone: a.time_zone } }
  return `<h1>Your appointment</h1><p>${h(a.clinic_name)}<br>${when(s, a.start_at)}</p>`
    + (a.patient_response === 'confirmed' ? '<div class="notice" role="status">Your visit is confirmed. The clinic can see your confirmation.</div>' : a.patient_response === 'change_requested' ? '<div class="notice" role="status">Your request for a new time is saved. The clinic will contact you; your current time stays booked until it is changed.</div>' : '<p>Let the clinic know in one reply.</p>')
    + `<form method="post" action="/visit/${h(data.token)}"><div class="actions"><button name="reply" value="confirmed">Confirm my visit</button><button class="secondary" name="reply" value="change_requested">Ask for a new time</button></div></form><p class="help">This private link works until your visit starts. If the clinic moves or cancels it, this link stops working.</p>`
}
