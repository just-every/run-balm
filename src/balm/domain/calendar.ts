// The schedule as a calendar: a day or a week, by practitioner or by room, in
// the clinic's time zone. A practitioner sees only their own diary.
import { datePlus, firstInstantOfHostDate, hostDateAt, weekdayForDate } from '../availability/timezone'
import { visibleAppointment } from './booking'
import { one, practitionerId, rows, type Actor } from './model'

const isDay = (value: unknown): value is string => typeof value === 'string' && /^\d{4}-\d\d-\d\d$/.test(value) && new Date(value + 'T00:00:00Z').toISOString().slice(0, 10) === value

export async function calendarView(db: D1Database, who: Actor, params: Record<string, string>) {
  const zone = (await one(db, 'SELECT time_zone FROM bm_settings WHERE id=1'))!.time_zone as string
  const desk = who.role === 'owner' || who.staffRole === 'reception', own = practitionerId(who)
  const today = hostDateAt(new Date(), zone), date = isDay(params.date) ? params.date : today
  const view = params.view === 'week' ? 'week' : 'day', by = params.by === 'room' && desk ? 'room' : 'practitioner'
  const practitioners = (await rows(db, "SELECT id,name FROM bm_staff WHERE role='practitioner' AND active=1 AND erased_at IS NULL ORDER BY name")).filter(p => desk || p.id === own)
  const rooms = await rows(db, 'SELECT id,name FROM bm_rooms WHERE active=1 ORDER BY name')
  const subjects = by === 'room' ? [...rooms, { id: 'none', name: 'No room' }] : practitioners
  const chosen = subjects.find(s => s.id === params.id)
  const first = view === 'week' ? datePlus(date, -weekdayForDate(date)) : date, days = view === 'week' ? 7 : 1
  const dates = Array.from({ length: days }, (_, i) => datePlus(first, i))
  const weekly = chosen ?? subjects[0]
  const columns = view === 'week'
    ? (weekly ? dates.map(d => ({ key: d, date: d, label: d, subject: weekly.id as string })) : [])
    : (chosen ? [chosen] : subjects).map(s => ({ key: s.id as string, date, label: s.name as string, subject: s.id as string }))
  const from = firstInstantOfHostDate(first, zone)!.toISOString(), to = firstInstantOfHostDate(datePlus(first, days), zone)!.toISOString()
  const appointments = await rows(db, `SELECT a.id,a.client_id,a.practitioner_id,a.service_id,a.room_id,a.series_id,a.start_at,a.end_at,a.status,a.booked_via,a.version,a.offer_id,
    c.first_name||' '||c.last_name AS client,p.name AS practitioner,s.name AS service,r.name AS room,(SELECT 1 FROM bm_intake_responses i WHERE i.appointment_id=a.id) AS intake_received
    FROM bm_appointments a JOIN bm_clients c ON c.id=a.client_id JOIN bm_staff p ON p.id=a.practitioner_id JOIN bm_services s ON s.id=a.service_id LEFT JOIN bm_rooms r ON r.id=a.room_id
    WHERE a.start_at<? AND a.end_at>? AND (? OR a.practitioner_id=?) ORDER BY a.start_at`, to, from, desk ? 1 : 0, own ?? '')
  const hours = await rows(db, 'SELECT practitioner_id,weekday,start_minute,end_minute FROM bm_hours')
  let selected = null
  if (params.appt) {
    const row = await visibleAppointment(db, who, params.appt).catch(() => null)
    if (row) {
      const detail = await one(db, `SELECT a.*,c.first_name||' '||c.last_name AS client,p.name AS practitioner,s.name AS service,r.name AS room FROM bm_appointments a
        JOIN bm_clients c ON c.id=a.client_id JOIN bm_staff p ON p.id=a.practitioner_id JOIN bm_services s ON s.id=a.service_id LEFT JOIN bm_rooms r ON r.id=a.room_id WHERE a.id=?`, row.id)
      const series = row.series_id ? await one(db, `SELECT COUNT(*) AS total,SUM(start_at<=?) AS position,SUM(status='booked' AND start_at>=?) AS remaining,
        (SELECT skipped FROM bm_series WHERE id=?) AS skipped FROM bm_appointments WHERE series_id=?`, row.start_at, row.start_at, row.series_id, row.series_id) : null
      selected = { ...detail, series: series ? { ...series, skipped: JSON.parse(series.skipped as string) } : null }
    }
  }
  return { zone, today, date, view, by, subject: (view === 'week' ? weekly?.id : chosen?.id) ?? null, dates, columns, appointments, hours, practitioners, rooms, subjects, selected,
    previous: datePlus(date, -days), next: datePlus(date, days),
    newSlot: /^\d{4}-\d\d-\d\dT\d\d:\d\d$/.test(params.new ?? '') ? params.new : null, col: subjects.some(x => x.id === params.col) ? params.col : null,
    offered: /^\d{1,3}$/.test(params.offered ?? '') ? Number(params.offered) : 0 }
}
