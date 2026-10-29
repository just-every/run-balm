import {eligibilityPolicies,eligibilityWarning} from '../insurance/eligibility-flags'
import { authorizationCoversVisit, signedAuthorizationChargeSql } from '../insurance/authorization-accounting'
// The flags each calendar visit carries (SCHED-002): the authorization that
// covers it as "8 of 12 visits left", and for the desk the patient's open balance.
import { hostDateAt } from '../availability/timezone'
import { authorizationsFor } from '../insurance/authorization'
import { openInvoices } from '../payments/ledger'
import { rows, seesBalances, type Actor, type Data } from './model'

/** Remaining visits count attended and booked visits, as the insurance file does (INS-003).
 * The balance is what the patient owes on approved invoices with no claim pending; reception and the owner see it. */
export async function addVisitFlags(db: D1Database, who: Actor, zone: string, visits: Data[]) {
  const desk = seesBalances(who)
  const clients = [...new Set(visits.map(v => String(v.client_id)))]
  const [auths, balances, chargeRows] = await Promise.all([
    Promise.all(clients.map(async id => [id, await authorizationsFor(db, id)] as const)),
    desk ? Promise.all(clients.map(async id => [id, (await openInvoices(db, id)).reduce((sum, i) => sum + i.open_cents, 0)] as const)) : Promise.resolve([]),
    rows(db, `SELECT * FROM (${signedAuthorizationChargeSql}) WHERE client_id IN (SELECT value FROM json_each(?))`, JSON.stringify(clients)),
  ])
  const policies=new Map(await Promise.all(clients.map(async clientId=>[clientId,await eligibilityPolicies(db,clientId)] as const)))
  const byClient = new Map(auths), owed = new Map(balances)
  for (const v of visits) {
    const date = hostDateAt(new Date(v.start_at), zone)
    v.eligibilityWarnings=v.status==='booked'?(policies.get(String(v.client_id))??[]).filter(p=>p.starts_on<=date&&(!p.ends_on||p.ends_on>=date)).flatMap(p=>eligibilityWarning(p as {id:string;eligibility_status:string})):[]
    const a = (byClient.get(String(v.client_id)) ?? []).find(a => a.episodeId === (v.episode_id ?? '') && a.starts_on <= date && a.ends_on >= date && (!a.practitioner_id || a.practitioner_id === v.practitioner_id))
    v.authorization = a ? { number: a.number, visits: a.visits, total: a.allowance_total, kind: a.allowance_kind, left: a.remaining_allowance, threshold: a.low_remainder, endsOn: a.ends_on, covered: authorizationCoversVisit(a, v, chargeRows, undefined, zone) } : null
    if (desk) v.balance_cents = owed.get(String(v.client_id)) ?? 0
  }
}
