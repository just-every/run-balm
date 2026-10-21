import { day, one, rows, type Data } from '../domain/model'
import { hostDateAt } from '../availability/timezone'
import type { BookingWarning } from './types'
import { bookingEpisode } from '../episodes'
import { accountAuthorizations, authorizationCoversVisit, authorizationOrder, lowRemainder, reservationAllowance, selectAuthorization, signedAuthorizationChargeSql, visitAllowance } from './authorization-accounting'

const episodeOf = (kind: string, column: string) => `COALESCE((SELECT episode_id FROM bm_episode_records WHERE record_kind='${kind}' AND record_id=${column}),'') AS episodeId`
const chargeFacts = (db: D1Database, clientId: string) => rows(db, `SELECT * FROM (${signedAuthorizationChargeSql}) WHERE client_id=?`, clientId)

/** Derived counters never drift. Excluding a moved visit releases exactly its
 * own selected authorization and its own configured reservation. */
export async function authorizationsFor(db: D1Database, clientId: string, excludeAppointmentId?: string) {
  const [authorizations, visits, settings, charges] = await Promise.all([
    rows(db, `SELECT z.*,p.client_id,y.unit_method,y.fixed_unit_minutes,${episodeOf('authorization', 'z.id')} FROM bm_authorizations z JOIN bm_policies p ON p.id=z.policy_id JOIN bm_payers y ON y.id=p.payer_id WHERE p.client_id=? ORDER BY z.starts_on DESC,z.id DESC`, clientId),
    rows(db, `SELECT id,client_id,start_at,status,practitioner_id,${episodeOf('visit', 'bm_appointments.id')} FROM bm_appointments WHERE client_id=? AND status IN ('attended','booked')`, clientId),
    one(db, 'SELECT time_zone FROM bm_settings WHERE id=1'), chargeFacts(db, clientId),
  ])
  return accountAuthorizations(authorizations, visits.filter(v => v.id !== excludeAppointmentId), settings!.time_zone, charges)
}

/** Caller applies ordinary booking authority/audit; this helper returns no PHI.
 * A move releases its existing reservation before evaluating its destination. */
export async function bookingWarnings(db: D1Database, clientId: string, date: string, practitionerId?: string, excludeAppointmentId?: string, plannedDates?: string[], episodeId?: string): Promise<BookingWarning[]> {
  const on = day(date.slice(0, 10), 'date'), warnings: BookingWarning[] = []
  const episode = episodeId ?? (excludeAppointmentId ? (await one(db, "SELECT episode_id FROM bm_episode_records WHERE record_kind='visit' AND record_id=?", excludeAppointmentId))?.episode_id ?? '' : await bookingEpisode(db, clientId))
  const [policies, auths, charges] = await Promise.all([
    rows(db, 'SELECT id,starts_on,ends_on,eligibility_status FROM bm_policies WHERE client_id=? AND priority=1', clientId),
    authorizationsFor(db, clientId, excludeAppointmentId), excludeAppointmentId ? chargeFacts(db, clientId) : Promise.resolve([]),
  ])
  const dates = plannedDates?.length ? plannedDates : [on]
  for (const p of policies) {
    if (dates.some(d => d < p.starts_on || p.ends_on && d > p.ends_on)) warnings.push({ code: 'policy_outside_coverage', message: 'The visit is outside the policy coverage dates.', policyId: p.id, blocking: false })
    if (p.eligibility_status === 'inactive' || p.eligibility_status === 'changed') warnings.push({ code: 'eligibility_' + p.eligibility_status, message: p.eligibility_status === 'inactive' ? 'The latest eligibility response says coverage is inactive.' : 'The latest eligibility response names other coverage. Review the policy.', policyId: p.id, blocking: false })
    const choices = auths.filter(a => a.policy_id === p.id && a.episodeId === episode && (!practitionerId || !a.practitioner_id || a.practitioner_id === practitionerId)).sort(authorizationOrder)
    if (!choices.length) continue
    const demand = new Map<string, { authorization: typeof choices[number]; count: number }>()
    for (const date of dates) {
      const current = choices.find(a => a.starts_on <= date && a.ends_on >= date)
      const a = current ?? choices[0], base = warningBase(a)
      if (!current) {
        if (!warnings.some(w => w.code === 'authorization_outside_dates' && w.authorizationId === a.id)) warnings.push({ ...base, code: 'authorization_outside_dates', message: 'The visit is outside the authorization dates.' })
        continue
      }
      if (excludeAppointmentId && !authorizationCoversVisit(a, { id: excludeAppointmentId }, charges)) {
        warnings.push({ ...base, code: 'authorization_not_covered', message: 'This visit is not covered by the current authorization.' })
        continue
      }
      const group = demand.get(a.id) ?? { authorization: a, count: 0 }
      group.count++; demand.set(a.id, group)
    }
    for (const { authorization: a, count } of demand.values()) {
      const needed = count * reservationAllowance(a), left = a.remaining_allowance, base = warningBase(a), label = a.allowance_kind === 'units' ? 'unit' : 'visit'
      if (left < needed) warnings.push({ ...base, code: 'authorization_exhausted', message: `This booking needs ${needed} ${label}${needed === 1 ? '' : 's'}, but only ${left} unreserved authorized ${label}${left === 1 ? ' remains' : 's remain'}.` })
      else if (left <= lowRemainder(a)) warnings.push({ ...base, blocking: false, code: 'authorization_low', message: `${left} unreserved authorized ${label}${left === 1 ? ' remains' : 's remain'}.` })
    }
  }
  return warnings
}

