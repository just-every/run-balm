// The flags each calendar visit carries (SCHED-002): the authorization that
// covers it as "8 of 12 visits left", and for the desk the patient's open balance.
import { hostDateAt } from '../availability/timezone'
import { authorizationsFor } from '../insurance/authorization'
import { openInvoices } from '../payments/ledger'
import { seesBalances, type Actor, type Data } from './model'

/** Remaining visits count attended and booked visits, as the insurance file does (INS-003).
 * The balance is what the patient owes on approved invoices with no claim pending; reception and the owner see it. */
export async function addVisitFlags(db: D1Database, who: Actor, zone: string, visits: Data[]) {
  const desk = seesBalances(who)
  const clients = [...new Set(visits.map(v => String(v.client_id)))]
  const [auths, balances] = await Promise.all([
    Promise.all(clients.map(async id => [id, await authorizationsFor(db, id)] as const)),
    desk ? Promise.all(clients.map(async id => [id, (await openInvoices(db, id)).reduce((sum, i) => sum + i.open_cents, 0)] as const)) : Promise.resolve([]),
  ])
  const byClient = new Map(auths), owed = new Map(balances)
  for (const v of visits) {
    const date = hostDateAt(new Date(v.start_at), zone)
    const a = (byClient.get(String(v.client_id)) ?? []).find(a => a.episodeId === (v.episode_id ?? '') && a.starts_on <= date && a.ends_on >= date && (!a.practitioner_id || a.practitioner_id === v.practitioner_id))
    v.authorization = a ? { number: a.number, visits: a.visits, left: Math.max(0, a.visits - a.used_visits - a.reserved_visits), endsOn: a.ends_on } : null
    if (desk) v.balance_cents = owed.get(String(v.client_id)) ?? 0
  }
}
