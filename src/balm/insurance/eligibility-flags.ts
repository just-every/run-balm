import { rows } from '../domain/model'
import type { BookingWarning } from './types'

export function eligibilityWarning(policy:{id:string;eligibility_status:string}):BookingWarning[] {
  const labels:Record<string,string>={inactive:'Coverage inactive',changed:'Coverage changed',exhausted:'Visit limit exhausted'}
  const label=labels[policy.eligibility_status]
  return label?[{code:'eligibility_'+policy.eligibility_status,policyId:policy.id,message:label+' in the latest recorded eligibility response. Review the policy before the visit.',blocking:false}]:[]
}
export async function eligibilityPolicies(db:D1Database,clientId:string) {
  return rows(db,'SELECT id,priority,starts_on,ends_on,eligibility_status FROM bm_policies WHERE client_id=?',clientId)
}
