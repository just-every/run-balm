// The demo clinic's diary: a week back and a week ahead, laid out inside each
// practitioner's hours in the clinic time zone, with fixed ids so the plan for a
// given `now` is always the same.
import { datePlus, hostDateAt, wallClockInstants, weekdayForDate } from '../availability/timezone'
import { clients, practitioners, series, services, zone, type Client, type Practitioner, type Service } from './people'

export const MIN = 60_000, HOUR = 60 * MIN, DAY = 24 * HOUR
export type Status = 'booked' | 'attended' | 'cancelled' | 'no_show'
export type Visit = {
  id: string; seq: number; client: Client; practitioner: Practitioner; service: Service
  start: number; end: number; status: Status; via: 'online' | 'staff'; createdAt: number; changedAt: number
  /** The client's visit number with this practitioner (1 is their first). */
  number: number; intakeAt: number | null; seriesId?: string
}

/** Clients who join after the first day: recent and upcoming new patients. */
const joins: Record<string, number> = { 'demo-client-elijah': -3, 'demo-client-victor': -2, 'demo-client-margaret': 1, 'demo-client-isabella': 2, 'demo-client-maria': 3, 'demo-client-caleb': 4 }
const pick = <T>(list: T[], n: number) => list[n % list.length]

const visit = (seq: number, client: Client, p: Practitioner, service: Service, start: number, number: number): Visit => ({ id: `demo-appt-${String(seq + 1).padStart(3, '0')}`, seq, client, practitioner: p, service,
  start, end: start + service.minutes * MIN, status: 'booked', via: 'staff', createdAt: 0, changedAt: 0, number, intakeAt: null })

/** The recurring series' first date: the Tuesday or Thursday that starts the shown week. */
export function seriesStart(now: number) {
  const today = hostDateAt(new Date(now), zone)
  for (let day = -6; ; day++) if (series.weekdays.includes(weekdayForDate(datePlus(today, day)))) return datePlus(today, day)
}

export function plan(now: number): Visit[] {
  const today = hostDateAt(new Date(now), zone), last = new Map<string, number>(), counts = new Map<string, number>(), visits: Visit[] = []
  // The series is booked first; the rest of that practitioner's day works around it.
  const reserved = new Map<string, [number, number][]>(), sp = practitioners.find(p => p.id === series.practitioner)!, ss = services.find(s => s.id === series.service)!
  const seriesFirst = seriesStart(now), seriesClient = clients.find(c => c.id === series.client)!
  for (let offset = 0; offset < series.weeks * 7; offset++) {
    const date = datePlus(seriesFirst, offset), instants = wallClockInstants(date, series.minute, zone)
    if (!series.weekdays.includes(weekdayForDate(date)) || instants.length !== 1) continue
    reserved.set(date, [[series.minute, series.minute + ss.minutes]])
    visits.push({ ...visit(visits.length, seriesClient, sp, ss, instants[0].getTime(), visits.length + 2), seriesId: series.id })
  }
  for (let day = -6; day <= 6; day++) {
    const date = datePlus(today, day), weekday = weekdayForDate(date)
    practitioners.forEach((p, pi) => p.hours.filter(w => w[0] === weekday).forEach(([, open, close], wi) => {
      let cursor = open + pick([0, 15, 30, 0, 45], day + 6 + pi + wi * 3)
      for (let n = 0, cap = pick([2, 3, 2, 1, 3], day + 6 + pi * 2 + wi); n < cap; n++) {
        // The client this practitioner has waited longest to see, never twice in a day.
        const client = clients.filter(c => c.practitioner === p.id && c.id !== series.client && (joins[c.id] ?? -6) <= day && last.get(c.id) !== day)
          .sort((a, b) => (last.get(a.id) ?? -99) - (last.get(b.id) ?? -99))[0]
        if (!client) break
        const count = counts.get(client.id) ?? 0
        const service = services.find(s => s.id === (count ? pick(p.then, count - 1) : p.first))!
        for (const [from, to] of p.id === series.practitioner ? reserved.get(date) ?? [] : []) if (cursor < to && cursor + service.minutes > from) cursor = to + 15
        const instants = wallClockInstants(date, cursor, zone)
        if (cursor + service.minutes > close || instants.length !== 1) break
        last.set(client.id, day); counts.set(client.id, count + 1)
        const seq = visits.length, start = instants[0].getTime()
        visits.push(visit(seq, client, p, service, start, count + 1))
        cursor += service.minutes + pick([0, 15, 30, 0, 60, 15], seq)
      }
    }))
  }
  const previous = new Map<string, Visit>()
  for (const v of visits.sort((a, b) => a.start - b.start)) {
    const first = v.number === 1, before = previous.get(v.client.id)
    previous.set(v.client.id, v)
    // New clients mostly book online; returning ones rebook at the desk after a visit.
    v.via = first && v.seq % 3 !== 0 ? 'online' : 'staff'
    v.createdAt = v.seriesId ? Math.min(Date.parse(seriesFirst + 'T12:00:00Z') - 3 * DAY, now - 2 * HOUR) : before && !first ? Math.min(before.end + 15 * MIN, now - (1 + v.seq % 30) * HOUR) : Math.min(v.start - (2 + v.seq % 6) * DAY, now - (2 + v.seq % 20) * HOUR)
    if (v.start < now - HOUR) v.status = !first && v.seq % 17 === 5 ? 'no_show' : !first && v.seq % 13 === 7 ? 'cancelled' : 'attended'
    else if (v.start > now + HOUR && !first && v.seq % 11 === 3) v.status = 'cancelled'
    v.changedAt = v.status === 'cancelled' ? Math.max(v.createdAt + HOUR, Math.min(v.start - 20 * HOUR, now - 30 * MIN)) : v.status === 'booked' ? v.createdAt : v.end + 5 * MIN
    // Every booking sends its own intake link, so a working clinic's diary shows nearly all of them received: visits that happened,
    // returning clients' upcoming ones, and canceled or missed ones, which were filled in before the change. New clients booked more than three days ahead have not yet.
    if (first && v.status === 'booked' && v.start > now + 3 * DAY) continue
    v.intakeAt = Math.max(v.createdAt + 10 * MIN, Math.min(v.createdAt + (3 + v.seq % 20) * HOUR, v.start - HOUR, now - 10 * MIN, v.status === 'cancelled' ? v.changedAt - 5 * MIN : Infinity))
  }
  return visits
}
