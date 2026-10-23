import { claimAgeBands } from '../insurance/claim-work'
import { claimNumber } from './insurance-shared'
import { empty, field, form, h, hidden, money, panel, select, stamp, status } from './shared'

function actionHistory(work: any, item: any) {
  const context = { settings: { time_zone: work.timeZone } }
  return `<details><summary>Claim action history</summary><ol>${item.actions.map((a: any) => `<li>${stamp(context, a.at)} · ${h(a.action.replace(/^insurance\./, '').replaceAll('_', ' '))} · ${h(a.actor_email)} · Claim ${claimNumber(a.claim_id)}</li>`).join('')}</ol>${(item.externalActions ?? []).map((a: any) => `<p>${h(a.kind === 'appeal_sent' ? 'Appeal sent outside Balm' : 'Payer follow-up')} on ${h(a.detail.on)} · ${h(a.detail.source)} · recorded by ${h(a.detail.recordedBy)}</p>`).join('')}</details>`
}

/** Added to the Insurance page for the owner and biller only. The parent passes
 * the GET filter values to claimWork, so links and reloads preserve the view. */
export function claimWorkPanel(work: any) {
  if (!work) return ''
  const path = '/app/insurance', filter = work.filters
  const payerChoices: [string, string][] = work.payers.map((p: any) => [p.id, p.name])
  const filters = `<form method="get" action="${path}#claim-work">${select('payerId', 'Payer', [['', 'All payers'], ...payerChoices], filter.payerId, '')}${select('age', 'Age from service date', [['', 'All ages'], ...claimAgeBands.map(a => [a, `${a} days`] as [string, string])], filter.age, '')}${select('reason', 'Reason', [['', 'All reasons'], ...work.reasons.map((r: string) => [r, r === 'unpaid' ? 'Awaiting payment' : r.replace('carc_', 'CO-')])], filter.reason, '')}<button type="submit">Filter claims</button></form>`
  const items = work.queue.map((c: any) => {
    const link = `/app/clients/${c.client_id}#claim-${c.id}`
    const deadlines = c.deadlines.map((d: any) => `<li>${h(d.kind === 'initial' ? 'Initial filing' : d.kind === 'correction' ? 'Correction' : 'Appeal')}: ${d.dueOn ? `${h(d.dueOn)}${d.completed ? ' · action recorded' : d.overdue ? ' · overdue' : ''}` : h(d.unknown)}${d.rule ? `<details><summary>Recorded payer instruction</summary><p>${h(d.rule.days)} calendar days from ${h(d.rule.basis.replaceAll('_', ' '))}. ${h(d.rule.source)}</p><p>Service dates ${h(d.rule.effective_from)} through ${h(d.rule.effective_to ?? 'no recorded end')}. Recorded by ${h(d.rule.recorded_by)}.</p>${d.adjudication ? `<p>Decision date ${h(d.adjudication.adjudicationOn)} · ${h(d.adjudication.source)}</p>` : ''}</details>` : ''}</li>`).join('')
    const recordDecision = ['denied', 'partial', 'rejected'].includes(c.status) ? `<details><summary>Record payer decision date</summary><p>Use the date on the payer’s decision, so appeal and correction limits use that date.</p>${form('insurance.filing.date', path, hidden('id', c.id) + field('adjudicationOn', 'Payer decision date', '', 'date', 'required') + field('source', 'Decision document or payer reference', '', 'text', 'required maxlength="2000"'), 'Record decision date')}</details>` : ''
    const recordAction = `<details><summary>Record completed billing work</summary><p>Record a follow-up or an appeal already sent through the payer’s channel.</p>${form('insurance.claim.action', path, hidden('id', c.id) + select('kind', 'Completed work', [['followup', 'Payer follow-up'], ['appeal_sent', 'Appeal sent outside Balm']]) + field('on', 'Date completed', '', 'date', 'required') + field('source', 'Billing reference or confirmation', '', 'text', 'required maxlength="2000"'), 'Record completed work')}</details>`
    return `<article class="claim-row claim-work-item"><h3><a href="${h(link)}">${h(c.patient)}</a> · ${h(c.payer_name)}</h3><p>${status(c.status)} · ${money(c.open_cents)} outstanding · ${h(c.ageDays)} days since ${h(c.service_date)}</p><p>Claim ${claimNumber(c.id)}</p>${c.reasons.map((r: any) => `<p><strong>${h(r.reason)}</strong> ${r.remarks.map(h).join(' ')} <small>${h(r.codes.join(', '))}</small></p>`).join('')}<p>${h(c.next)}</p><ul>${deadlines}</ul><p><a href="${h(link)}">Open claim to correct or draft an appeal</a></p>${recordDecision}${recordAction}${actionHistory(work, c)}</article>`
  }).join('')
  const ruleForm = `<details><summary>Record a payer filing instruction</summary><p>Copy the payer’s documented limit. There is no default limit. A new instruction is retained beside earlier entries and takes precedence for matching service dates. Record initial, correction and appeal limits separately.</p>${form('insurance.filing.save', path,
    select('payerId', 'Payer', payerChoices) + select('kind', 'Limit for', [['initial', 'Initial claim'], ['correction', 'Corrected claim'], ['appeal', 'Appeal']])
    + select('basis', 'Count calendar days from', [['service_date', 'Date of service'], ['adjudication_date', 'Payer decision date (correction or appeal only)']])
    + field('days', 'Calendar days allowed', '', 'number', 'required min="0" max="3660" step="1"')
    + field('effectiveFrom', 'Applies to service dates from', '', 'date', 'required') + field('effectiveTo', 'Applies to service dates through (optional)', '', 'date')
    + field('source', 'Payer instruction source and reference', '', 'text', 'required maxlength="2000"'), 'Record payer instruction')}</details>`
  const closed = work.history.filter((c: any) => !work.queue.some((q: any) => q.id === c.id)).map((c: any) => `<article class="claim-work-item"><p><a href="/app/clients/${h(c.clientId)}#claim-${h(c.id)}">Claim ${claimNumber(c.id)}</a> · ${status(c.status)}</p>${actionHistory(work, c)}</article>`).join('')
  return panel('Denials and unpaid claims', `<p>Balances and age are current through ${h(work.today)} in the clinic’s time zone. Unknown filing limits require a payer instruction; a missing decision date stays unknown.</p>${filters}${items || empty('No claims match these filters.')}${ruleForm}${closed ? `<details><summary>Other claim histories</summary>${closed}</details>` : ''}`, '', 'claim-work')
}
