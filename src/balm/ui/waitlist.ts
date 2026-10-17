import { clientName, desk, empty, entry, field, form, h, hidden, panel, practitioners, rows, select, services, status, when } from './shared'

const dateLabel = (date: string) => new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', month: 'short', day: 'numeric', year: 'numeric' }).format(new Date(date + 'T00:00:00Z'))
const outcomes: Record<string, string> = { accepted: 'Accepted', too_late: 'Too late' }
const deliveries: Record<string, string> = { sent: 'Emailed', no_email: 'No email address', mail_unavailable: 'Mail not set up', pending: 'Sending' }

/** Practitioner (or anyone), service, dates and a note; the client is chosen by the caller. */
export function waitlistForm(s: any, back: string, client: string) {
  const choices = practitioners(s).filter(p => desk(s) || p.id === s.actor.staffId)
  return form('waitlist.add', back, client + select('practitionerId', 'Practitioner', [...(desk(s) ? [['', 'Any practitioner']] : []), ...choices.map(p => [p.id, p.name])] as [unknown, unknown][], desk(s) ? '' : s.actor.staffId, desk(s) ? '' : 'required')
    + select('serviceId', 'Service', services(s).map(x => [x.id, `${x.name} · ${x.duration_minutes} min`]))
    + `<div class="pair">${field('earliestDate', 'From', '', 'date')}${field('latestDate', 'Until', '', 'date', 'required')}</div>`
    + field('note', 'Note for staff (optional)', '', 'text', 'maxlength="300" placeholder="Prefers mornings"'), 'Add to waitlist')
}

export function waitlist(s: any) {
  const w = s.waitlist ?? { entries: [], offers: [] }, entries = rows(w, 'entries'), byEntry = new Map(entries.map((e: any) => [e.id, e]))
  const waiting = entries.filter((e: any) => e.status === 'waiting')
  const list = waiting.map((e: any) => entry(e.client, `<p>${h(e.service)} · ${h(e.practitioner ?? 'Any practitioner')}<br>${h(dateLabel(e.earliest_date))} to ${h(dateLabel(e.latest_date))}${e.note ? `<br><span class="help">${h(e.note)}</span>` : ''}</p>`
    + `<p><a href="/app/clients/${h(e.client_id)}">Open client file</a></p>${form('waitlist.remove', '/app/waitlist', hidden('id', e.id), 'Remove from waitlist', true)}`)).join('')
  const done = entries.filter((e: any) => e.status !== 'waiting').slice(0, 30).map((e: any) => `<li>${h(e.client)} · ${h(e.service)} ${status(e.status === 'booked' ? 'Booked from an offer' : 'Removed')}</li>`).join('')
  const offers = rows(w, 'offers').map((o: any) => entry(`${o.practitioner} · ${new Intl.DateTimeFormat('en-US', { timeZone: s.settings.time_zone, weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }).format(new Date(o.start_at))}`,
    `<p>${status(o.status === 'open' ? 'Open' : o.status === 'taken' ? 'Taken' : 'Closed: booked another way')} <span class="help">offered ${when(s, o.created_at)}</span></p><ul class="plain">${o.recipients.map((r: any) => `<li>${h((byEntry.get(r.entryId) as any)?.client ?? 'Waitlist entry')}: ${h(deliveries[r.delivery] ?? r.delivery)}${r.outcome ? ` · ${h(outcomes[r.outcome])}` : ''}${r.takenNotice === 'sent' ? ' · told it was taken' : ''}</li>`).join('')}</ul>`)).join('')
  const clients = rows(s, 'clients')
  return `<h1>Waitlist</h1><p>Clients waiting for an earlier or a better time. When a booked visit at least two hours ahead is canceled, Balm emails that time to everyone waiting whose practitioner, service and dates fit. The first to accept is booked into the calendar, and the others are told it has been taken.</p>`
    + `<p class="help">Text-message offers: not available yet. Offers go by email until the clinic connects a text-message provider.</p>`
    + `<div class="grid">${panel(`Waiting (${waiting.length})`, list || empty('Nobody is waiting.'))}${panel('Add to the waitlist', clients.length && services(s).length ? waitlistForm(s, '/app/waitlist', select('clientId', 'Client', clients.map(c => [c.id, clientName(c)]))) + '<p class="help">The client needs an email address for offers.</p>' : empty('Add a client and a service first.'))}`
    + `${panel('Offers', offers || empty('No times offered yet.'), 'full')}${done ? panel('Booked or removed', `<ul class="plain">${done}</ul>`) : ''}</div>`
}
