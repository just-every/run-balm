// The calendar grid: one column per practitioner or room (day view) or per day
// (week view), 15-minute rows in the clinic's time zone, labelled every half
// hour. Visits are cards with their chips; free half hours between visits inside
// a practitioner's hours are open slots with the waitlist count. Cards are placed
// with the grid classes in calendar-style.ts, so the page needs no inline styles.
import { weekdayForDate, zonedParts } from '../availability/timezone'
import { icon } from './icons'
import { avatar } from './shell'
import { desk, h, money } from './shared'

const step = 15
export const calendarLink = (c: any, extra: Record<string, string> = {}) => {
  const params = new URLSearchParams({ view: c.view, date: c.date, by: c.by, ...(c.subject ? { id: c.subject } : {}), ...extra })
  for (const [key, value] of [...params]) if (!value) params.delete(key)
  return `/app?${params}`
}
export const local = (iso: string, zone: string) => { const p = zonedParts(new Date(iso), zone); return { date: `${p.year}-${String(p.month).padStart(2, '0')}-${String(p.day).padStart(2, '0')}`, minute: p.hour * 60 + p.minute } }
export const clockLabel = (minute: number) => new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', hour: 'numeric', minute: '2-digit' }).format(new Date(Date.UTC(2026, 0, 1, 0, minute)))
const hhmm = (minute: number) => `${String(Math.floor(minute / 60)).padStart(2, '0')}:${String(minute % 60).padStart(2, '0')}`
/** 9:00 – 9:45 for a card; the period shows only when the visit crosses noon. */
export const span = (start: string, end: string, zone: string) => {
  const part = (iso: string) => new Intl.DateTimeFormat('en-US', { timeZone: zone, hour: 'numeric', minute: '2-digit' }).format(new Date(iso))
  const [a, b] = [part(start), part(end)], same = a.slice(-2) === b.slice(-2)
  return `${same ? a.slice(0, -3) : a} – ${same ? b.slice(0, -3) : b}`
}
export const statusLabel: Record<string, string> = { booked: 'Booked', attended: 'Attended', no_show: 'Did not attend', cancelled: 'Canceled' }

/** Whether a visit belongs in a column; the grid draws only live ones, the list under it every status. */
export function inColumn(c: any, column: any, a: any) {
  if (local(a.start_at, c.zone).date !== column.date) return false
  if (c.by === 'room') return column.subject === 'none' ? !a.room_id : a.room_id === column.subject
  if (c.by === 'equipment') return a.equipment_id === column.subject
  return a.practitioner_id === column.subject
}
function openWindows(c: any, column: any) {
  if (c.by !== 'practitioner') return null
  const weekday = weekdayForDate(column.date)
  return c.hours.filter((w: any) => w.practitioner_id === column.subject && w.weekday === weekday)
}

/** A visit's colour: coral when this visit's claim was denied or the patient is past Medicare's KX threshold, sage when attended with a signed note, honey while its note waits, sky when booked. */
export function visitTone(a: any) {
  if (Number(a.claims_to_fix) > 0 || Number(a.kx_required) === 1) return 'coral'
  if (a.status === 'attended') return a.note_status === 'signed' ? 'sage' : 'honey'
  if (a.status === 'no_show') return 'muted'
  return 'sky'
}
export const toneIcon: Record<string, string> = { coral: 'warning', sage: 'checked', honey: 'pen', muted: 'x', sky: 'calendar' }

/** The chips a card carries, most important first: the coral flag, the note state, the visit's flags, the service, then the payer, so a
 * narrow card that keeps only the first ones still shows whether its note is signed and drops the payer, which the
 * patient panel carries. The flag has a short form ("KX", "Denied") that the narrowest half-hour cards print, so the
 * flag and the note state share their one chip row. */
export function visitChips(s: any, a: any) {
  const pay = s.payments?.visits?.[a.id]
  const chips: [string, string, string?][] = []
  if (a.alerts?.length) chips.push([`${a.alerts.length} patient ${a.alerts.length === 1 ? 'alert' : 'alerts'}`, 'coral', 'Alert'])
  if (Number(a.claims_to_fix) > 0) chips.push(['Claim denied', 'coral', 'Denied'])
  else if (Number(a.kx_required) === 1) chips.push(['KX threshold', 'coral', 'KX'])
  if (a.note_status === 'signed') chips.push(['Signed', 'sage'])
  else if (a.status === 'attended') chips.push(['Note to sign', 'honey'])
  // SCHED-002 flags, ahead of the service and payer the patient panel also carries: intake, the covering authorization
  // and, for the desk, the patient's open balance.
  if (a.status === 'booked') chips.push(a.intake_received || a.intake_on_file ? ['Intake in', ''] : ['Intake due', 'honey'])
  if (a.authorization) chips.push([`${a.authorization.left} of ${a.authorization.visits} visits left`, a.authorization.left <= 2 ? 'honey' : '', `${a.authorization.left} left`])
  if (Number(a.balance_cents) > 0) chips.push([`${money(Number(a.balance_cents))} owed`, 'honey'])
  chips.push([a.service, ''], [a.payer ?? 'Self-pay', ''])
  if (a.equipment) chips.push([a.equipment, ''])
  if (pay?.copayCents > 0 && a.status === 'booked') chips.push([`${money(pay.copayCents)} copay`, ''])
  if (pay?.card) chips.push(['Card on file', ''])
  if (a.series_id) chips.push(['Series', ''])
  if (a.offer_id) chips.push(['Waitlist', ''])
  return chips
}

