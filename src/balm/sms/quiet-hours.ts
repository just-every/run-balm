import { insist, optional, text } from '../domain/model'

type Interval = { start: string; end: string }
const clock = /^(?:[01]\d|2[0-3]):[0-5]\d$/
const minutes = (value: string) => Number(value.slice(0, 2)) * 60 + Number(value.slice(3))

/** Patient-supplied IANA zone only; never derive it from a phone, clinic or browser. */
export function patientSmsZone(value: unknown): string | null {
  const zone = optional(value, 'patient_sms_time_zone', 100)
  if (!zone) return null
  insist(zone === 'UTC' || /^[A-Za-z_+-]+(?:\/[A-Za-z0-9_+-]+)+$/.test(zone), 'invalid_patient_sms_time_zone')
  try { new Intl.DateTimeFormat('en-US', { timeZone: zone }).format(0) }
  catch { insist(false, 'invalid_patient_sms_time_zone') }
  return zone
}

/** Daily local-clock intervals, inclusive at the start and exclusive at the end. */
export function quietIntervals(value: unknown): Interval[] {
  const lines = text(value, 'quiet_intervals', 1000).split(/\r?\n/).filter(line => line.trim())
  insist(lines.length > 0 && lines.length <= 8, 'record_one_to_eight_quiet_intervals')
  return lines.map(line => {
    const parts = line.trim().split('-').map(part => part.trim())
    insist(parts.length === 2 && parts.every(part => clock.test(part)) && parts[0] !== parts[1], 'invalid_quiet_interval_use_HH_MM_to_HH_MM')
    return { start: parts[0], end: parts[1] }
  })
}

/** Evaluate actual instants in the patient's zone, including skipped or repeated DST hours. */
export function quietHoursBlock(intervals: unknown, zone: unknown, at: string): string | null {
  let policy: Interval[], patientZone: string | null
  try {
    policy = JSON.parse(String(intervals))
    insist(Array.isArray(policy) && policy.length > 0 && policy.length <= 8, 'invalid_policy')
    insist(policy.every(part => part && clock.test(part.start) && clock.test(part.end) && part.start !== part.end), 'invalid_policy')
  } catch { return 'Not sent: the owner must record valid SMS quiet intervals in Settings.' }
  try { patientZone = patientSmsZone(zone) } catch { patientZone = null }
  if (!patientZone) return 'Not sent: record the patient’s IANA time zone on their file.'
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone: patientZone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(new Date(at))
  const minute = Number(parts.find(part => part.type === 'hour')!.value) * 60 + Number(parts.find(part => part.type === 'minute')!.value)
  return policy.some(part => {
    const start = minutes(part.start), end = minutes(part.end)
    return start < end ? minute >= start && minute < end : minute >= start || minute < end
  }) ? 'Deferred: patient-local quiet hours; no text provider attempt. Rechecked every minute until the visit starts.' : null
}
