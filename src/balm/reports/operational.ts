import { anonymousOperationalFacts } from '../retention/operations'
// Owner-only operational reports (REPORT-001). Every figure is an aggregate per
// practitioner; no patient names, note text or plan narratives leave this module.
// A day is a whole clinic-local date in the clinic's time zone; a visit belongs
// to the local date its start falls on, and the range includes both ends.
import { datePlus, hostDateAt, weekdayForDate } from '../availability/timezone'
import { csvCell } from '../domain/disclosures'
import { human, insist, need, rows, text, type Actor, type Data } from '../domain/model'
import { reportRange } from './range'
import { referralConversion } from './referrals'

export const reportKinds = ['visits', 'plans', 'evaluations', 'utilization', 'payroll', 'referrals'] as const
export type ReportKind = typeof reportKinds[number]

type Practitioner = { id: string; name: string }
const percent = (part: number, whole: number) => whole > 0 ? Math.round(part / whole * 1000) / 10 : null
const minutesBetween = (start: string, end: string) => Math.round((Date.parse(end) - Date.parse(start)) / 60_000)

async function filters(db: D1Database, input: Data) {
  const range = await reportRange(db, input)
  const practitionerId = input.practitionerId ? text(input.practitionerId, 'practitioner', 100) : ''
  const practitioners = await rows<Practitioner>(db, "SELECT id,name FROM bm_staff WHERE role='practitioner' AND erased_at IS NULL AND (?='' OR id=?) ORDER BY name,id", practitionerId, practitionerId)
  insist(!practitionerId || practitioners.length, 'practitioner_not_found', 404)
  return { ...range, practitionerId, practitioners }
}