function warningBase(a: Data) {
  return { policyId: a.policy_id as string, authorizationId: a.id as string, remainingVisits: a.remaining_visits as number, remainingAllowance: a.remaining_allowance as number, allowanceKind: (a.allowance_kind ?? 'visits') as 'visits' | 'units', expiresOn: a.ends_on as string, blocking: a.booking_action === 'block' }
}

/** Existing reservations take their chronological position after actual usage.
 * Attended unsigned unit visits reserve the same allowance as future bookings. */
export async function existingVisitWarnings(db: D1Database, clientId: string): Promise<Record<string, BookingWarning[]>> {
  const [policies, auths, visits, settings, charges] = await Promise.all([
    rows(db, 'SELECT id,starts_on,ends_on,eligibility_status FROM bm_policies WHERE client_id=? AND priority=1', clientId),
    authorizationsFor(db, clientId),
    rows(db, `SELECT id,client_id,start_at,status,practitioner_id,${episodeOf('visit', 'bm_appointments.id')} FROM bm_appointments WHERE client_id=? AND status IN ('booked','attended') ORDER BY start_at,id`, clientId),
    one(db, 'SELECT time_zone FROM bm_settings WHERE id=1'), chargeFacts(db, clientId),
  ])
  const reserved = new Map<string, number>(), result: Record<string, BookingWarning[]> = {}
  for (const visit of visits) {
    const on = hostDateAt(new Date(visit.start_at), settings!.time_zone), warnings: BookingWarning[] = []
    for (const policy of policies) {
      if (on < policy.starts_on || policy.ends_on && on > policy.ends_on) warnings.push({ code: 'policy_outside_coverage', message: 'The visit is outside the policy coverage dates.', policyId: policy.id, blocking: false })
      if (policy.eligibility_status === 'inactive' || policy.eligibility_status === 'changed') warnings.push({ code: 'eligibility_' + policy.eligibility_status, message: policy.eligibility_status === 'inactive' ? 'The latest eligibility response says coverage is inactive.' : 'The latest eligibility response names other coverage. Review the policy.', policyId: policy.id, blocking: false })
      const choices = auths.filter(a => a.policy_id === policy.id && a.episodeId === visit.episodeId && (!a.practitioner_id || a.practitioner_id === visit.practitioner_id))
      if (!choices.length) continue
      const current = selectAuthorization(choices, policy.id, on, visit.practitioner_id, visit.episodeId), a = current ?? choices[0], base = warningBase(a)
      if (!current) warnings.push({ ...base, code: 'authorization_outside_dates', message: 'The visit is outside the authorization dates.' })
      else if (!authorizationCoversVisit(a, visit, charges)) warnings.push({ ...base, code: 'authorization_not_covered', message: 'This visit is not covered by the current authorization.' })
      else {
        const usage = visitAllowance(a, visit, charges), position = (reserved.get(a.id) ?? 0) + usage.reserved
        reserved.set(a.id, position)
        const label = a.allowance_kind === 'units' ? 'unit' : 'visit'
        if (a.used_allowance + position > a.allowance_total) warnings.push({ ...base, code: 'authorization_exhausted', message: `This visit exceeds the authorized ${label} allowance.` })
        else if (a.used_allowance + a.reserved_allowance <= a.allowance_total && a.remaining_allowance <= lowRemainder(a)) warnings.push({ ...base, blocking: false, code: 'authorization_low', message: `${a.remaining_allowance} unreserved authorized ${label}${a.remaining_allowance === 1 ? ' remains' : 's remain'}.` })
      }
    }
    result[visit.id] = warnings
  }
  return result
}
