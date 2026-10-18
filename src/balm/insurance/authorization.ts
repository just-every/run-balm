import { day, one, rows, type Data } from '../domain/model'
import { hostDateAt } from '../availability/timezone'
import type { BookingWarning } from './types'

/** Each attended or booked visit belongs to the most recently starting
 * authorization that covers its local date/provider. Counters cannot drift. */
export async function authorizationsFor(db: D1Database, clientId: string) {
  const [authorizations,visits,settings]=await Promise.all([
    rows(db,`SELECT z.*,p.client_id FROM bm_authorizations z JOIN bm_policies p ON p.id=z.policy_id WHERE p.client_id=? ORDER BY z.starts_on DESC,z.id DESC`,clientId),
    rows(db,"SELECT id,start_at,status,practitioner_id FROM bm_appointments WHERE client_id=? AND status IN ('attended','booked')",clientId),
    one(db,'SELECT time_zone FROM bm_settings WHERE id=1')
  ])
  const out:(Data & {used_visits:number;reserved_visits:number})[]=authorizations.map(a=>({...a,used_visits:0,reserved_visits:0}))
  for(const visit of visits) {
    const date=hostDateAt(new Date(visit.start_at),settings!.time_zone)
    const policies=new Set<string>()
    for(const a of out)if(!policies.has(a.policy_id)&&date>=a.starts_on&&date<=a.ends_on&&(!a.practitioner_id||a.practitioner_id===visit.practitioner_id)) {
      policies.add(a.policy_id);visit.status==='attended'?a.used_visits++:a.reserved_visits++
    }
  }
  return out
}
/** Caller applies ordinary booking authority/audit; this helper returns no PHI.
 * excludeAppointmentId lets a move release its existing reservation first. */
export async function bookingWarnings(db: D1Database, clientId: string, date: string, practitionerId?: string,excludeAppointmentId?:string, plannedDates?: string[]): Promise<BookingWarning[]> {
  const on = day(date.slice(0,10),'date'), warnings: BookingWarning[] = []
  const [policies,auths,settings,excluded]=await Promise.all([
    rows(db,'SELECT id,starts_on,ends_on,eligibility_status FROM bm_policies WHERE client_id=? AND priority=1',clientId),
    authorizationsFor(db,clientId),one(db,'SELECT time_zone FROM bm_settings WHERE id=1'),
    excludeAppointmentId?one(db,"SELECT start_at,practitioner_id FROM bm_appointments WHERE id=? AND client_id=? AND status='booked'",excludeAppointmentId,clientId):Promise.resolve(null)
  ])
  if(excluded) {
    const oldDate=hostDateAt(new Date(excluded.start_at),settings!.time_zone),seen=new Set<string>()
    for(const a of auths)if(!seen.has(a.policy_id)&&a.starts_on<=oldDate&&a.ends_on>=oldDate&&(!a.practitioner_id||a.practitioner_id===excluded.practitioner_id)) {seen.add(a.policy_id);a.reserved_visits=Math.max(0,a.reserved_visits-1)}
  }
  for (const p of policies) {
    if (on < p.starts_on || (p.ends_on && on > p.ends_on)) warnings.push({code:'policy_outside_coverage',message:'The visit is outside the policy coverage dates.',policyId:p.id,blocking:false})
    if (p.eligibility_status === 'inactive' || p.eligibility_status === 'changed') warnings.push({code:'eligibility_'+p.eligibility_status,message:p.eligibility_status === 'inactive' ? 'The latest eligibility response says coverage is inactive.' : 'The latest eligibility response names other coverage. Review the policy.',policyId:p.id,blocking:false})
    const choices = auths.filter(a=>a.policy_id===p.id && (!practitionerId || !a.practitioner_id || a.practitioner_id===practitionerId))
    if (!choices.length) continue
    const current = choices.find(a=>a.starts_on<=on && a.ends_on>=on)
    const a = current ?? choices[0], plannedVisits = Math.max(1, (plannedDates ?? [on]).filter(d => d >= a.starts_on && d <= a.ends_on).length), left = Math.max(0,a.visits-a.used_visits-a.reserved_visits)
    const base = {policyId:p.id,authorizationId:a.id,remainingVisits:left,expiresOn:a.ends_on,blocking:a.booking_action==='block'}
    if (!current) warnings.push({...base,code:'authorization_outside_dates',message:'The visit is outside the authorization dates.'})
    else if (left<plannedVisits) warnings.push({...base,code:'authorization_exhausted',message:`This booking needs ${plannedVisits} visit${plannedVisits===1?'':'s'}, but only ${left} unreserved authorized visit${left===1?' remains':'s remain'}.`})
    else if (left<=2) warnings.push({...base,blocking:false,code:'authorization_low',message:`${left} unreserved authorized visit${left===1?' remains':'s remain'}.`})
  }
  return warnings
}