/** The owner's operational reports for one inclusive clinic-local date range. */
export async function operationalReports(db: D1Database, who: Actor, input: Data) {
  human(who); need(who, 'owner')
  insist(who.role === 'owner', 'role_cannot_do_this', 403)
  const f = await filters(db, input), ids = f.practitioners.map(p => p.id)
  const mine = (id: unknown) => ids.includes(String(id))
  const visits = (await rows(db, `SELECT a.practitioner_id,a.service_id,a.start_at,a.end_at,a.status,s.name AS service FROM bm_appointments a JOIN bm_services s ON s.id=a.service_id
    WHERE julianday(a.start_at)>=julianday(?) AND julianday(a.start_at)<julianday(?) ORDER BY a.start_at,a.id`, f.start, f.end)).filter(v => mine(v.practitioner_id))
  const evaluations = (await rows(db, `SELECT n.author_id,n.template FROM bm_notes n LEFT JOIN bm_appointments a ON a.id=n.appointment_id
    WHERE n.signed_at IS NOT NULL AND n.template LIKE '%.evaluation'
    AND julianday(COALESCE(a.start_at,n.signed_at))>=julianday(?) AND julianday(COALESCE(a.start_at,n.signed_at))<julianday(?)`, f.start, f.end)).filter(n => mine(n.author_id))
  const episodeOf = (kind: string, column: string) => `COALESCE((SELECT episode_id FROM bm_episode_records WHERE record_kind='${kind}' AND record_id=${column}),'') AS episode_id`
  const plans = await rows(db, `SELECT id,client_id,author_id,json_extract(content,'$.startDate') AS start_date,
    json_extract(content,'$.frequencyPerWeek') AS per_week,json_extract(content,'$.durationWeeks') AS weeks,${episodeOf('plan', 'bm_plans_of_care.id')}
    FROM bm_plans_of_care WHERE json_extract(content,'$.startDate') BETWEEN ? AND ? OR EXISTS(SELECT 1 FROM bm_episode_records WHERE record_kind='plan' AND record_id=bm_plans_of_care.id)`, f.from, f.to)
  const planVisits = plans.length ? await rows(db, `SELECT client_id,practitioner_id,start_at,status,${episodeOf('visit', 'bm_appointments.id')} FROM bm_appointments WHERE status IN ('attended','booked')
    AND client_id IN (SELECT client_id FROM bm_plans_of_care)`) : []
  const hours = await rows(db, 'SELECT practitioner_id,weekday,start_minute,end_minute FROM bm_hours')
  const anonymous = await anonymousOperationalFacts(db, f)
  visits.push(...anonymous.visits.filter(v => mine(v.practitioner_id)))
  evaluations.push(...anonymous.evaluations.filter(n => mine(n.author_id)))
  plans.push(...anonymous.plans)
  planVisits.push(...anonymous.planVisits)

  const byPractitioner = <T>(make: () => T) => new Map(f.practitioners.map(p => [p.id, make()]))
  const visitRows = byPractitioner(() => ({ scheduled: 0, booked: 0, arrived: 0, cancelled: 0, noShows: 0 }))
  const timeRows = byPractitioner(() => ({ availableMinutes: 0, bookedMinutes: 0, attendedMinutes: 0 }))
  const payroll = new Map<string, { practitionerId: string; service: string; attendedVisits: number; attendedMinutes: number }>()
  for (const v of visits) {
    const counts = visitRows.get(v.practitioner_id)!, time = timeRows.get(v.practitioner_id)!, minutes = minutesBetween(v.start_at, v.end_at)
    counts.scheduled++
    if (v.status === 'booked') counts.booked++
    if (v.status === 'attended') counts.arrived++
    if (v.status === 'cancelled') counts.cancelled++
    if (v.status === 'no_show') counts.noShows++
    if (v.status !== 'cancelled') time.bookedMinutes += minutes
    if (v.status === 'attended') {
      time.attendedMinutes += minutes
      const key = JSON.stringify([v.practitioner_id, v.service_id]), row = payroll.get(key) ?? { practitionerId: v.practitioner_id, service: v.service, attendedVisits: 0, attendedMinutes: 0 }
      row.attendedVisits++; row.attendedMinutes += minutes; payroll.set(key, row)
    }
  }
  // Available time is each practitioner's current weekly hours on every open
  // clinic-local date in the range, in wall-clock minutes; clinic holidays count as closed.
  for (let date = f.from; date <= f.to; date = datePlus(date, 1)) {
    if (f.holidays.has(date)) continue
    const weekday = weekdayForDate(date)
    for (const window of hours) if (window.weekday === weekday && timeRows.has(window.practitioner_id)) timeRows.get(window.practitioner_id)!.availableMinutes += Number(window.end_minute) - Number(window.start_minute)
  }
  const evaluationRows = byPractitioner(() => ({ pt: 0, ot: 0, slp: 0 }))
  for (const n of evaluations) {
    const discipline = String(n.template).split('.')[0] as 'pt' | 'ot' | 'slp', row = evaluationRows.get(n.author_id)!
    if (discipline in row) row[discipline]++
  }
  // REF-003: an episode of care with a plan counts once, in the range its first plan
  // starts in. Its planned visits come from its latest-starting plan (ties: higher id),
  // whose therapist the row belongs to; it counts every attended visit filed to the
  // episode. A plan no episode holds is one episode by itself, as before episodes:
  // attended visits with its own therapist, outside any episode, from its start date
  // through the last day of its planned weeks. Completed: attended at least the planned
  // visits. Dropped off: fewer, with no visit of that episode (or therapist) booked after now.
  const now = Date.now()
  const planRows = byPractitioner(() => ({ plans: 0, completed: 0, inProgress: 0, droppedOff: 0, attendedVisits: 0, plannedVisits: 0 }))
  const tally = (author: string, attended: number, planned: number, upcoming: boolean) => {
    const row = planRows.get(author)!
    row.plans++; row.attendedVisits += attended; row.plannedVisits += planned
    if (attended >= planned) row.completed++
    else if (upcoming) row.inProgress++
    else row.droppedOff++
  }
  const episodes = new Map<string, Data[]>()
  for (const plan of plans) {
    if (plan.episode_id) { episodes.set(plan.episode_id, [...episodes.get(plan.episode_id) ?? [], plan]); continue }
    if (plan.start_date < f.from || plan.start_date > f.to || !mine(plan.author_id)) continue
    const last = datePlus(plan.start_date, Number(plan.weeks) * 7 - 1), planned = Number(plan.per_week) * Number(plan.weeks)
    const theirs = planVisits.filter(v => !v.episode_id && v.client_id === plan.client_id && v.practitioner_id === plan.author_id)
    const attended = theirs.filter(v => v.status === 'attended' && (d => d >= plan.start_date && d <= last)(hostDateAt(new Date(v.start_at), f.zone))).length
    tally(plan.author_id, attended, planned, theirs.some(v => v.status === 'booked' && Date.parse(v.start_at) > now))
  }
  for (const [episode, list] of episodes) {
    const first = list.reduce((a, b) => b.start_date < a ? b.start_date : a, list[0].start_date as string)
    const latest = [...list].sort((a, b) => b.start_date.localeCompare(a.start_date) || String(b.id).localeCompare(String(a.id)))[0]
    if (first < f.from || first > f.to || !mine(latest.author_id)) continue
    const theirs = planVisits.filter(v => v.episode_id === episode)
    tally(latest.author_id, theirs.filter(v => v.status === 'attended').length, Number(latest.per_week) * Number(latest.weeks), theirs.some(v => v.status === 'booked' && Date.parse(v.start_at) > now))
  }

  const named = <T extends object>(map: Map<string, T>) => f.practitioners.map(p => ({ practitionerId: p.id, practitioner: p.name, ...map.get(p.id)! }))
  const total = <T extends Record<string, unknown>>(list: T[]) => {
    const sum: Record<string, number> = {}
    for (const row of list) for (const [key, value] of Object.entries(row)) if (typeof value === 'number') sum[key] = (sum[key] ?? 0) + value
    return sum
  }
  const withVisitRate = (r: { arrived: number; noShows: number }) => ({ ...r, noShowRate: percent(r.noShows, r.arrived + r.noShows) })
  const withTimeRate = (r: { availableMinutes: number; bookedMinutes: number; attendedMinutes: number }) => ({ ...r, utilization: percent(r.bookedMinutes, r.availableMinutes), productivity: percent(r.attendedMinutes, r.availableMinutes) })
  const withPlanRate = (r: { plans: number; droppedOff: number; attendedVisits: number }) => ({ ...r, visitsPerPlan: r.plans ? Math.round(r.attendedVisits / r.plans * 10) / 10 : null, dropOffRate: percent(r.droppedOff, r.plans) })
  const visitList = named(visitRows), timeList = named(timeRows), planList = named(planRows)
  const evaluationList = named(evaluationRows).map(r => ({ ...r, total: r.pt + r.ot + r.slp }))
  const payrollList = [...payroll.values()].map(r => ({ ...r, practitioner: f.practitioners.find(p => p.id === r.practitionerId)!.name }))
    .sort((a, b) => a.practitioner.localeCompare(b.practitioner) || a.service.localeCompare(b.service))
  return {
    from: f.from, to: f.to, timeZone: f.zone, practitionerId: f.practitionerId || null,
    practitioners: (await rows<Practitioner>(db, "SELECT id,name FROM bm_staff WHERE role='practitioner' AND erased_at IS NULL ORDER BY name,id")),
    visits: { rows: visitList.map(withVisitRate), total: withVisitRate(total(visitList) as any) },
    plans: { rows: planList.map(withPlanRate), total: withPlanRate(total(planList) as any) },
    evaluations: { rows: evaluationList, total: total(evaluationList) },
    utilization: { rows: timeList.map(withTimeRate), total: withTimeRate(total(timeList) as any) },
    payroll: { rows: payrollList, total: total(payrollList) },
    referrals: await referralConversion(db, f),
  }
}

