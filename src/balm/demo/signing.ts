// Who has signed their treatment notes in the demo clinic. Practitioners sign within a day
// or two, so only the last few attended visits (yesterday and today) wait for a signature.
import { hostDateAt } from '../availability/timezone'
import { zone } from './people'
import { DAY, HOUR, MIN, type Visit } from './visits'

/** The attended visits whose note is still unsigned: yesterday's and today's, between three and six of the most recent. */
export function awaitingSignature(visits: Visit[], now: number) {
  const since = hostDateAt(new Date(now - DAY), zone), attended = visits.filter(v => v.status === 'attended').sort((a, b) => b.end - a.end)
  const recent = attended.filter(v => hostDateAt(new Date(v.start), zone) >= since).length
  return new Set(attended.slice(0, Math.min(6, Math.max(3, recent))).map(v => v.id))
}

const hourIn = new Intl.DateTimeFormat('en-US', { timeZone: zone, hour: 'numeric', hourCycle: 'h23' })
const clinicHour = (at: number) => Number(hourIn.format(at))

/** When the practitioner signed: some hours after writing the note, and after its correction if it has one. Nobody signs at night; those wait for the next morning. */
export function signedAt(v: Visit, written: number, amendedAt: number | null, now: number) {
  let at = Math.max(written + (1 + v.seq % 6) * HOUR, amendedAt === null ? 0 : amendedAt + HOUR)
  if (clinicHour(at) >= 19 || clinicHour(at) < 7) {
    at = Math.floor(at / HOUR) * HOUR
    while (clinicHour(at) !== 7) at += HOUR
    at += (30 + v.seq % 60) * MIN
  }
  return Math.min(at, now - 10 * MIN)
}