/** Existing bookings reserve visits in date order, after attended visits.
 * They are not new bookings competing with every other existing reservation. */
export async function existingVisitWarnings(db: D1Database, clientId: string): Promise<Record<string, BookingWarning[]>> {
  const [policies, auths, visits, settings] = await Promise.all([
    rows(db, 'SELECT id,starts_on,ends_on,eligibility_status FROM bm_policies WHERE client_id=? AND priority=1', clientId),
    authorizationsFor(db, clientId),
    rows(db, "SELECT id,start_at,practitioner_id FROM bm_appointments WHERE client_id=? AND status='booked' ORDER BY start_at,id", clientId),
    one(db, 'SELECT time_zone FROM bm_settings WHERE id=1'),
  ])
  const reserved = new Map<string, number>(), result: Record<string, BookingWarning[]> = {}
  for (const visit of visits) {
    const on = hostDateAt(new Date(visit.start_at), settings!.time_zone), warnings: BookingWarning[] = []
    for (const policy of policies) {
      if (on < policy.starts_on || (policy.ends_on && on > policy.ends_on)) warnings.push({ code: 'policy_outside_coverage', message: 'The visit is outside the policy coverage dates.', policyId: policy.id, blocking: false })
      if (policy.eligibility_status === 'inactive' || policy.eligibility_status === 'changed') warnings.push({ code: 'eligibility_' + policy.eligibility_status, message: policy.eligibility_status === 'inactive' ? 'The latest eligibility response says coverage is inactive.' : 'The latest eligibility response names other coverage. Review the policy.', policyId: policy.id, blocking: false })
      const choices = auths.filter(a => a.policy_id === policy.id && (!a.practitioner_id || a.practitioner_id === visit.practitioner_id))
      if (!choices.length) continue
      const current = choices.find(a => a.starts_on <= on && a.ends_on >= on), authorization = current ?? choices[0]
      const base = { policyId: policy.id, authorizationId: authorization.id, expiresOn: authorization.ends_on, blocking: authorization.booking_action === 'block' }
      if (!current) warnings.push({ ...base, code: 'authorization_outside_dates', message: 'The visit is outside the authorization dates.' })
      else {
        const position = (reserved.get(authorization.id) ?? 0) + 1
        reserved.set(authorization.id, position)
        const left = Math.max(0, authorization.visits - authorization.used_visits - authorization.reserved_visits)
        if (authorization.used_visits + position > authorization.visits) warnings.push({ ...base, code: 'authorization_exhausted', remainingVisits: left, message: 'This booked visit exceeds the authorized visit count.' })
        else if (authorization.used_visits + authorization.reserved_visits <= authorization.visits && left <= 2) warnings.push({ ...base, code: 'authorization_low', remainingVisits: left, blocking: false, message: `${left} unreserved authorized visit${left === 1 ? ' remains' : 's remain'}.` })
      }
    }
    result[visit.id] = warnings
  }
  return result
}
