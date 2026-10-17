// The calendar on a phone: the same visits as the grid, as cards stacked in time
// order so nothing is cut at a card edge. The day view shows one practitioner (or
// room) at a time with a switcher that needs no script; the week view stacks its
// days, and a day without visits folds to one line. Open slots between visits
// stay bookable. The grid takes over above 600 px (calendar-style.ts).
import { calendarLink, clockLabel, inColumn, local, openSlots, practitionerName, visitCard, waitingFor } from './calendar'
import { icon } from './icons'
import { avatar } from './shell'
import { desk, h } from './shared'

const dayName = (date: string) => new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', weekday: 'short', month: 'short', day: 'numeric' }).format(new Date(date + 'T00:00:00Z'))
const tally = (n: number) => n === 1 ? '1 appointment' : `${n} appointments`

function items(s: any, c: any, column: any, live: any[]) {
  const mine = live.filter(a => inColumn(c, column, a))
  const bookable = desk(s) || (c.by === 'practitioner' && column.subject === s.actor.staffId)
  const slots = bookable ? openSlots(c, column, live).map(([from, to]) => {
    const waiting = waitingFor(s, column)
    return { at: from, html: `<li><a class="openslot" href="${h(calendarLink(c, { new: `${column.date}T${String(Math.floor(from / 60)).padStart(2, '0')}:${String(from % 60).padStart(2, '0')}`, col: column.subject }))}#book">${icon('open')}<span><strong>Open slot · ${h(clockLabel(from))} – ${h(clockLabel(to))}</strong><small>${waiting ? `${waiting} on the waitlist` : 'Select to book'}</small></span></a></li>` }
  }) : []
  const visits = mine.map(a => ({ at: local(a.start_at, c.zone).minute, html: `<li>${visitCard(s, c, a, 'ag')}</li>` }))
  const all = [...visits, ...slots].sort((x, y) => x.at - y.at)
  return { count: mine.length, html: all.length ? `<ol class="ag-list">${all.map(x => x.html).join('')}</ol>` : '<p class="ag-none">No visits</p>' }
}

export function calendarAgenda(s: any, c: any) {
  if (!c.columns.length) return ''
  const live = c.appointments.filter((a: any) => a.status !== 'cancelled')
  if (c.view === 'week') {
    const days = c.columns.map((column: any) => {
      const { count, html } = items(s, c, column, live), today = column.date === c.today
      const head = `<a href="${h(calendarLink({ ...c, view: 'day', date: column.date }, { id: '' }))}">${h(dayName(column.date))}</a>${today ? ' <span class="ag-today">Today</span>' : ''}`
      return count || today
        ? `<section class="ag-day${today ? ' today' : ''}"><h3>${head}<small>${tally(count)}</small></h3>${html}</section>`
        : `<p class="ag-empty">${head}<small>No visits</small></p>`
    })
    return `<div class="agenda week">${days.join('')}</div>`
  }
  // One column at a time: the selected visit's column first, else the first (the signed-in practitioner's own).
  const chosen = Math.max(0, c.columns.findIndex((column: any) => c.selected && inColumn(c, column, c.selected)))
  const built = c.columns.map((column: any) => ({ column, ...items(s, c, column, live) }))
  const label = (column: any) => c.by === 'practitioner' ? practitionerName(column) : h(column.label)
  const picker = built.length > 1 ? `<div class="ag-pick" role="radiogroup" aria-label="${c.by === 'room' ? 'Room' : 'Practitioner'}">${built.map((b: any, i: number) => `<input type="radio" class="ag-radio" name="agenda-col" id="ag-${i}"${i === chosen ? ' checked' : ''}><label for="ag-${i}">${h(b.column.label)}<small>${b.count}</small></label>`).join('')}</div>` : ''
  const columns = built.map((b: any, i: number) => `<section class="ag-col ag-${i}${built.length > 1 ? '' : ' only'}"><h3>${c.by === 'practitioner' ? avatar(b.column.label) : ''}<span>${label(b.column)}<small>${tally(b.count)}</small></span></h3>${b.html}</section>`).join('')
  return `<div class="agenda day">${picker}${columns}</div>`
}
