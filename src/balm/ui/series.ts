// Recurring visits: the pattern form, the per-date review a person sees before
// anything is saved, and the result once the series is booked.
import { field, form, h, hidden, practitioners, result, rows, select, services } from './shared'

const weekdayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const action = (name: string, back: string) => `/app/action?name=${encodeURIComponent(name)}&amp;returnTo=${encodeURIComponent(back)}`
const dateLabel = (date: string) => new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', weekday: 'short', month: 'short', day: 'numeric' }).format(new Date(date + 'T00:00:00Z'))
const clockIn = (iso: string, zone: string) => new Intl.DateTimeFormat('en-US', { timeZone: zone, hour: 'numeric', minute: '2-digit' }).format(new Date(iso))

/** Why a date cannot be booked, in plain words. */
export function problemText(o: any, zone: string) {
  const clash = o.clash ? ` ${clockIn(o.clash.start_at, zone)}–${clockIn(o.clash.end_at, zone)} (${o.clash.service})` : ''
  switch (o.problem) {
    case 'practitioner_already_booked': return `Overlaps another visit${clash}`
    case 'room_in_use': return `The room is booked${clash}`
    case 'outside_practitioner_hours': return 'Outside the practitioner’s hours'
    case 'overlaps_another_visit_in_this_series': return 'Overlaps another visit in this series'
    case 'start_too_far_in_past': return 'In the past'
    default: return String(o.problem).replace(/_/g, ' ')
  }
}

type Defaults = { clientSelect?: string; clientId?: string; practitionerId?: string; roomId?: string; firstDate?: string; time?: string }
export function seriesForm(s: any, back: string, d: Defaults) {
  const choices = practitioners(s).filter(p => s.actor.role === 'owner' || s.actor.staffRole === 'reception' || p.id === s.actor.staffId)
  const roomList = rows(s, 'rooms').filter(r => r.active === undefined || r.active)
  return form('series.preview', back, (d.clientId ? hidden('clientId', d.clientId) : d.clientSelect ?? '')
    + select('practitionerId', 'Practitioner', choices.map(p => [p.id, p.name]), d.practitionerId) + select('serviceId', 'Service', services(s).map(x => [x.id, `${x.name} · ${x.duration_minutes} min`]))
    + (roomList.length ? select('roomId', 'Room', [['', 'No room'], ...roomList.map(r => [r.id, r.name])] as [unknown, unknown][], d.roomId ?? '', '') : '')
    + `<fieldset class="weekdays"><legend>Every</legend>${weekdayNames.map((name, i) => `<label class="check"><input type="checkbox" name="weekday_${i}" value="on"><span>${name}</span></label>`).join('')}</fieldset>`
    + `<div class="pair">${field('time', 'Start time', d.time ?? '', 'time', 'required step="300"')}${field('weeks', 'For how many weeks', 6, 'number', 'required min="1" max="26"')}</div>`
    + field('firstDate', 'Starting', d.firstDate ?? '', 'date', 'required') + '<p class="help">Next you see every date, and any that would overlap or fall outside hours, before anything is booked.</p>', 'Check the dates')
}

/** The review of every date, or the booked series. */
export function seriesResult(s: any, notice: any, back: string) {
  const r = result(notice)
  if (r?.seriesId && r.booked) {
    const mail = r.mail === 'sent' ? 'The intake link for the first visit was emailed to the client.' : 'Give the client their intake link for the first visit:'
    return `<div class="notice" role="status"><strong>Series booked: ${r.booked} visits.</strong>${r.skipped.length ? ` Skipped by you: ${h(r.skipped.map(dateLabel).join(', '))}.` : ''} ${h(mail)} <a href="/intake/${h(r.token)}">/intake/${h(r.token)}</a></div>`
  }
  if (!r?.preview) return ''
  const zone = r.timeZone, free = r.occurrences.filter((o: any) => !o.problem).length
  const base = hidden('clientId', r.clientId) + hidden('practitionerId', r.practitionerId) + hidden('serviceId', r.serviceId) + hidden('roomId', r.roomId ?? '')
    + hidden('weekdays', r.pattern.weekdays.join(',')) + hidden('weeks', r.pattern.weeks) + hidden('firstDate', r.pattern.firstDate) + hidden('time', r.pattern.time)
  const table = r.occurrences.map((o: any, i: number) => `<tr class="${o.problem ? (o.skip ? 'skipped' : 'conflict') : ''}"><td>${hidden('date_' + i, o.date)}${h(dateLabel(o.date))}</td>`
    + `<td><input aria-label="Start time ${h(dateLabel(o.date))}" name="time_${i}" type="time" step="300" value="${h(o.time)}" required></td>`
    + `<td>${o.problem ? `<strong>${h(problemText(o, zone))}</strong>` : 'Free'}</td>`
    + `<td><label class="check"><input type="checkbox" name="skip_${i}" value="on"${o.skip ? ' checked' : ''}><span>Skip</span></label></td></tr>`).join('')
  const verdict = r.conflicts ? `<strong>${r.conflicts} of ${r.occurrences.length} dates can’t be booked as they are.</strong> Change the time of each, or skip it, then check again.`
    : `<strong>All ${r.occurrences.length - r.occurrences.filter((o: any) => o.skip).length} dates are free.</strong>${r.occurrences.some((o: any) => o.skip) ? ' Skipped dates are recorded with the series.' : ''}`
  return `<section class="notice series-review" aria-labelledby="series-review"><h3 id="series-review">Recurring visits for ${h(r.client)}: ${h(r.service)} with ${h(r.practitioner)}</h3><p>${verdict} <span class="help">${free} free · times in ${h(zone)}</span></p>`
    + `<form method="post" action="${action('series.preview', back)}">${base}<div class="table"><table><thead><tr><th>Date</th><th>Time</th><th>Check</th><th>Skip</th></tr></thead><tbody>${table}</tbody></table></div>`
    + `<div class="actions"><button type="submit" class="secondary">Check again</button><button type="submit" formaction="${action('series.book', back)}"${r.conflicts ? ' disabled' : ''}>Book ${r.occurrences.length - r.occurrences.filter((o: any) => o.skip).length} visits</button></div></form></section>`
}