/** Free half hours or more inside a practitioner's hours, from now on, between their live visits. */
export function openSlots(c: any, column: any, live: any[], now = Date.now()) {
  const windows = openWindows(c, column)
  if (!windows || column.date < c.today) return []
  const taken = live.filter(a => inColumn(c, column, a)).map(a => { const start = local(a.start_at, c.zone).minute; return [start, start + Math.round((Date.parse(a.end_at) - Date.parse(a.start_at)) / 60_000)] })
  const nowMinute = column.date === c.today ? local(new Date(now).toISOString(), c.zone).minute : 0
  const out: [number, number][] = [], earliest = Math.ceil(nowMinute / 15) * 15
  for (const w of windows) {
    const busy = taken.filter(([from, to]) => to > w.start_minute && from < w.end_minute).sort((x, y) => x[0] - y[0])
    if (!busy.length) continue
    // Between visits only: a stretch with no visit on either side is plain free time, not a slot to fill.
    let cursor = w.start_minute, afterVisit = false
    for (const [from, to] of [...busy, [w.end_minute, w.end_minute]]) {
      const start = Math.max(cursor, earliest), end = Math.min(from, w.end_minute)
      if (end - start >= 30 && end - start <= 120 && (afterVisit || from < w.end_minute)) out.push([start, end])
      cursor = Math.max(cursor, to); afterVisit = true
    }
  }
  return out
}
export const waitingFor = (s: any, column: any) => (s.waitlist?.entries ?? []).filter((e: any) => e.status === 'waiting' && (!e.practitioner_id || e.practitioner_id === column.subject) && e.earliest_date <= column.date && e.latest_date >= column.date).length

/** A visit card's time: the start, then the end in its own span so a narrow half-hour card can keep the start alone. */
const timeSpans = (time: string) => { const [from, to] = time.split(' – '); return `<span class="appt-time"><span class="t-from">${h(from)}</span><span class="t-to"> – ${h(to)}</span></span>` }

/** A visit card's link attributes and content: status glyph, time, name and chips. The grid places it; the phone agenda lists it. */
export function visitCard(s: any, c: any, a: any, classes: string, extra = '') {
  const time = span(a.start_at, a.end_at, c.zone), tone = visitTone(a), chips = visitChips(s, a)
  return `<a class="appt st-${h(a.status)} tone-${tone} ${classes}${c.selected?.id === a.id ? ' chosen' : ''}" href="${h(calendarLink(c, { appt: a.id }))}#visit"${extra} aria-label="${h(`${time} ${a.client}, ${a.service}, ${statusLabel[a.status] ?? a.status}`)}">`
    + `${icon(toneIcon[tone], 'mark')}<span class="appt-copy">${timeSpans(time)}<strong>${h(a.client)}</strong>`
    + `<span class="appt-tags">${chips.map(([text, t, brief], k) => `<span class="tag${t ? ' ' + t : ''} k${Math.min(k, 3)}">${brief ? `<span class="full">${h(text)}</span><span class="brief">${h(brief)}</span>` : h(text)}</span>`).join('')}</span></span>${icon('chevron', 'go')}</a>`
}
/** A practitioner's name with the credential kept whole on one line ("CCC-SLP" never breaks). */
export const practitionerName = (column: any) => `${h(column.label)}${column.credentials ? `, <span class="cred">${h(column.credentials)}</span>` : ''}`

/** Partition the visible row intervals into connected groups and reusable lanes.
 * Row intervals matter here: two five-minute visits can share a painted quarter
 * hour even when their exact times do not overlap. Neither may cover the other. */
function visitGroups(visits: any[], zone: string, lo: number, hi: number) {
  const sorted = visits.map(a => {
    const minute = local(a.start_at, zone).minute
    const start = Math.floor((Math.max(lo, minute) - lo) / step)
    const end = Math.min((hi - lo) / step, Math.max(start + 1, Math.ceil((minute + (Date.parse(a.end_at) - Date.parse(a.start_at)) / 60_000 - lo) / step)))
    return { a, start, end }
  }).sort((a, b) => a.start - b.start || b.end - a.end || String(a.a.id).localeCompare(String(b.a.id)))
  const groups: { start: number; end: number; lanes: typeof sorted[] }[] = []
  for (const visit of sorted) {
    let group = groups[groups.length - 1]
    if (!group || visit.start >= group.end) {
      group = { start: visit.start, end: visit.end, lanes: [] }
      groups.push(group)
    }
    const lane = group.lanes.find(lane => lane[lane.length - 1].end <= visit.start)
    if (lane) lane.push(visit)
    else group.lanes.push([visit])
    group.end = Math.max(group.end, visit.end)
  }
  return groups
}

