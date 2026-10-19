// The report date range: whole clinic-local dates in the clinic's time zone,
// inclusive at both ends, at most a year; by default this month through today.
import { datePlus, firstInstantOfHostDate, hostDateAt } from '../availability/timezone'
import { day, insist, one, type Data } from '../domain/model'

export async function reportRange(db: D1Database, input: Data) {
  const settings = await one(db, 'SELECT time_zone,holidays FROM bm_settings WHERE id=1')
  insist(settings?.time_zone, 'clinic_time_zone_not_set', 409)
  const zone = String(settings.time_zone), today = hostDateAt(new Date(), zone)
  const from = input.from ? day(input.from, 'from') : today.slice(0, 8) + '01', to = input.to ? day(input.to, 'to') : today
  insist(from <= to, 'report_date_range_reversed')
  insist(Date.parse(to) - Date.parse(from) <= 366 * 86400_000, 'report_range_longer_than_a_year')
  const start = firstInstantOfHostDate(from, zone), end = firstInstantOfHostDate(datePlus(to, 1), zone)
  insist(start && end, 'invalid_report_date_range')
  const holidays = new Set((JSON.parse(String(settings.holidays ?? '[]')) as { date: string }[]).map(h => h.date))
  return { from, to, zone, today, holidays, start: start.toISOString(), end: end.toISOString(), days: Math.round((Date.parse(to) - Date.parse(from)) / 86400_000) + 1 }
}
