import { coverageFields, pendingEstimatePanel } from './estimates'
import { visitFeePanel } from './visit-policy'
import { dailyClosePanel } from './daily-close'
import { breakGlassNoticePanel } from './care-team'
import { calendarFeedPanel } from './calendar-feed'
// The schedule, laid out as the owner-picked Today screen: the day's heading and
// counts, the clinician columns, and the selected visit's patient panel beside
// them; the booking panel takes that place when no visit is selected.
import { calendarGrid, calendarLink, clockLabel, inColumn, moveForm, openSlots, span, statusLabel } from './calendar'
import { calendarAgenda } from './agenda'
import { bookingResult } from './clients'
import { checkInActions } from './payments'
import { problemText, seriesForm, seriesResult } from './series'
import { documentationDailyClose } from './documentation'
import { noteChip, notesToSign, notesTally, planChip } from './chart-status'
import { zoneLabel } from './time-zone'
import { icon } from './icons'
import { patientPanel } from './visit-panel'
import { check, cancelForm, clientName, desk, empty, intakeChip, field, form, h, hidden, owner, panel, practitioners, rows, select, services, stamp, status } from './shared'
import { fullName } from '../domain/model'

function setupChecklist(s: any) {
  const staff = rows(s, 'staff').find(p => p.email?.toLowerCase() === s.actor.email.toLowerCase())
  const steps: [boolean, string][] = [
    [!staff || fullName(staff.name), 'Enter your first and last name in <a href="/app/clinic#you">Clinic</a>: it goes on your signed notes and insurance claims.'],
    [s.settings.clinic_name !== 'My clinic', 'Name your clinic in <a href="/app/clinic">Clinic</a>.'],
    [services(s).length > 0, 'Add at least one service with its length and price in <a href="/app/clinic">Clinic</a>.'],
    [practitioners(s).length > 0, 'Add a practitioner (yourself too, if you treat clients) in <a href="/app/clinic">Clinic</a>.'],
    [rows(s, 'hours').length > 0, 'Set each practitioner’s weekly hours in <a href="/app/clinic">Clinic</a>.'],
  ]
  if (steps.every(([done]) => done)) return ''
  return panel('Finish setting up', `<ol class="steps">${steps.map(([done, text]) => `<li${done ? ' class="done"' : ''}>${done ? '<span class="status sage">Done</span> ' : ''}${text}</li>`).join('')}</ol><p>Then share your booking page: <a href="/book">/book</a> on this app’s address.</p>`, 'setup')
}

const longDate = (date: string, options: Intl.DateTimeFormatOptions = { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' }) => new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', ...options }).format(new Date(date + 'T00:00:00Z'))
const equipmentChoices = (s: any) => [['', 'No equipment'], ...rows(s, 'equipment').filter(r => r.active === undefined || r.active).map(r => [r.id, r.name])] as [unknown, unknown][]
const subjectWord = (c: any) => c.by === 'room' ? 'Room' : c.by === 'equipment' ? 'Equipment' : 'Practitioner'
const roomChoices = (s: any) => [['', 'No room'], ...rows(s, 'rooms').filter(r => r.active === undefined || r.active).map(r => [r.id, r.name])] as [unknown, unknown][]
const canBook = (s: any) => desk(s) || !!s.actor.staffId

/** The top bar on the schedule: the shown day or week with its arrows, back to today, and Book a visit. */
export function scheduleTop(s: any) {
  const c = s.calendar
  if (!c) return ''
  const title = c.view === 'week' ? `${longDate(c.dates[0], { month: 'short', day: 'numeric' })} – ${longDate(c.dates[6], { month: 'short', day: 'numeric', year: 'numeric' })}` : longDate(c.date, { weekday: 'long', month: 'short', day: 'numeric', year: 'numeric' })
  return `<div class="datenav"><a class="step" href="${h(calendarLink({ ...c, date: c.previous }))}" aria-label="Previous ${c.view}">${icon('back')}</a><strong>${h(title)}</strong><a class="step" href="${h(calendarLink({ ...c, date: c.next }))}" aria-label="Next ${c.view}">${icon('chevron')}</a>${c.date === c.today ? '' : `<a class="button secondary small" href="${h(calendarLink({ ...c, date: c.today }))}">Today</a>`}</div><span class="grow"></span>`
    + (canBook(s) && services(s).length && practitioners(s).length ? `<a class="button new" href="${h(calendarLink(c))}#book">${icon('plus')}Book a visit</a>` : '')
}