export type OperationalReports = Awaited<ReturnType<typeof operationalReports>>

const columns: Record<ReportKind, [string, string][]> = {
  visits: [['practitioner', 'practitioner'], ['scheduled', 'scheduled'], ['booked', 'still_booked'], ['arrived', 'arrived'], ['cancelled', 'cancelled'], ['noShows', 'no_shows'], ['noShowRate', 'no_show_rate_percent']],
  plans: [['practitioner', 'practitioner'], ['plans', 'plans_of_care'], ['completed', 'completed'], ['inProgress', 'in_progress'], ['droppedOff', 'dropped_off'], ['attendedVisits', 'attended_visits'], ['plannedVisits', 'planned_visits'], ['visitsPerPlan', 'visits_per_plan'], ['dropOffRate', 'drop_off_rate_percent']],
  evaluations: [['practitioner', 'practitioner'], ['pt', 'pt_evaluations'], ['ot', 'ot_evaluations'], ['slp', 'slp_evaluations'], ['total', 'total']],
  utilization: [['practitioner', 'practitioner'], ['availableMinutes', 'available_minutes'], ['bookedMinutes', 'booked_minutes'], ['attendedMinutes', 'attended_minutes'], ['utilization', 'utilization_percent'], ['productivity', 'productivity_percent']],
  payroll: [['practitioner', 'practitioner'], ['service', 'service'], ['attendedVisits', 'attended_visits'], ['attendedMinutes', 'attended_minutes']],
  referrals: [['group', 'by'], ['name', 'source_or_referring_provider'], ['received', 'received'], ['scheduled', 'scheduled'], ['evaluated', 'evaluated'], ['discharged', 'discharged'], ['lost', 'lost'], ['open', 'not_yet_scheduled'], ['conversion', 'scheduled_percent']],
}

/** One report as CSV: a header, a row per practitioner (and service for payroll), then the all-practitioner total. */
export function operationalCsv(report: OperationalReports, kind: ReportKind) {
  const cols = columns[kind], section = report[kind] as { rows: Data[]; total: Data }
  const line = (row: Data) => cols.map(([key]) => csvCell(row[key] ?? '')).join(',')
  return [cols.map(([, label]) => csvCell(label)).join(','), ...section.rows.map(line), line({ ...section.total, practitioner: 'All practitioners', name: 'All referrals' })].join('\r\n') + '\r\n'
}
