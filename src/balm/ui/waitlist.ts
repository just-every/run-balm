import { check, clientName, desk, empty, entry, field, form, h, hidden, panel, practitioners, rows, select, services, status, when } from './shared'

const dateLabel = (date: string) => new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', month: 'short', day: 'numeric', year: 'numeric' }).format(new Date(date + 'T00:00:00Z'))
const weekdays = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
const clock = (minute: number) => `${String(Math.floor(minute / 60)).padStart(2, '0')}:${String(minute % 60).padStart(2, '0')}`
const preferenceLabel = (e: any) => `${JSON.parse(e.preferred_weekdays).map((d: number) => weekdays[d]).join(', ')} · ${clock(e.preferred_start_minute)} to ${clock(e.preferred_end_minute)}`
const outcomes: Record<string, string> = { accepted: 'Accepted', too_late: 'Too late' }
const deliveries: Record<string, string> = { sent: 'Emailed', suppressed: 'Not emailed: email is suppressed on this install', no_email: 'No email address', mail_unavailable: 'Mail not set up', pending: 'Sending', queued: 'Waiting for a turn' }

/** Practitioner (or anyone), service, dates and a note; the client is chosen by the caller. */
export function waitlistForm(s: any, back: string, client: string) {
  const choices = practitioners(s).filter(p => desk(s) || p.id === s.actor.staffId)
  return form('waitlist.add', back, client + select('practitionerId', 'Practitioner', [...(desk(s) ? [['', 'Any practitioner']] : []), ...choices.map(p => [p.id, p.name])] as [unknown, unknown][], desk(s) ? '' : s.actor.staffId, desk(s) ? '' : 'required')
    + select('serviceId', 'Service', services(s).map(x => [x.id, `${x.name} · ${x.duration_minutes} min`]))
    + `<div class="pair">${field('earliestDate', 'From', '', 'date')}${field('latestDate', 'Until', '', 'date', 'required')}</div>`
    + `<fieldset><legend>Preferred days</legend>${hidden('weekdaysSelected', 'on')}<div class="checks">${weekdays.map((label, d) => check('weekday_' + d, label, 'checked')).join('')}</div></fieldset>`
    + `<p class="help">Times use ${h(s.settings.time_zone)}. The whole visit must fit. Leave times blank for any time; an end must be later than a start on the same day.</p>`
    + `<div class="pair">${field('timeFrom', 'From time (optional)', '', 'time')}${field('timeUntil', 'Until time (optional)', '', 'time')}</div>`
    + field('note', 'Note for staff (optional)', '', 'text', 'maxlength="300" placeholder="Additional information"'), 'Add to waitlist')
}

export function waitlist(s: any) {
  const w = s.waitlist ?? { entries: [], offers: [] }, entries = rows(w, 'entries'), byEntry = new Map(entries.map((e: any) => [e.id, e]))
  const waiting = entries.filter((e: any) => e.status === 'waiting')
  const list = waiting.map((e: any) => entry(e.client, `<p>${h(e.service)} · ${h(e.practitioner ?? 'Any practitioner')}<br>${h(dateLabel(e.earliest_date))} to ${h(dateLabel(e.latest_date))}<br>${h(preferenceLabel(e))} (${h(s.settings.time_zone)})${e.note ? `<br><span class="help">${h(e.note)}</span>` : ''}</p>`
    + `<p><a href="/app/clients/${h(e.client_id)}">Open client file</a></p>${form('waitlist.remove', '/app/waitlist', hidden('id', e.id), 'Remove from waitlist', true)}`)).join('')
  const done = entries.filter((e: any) => e.status !== 'waiting').slice(0, 30).map((e: any) => `<li>${h(e.client)} · ${h(e.service)} · ${h(preferenceLabel(e))} ${status(e.status === 'booked' ? 'Booked from an offer' : 'Removed')}</li>`).join('')
  const offers = rows(w, 'offers').map((o: any) => entry(`${o.practitioner} · ${new Intl.DateTimeFormat('en-US', { timeZone: s.settings.time_zone, weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZoneName: 'short' }).format(new Date(o.start_at))}`,
    `<p>${status(o.status === 'open' ? 'Open' : o.status === 'taken' ? 'Taken' : 'Closed: booked another way')} <span class="help">offered ${when(s, o.created_at)}</span></p><ul class="plain">${o.recipients.map((r: any) => `<li>${h((byEntry.get(r.entryId) as any)?.client ?? 'Waitlist entry')}: ${h(s.local && r.delivery === 'sent' ? 'Not emailed: Balm on this computer sends no email' : deliveries[r.delivery] ?? r.delivery)}${r.outcome ? ` · ${h(r.outcome === 'too_late' && r.expiresAt ? 'Turn ended' : outcomes[r.outcome])}` : ''}${r.expiresAt ? ` · hold until ${h(when(s, r.expiresAt))}` : ''}${r.takenNotice === 'sent' ? ' · told it was taken' : ''}</li>`).join('')}</ul>`)).join('')
  const clients = rows(s, 'clients')
  return `<h1>Waitlist</h1><p>Clients waiting for an earlier or a better time. When a booked visit at least two hours ahead is canceled, Balm emails matching patients in the order they joined. Each has a 15-minute hold, ending no later than one hour before the visit. When a hold expires, the next matching patient gets a turn. An acceptance books one visit and tells the others the time is taken.</p>`
    + `<p class="help">Text-message offers: not available yet. Offers go by email until the clinic connects a text-message provider.</p>`
    + `<div class="grid">${panel(`Waiting (${waiting.length})`, list || empty('Nobody is waiting.'))}${panel('Add to the waitlist', clients.length && services(s).length ? waitlistForm(s, '/app/waitlist', select('clientId', 'Client', clients.map(c => [c.id, clientName(c)]))) + '<p class="help">The client needs an email address for offers.</p>' : empty('Add a client and a service first.'))}`
    + `${panel('Offers', offers || empty('No times offered yet.'), 'full')}${done ? panel('Booked or removed', `<ul class="plain">${done}</ul>`) : ''}</div>`
}
