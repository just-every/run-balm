import { calendarGrid, calendarLink, clockLabel, inColumn, moveForm, statusLabel } from './calendar'
import { bookingResult } from './clients'
import { checkInActions } from './payments'
import { problemText, seriesForm, seriesResult } from './series'
import { noteChip, notesToSign, notesTally, planChip } from './chart-status'
import { zoneLabel } from './time-zone'
import { cancelForm, clientName, desk, empty, entry, intakeChip, field, form, h, hidden, owner, panel, practitioners, rows, select, services, status, when } from './shared'

function setupChecklist(s: any) {
  const steps: [boolean, string][] = [
    [s.settings.clinic_name !== 'My clinic', 'Name your clinic in <a href="/app/clinic">Clinic</a>.'],
    [services(s).length > 0, 'Add at least one service with its length and price in <a href="/app/clinic">Clinic</a>.'],
    [practitioners(s).length > 0, 'Add a practitioner (yourself too, if you treat clients) in <a href="/app/clinic">Clinic</a>.'],
    [rows(s, 'hours').length > 0, 'Set each practitioner’s weekly hours in <a href="/app/clinic">Clinic</a>.'],
  ]
  if (steps.every(([done]) => done)) return ''
  return panel('Finish setting up', `<ol class="steps">${steps.map(([done, text]) => `<li${done ? ' class="done"' : ''}>${done ? '<span class="status">Done</span> ' : ''}${text}</li>`).join('')}</ol><p>Then share your booking page: <a href="/book">/book</a> on this app’s address.</p>`, 'full')
}

const longDate = (date: string, options: Intl.DateTimeFormatOptions = { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' }) => new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', ...options }).format(new Date(date + 'T00:00:00Z'))
const roomChoices = (s: any) => [['', 'No room'], ...rows(s, 'rooms').filter(r => r.active === undefined || r.active).map(r => [r.id, r.name])] as [unknown, unknown][]

function toolbar(s: any, c: any) {
  const tab = (label: string, extra: any, current: boolean) => `<a class="seg${current ? ' on' : ''}" href="${h(calendarLink({ ...c, ...extra }))}"${current ? ' aria-current="true"' : ''}>${h(label)}</a>`
  const title = c.view === 'week' ? `${longDate(c.dates[0], { month: 'short', day: 'numeric' })} – ${longDate(c.dates[6], { month: 'short', day: 'numeric', year: 'numeric' })}` : longDate(c.date)
  const subjects = c.subjects.map((x: any) => [x.id, x.name]) as [unknown, unknown][]
  const filter = subjects.length > 1 || c.view === 'week' ? `<form class="cal-filter" method="get" action="/app">${hidden('view', c.view)}${hidden('date', c.date)}${hidden('by', c.by)}`
    + select('id', c.by === 'room' ? 'Room' : 'Practitioner', c.view === 'week' ? subjects : [['', c.by === 'room' ? 'All rooms' : 'All practitioners'], ...subjects], c.subject ?? '', '') + '<button type="submit" class="secondary">Show</button></form>' : ''
  return `<div class="cal-bar"><h2 class="cal-title">${h(title)}</h2><div class="cal-nav"><a class="seg" href="${h(calendarLink({ ...c, date: c.previous }))}" aria-label="Previous ${c.view}">‹ Previous</a>${tab('Today', { date: c.today }, false)}<a class="seg" href="${h(calendarLink({ ...c, date: c.next }))}" aria-label="Next ${c.view}">Next ›</a></div>`
    + `<div class="cal-nav">${tab('Day', { view: 'day' }, c.view === 'day')}${tab('Week', { view: 'week' }, c.view === 'week')}</div>`
    + (desk(s) && rows(s, 'rooms').length ? `<div class="cal-nav">${tab('Practitioners', { by: 'practitioner', subject: null }, c.by === 'practitioner')}${tab('Rooms', { by: 'room', subject: null }, c.by === 'room')}</div>` : '')
    + `${filter}</div><p class="help">Times are in ${h(zoneLabel(c.zone))}. ${desk(s) || s.actor.staffId ? 'Select a visit to change it, drag it to a new time, or select an empty time to book.' : ''} Shaded times are outside the practitioner’s hours.</p>`
}