export function calendarGrid(s: any, c: any) {
  const none = c.by === 'room' ? 'rooms' : c.by === 'equipment' ? 'equipment' : 'practitioners'
  if (!c.columns.length) return `<div class="empty-state">${icon('people')}<h2>No ${none} yet</h2><p>No ${none} yet. The owner adds ${c.by === 'equipment' ? 'it' : 'them'} on the Clinic page.</p>${s.actor.role === 'owner' ? '<a class="button secondary" href="/app/clinic">Open Clinic</a>' : ''}</div>`
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
  let html = `<div class="cal-head rs1 cs1">Time</div>`
  c.columns.forEach((column: any, i: number) => {
    const count = live.filter((a: any) => inColumn(c, column, a)).length, tally = `<small>${count === 1 ? '1 appointment' : `${count} appointments`}</small>`
    const label = c.view === 'week'
      ? `<span><a href="${h(calendarLink({ ...c, view: 'day', date: column.date }, { id: '' }))}"><strong>${h(new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', weekday: 'short', month: 'short', day: 'numeric' }).format(new Date(column.date + 'T00:00:00Z')))}</strong></a>${column.date === c.today ? `<small>Today · ${count === 1 ? '1 appointment' : `${count} appointments`}</small>` : tally}</span>`
      : `${c.by === 'practitioner' ? avatar(column.label) : ''}<span><strong>${practitionerName(column)}</strong>${tally}</span>`
    html += `<div class="cal-head rs1 cs${i + 2}${column.date === c.today && c.view === 'week' ? ' is-today' : ''}">${label}</div>`
  })
  for (let minute = lo; minute < hi; minute += 30) html += `<div class="cal-time rs${row(minute)} re${Math.min(2, (hi - minute) / step)} cs1">${h(clockLabel(minute))}</div>`
  c.columns.forEach((column: any, i: number) => {
    const windows = openWindows(c, column)
    html += `<div class="cal-track rs2 re${rowsCount} cs${i + 2}">`
    for (let minute = lo; minute < hi; minute += step) {
      const open = !windows || windows.some((w: any) => minute >= w.start_minute && minute < w.end_minute)
      const book = canBook(column) ? ` data-book="${h(calendarLink(c, { new: `${column.date}T${hhmm(minute)}`, col: column.subject }))}#book"` : ''
      html += `<div class="cell rs${row(minute) - 1} cs1${open ? '' : ' off'}${minute % 60 === 0 ? ' hour' : minute % 30 === 0 ? ' half' : ''}" data-date="${column.date}" data-time="${hhmm(minute)}" data-col="${h(column.subject)}"${book}></div>`
    }
    if (canBook(column)) for (const [from, to] of openSlots(c, column, live)) {
      const waiting = waitingFor(s, column)
      html += `<a class="openslot${to - from <= 30 ? ' compact' : ''} rs${row(from) - 1} re${Math.max(1, Math.round((to - from) / step))} cs1" href="${h(calendarLink(c, { new: `${column.date}T${hhmm(from)}`, col: column.subject }))}#book">${icon('open')}<span><strong>Open slot</strong><small>${waiting ? `${waiting} on the waitlist` : `${h(clockLabel(from))} – ${h(clockLabel(to))}`}</small></span></a>`
    }
    const card = ({ a, start, end }: { a: any; start: number; end: number }, offset: number) => {
      const spanRows = end - start
      const movable = a.status === 'booked' && (desk(s) || a.practitioner_id === s.actor.staffId)
      return visitCard(s, c, a, `size${Math.min(3, spanRows)} rs${start - offset + 1} re${spanRows} cs1`, movable ? ` draggable="true" data-id="${h(a.id)}" data-version="${h(a.version)}"` : ' draggable="false"')
    }
    for (const group of visitGroups(live.filter((a: any) => inColumn(c, column, a)), c.zone, lo, hi)) {
      html += group.lanes.length === 1 ? group.lanes[0].map(visit => card(visit, 0)).join('')
        : `<div class="overlap rs${group.start + 1} re${group.end - group.start} cs1">${group.lanes.map(lane => `<div class="overlap-lane">${lane.map(visit => card(visit, group.start)).join('')}</div>`).join('')}</div>`
    }
    html += '</div>'
  })
  return `<div class="cal-wrap"><div class="cal n${n}${c.view === 'week' ? ' wk' : ''}" data-calendar data-by="${h(c.by)}">${html}</div></div>`
}

/** The hidden form a drag fills in; the edit panel's form does the same without JavaScript. */
export const moveForm = (c: any) => `<form id="move-form" hidden method="post" action="/app/action?name=appointment.move&amp;returnTo=${encodeURIComponent(calendarLink(c))}" aria-hidden="true">`
  + `<input name="id"><input name="version"><input name="date"><input name="time"><input name="${c.by === 'room' ? 'roomId' : c.by === 'equipment' ? 'equipmentId' : 'practitionerId'}"></form>`
