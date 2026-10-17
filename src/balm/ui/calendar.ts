// The calendar grid: one column per practitioner or room (day view) or per day
// (week view), 15-minute rows in the clinic's time zone. Visits are placed with
// the grid classes in calendar-style.ts, so the page needs no inline styles.
import { weekdayForDate, zonedParts } from '../availability/timezone'
import { desk, h } from './shared'

const step = 15
export const calendarLink = (c: any, extra: Record<string, string> = {}) => {
  const params = new URLSearchParams({ view: c.view, date: c.date, by: c.by, ...(c.subject ? { id: c.subject } : {}), ...extra })
  for (const [key, value] of [...params]) if (!value) params.delete(key)
  return `/app?${params}`
}
const local = (iso: string, zone: string) => { const p = zonedParts(new Date(iso), zone); return { date: `${p.year}-${String(p.month).padStart(2, '0')}-${String(p.day).padStart(2, '0')}`, minute: p.hour * 60 + p.minute } }
export const clockLabel = (minute: number) => new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', hour: 'numeric', minute: '2-digit' }).format(new Date(Date.UTC(2026, 0, 1, 0, minute)))
const hhmm = (minute: number) => `${String(Math.floor(minute / 60)).padStart(2, '0')}:${String(minute % 60).padStart(2, '0')}`
export const statusLabel: Record<string, string> = { booked: 'Booked', attended: 'Attended', no_show: 'Did not attend', cancelled: 'Canceled' }

/** Whether a visit belongs in a column; the grid draws only live ones, the list under it every status. */
export function inColumn(c: any, column: any, a: any) {
  if (local(a.start_at, c.zone).date !== column.date) return false
  if (c.by === 'room') return column.subject === 'none' ? !a.room_id : a.room_id === column.subject
  return a.practitioner_id === column.subject
}
function openWindows(c: any, column: any) {
  if (c.by === 'room') return null
  const weekday = weekdayForDate(column.date)
  return c.hours.filter((w: any) => w.practitioner_id === column.subject && w.weekday === weekday)
}

export function calendarGrid(s: any, c: any) {
  if (!c.columns.length) return `<p class="empty">${c.by === 'room' ? 'No rooms yet. The owner adds rooms on the Clinic page.' : 'No practitioners yet. The owner adds them on the Clinic page.'}</p>`
  const live = c.appointments.filter((a: any) => a.status !== 'cancelled')
  // The visible hours: every open window and visit shown, at least 8 AM to 6 PM.
  let lo = 8 * 60, hi = 18 * 60
  for (const column of c.columns) {
    for (const w of openWindows(c, column) ?? []) { lo = Math.min(lo, w.start_minute); hi = Math.max(hi, w.end_minute) }
    for (const a of live.filter((a: any) => inColumn(c, column, a))) { const start = local(a.start_at, c.zone).minute; lo = Math.min(lo, start); hi = Math.max(hi, Math.min(1440, start + (Date.parse(a.end_at) - Date.parse(a.start_at)) / 60_000)) }
  }
  lo = Math.floor(lo / 60) * 60; hi = Math.min(1440, Math.ceil(hi / 60) * 60)
  const rowsCount = (hi - lo) / step, n = c.columns.length
  const row = (minute: number) => 2 + Math.floor((minute - lo) / step)
  const canBook = (column: any) => desk(s) || (c.by === 'practitioner' && column.subject === s.actor.staffId)
  let html = `<div class="cal-head rs1 cs1"></div>`
  c.columns.forEach((column: any, i: number) => {
    const label = c.view === 'week' ? `<a href="${h(calendarLink({ ...c, view: 'day', date: column.date }, { id: '' }))}">${h(new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', weekday: 'short', month: 'short', day: 'numeric' }).format(new Date(column.date + 'T00:00:00Z')))}</a>` : h(column.label)
    html += `<div class="cal-head rs1 cs${i + 2}${column.date === c.today && c.view === 'week' ? ' today' : ''}">${label}</div>`
  })
  for (let minute = lo; minute < hi; minute += 60) html += `<div class="cal-time rs${row(minute)} re${Math.min(4, (hi - minute) / step)} cs1">${h(clockLabel(minute))}</div>`
  c.columns.forEach((column: any, i: number) => {
    const windows = openWindows(c, column)
    for (let minute = lo; minute < hi; minute += step) {
      const open = !windows || windows.some((w: any) => minute >= w.start_minute && minute < w.end_minute)
      const book = canBook(column) ? ` data-book="${h(calendarLink(c, { new: `${column.date}T${hhmm(minute)}`, col: column.subject }))}#book"` : ''
      html += `<div class="cell rs${row(minute)} cs${i + 2}${open ? '' : ' off'}${minute % 60 === 0 ? ' hour' : ''}" data-date="${column.date}" data-time="${hhmm(minute)}" data-col="${h(column.subject)}"${book}></div>`
    }
    for (const a of live.filter((a: any) => inColumn(c, column, a))) {
      const start = Math.max(lo, local(a.start_at, c.zone).minute), span = Math.max(1, Math.min(rowsCount - (row(start) - 2), Math.ceil((Date.parse(a.end_at) - Date.parse(a.start_at)) / 60_000 / step)))
      const time = `${new Intl.DateTimeFormat('en-US', { timeZone: c.zone, hour: 'numeric', minute: '2-digit' }).format(new Date(a.start_at))}–${new Intl.DateTimeFormat('en-US', { timeZone: c.zone, hour: 'numeric', minute: '2-digit' }).format(new Date(a.end_at))}`
      const where = c.by === 'room' ? a.practitioner : a.room
      const movable = a.status === 'booked' && (desk(s) || a.practitioner_id === s.actor.staffId)
      html += `<a class="appt st-${h(a.status)} rs${row(start)} re${span} cs${i + 2}${c.selected?.id === a.id ? ' chosen' : ''}" href="${h(calendarLink(c, { appt: a.id }))}#visit"${movable ? ` draggable="true" data-id="${h(a.id)}" data-version="${h(a.version)}"` : ' draggable="false"'} aria-label="${h(`${time} ${a.client}, ${a.service}, ${statusLabel[a.status] ?? a.status}`)}">`
        + `<span class="appt-time">${h(time)}</span> <strong>${h(a.client)}</strong><span class="appt-meta">${h(a.service)}${where ? ` · ${h(where)}` : ''}</span>`
        + `<span class="appt-tags"><span class="tag">${h(statusLabel[a.status] ?? a.status)}</span>${a.series_id ? '<span class="tag">Series</span>' : ''}${a.offer_id ? '<span class="tag">Waitlist</span>' : ''}${a.note_status === 'signed' ? '<span class="tag done">Note signed ✓</span>' : a.note_status === 'unsigned' || a.status === 'attended' ? '<span class="tag todo">Note to sign</span>' : ''}</span></a>`
    }
  })
  return `<div class="cal-wrap"><div class="cal n${n}" data-calendar data-by="${h(c.by)}">${html}</div></div>`
}

/** The hidden form a drag fills in; the edit panel's form does the same without JavaScript. */
export const moveForm = (c: any) => `<form id="move-form" hidden method="post" action="/app/action?name=appointment.move&amp;returnTo=${encodeURIComponent(calendarLink(c))}" aria-hidden="true">`
  + `<input name="id"><input name="version"><input name="date"><input name="time"><input name="${c.by === 'room' ? 'roomId' : 'practitionerId'}"></form>`