function moveFields(s: any, c: any, a: any, prefix = '') {
  const choices = practitioners(s).filter(p => desk(s) || p.id === s.actor.staffId)
  const local = new Intl.DateTimeFormat('en-CA', { timeZone: c.zone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(a.start_at))
  const time = new Intl.DateTimeFormat('en-GB', { timeZone: c.zone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(a.start_at))
  return `<div class="pair">${prefix ? '' : field('date', 'Date', local, 'date', 'required')}${field('time', prefix ? 'New start time for each' : 'Start time', time, 'time', 'required step="300"')}</div>`
    + (desk(s) && choices.length > 1 ? select('practitionerId', 'Practitioner', choices.map(p => [p.id, p.name]), a.practitioner_id) : '')
    + (rows(s, 'rooms').length ? select('roomId', 'Room', roomChoices(s), a.room_id ?? '', '') : '')
}

function conflicts(c: any, notice: any) {
  const r = notice.result
  if (!r?.moveRest) return ''
  return `<div class="notice error" role="alert"><strong>Nothing was moved.</strong> These visits would not fit at the new time:<ul class="plain">${r.occurrences.filter((o: any) => o.problem).map((o: any) => `<li>${h(longDate(o.date, { weekday: 'short', month: 'short', day: 'numeric' }))}: ${h(problemText(o, c.zone))}</li>`).join('')}</ul></div>`
}

function selectedPanel(s: any, c: any, notice: any) {
  const a = c.selected
  if (!a) return ''
  const back = calendarLink(c, { appt: a.id }), mine = desk(s) || a.practitioner_id === s.actor.staffId
  const started = Date.parse(a.start_at) <= Date.now() + 3600_000
  const series = a.series ? `<p>${status(`Visit ${a.series.position} of ${a.series.total} in a series`)}${a.series.skipped.length ? ` <span class="help">Skipped when booked: ${h(a.series.skipped.map((d: string) => longDate(d, { month: 'short', day: 'numeric' })).join(', '))}</span>` : ''}</p>` : ''
  let actions = checkInActions(s, a, back)
  if (a.status === 'booked' && mine) {
    actions += started ? `<div class="actions">${form('appointment.attend', back, hidden('id', a.id), 'Mark attended')}${form('appointment.no_show', back, hidden('id', a.id), 'Did not attend', true)}</div>` : ''
    actions += `<details open><summary>Move this visit</summary>${form('appointment.move', back, hidden('id', a.id) + hidden('version', a.version) + moveFields(s, c, a), 'Move visit')}</details>`
    if (a.series && a.series.remaining > 1) actions += `<details><summary>Move this and the later visits in the series (${a.series.remaining})</summary>${form('series.move_rest', back, hidden('appointmentId', a.id) + moveFields(s, c, a, 'rest'), `Move ${a.series.remaining} visits`)}<p class="help">Each keeps its date. If any would overlap or fall outside hours, nothing moves and the dates are listed.</p></details>`
    actions += `${cancelForm('appointment.cancel', calendarLink(c), hidden('id', a.id), 'Cancel this visit', 'Cancel visit', a.client)}${a.series && a.series.remaining > 1 ? cancelForm('series.cancel_rest', calendarLink(c), hidden('appointmentId', a.id), `Cancel this and the rest of the series (${a.series.remaining})`, `Cancel ${a.series.remaining} visits`, a.client, a.series.remaining) : ''}<p class="help">A canceled time at least two hours ahead is offered to the waitlist by email.</p>`
  }
  return `<div id="visit">` + panel('Selected visit', `${conflicts(c, notice)}<p><strong>${h(a.client)}</strong><br>${h(a.service)} with ${h(a.practitioner)}${a.room ? ` · ${h(a.room)}` : ''}<br>${when(s, a.start_at)}</p><p>${status(statusLabel[a.status] ?? a.status)} ${a.patient_response && a.patient_response !== 'awaiting' ? status(a.patient_response) : ''} ${a.booked_via === 'online' ? status(a.offer_id ? 'From the waitlist' : 'Booked online') : ''} ${noteChip(a)} ${planChip(s, a)}</p>${series}<p><a href="/app/clients/${h(a.client_id)}">Open client file</a> · <a href="${h(calendarLink(c))}">Close</a></p>${actions}`) + '</div>'
}

function bookPanel(s: any, c: any, notice: any) {
  const [date, time] = (c.newSlot ?? '').split('T')
  const clients = rows(s, 'clients'), choices = practitioners(s).filter(p => desk(s) || p.id === s.actor.staffId)
  if (!services(s).length || !choices.length) return ''
  const practitioner = c.by === 'practitioner' ? (c.col ?? c.subject) : undefined, room = c.by === 'room' && c.col !== 'none' ? c.col : undefined
  const back = calendarLink(c), clientSelect = clients.length ? select('clientId', 'Client', clients.map(x => [x.id, clientName(x)])) : ''
  const one = clients.length ? form('appointment.book', back, clientSelect + select('practitionerId', 'Practitioner', choices.map(p => [p.id, p.name]), practitioner)
    + select('serviceId', 'Service', services(s).map(x => [x.id, `${x.name} · ${x.duration_minutes} min`])) + (rows(s, 'rooms').length ? select('roomId', 'Room', roomChoices(s), room ?? '', '') : '')
    + `<div class="pair">${field('date', 'Date', date ?? c.date, 'date', 'required')}${field('time', 'Start time', time ?? '', 'time', 'required step="300"')}</div><p class="help">Any start time in 5-minute steps inside the practitioner's hours. Online booking offers patients quarter-hour times.</p>`, 'Book visit') : empty('Add a client first on the Clients page.')
  return `<div id="book">` + panel(c.newSlot ? `Book ${clockLabel(+time.slice(0, 2) * 60 + +time.slice(3))}, ${longDate(date, { weekday: 'short', month: 'short', day: 'numeric' })}` : 'Book a visit',
    `${bookingResult(s, notice)}${seriesResult(s, notice, back)}${one}${clients.length ? `<details${notice.result?.preview ? ' open' : ''}><summary>Book recurring visits</summary>${seriesForm(s, back, { clientSelect, practitionerId: practitioner, roomId: room, firstDate: date ?? c.date, time })}</details>` : ''}`) + '</div>'
}

function listPanel(s: any, c: any) {
  const items = c.appointments.filter((a: any) => c.columns.some((column: any) => inColumn(c, column, a))).map((a: any) => entry(`${new Intl.DateTimeFormat('en-US', { timeZone: c.zone, weekday: c.view === 'week' ? 'short' : undefined, hour: 'numeric', minute: '2-digit' }).format(new Date(a.start_at))} · ${a.client}`,
    `<p>${h(a.service)} with ${h(a.practitioner)}${a.room ? ` · ${h(a.room)}` : ''}<br>${status(statusLabel[a.status] ?? a.status)} ${a.patient_response && a.patient_response !== 'awaiting' ? status(a.patient_response) : ''} ${intakeChip(a)} ${a.series_id ? status('Series') : ''} ${noteChip(a)} ${planChip(s, a)}</p><p><a href="${h(calendarLink(c, { appt: a.id }))}#visit">${a.status === 'booked' ? 'Change' : 'Details'}</a> · <a href="/app/clients/${h(a.client_id)}">Client file</a></p>${checkInActions(s, a, calendarLink(c))}`)).join('')
  return panel(c.view === 'week' ? 'This week as a list' : 'This day as a list', notesTally(c.appointments) + (items || empty('No visits.')))
}

export function schedule(s: any, notice: any = {}) {
  const c = s.calendar
  const intro = owner(s) ? `<p>The whole clinic’s calendar. Your public booking page is <a href="/book">/book</a>; clients waiting for a time are on the <a href="/app/waitlist">Waitlist</a>.</p>`
    : desk(s) ? '<p>Everyone’s calendar. Clinical notes and intake answers stay with practitioners.</p>' : '<p>Your calendar.</p>'
  const offered = c.offered ? `<div class="notice" role="status">The freed time was offered by email to ${c.offered} ${c.offered === 1 ? 'person' : 'people'} on the waitlist. The first to accept is booked.</div>` : ''
  return `<h1>Schedule</h1>${intro}${offered}${owner(s) ? setupChecklist(s) : ''}${notesToSign(s)}${toolbar(s, c)}${calendarGrid(s, c)}${moveForm(c)}<div class="grid cal-panels">${selectedPanel(s, c, notice)}${desk(s) || s.actor.staffId ? bookPanel(s, c, notice) : ''}${listPanel(s, c)}</div>`
}
