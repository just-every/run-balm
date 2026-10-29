import { check, form, h, hidden, panel, select, stamp, when } from './shared'

export function continuityPanel(s: any, f: any) {
  const continuity = f.continuity
  if (!continuity?.series.length) return ''
  const path = '/app/clients/' + f.client.id
  const prepare = form('continuity.prepare', path, select('seriesId', 'Signed-plan series', continuity.series.map((v: any) => [v.id, v.service + ' · ' + JSON.parse(v.pattern).firstDate]))
    + '<p>After two cancellations, prepare replacement dates using the current signed cadence, available capacity and unreserved authorization. No date is booked or held, and no patient is contacted.</p>', 'Prepare replacement sequence')
  const proposals = continuity.proposals.map((p: any) => {
    const v = p.payload
    const offered = (p.offers ?? []).map((o: any) => `<p>${o.accepted_at ? 'Patient accepted; all replacement visits booked ' + stamp(s, o.accepted_at) : o.revoked_at ? 'Portal offer withdrawn' : !o.execution_authority ? 'Historical portal offer; no booking authority' : 'Portal offer expires ' + stamp(s, o.expires_at)}</p>`
      + (!o.accepted_at && !o.revoked_at && o.execution_authority ? form('continuity.withdraw', path, hidden('id', o.id), 'Withdraw portal offer') : '')).join('')
    return `<article class="entry"><h3>${h(v.service)} with ${h(v.practitioner)}</h3><p>${p.approved_at ? 'Preparation approved' : p.review_authority ? 'Awaiting clinician review' : 'Historical preparation — prepare again for current review'}</p><p>Signed cadence: ${h(v.cadence.frequencyPerWeek)} visits per week, ${h(v.cadence.firstDate)} through ${h(v.cadence.lastDate)}. Times in ${h(v.timeZone)}.</p>`
      + `<ol>${v.occurrences.map((o: any) => `<li>${when(s, o.startAt)} · ${h(o.allowance)} ${h(v.authorization.find((a: any) => a.id === o.authorizationId)?.kind === 'units' ? o.allowance === 1 ? 'unit' : 'units' : o.allowance === 1 ? 'visit' : 'visits')}</li>`).join('')}</ol>`
      + v.authorization.map((a: any) => `<p>Authorization ${h(a.number)}: ${h(a.total)} ${h(a.kind)} total, ${h(a.used)} used, ${h(a.reserved)} already reserved, ${h(a.remaining)} available. This sequence would use ${h(a.proposed)} and leave ${h(a.afterBooking)}. Approval reserves none.</p>`).join('')
      + `<details><summary>Records used</summary><p><a href="${h(path)}#plan-${h(v.planId)}">Signed plan of care</a></p><ul>${v.cancellations.map((c: any) => `<li><a href="${h(path)}#visit-${h(c.id)}">Canceled visit ${when(s, c.startAt)}</a></li>`).join('')}</ul><p>${v.waitlist.length ? v.waitlist.map((w: any) => h(w.status) + ': ' + h(w.earliestDate) + ' through ' + h(w.latestDate)).join('<br>') : 'No recorded waitlist preferences for this service.'}</p><p>Exact review digest: <span class="continuity-digest">${h(p.digest)}</span></p></details>`
      + `<p>Prepared ${stamp(s, p.prepared_at)} by ${h(p.prepared_by)}${p.approved_at ? '<br>Approved ' + stamp(s, p.approved_at) + ' by ' + h(p.approved_by) : ''}</p>`
      + (p.review_authority && !p.approved_at ? form('continuity.approve', path, hidden('id', p.id) + hidden('digest', p.digest) + check('confirm', 'I reviewed these exact dates and the unchanged signed cadence. Record preparation approval only; book nothing and contact nobody.'), 'Approve preparation') : '')
      + offered
      + (p.review_authority && p.approved_at && !p.offers?.some((o: any) => o.accepted_at) ? form('continuity.offer', path, hidden('id', p.id) + hidden('digest', p.digest) + check('confirm', 'Release these exact dates to this patient’s signed-in portal for confirmation. Nothing is held; book all dates only after the patient accepts and the sources still agree.'), 'Offer dates in patient portal') : '') + '</article>'
  }).join('')
  return panel('Care continuity', prepare + proposals, 'full', 'care-continuity')
}