function viewControls(s: any, c: any) {
  const tab = (label: string, extra: any, current: boolean) => `<a class="seg${current ? ' on' : ''}" href="${h(calendarLink({ ...c, ...extra }))}"${current ? ' aria-current="true"' : ''}>${h(label)}</a>`
  const subjects = c.subjects.map((x: any) => [x.id, x.name]) as [unknown, unknown][]
  const filter = subjects.length > 1 || c.view === 'week' ? `<form class="cal-filter" method="get" action="/app">${hidden('view', c.view)}${hidden('date', c.date)}${hidden('by', c.by)}`
    + select('id', subjectWord(c), c.view === 'week' ? subjects : [['', c.by === 'room' ? 'All rooms' : c.by === 'equipment' ? 'All equipment' : 'All practitioners'], ...subjects], c.subject ?? '', '') + '<button type="submit" class="secondary">Show</button></form>' : ''
  return `<div class="cal-controls"><div class="cal-nav" aria-label="View">${tab('Day', { view: 'day' }, c.view === 'day')}${tab('Week', { view: 'week' }, c.view === 'week')}</div>`
    + (desk(s) && (rows(s, 'rooms').length || rows(s, 'equipment').length) ? `<div class="cal-nav" aria-label="Columns">${tab('Practitioners', { by: 'practitioner', subject: null }, c.by === 'practitioner')}${rows(s, 'rooms').length ? tab('Rooms', { by: 'room', subject: null }, c.by === 'room') : ''}${rows(s, 'equipment').length ? tab('Equipment', { by: 'equipment', subject: null }, c.by === 'equipment') : ''}</div>` : '')
    + filter + daySheetLinks(c) + '</div>'
}
/** SCHED-002: print or export the shown day with the same column filter. */
function daySheetLinks(c: any) {
  const query = new URLSearchParams({ date: c.date, by: c.by, ...(c.subject ? { id: c.subject } : {}) })
  return `<p class="day-sheet"><a href="/api/balm/day-sheet.html?${h(query)}" target="_blank" rel="noopener">Print day sheet</a> · <a href="/api/balm/day-sheet.csv?${h(query)}">Export day sheet (CSV)</a></p>`
}

/** Today, or the day's name: the columns, the appointment count and the open slots between visits. */
function heading(s: any, c: any) {
  const live = c.appointments.filter((a: any) => a.status !== 'cancelled' && c.columns.some((column: any) => inColumn(c, column, a)))
  const open = canBook(s) && c.view === 'day' ? c.columns.reduce((n: number, column: any) => n + openSlots(c, column, live).length, 0) : 0
  // The week shows one practitioner's (or room's) visits: the heading names whose, and the switcher beside it changes it.
  const subject = c.subjects.find((x: any) => x.id === c.subject)
  const who = c.view === 'week' ? (subject ? `For ${subject.name}${subject.credentials ? `, ${subject.credentials}` : ''}` : 'Week view') : c.by === 'room' ? `${c.columns.length} ${c.columns.length === 1 ? 'room' : 'rooms'}` : c.by === 'equipment' ? `${c.columns.length} equipment ${c.columns.length === 1 ? 'item' : 'items'}` : `${c.columns.length} ${c.columns.length === 1 ? 'practitioner' : 'practitioners'}`
  const title = c.view === 'week' ? (c.dates.includes(c.today) ? 'This week' : `Week of ${longDate(c.dates[0], { month: 'short', day: 'numeric' })}`) : c.date === c.today ? 'Today' : longDate(c.date, { weekday: 'long' })
  const parts = [who, `${live.length} ${live.length === 1 ? 'appointment' : 'appointments'}`, ...(open ? [`${open} open ${open === 1 ? 'slot' : 'slots'}`] : [])]
  const switcher = c.view === 'week' && c.subjects.length > 1 ? `<nav class="cal-nav week-who" aria-label="${subjectWord(c)}">${c.subjects.map((x: any) => `<a class="seg${x.id === c.subject ? ' on' : ''}" href="${h(calendarLink({ ...c, subject: x.id }))}"${x.id === c.subject ? ' aria-current="true"' : ''}>${h(x.name)}</a>`).join('')}</nav>` : ''
  return `<div class="today-head"><div><h1>${h(title)}</h1><p class="sub">${parts.map(h).join(' <span aria-hidden="true">·</span> ')}</p></div>${switcher}<details class="view-options"><summary>${c.view === 'week' ? 'Week view' : 'Day view'}${icon('chevron')}</summary>${viewControls(s, c)}</details></div>`
}

