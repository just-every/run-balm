// REF-001 referral conversion for REPORT-001: referrals received in the inclusive
// clinic-local range, by source and by referring provider, with each stage reached.
// A practitioner filter keeps referrals whose first booked or attended visit is with
// that practitioner. Figures are counts; no patient is named.
import { referralSources, referralStages } from '../referrals'
import { rows, type Data } from '../domain/model'

type Fact = { stage: string; scheduled: boolean; evaluated: boolean }
const percent = (part: number, whole: number) => whole > 0 ? Math.round(part / whole * 1000) / 10 : null
/** Scheduled and evaluated count every referral that reached them, whatever happened after. */
const counts = (list: Fact[]) => {
  const scheduled = list.filter(r => r.scheduled).length
  return { received: list.length, scheduled, evaluated: list.filter(r => r.evaluated).length, discharged: list.filter(r => r.stage === 'discharged').length,
    lost: list.filter(r => r.stage === 'lost').length, open: list.filter(r => r.stage === 'received').length, conversion: percent(scheduled, list.length) }
}
export const providerLabel = (r: Data) => r.kind === 'direct_access' ? 'Direct access (no referral)'
  : r.npi_source === 'nppes' ? `${r.provider_name ?? `${r.referring_first} ${r.referring_last}`.trim()} · NPI ${r.referring_npi} (NPPES)`
  : r.referring_npi ? `${`${r.referring_first} ${r.referring_last}`.trim()} · NPI ${r.referring_npi} (entered, not checked)` : `${`${r.referring_first} ${r.referring_last}`.trim()} (no NPI)`

export async function referralConversion(db: D1Database, f: { from: string; to: string; zone: string; practitionerId: string }) {
  const list = await rows(db, `SELECT r.id,r.kind,r.source,r.received_on,r.referring_first,r.referring_last,r.referring_npi,r.npi_source,r.episode_id,r.lost_at,p.name AS provider_name
    FROM bm_referrals r LEFT JOIN bm_referring_providers p ON p.npi=r.referring_npi AND r.npi_source='nppes' WHERE r.received_on BETWEEN ? AND ?`, f.from, f.to)
  const stages = await referralStages(db, list, f.zone)
  const facts = list.map(r => { const s = stages.get(r.id as string)!
    return { source: r.source as string, provider: providerLabel(r), stage: s.stage, scheduled: !!s.scheduledOn, evaluated: !!s.evaluatedOn, practitionerId: s.practitionerId } })
  facts.push(...(await rows(db, 'SELECT source,provider,stage,scheduled,evaluated,practitioner_id AS practitionerId FROM bm_destroyed_referrals WHERE received_on BETWEEN ? AND ?', f.from, f.to))
    .map(r => ({ ...r, scheduled: r.scheduled === 1, evaluated: r.evaluated === 1 })) as any[])
  const kept = facts.filter(r => !f.practitionerId || r.practitionerId === f.practitionerId)
  const group = (by: 'source' | 'provider') => [...new Set(kept.map(r => r[by]))].sort().map(name => ({ group: by, name: by === 'source' ? referralSources.find(([k]) => k === name)?.[1] ?? name : name, ...counts(kept.filter(r => r[by] === name)) }))
  return { rows: [...group('source'), ...group('provider')], total: { group: 'total', ...counts(kept) } }
}

/** Anonymous referral facts kept by a HIPAA-002 purge, with each referral's stage at destruction. */
export async function preserveReferrals(db: D1Database, clientId: string, zone: string) {
  const list = await rows(db, `SELECT r.*,p.name AS provider_name FROM bm_referrals r LEFT JOIN bm_referring_providers p ON p.npi=r.referring_npi AND r.npi_source='nppes' WHERE r.client_id=?`, clientId)
  const stages = await referralStages(db, list, zone)
  return list.map(r => { const s = stages.get(r.id as string)!
    return db.prepare('INSERT INTO bm_destroyed_referrals(id,received_on,source,provider,stage,scheduled,evaluated,practitioner_id) VALUES(?,?,?,?,?,?,?,?)').bind(r.id, r.received_on, r.source, providerLabel(r), s.stage, s.scheduledOn ? 1 : 0, s.evaluatedOn ? 1 : 0, s.practitionerId) })
}
