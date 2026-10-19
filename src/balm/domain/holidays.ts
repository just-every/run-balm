import { datePlus, firstInstantOfHostDate } from '../availability/timezone'
import { audit, commit, day, guard, human, insist, need, one, stmt, text, type Actor, type Data } from './model'

export function holidayRanges(holidays: { date: string; name: string }[], zone: string) {
  return holidays.map(h => {
    const start = firstInstantOfHostDate(h.date, zone), end = firstInstantOfHostDate(datePlus(h.date, 1), zone)
    insist(start && end, 'holiday_date_not_in_this_time_zone')
    return { date: h.date, name: h.name, startAt: start.toISOString(), endAt: end.toISOString() }
  })
}
/** Clinic settings authority applies to named all-day closures. Existing visits remain for staff to resolve. */
export async function saveHoliday(db: D1Database, who: Actor, input: Data) {
  need(who, 'owner'); human(who)
  const clinic = (await one(db, 'SELECT holidays,time_zone,version FROM bm_settings WHERE id=1'))!
  insist(clinic.time_zone, 'clinic_time_zone_not_set', 409)
  const date = day(input.date, 'holiday_date')
  const list = JSON.parse(clinic.holidays as string).filter((h: { date: string }) => h.date !== date)
  if (input.remove !== true && input.remove !== 'on') list.push({ date, name: text(input.name, 'holiday_name', 120) })
  insist(list.length <= 366, 'too_many_holidays')
  const holidays = holidayRanges(list, clinic.time_zone as string).sort((a,b) => a.date.localeCompare(b.date))
  await commit(db, who, [guard(db, 'EXISTS(SELECT 1 FROM bm_settings WHERE id=1 AND version=?)', clinic.version),
    stmt(db, 'UPDATE bm_settings SET holidays=?,version=version+1 WHERE id=1', JSON.stringify(holidays)),
    audit(db, who, 'holiday.saved', null, null, date)])
  return { saved: true }
}
