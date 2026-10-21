import { bill, cpt, type Charge } from '../charting/cpt'
import { hostDateAt } from '../availability/timezone'
import { one } from '../domain/model'

/** The primary policy covering the service's clinic-local date. This reads the
 * current payer settings; dated payer-setting history remains INS-001 work. */
export async function primaryUnitMethod(db: D1Database, clientId: string, serviceAt: string) {
  const settings = await one(db, 'SELECT time_zone FROM bm_settings WHERE id=1')
  const date = hostDateAt(new Date(serviceAt), settings!.time_zone as string)
  const policy = await one(db, "SELECT p.payer_id,y.name,y.unit_method,y.version AS payer_version FROM bm_policies p JOIN bm_payers y ON y.id=p.payer_id WHERE p.client_id=? AND p.starts_on<=? AND (p.ends_on IS NULL OR p.ends_on='' OR p.ends_on>=?) ORDER BY p.priority,p.starts_on DESC LIMIT 1", clientId, date, date)
  return { method: (policy?.unit_method ?? (policy ? null : 'cms')) as string | null, payerId: policy?.payer_id ?? null, payer: policy?.name ?? null, payerVersion: policy?.payer_version ?? null }
}

/** The same per-service AMA or pooled CMS calculation for previews and charges.
 * An unconfigured payer retains a labelled provisional CMS estimate; the claim
 * scrubber still refuses submission until the owner chooses the payer method. */
export function payerBilling(charges: Charge[], method: string | null) {
  const cms = bill(charges)
  if (method !== 'ama') return cms
  const lines = charges.map(c => ({ ...cpt(c.code)!, minutes: c.minutes, units: cpt(c.code)!.timed ? Math.floor((c.minutes + 7) / 15) : 1 }))
  return { lines, timedMinutes: cms.timedMinutes, timedUnits: lines.filter(l => l.timed).reduce((sum, l) => sum + l.units, 0), units: lines.reduce((sum, l) => sum + l.units, 0) }
}