function moveFields(s: any, c: any, a: any, prefix = '') {
  const choices = practitioners(s).filter(p => desk(s) || p.id === s.actor.staffId)
  const local = new Intl.DateTimeFormat('en-CA', { timeZone: c.zone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(a.start_at))
  const time = new Intl.DateTimeFormat('en-GB', { timeZone: c.zone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(a.start_at))
  return `<div class="pair">${prefix ? '' : field('date', 'Date', local, 'date', 'required')}${field('time', prefix ? 'New start time for each' : 'Start time', time, 'time', 'required step="300"')}</div>`
    + (desk(s) && choices.length > 1 ? select('practitionerId', 'Practitioner', choices.map(p => [p.id, p.name]), a.practitioner_id) : '')
    + (rows(s, 'rooms').length ? select('roomId', 'Room', roomChoices(s), a.room_id ?? '', '') : '')
    + (rows(s, 'equipment').length && !prefix ? select('equipmentId', 'Equipment', equipmentChoices(s), a.equipment_id ?? '', '') : '')
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
  const visit = `<div class="visit-line">${conflicts(c, notice)}<p><strong>${h(span(a.start_at, a.end_at, c.zone))}</strong> · ${h(a.service)} with ${h(a.practitioner)}${a.room ? ` · ${h(a.room)}` : ''}${a.equipment ? ` · ${h(a.equipment)}` : ''}</p><p class="chips">${status(statusLabel[a.status] ?? a.status)} ${a.patient_response && a.patient_response !== 'awaiting' ? status(a.patient_response) : ''} ${a.booked_via === 'online' ? status(a.offer_id ? 'From the waitlist' : 'Booked online') : ''} ${noteChip(a)} ${planChip(s, a)}</p>${series}</div>`
  // The visit's next action: check in at the desk, mark it, or start its note for the treating practitioner.
  let primary = checkInActions(s, a, back)
  if (a.status === 'booked' && mine && started) primary += `<div class="actions">${form('appointment.attend', back, hidden('id', a.id), 'Mark attended')}${form('appointment.no_show', back, hidden('id', a.id), 'Did not attend', true)}</div>`
  if (a.practitioner_id === s.actor.staffId && a.status !== 'cancelled') primary += a.note_status === 'signed' ? `<a class="button secondary start" href="/app/clients/${h(a.client_id)}#notes">Open the signed note${icon('arrow')}</a>`
    : `<a class="button start" href="/app/clients/${h(a.client_id)}?compose=${h(a.id)}#notes">${a.note_status === 'unsigned' ? 'Open the note' : 'Start a note'}${icon('arrow')}</a>`
  let actions = ''
  if (a.status === 'booked' && mine) {
    actions += `<details><summary>Move this visit</summary>${form('appointment.move', back, hidden('id', a.id) + hidden('version', a.version) + moveFields(s, c, a) + coverageFields() + check('acknowledgeMedicareOverlap', 'Book anyway if this overlaps another Medicare patient with this practitioner (one-on-one timed codes cannot be billed for both over the same minutes; overlapping Medicare treatment bills as group therapy, 97150). Your name is kept on both visits.', ''), 'Move visit')}</details>`
    if (a.series && a.series.remaining > 1) actions += `<details><summary>Move this and the later visits in the series (${a.series.remaining})</summary>${form('series.move_rest', back, hidden('appointmentId', a.id) + moveFields(s, c, a, 'rest'), `Move ${a.series.remaining} visits`)}<p class="help">Each keeps its date. If any would overlap or fall outside hours, nothing moves and the dates are listed.</p></details>`
    if (a.series && a.series.booked > 1) actions += `<details><summary>Move the whole series (${a.series.booked} booked visits)</summary>${form('series.move_rest', back, hidden('appointmentId', a.id) + hidden('scope', 'all') + moveFields(s, c, a, 'all'), 'Move whole series')}</details>` + cancelForm('series.cancel_rest', back, hidden('appointmentId', a.id) + hidden('scope', 'all'), `Cancel the whole series (${a.series.booked} booked visits)`, 'Cancel whole series', a.client, a.series.booked)
    actions += `${cancelForm('appointment.cancel', back, hidden('id', a.id), 'Cancel this visit', 'Cancel visit', a.client)}${a.series && a.series.remaining > 1 ? cancelForm('series.cancel_rest', back, hidden('appointmentId', a.id), `Cancel this and the rest of the series (${a.series.remaining})`, `Cancel ${a.series.remaining} visits`, a.client, a.series.remaining) : ''}<p class="help">A canceled time at least two hours ahead is offered to the waitlist by email.</p>`
  }
  const history = `<details><summary>Visit history</summary><ol class="plain">${a.history.map((e: any) => `<li>${h(e.action.replace('appointment.', '').replaceAll('_', ' '))} · ${h(e.actor_email)} (${h(e.actor_role)})<br>${stamp(s, e.at)}${e.detail ? ` · ${h(e.detail)}` : ''}</li>`).join('')}</ol></details>`
  actions = `<div class="visit-actions">${actions}${visitFeePanel(s, a, back)}${history}<p class="help"><a href="/app/clients/${h(a.client_id)}">Open client file</a> · <a href="${h(calendarLink(c))}">Close</a></p></div>`
  return patientPanel(s, c, a, { visit, primary: primary ? `<div class="primary">${primary}</div>` : '', actions })
}

function bookPanel(s: any, c: any, notice: any) {
  const [date, time] = (c.newSlot ?? '').split('T')
  const clients = rows(s, 'clients'), choices = practitioners(s).filter(p => desk(s) || p.id === s.actor.staffId)
  if (!services(s).length || !choices.length) return ''
  const practitioner = c.by === 'practitioner' ? (c.col ?? c.subject) : undefined, room = c.by === 'room' && c.col !== 'none' ? c.col : undefined, item = c.by === 'equipment' ? c.col : undefined
  const back = calendarLink(c), clientSelect = clients.length ? select('clientId', 'Client', clients.map(x => [x.id, clientName(x)])) : ''
  const one = clients.length ? form('appointment.book', back, clientSelect + select('practitionerId', 'Practitioner', choices.map(p => [p.id, p.name]), practitioner)
    + select('serviceId', 'Service', services(s).map(x => [x.id, `${x.name} · ${x.duration_minutes} min`])) + (rows(s, 'rooms').length ? select('roomId', 'Room', roomChoices(s), room ?? '', '') : '') + (rows(s, 'equipment').length ? select('equipmentId', 'Equipment', equipmentChoices(s), item ?? '', '') : '')
    + `<div class="pair">${field('date', 'Date', date || c.date, 'date', 'required')}${field('time', 'Start time', time ?? '', 'time', 'required step="300"')}</div><p class="help">Any start time in 5-minute steps inside the practitioner's hours. Online booking offers patients quarter-hour times.</p>` + coverageFields() + check('acknowledgeMedicareOverlap', 'Book anyway if this overlaps another Medicare patient with this practitioner (one-on-one timed codes cannot be billed for both over the same minutes; overlapping Medicare treatment bills as group therapy, 97150). Your name is kept on both visits.', ''), 'Book visit') : empty('Add a client first on the Clients page.')
  return `<div id="book">` + panel(c.newSlot ? `Book ${clockLabel(+time.slice(0, 2) * 60 + +time.slice(3))}, ${longDate(date, { weekday: 'short', month: 'short', day: 'numeric' })}` : 'Book a visit',
    `${bookingResult(s, notice)}${seriesResult(s, notice, back)}${one}${clients.length ? `<details${notice.result?.preview ? ' open' : ''}><summary>Book recurring visits</summary>${seriesForm(s, back, { clientSelect, practitionerId: practitioner, roomId: room, firstDate: date || c.date, time })}</details>` : ''}`) + '</div>'
}

/** Every visit of the day or week, every stamp, status, with check-in: the grid's accessible twin, folded under it. One Stripe line covers every check-in. */
function listPanel(s: any, c: any) {
  const block = s.payments?.stripe?.block, once = (html: string) => block ? html.replace(`<p class="help">${h(block)}</p>`, '') : html
  const shown = c.appointments.filter((a: any) => c.columns.some((column: any) => inColumn(c, column, a)))
  const items = shown.map((a: any) => `<li><span class="when">${h(new Intl.DateTimeFormat('en-US', { timeZone: c.zone, weekday: c.view === 'week' ? 'short' : undefined, hour: 'numeric', minute: '2-digit' }).format(new Date(a.start_at)))}</span>`
    + `<div class="what"><strong>${h(a.client)}</strong> <span class="help">${h(a.service)} with ${h(a.practitioner)}${a.room ? ` · ${h(a.room)}` : ''}${a.equipment ? ` · ${h(a.equipment)}` : ''}${a.payer ? ` · ${h(a.payer)}` : ''}</span><p class="chips">${status(statusLabel[a.status] ?? a.status)} ${a.patient_response && a.patient_response !== 'awaiting' ? status(a.patient_response) : ''} ${intakeChip(a)} ${a.series_id ? status('Series') : ''} ${noteChip(a)} ${planChip(s, a)}</p></div>`
    + `<div class="row-links"><a href="${h(calendarLink(c, { appt: a.id }))}#visit">${a.status === 'booked' ? 'Change' : 'Details'}</a> · <a href="/app/clients/${h(a.client_id)}">Client file</a>${once(checkInActions(s, a, calendarLink(c)))}</div></li>`).join('')
  const title = c.view === 'week' ? 'This week as a list' : 'This day as a list'
  return `<details class="panel day-list full"><summary><h2>${title}</h2><span class="help">${shown.length} ${shown.length === 1 ? 'visit' : 'visits'}, every status</span></summary>${notesTally(c.appointments)}${block && items.includes('pay.checkin') ? `<p class="help">${h(block)}</p>` : ''}${items ? `<ul class="visit-rows">${items}</ul>` : empty('No visits.')}</details>`
}

export function schedule(s: any, notice: any = {}) {
  const c = s.calendar
  const intro = owner(s) ? `<p class="help">The whole clinic’s calendar. Your public booking page is <a href="/book">/book</a>; clients waiting for a time are on the <a href="/app/waitlist">Waitlist</a>.</p>`
    : desk(s) ? '<p class="help">Everyone’s calendar. Clinical notes and intake answers stay with practitioners.</p>' : '<p class="help">Your calendar.</p>'
  const offered = c.offered ? `<div class="notice" role="status">The freed time was offered by email to ${c.offered} ${c.offered === 1 ? 'person' : 'people'} on the waitlist. The first to accept is booked.</div>` : ''
  const side = selectedPanel(s, c, notice) || (canBook(s) ? bookPanel(s, c, notice) : '')
  const how = `<p class="help cal-help">Times are in ${h(zoneLabel(c.zone))}. ${canBook(s) ? 'Select a visit to change it, drag it to a new time, or select an empty time to book.' : ''} Shaded times are outside the practitioner’s hours.</p>`
  return `<div class="today${side ? '' : ' single'}${c.view === 'week' ? ' week' : ''}"><div class="today-main">${heading(s, c)}${offered}${owner(s) ? setupChecklist(s) : ''}${calendarGrid(s, c)}${calendarAgenda(s, c)}${moveForm(c)}${how}${intro}</div>${side ? `<aside class="today-side">${side}</aside>` : ''}</div>`
    + `<div class="grid today-more">${pendingEstimatePanel(s)}${breakGlassNoticePanel(s)}${dailyClosePanel(s)}${notesToSign(s)}${documentationDailyClose(s)}${listPanel(s, c)}${calendarFeedPanel(s, notice)}</div>`
}

