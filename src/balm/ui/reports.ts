// The owner's operational reports: one filter form, a table per report with its
// all-practitioner total, and a CSV download that carries the same filters.
import { empty, field, h, panel } from './shared'

const table = (heads: string[], body: unknown[][]) => `<div class="table"><table><thead><tr>${heads.map(x => `<th scope="col">${h(x)}</th>`).join('')}</tr></thead><tbody>${body.map((r, i) => `<tr${i === body.length - 1 ? ' class="total"' : ''}>${r.map(c => `<td>${h(c ?? '—')}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`
const pct = (value: unknown) => value === null || value === undefined ? '—' : `${value}%`

export function reportsPage(s: any) {
  const r = s.reports
  if (!r) return ''
  const query = (kind: string) => `/api/balm/reports/${kind}.csv?` + new URLSearchParams({ from: r.from, to: r.to, ...(r.practitionerId ? { practitionerId: r.practitionerId } : {}) }).toString()
  const download = (kind: string, label: string) => `<p><a class="button secondary" href="${h(query(kind))}" download>Download ${h(label)} CSV</a></p>`
  const all = (row: any) => ({ ...row, practitioner: 'All practitioners' })
  const section = (kind: string, title: string, intro: string, heads: string[], cells: (row: any) => unknown[], label: string) => {
    const list = r[kind].rows as any[]
    return panel(title, `<p class="help">${h(intro)}</p>` + (list.length ? table(heads, [...list.map(cells), cells(all(r[kind].total))]) : empty('No practitioners match this filter.')) + download(kind, label), 'full', `report-${kind}`)
  }
  const choices = [['', 'All practitioners'], ...r.practitioners.map((p: any) => [p.id, p.name])]
  const filter = `<form method="get" action="/app/reports" class="report-filter"><div class="pair">${field('from', 'From', r.from, 'date', 'required')}${field('to', 'Through', r.to, 'date', 'required')}</div>`
    + `<label>Practitioner<select name="practitionerId">${choices.map(([value, label]) => `<option value="${h(value)}"${value === (r.practitionerId ?? '') ? ' selected' : ''}>${h(label)}</option>`).join('')}</select></label>`
    + `<p class="help">Dates include the whole day in ${h(r.timeZone)}; a visit counts on the clinic date it starts. Every visit is at the clinic's one location, so there is no location filter yet.</p><button type="submit">Run reports</button></form>`
  return `<div class="grid">${panel('Operational reports', (s.reportError ? `<div class="notice error" role="alert">${h(s.reportError)}</div>` : '') + filter, 'full')}`
    + section('visits', 'Visits, arrivals, cancellations and no-shows', 'Every visit that starts in the range, by its current status. The no-show rate is no-shows out of arrivals plus no-shows.',
      ['Practitioner', 'Scheduled', 'Still booked', 'Arrived', 'Cancelled', 'No-shows', 'No-show rate'], x => [x.practitioner, x.scheduled, x.booked, x.arrived, x.cancelled, x.noShows, pct(x.noShowRate)], 'visits')
    + section('plans', 'Plan-of-care completion', 'Each plan of care that starts in the range is one episode. It counts attended visits with its therapist from its start date through its planned weeks. Completed means the planned visits were attended; dropped off means fewer, with no visit booked with that therapist.',
      ['Practitioner', 'Plans', 'Completed', 'In progress', 'Dropped off', 'Attended visits', 'Planned visits', 'Visits per plan', 'Drop-off rate'], x => [x.practitioner, x.plans, x.completed, x.inProgress, x.droppedOff, x.attendedVisits, x.plannedVisits, x.visitsPerPlan, pct(x.dropOffRate)], 'plan-of-care')
    + section('evaluations', 'New evaluations', 'Signed initial evaluation notes, dated by their visit (or their signing when no visit is linked).',
      ['Practitioner', 'PT', 'OT', 'SLP', 'Total'], x => [x.practitioner, x.pt, x.ot, x.slp, x.total], 'evaluations')
    + section('utilization', 'Utilization and productivity', 'Available minutes are each practitioner’s current weekly hours on every date in the range except clinic holidays. Utilization is booked, attended and no-show minutes out of available minutes; productivity is attended minutes out of available minutes.',
      ['Practitioner', 'Available minutes', 'Booked minutes', 'Attended minutes', 'Utilization', 'Productivity'], x => [x.practitioner, x.availableMinutes, x.bookedMinutes, x.attendedMinutes, pct(x.utilization), pct(x.productivity)], 'utilization')
    + section('payroll', 'Visit counts for payroll', 'Attended visits and their booked minutes, by practitioner and service.',
      ['Practitioner', 'Service', 'Attended visits', 'Attended minutes'], x => [x.practitioner, x.service ?? '', x.attendedVisits, x.attendedMinutes], 'payroll')
    + panel('Referral conversion', '<p>Balm does not record referrals yet, so there is no referral conversion to report. It is added here when referrals are recorded.</p>', 'full', 'report-referrals')
    + '</div>'
}
