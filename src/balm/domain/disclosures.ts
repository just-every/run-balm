import { datePlus, firstInstantOfHostDate, wallClockInstants } from '../availability/timezone'
import { clientVisible } from './clients'
import { audit, commit, day, guard, human, id, insist, need, now, one, rows, stmt, text, type Actor, type Data } from './model'

const ownerOnly = (who: Actor) => { human(who); need(who, 'owner') }
const patientGuard = (db: D1Database, clientId: string) => guard(db, 'EXISTS(SELECT 1 FROM bm_clients WHERE id=? AND erased_at IS NULL)', clientId)

async function timeZone(db: D1Database) {
  const settings = await one(db, 'SELECT time_zone FROM bm_settings WHERE id=1')
  insist(settings?.time_zone, 'clinic_time_zone_not_set', 409)
  return settings.time_zone as string
}

function releaseInstant(input: Data, zone: string) {
  let instant: Date
  if (input.releasedAt) {
    const value = text(input.releasedAt, 'release_time', 40)
    insist(/^\d{4}-\d\d-\d\dT\d\d:\d\d(:\d\d(\.\d{1,3})?)?(Z|[+-]\d\d:\d\d)$/.test(value), 'release_time_needs_time_zone')
    day(value.slice(0, 10), 'release_date')
    insist(/^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?/.test(value.slice(11)), 'invalid_release_time')
    instant = new Date(value)
  } else {
    const date = day(input.releasedDate, 'release_date'), clock = text(input.releasedTime, 'release_time', 5)
    insist(/^([01]\d|2[0-3]):[0-5]\d$/.test(clock), 'invalid_release_time')
    const [hour, minute] = clock.split(':').map(Number)
    const candidates = wallClockInstants(date, hour * 60 + minute, zone)
    insist(candidates.length === 1, 'ambiguous_or_missing_release_time')
    instant = candidates[0]
  }
  insist(Number.isFinite(instant.getTime()), 'invalid_release_time')
  insist(instant.getTime() <= Date.now(), 'release_must_already_have_happened')
  return instant.toISOString()
}

/** The owner records a release already completed outside Balm. This never sends records. */
export async function recordDisclosure(db: D1Database, who: Actor, input: Data) {
  ownerOnly(who)
  const client = await clientVisible(db, who, input.clientId), zone = await timeZone(db)
  const recipient = text(input.recipient, 'recipient', 300), purpose = text(input.purpose, 'purpose', 1000)
  const basis = text(input.basis, 'disclosure_basis', 1000), records = text(input.records, 'records_released', 2000)
  const releasedAt = releaseInstant(input, zone), disclosureId = id(), recordedAt = now()
  await commit(db, who, [patientGuard(db, client.id),
    stmt(db, 'INSERT INTO bm_disclosures(id,client_id,recipient,purpose,basis,records,released_at,recorded_at,recorded_by) VALUES(?,?,?,?,?,?,?,?,?)',
      disclosureId, client.id, recipient, purpose, basis, records, releasedAt, recordedAt, who.email),
    audit(db, who, 'disclosure.recorded', client.id, disclosureId),
  ])
  return { id: disclosureId, clientId: client.id, releasedAt, recordedAt }
}

/** Owner-only client-file accounting. Non-owners receive no disclosure information. */
export async function disclosuresFor(db: D1Database, who: Actor, clientId: string) {
  if (who.role !== 'owner') return null
  ownerOnly(who); await clientVisible(db, who, clientId)
  const disclosures = await rows(db, 'SELECT * FROM bm_disclosures WHERE client_id=? ORDER BY released_at DESC,id', clientId)
  await commit(db, who, [patientGuard(db, clientId), audit(db, who, 'disclosure.read', clientId)])
  return disclosures
}

async function rangeFor(db: D1Database, who: Actor, clientId: string, input: Data) {
  ownerOnly(who); await clientVisible(db, who, clientId)
  const from = day(input.from, 'from'), to = day(input.to, 'to'), zone = await timeZone(db)
  insist(from <= to, 'report_date_range_reversed')
  const start = firstInstantOfHostDate(from, zone), end = firstInstantOfHostDate(datePlus(to, 1), zone)
  insist(start && end, 'invalid_report_date_range')
  return { clientId, from, to, timeZone: zone, start: start.toISOString(), end: end.toISOString() }
}

async function releasesIn(db: D1Database, range: Awaited<ReturnType<typeof rangeFor>>) {
  return rows(db, 'SELECT * FROM bm_disclosures WHERE client_id=? AND released_at>=? AND released_at<? ORDER BY released_at,id', range.clientId, range.start, range.end)
}

export async function disclosureReport(db: D1Database, who: Actor, clientId: string, input: Data) {
  const range = await rangeFor(db, who, clientId, input), disclosures = await releasesIn(db, range)
  await commit(db, who, [patientGuard(db, clientId), audit(db, who, 'disclosure.accounting_read', clientId)])
  const { start, end, ...period } = range
  return { ...period, disclosures }
}

/** Raw access events, never presentation groups or mutation events such as invoice preparation. */
export async function accessReport(db: D1Database, who: Actor, clientId: string, input: Data) {
  const range = await rangeFor(db, who, clientId, input)
  const access = await rows(db, `SELECT sequence,at,actor_email,actor_role,action,subject_id,detail FROM bm_audit
    WHERE client_id=? AND at>=? AND at<? AND (
      action IN ('file.viewed','portal.viewed','agent.context') OR action LIKE '%.read'
      OR action LIKE '%\\_read' ESCAPE '\\' OR action LIKE '%.downloaded' OR action LIKE '%\\_downloaded' ESCAPE '\\'
    ) ORDER BY at,sequence`, clientId, range.start, range.end)
  const disclosures = await releasesIn(db, range)
  await commit(db, who, [patientGuard(db, clientId), audit(db, who, 'access_report.read', clientId)])
  const { start, end, ...period } = range
  return { ...period, access, disclosures }
}

/** Quotes every cell and neutralizes spreadsheet formulas in external text. */
export function csvCell(value: unknown) {
  const raw = String(value ?? ''), safe = /^[\s]*[=+@-]/.test(raw) ? "'" + raw : raw
  return '"' + safe.replace(/"/g, '""') + '"'
}

/** Fixed columns; every cell goes through csvCell. */
export function reportCsv(report: Data, kind: 'disclosures' | 'access') {
  const cell = csvCell
  const headers = ['kind', 'at', 'actor', 'role', 'action', 'subject', 'recipient', 'purpose', 'basis', 'records', 'recorded_at']
  const records: unknown[][] = (kind === 'access' ? (report.access ?? []).map((a: Data) => ['access', a.at, a.actor_email, a.actor_role, a.action, a.subject_id, '', '', '', '', '']) : [])
    .concat((report.disclosures ?? []).map((d: Data) => ['disclosure', d.released_at, d.recorded_by, 'owner', 'disclosure.recorded', d.id, d.recipient, d.purpose, d.basis, d.records, d.recorded_at]))
  return [headers, ...records].map(row => row.map(cell).join(',')).join('\r\n') + '\r\n'
}
