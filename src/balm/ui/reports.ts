// The owner's operational reports: one filter form, a table per report with its
// all-practitioner total, and a CSV download that carries the same filters.
import { empty, field, h, panel, select } from './shared'
import { financialSections } from './financial-reports'

const table = (heads: string[], body: unknown[][]) => `<div class="table"><table><thead><tr>${heads.map(x => `<th scope="col">${h(x)}</th>`).join('')}</tr></thead><tbody>${body.map((r, i) => `<tr${i === body.length - 1 ? ' class="total"' : ''}>${r.map(c => `<td>${h(c ?? '—')}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`
const pct = (value: unknown) => value === null || value === undefined ? '—' : `${value}%`

export function reportsPage(s: any) {
  const r = s.reports
  if (!r) return financialSections(s)
  const query = (kind: string) => `/api/balm/reports/${kind}.csv?` + new URLSearchParams({ from: r.from, to: r.to, ...(r.practitionerId ? { practitionerId: r.practitionerId } : {}),...(r.locationId?{locationId:r.locationId}:{}) }).toString()
  const download = (kind: string, label: string) => `<p><a class="button secondary" href="${h(query(kind))}" download>Download ${h(label)} CSV</a></p>`
  const all = (row: any) => ({ ...row, practitioner: 'All practitioners' })
  const section = (kind: string, title: string, intro: string, heads: string[], cells: (row: any) => unknown[], label: string) => {
    const list = r[kind].rows as any[]
    return panel(title, `<p class="help">${h(intro)}</p>` + (list.length ? table(heads, [...list.map(cells), cells(all(r[kind].total))]) : empty('No practitioners match this filter.')) + download(kind, label), 'full', `report-${kind}`)
  }
  const choices = [['', 'All practitioners'], ...r.practitioners.map((p: any) => [p.id, p.name])]
  const filter = `<form method="get" action="/app/reports" class="report-filter"><div class="pair">${field('from', 'From', r.from, 'date', 'required')}${field('to', 'Through', r.to, 'date', 'required')}</div>`
    + `<label>Location<select name="locationId">${[['','All locations'],['unassigned','Unassigned'],...(r.locations??[]).map((l:any)=>[l.id,l.name])].map(([value,label])=>`<option value="${h(value)}"${value===(r.locationId??'')?' selected':''}>${h(label)}</option>`).join('')}</select></label>`
    + `<label>Practitioner<select name="practitionerId">${choices.map(([value, label]) => `<option value="${h(value)}"${value === (r.practitionerId ?? '') ? ' selected' : ''}>${h(label)}</option>`).join('')}</select></label>`
    + `<p class="help">Dates include the whole day in ${h(r.timeZone)}; a visit counts on the clinic date it starts. Visits and evaluations use their room’s location; weekly hours use the owner’s explicit location assignment. Plans count once at their source note’s visit location (the latest plan’s source for an episode); completion counts that whole course. Referrals use their first episode visit’s location. Unknown locations remain Unassigned; older anonymous facts stay there.</p><button type="submit">Run reports</button></form>`
  return `<div class="grid">${panel('Operational reports', (s.reportError ? `<div class="notice error" role="alert">${h(s.reportError)}</div>` : '') + filter, 'full')}`
    + section('visits', 'Visits, arrivals, cancellations and no-shows', 'Every visit that starts in the range, by its current status. The no-show rate is no-shows out of arrivals plus no-shows.',
      ['Practitioner', 'Scheduled', 'Still booked', 'Arrived', 'Cancelled', 'No-shows', 'No-show rate'], x => [x.practitioner, x.scheduled, x.booked, x.arrived, x.cancelled, x.noShows, pct(x.noShowRate)], 'visits')
    + section('plans', 'Plan-of-care completion', 'Each episode of care counts once, in the range its first plan of care starts in, with every attended visit filed to it and the planned visits of its latest plan. A plan not assigned to an episode is one episode by itself: attended visits with its therapist from its start date through its planned weeks. Completed means the planned visits were attended; dropped off means fewer, with no visit of that episode (or therapist) booked.',
      ['Practitioner', 'Plans', 'Completed', 'In progress', 'Dropped off', 'Attended visits', 'Planned visits', 'Visits per plan', 'Drop-off rate'], x => [x.practitioner, x.plans, x.completed, x.inProgress, x.droppedOff, x.attendedVisits, x.plannedVisits, x.visitsPerPlan, pct(x.dropOffRate)], 'plan-of-care')
    + section('evaluations', 'New evaluations', 'Signed initial evaluation notes, dated by their visit (or their signing when no visit is linked).',
      ['Practitioner', 'PT', 'OT', 'SLP', 'Total'], x => [x.practitioner, x.pt, x.ot, x.slp, x.total], 'evaluations')
    + section('utilization', 'Utilization and productivity', 'Available minutes are each practitioner’s current weekly hours on every date in the range except clinic holidays. Utilization is booked, attended and no-show minutes out of available minutes; productivity is attended minutes out of available minutes.',
      ['Practitioner', 'Available minutes', 'Booked minutes', 'Attended minutes', 'Utilization', 'Productivity'], x => [x.practitioner, x.availableMinutes, x.bookedMinutes, x.attendedMinutes, pct(x.utilization), pct(x.productivity)], 'utilization')
    + section('payroll', 'Visit counts for payroll', 'Attended visits and their booked minutes, by practitioner and service.',
      ['Practitioner', 'Service', 'Attended visits', 'Attended minutes'], x => [x.practitioner, x.service ?? '', x.attendedVisits, x.attendedMinutes], 'payroll')
    + panel('Referral conversion', '<p class="help">Referrals received in the range, by source and by referring provider. Scheduled counts referrals whose episode has a booked or attended visit (or got further); evaluated, a signed initial evaluation; discharged, a closed episode; lost, recorded by a person. With a practitioner chosen, only referrals whose first visit is with them count.</p>'
      + (r.referrals.rows.length ? table(['Source or referring provider', 'Received', 'Scheduled', 'Evaluated', 'Discharged', 'Lost', 'Not yet scheduled', 'Scheduled share'],
        [...r.referrals.rows, { ...r.referrals.total, group: 'total', name: 'All referrals' }].map((x: any) => [x.group === 'source' ? `Source: ${x.name}` : x.group === 'provider' ? `Provider: ${x.name}` : x.name, x.received, x.scheduled, x.evaluated, x.discharged, x.lost, x.open, pct(x.conversion)]))
        : empty('No referrals received in this range.')) + download('referrals', 'referral conversion'), 'full', 'report-referrals')
    + outcomeSection(s.outcomes)
    + financialSections(s)
    + '</div>'
}

function outcomeSection(r: any) {
  if (!r) return ''
  const query = new URLSearchParams({from:r.from,to:r.to,outcomePractitionerId:r.practitionerId,diagnosis:r.diagnosis,payerId:r.payerId})
  const form = `<form method="get" action="/app/reports#report-outcomes" class="report-filter"><div class="pair">${field('from','Outcome cohort from',r.from,'date','required')}${field('to','Outcome cohort through',r.to,'date','required')}</div>`
    + select('outcomePractitionerId','Outcome practitioner',[['','All practitioners'],...r.practitioners.map((p:any)=>[p.id,p.name])],r.practitionerId,'')
    + select('diagnosis','Diagnosis',[['','All diagnoses'],...r.diagnoses.map((code:string)=>[code,code])],r.diagnosis,'')
    + select('payerId','Payer',[['','All payers'],['unrecorded','No recorded coverage'],...r.payers.map((p:any)=>[p.id,p.name])],r.payerId,'')
    + '<button type="submit">Run outcome report</button></form>'
  const heads = ['Practitioner','Instrument and version','Scoring version','Unit','Episodes','Paired','Missing baseline','Missing follow-up','Missing both','Baseline mean','Follow-up mean','Mean change']
  const body = r.rows.map((x:any)=>[x.practitioner,`${x.instrument} · ${x.source} · ${x.instrumentVersion} · ${x.side}`,x.scoringVersion,x.unit,x.episodes,x.paired,x.missingBaseline,x.missingFollowUp,x.missingBoth,x.baselineMean,x.followUpMean,x.meanChange])
  const result = body.length ? `<div class="table"><table><thead><tr>${heads.map(x=>`<th scope="col">${h(x)}</th>`).join('')}</tr></thead><tbody>${body.map((row:any[])=>`<tr>${row.map(value=>`<td>${h(value??'—')}</td>`).join('')}</tr>`).join('')}</tbody></table></div>` : empty('No outcome scores match this cohort. Missing scores are never treated as zero.')
  return panel('Outcome changes',form+`<p>${h(r.episodes)} episodes in this cohort.</p><p class="help">Episodes count once under the practitioner of their first filed visit. Dates select that first visit; follow-up includes later visits through the end date. Diagnosis means a recorded visit code anywhere in the episode; payer means recorded coverage for an episode visit. Neither filter duplicates an episode. Baseline is the score at the first visit; follow-up is the latest later score of the same instrument, version, side and unit. Means use complete pairs only. Missing both is included in both missing counts. Duplicate observations on a visit are missing. Chart scores are clinician-entered and unversioned; intake item sets and scoring versions stay separate. Change is follow-up minus baseline; higher may be better or worse depending on the instrument. This report is not a MIPS submission.</p>`+result+`<p><a class="button secondary" href="${h('/api/balm/reports/outcomes.csv?'+query)}" download>Download outcomes CSV</a></p>`,'full','report-outcomes')
}
