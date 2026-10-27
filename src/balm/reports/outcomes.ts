// REPORT-003: episode cohorts, never a join of scores with diagnoses or policies.
import { hostDateAt } from '../availability/timezone'
import { csvCell } from '../domain/disclosures'
import { audit, commit, human, insist, rows, text, type Actor, type Data } from '../domain/model'
import { reportRange } from './range'
import { comparableOutcome } from '../intake/outcomes'
import { outcomePair } from '../episodes/summary'

export async function outcomeReport(db: D1Database, who: Actor, input: Data) {
  human(who); insist(who.role === 'owner', 'role_cannot_do_this', 403)
  const range = await reportRange(db, input)
  const practitionerId = input.outcomePractitionerId ? text(input.outcomePractitionerId, 'practitioner', 100) : ''
  const diagnosis = input.diagnosis ? text(input.diagnosis, 'diagnosis', 10).toUpperCase() : ''
  const payerId = input.payerId ? text(input.payerId, 'payer', 100) : ''
  const [visits, codes, policies, intake, measures, practitioners, payers] = await Promise.all([
    rows(db, `SELECT a.id,a.client_id,a.practitioner_id,a.start_at,e.episode_id FROM bm_appointments a
      JOIN bm_episode_records e ON e.record_kind='visit' AND e.record_id=a.id
      WHERE a.status<>'cancelled' ORDER BY julianday(a.start_at),a.id`),
    rows(db, "SELECT appointment_id,code FROM bm_visit_codes WHERE kind='icd10'"),
    rows(db, 'SELECT client_id,payer_id,starts_on,ends_on FROM bm_policies'),
    rows(db, 'SELECT r.id,r.appointment_id,r.form_id,r.scores FROM bm_intake_responses r'),
    rows(db, `SELECT m.id,n.appointment_id,m.name,m.side,m.unit,m.value FROM bm_measures m JOIN bm_notes n ON n.id=m.note_id
      WHERE m.kind='score' AND n.signed_at IS NOT NULL ORDER BY n.signed_at,n.id,m.recorded_at,m.id`),
    rows(db, "SELECT id,name FROM bm_staff WHERE role='practitioner' AND erased_at IS NULL ORDER BY name,id"),
    rows(db, 'SELECT id,name FROM bm_payers ORDER BY name,id'),
  ])
  insist(!practitionerId || practitioners.some(p => p.id === practitionerId), 'practitioner_not_found', 404)
  insist(!payerId || payerId === 'unrecorded' || payers.some(p => p.id === payerId), 'payer_not_found', 404)
  const episodes = new Map<string, Data[]>()
  for (const visit of visits) episodes.set(visit.episode_id, [...episodes.get(visit.episode_id) ?? [], visit])
  const diagnoses = [...new Set(codes.map(c => String(c.code)))].sort()
  const cohort = [...episodes.values()].filter(list => {
    const first = list[0], date = hostDateAt(new Date(first.start_at), range.zone)
    const ids = new Set(list.map(v => v.id))
    const covered = policies.filter(p => p.client_id === first.client_id && list.some(v => {
      const day = hostDateAt(new Date(v.start_at), range.zone)
      return p.starts_on <= day && (!p.ends_on || p.ends_on >= day)
    }))
    return date >= range.from && date <= range.to && (!practitionerId || first.practitioner_id === practitionerId)
      && (!diagnosis || codes.some(c => ids.has(c.appointment_id) && c.code === diagnosis))
      && (!payerId || (payerId === 'unrecorded' ? !covered.length : covered.some(p => p.payer_id === payerId)))
  })
  const variants = new Map<string, Data>(), points = new Map<string, Data[]>()
  const add = (appointmentId: string, instrument: Data, value: number, order: string) => {
    const key = JSON.stringify([instrument.source,instrument.instrument,instrument.instrumentVersion,instrument.scoringVersion,instrument.side,instrument.unit])
    variants.set(key, instrument)
    const entry = { key, value, order }
    points.set(appointmentId, [...points.get(appointmentId) ?? [], entry])
  }
  for (const response of intake) for (const score of JSON.parse(response.scores)) {
    const instrument = comparableOutcome(score, response.form_id)
    if (instrument && Number.isFinite(score.score)) add(response.appointment_id, instrument, score.score, response.id)
  }
  for (const m of measures) add(m.appointment_id, { source:'Signed chart', instrument:String(m.name).trim().toLowerCase(), instrumentVersion:'Unversioned chart entry', scoringVersion:'Clinician entered', side:m.side, unit:m.unit, direction:'Change is follow-up minus baseline' }, Number(m.value), m.id)
  // Only variants present in this cohort through the inclusive end date appear.
  const present = new Set(cohort.flatMap(list => list.filter(v => Date.parse(v.start_at) < Date.parse(range.end)).flatMap(v => (points.get(v.id) ?? []).map(p => p.key))))
  const groups = new Map<string, Data>()
  for (const list of cohort) {
    const first = list[0], eligible = list.filter(v => Date.parse(v.start_at) < Date.parse(range.end))
    for (const key of present) {
      const groupKey = JSON.stringify([first.practitioner_id,key])
      const row = groups.get(groupKey) ?? { practitionerId:first.practitioner_id, practitioner:practitioners.find(p => p.id === first.practitioner_id)?.name ?? 'Former practitioner', ...variants.get(key), episodes:0, paired:0, unversionedPairs:0, missingBaseline:0, missingFollowUp:0, missingBoth:0, baselineTotal:0, followUpTotal:0, changeTotal:0 }
      const pair = outcomePair(eligible.map(v => ({ ...v, points:(points.get(v.id) ?? []).filter(p => p.key === key) })))
      row.episodes++
      if (pair.baseline === null) row.missingBaseline++
      if (pair.followUp === null) row.missingFollowUp++
      if (pair.baseline === null && pair.followUp === null) row.missingBoth++
      if (pair.baseline !== null && pair.followUp !== null) {
        if (row.source === 'Signed chart') row.unversionedPairs++
        else { row.paired++; row.baselineTotal += pair.baseline; row.followUpTotal += pair.followUp; row.changeTotal += pair.followUp - pair.baseline }
      }
      groups.set(groupKey,row)
    }
  }
  const round = (n: number) => Math.round(n * 100) / 100
  const result = [...groups.values()].map(({baselineTotal,followUpTotal,changeTotal,...r}) => ({...r, baselineMean:r.paired ? round(baselineTotal/r.paired) : null, followUpMean:r.paired ? round(followUpTotal/r.paired) : null, meanChange:r.paired ? round(changeTotal/r.paired) : null}))
    .sort((a:Data,b:Data) => a.practitioner.localeCompare(b.practitioner) || a.instrument.localeCompare(b.instrument) || JSON.stringify(a).localeCompare(JSON.stringify(b)))
  await commit(db,who,[audit(db,who,'report.outcomes_read',null,null,JSON.stringify({from:range.from,to:range.to,practitionerId,diagnosis,payerId})),
    ...[...new Set(cohort.map(list => String(list[0].client_id)))].map(clientId => audit(db,who,'report.outcomes_read',clientId))])
  const episodesWithoutScores = cohort.filter(list => !list.some(v => Date.parse(v.start_at) < Date.parse(range.end) && points.get(v.id)?.length)).length
  return {from:range.from,to:range.to,timeZone:range.zone,practitionerId,diagnosis,payerId,practitioners,payers,diagnoses,episodes:cohort.length,episodesWithoutScores,rows:result}
}

export function outcomeCsv(report: Awaited<ReturnType<typeof outcomeReport>>) {
  const columns = ['practitioner','source','instrument','instrumentVersion','scoringVersion','side','unit','direction','episodes','paired','missingBaseline','missingFollowUp','missingBoth','baselineMean','followUpMean','meanChange','unversionedPairs']
  return [columns,...report.rows.map(r => columns.map(k => (r as Data)[k] ?? ''))].map(row => row.map(value => typeof value === 'number' ? String(value) : csvCell(value)).join(',')).join('\r\n')+'\r\n'
}
