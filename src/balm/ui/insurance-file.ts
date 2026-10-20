import { assignForm, episodeField, episodeLabel } from './episodes'
import { hostDateAt } from '../availability/timezone'
import { desk, empty, entry, field, form, h, hidden, money, owner, panel, select, stamp, status, textarea, usDate, when, zoneOf } from './shared'
import { authorizationForm, policyForm } from './insurance-policy'
import { medicareClaimForms } from './insurance-medicare'
import { claimErrors, claimNumber, insuranceResult, x12Link, x12Upload } from './insurance-shared'

const benefitLabel: Record<string, string> = { '1': 'Active coverage', '6': 'Inactive coverage', A: 'Coinsurance', B: 'Copay', C: 'Deductible', F: 'Visit limit', R: 'Other coverage' }
const periodLabel: Record<string, string> = { '22': 'service year', '23': 'calendar year', '29': 'remaining', '27': 'visit' }
const serviceLabel: Record<string, string> = { '30': 'Health plan', AD: 'Occupational therapy', AE: 'Physical medicine', AF: 'Speech therapy' }
function coverageWarnings(s: any, f: any) {
  const groups = new Map<string, { warning: any; visits: any[] }>()
  for (const [appointmentId, warnings] of Object.entries(f.insurance.warnings ?? {})) {
    const visit = f.appointments.find((a: any) => a.id === appointmentId)
    if (!visit) continue
    for (const warning of warnings as any[]) {
      const key = [warning.code, warning.policyId, warning.authorizationId].join(':')
      const group = groups.get(key) ?? { warning, visits: [] }
      if (!group.visits.some(v => v.id === visit.id)) group.visits.push(visit)
      groups.set(key, group)
    }
  }
  return [...groups.values()].map(({ warning, visits }) => {
    const authorization = f.insurance.authorizations.find((a: any) => a.id === warning.authorizationId)
    const label = authorization ? `Authorization ${authorization.number}: ` : ''
    const message = warning.code === 'authorization_exhausted' ? `${visits.length} booked visit${visits.length === 1 ? ' exceeds' : 's exceed'} the authorized allowance. Review these visits with the payer before treatment.` : warning.message
    const affected = warning.code === 'authorization_low' ? '' : `<ul>${visits.sort((a, b) => a.start_at.localeCompare(b.start_at)).map(v => `<li><a href="#visit-${h(v.id)}">${when(s, v.start_at)} · ${h(v.service)} with ${h(v.practitioner)}</a></li>`).join('')}</ul>`
    return `<div class="notice"><p>${h(label + message)}</p>${affected}</div>`
  }).join('')
}
function benefits(e: any) {
  const payload = typeof e.benefits === 'string' ? JSON.parse(e.benefits) : e.benefits
  return (payload?.benefits ?? []).map((b: any) => `<li><strong>${h(benefitLabel[b.information] ?? `Benefit ${b.information}`)}</strong> · ${h(b.serviceTypes.map((t: string) => serviceLabel[t] ?? t).join(', '))}${b.amountCents !== null ? ` · ${money(b.amountCents)}` : ''}${b.percent !== null ? ` · ${(b.percent * 100).toFixed(0)}%` : ''}${b.quantity !== null ? ` · ${h(b.quantity)} ${b.quantityQualifier === 'VS' ? 'visits' : h(b.quantityQualifier)}` : ''}${b.timePeriod ? ` · ${h(periodLabel[b.timePeriod] ?? `period ${b.timePeriod}`)}` : ''}${b.network ? ` · ${b.network === 'Y' ? 'in network' : b.network === 'N' ? 'out of network' : h(b.network)}` : ''}</li>`).join('')
    + (payload?.errors ?? []).map((e: any) => `<li>Payer error ${h(e.reason)} · follow-up ${h(e.followup)}</li>`).join('')
}
function coverage(s: any, f: any, path: string) {
  const i = f.insurance, today = hostDateAt(new Date(), zoneOf(s))
  const list = i.policies.map((p: any) => {
    const requests = i.eligibility.filter((e: any) => e.policy_id === p.id)
    const elig = requests.map((e: any) => e.benefits?.manual ? `<details open><summary>Eligibility for ${h(usDate(e.service_date, zoneOf(s)))} · ${h(e.status)} · checked by hand</summary><p>${h(e.benefits.manual.source)}${e.benefits.manual.copayCents !== null ? ` · copay ${money(e.benefits.manual.copayCents)}` : ''}<br><span class="help">Recorded by ${h(e.benefits.manual.by)} ${stamp(s, e.checked_at)}</span></p></details>` : `<details${e.benefits ? ' open' : ''}><summary>Eligibility for ${h(usDate(e.service_date, zoneOf(s)))} · ${h(e.status)}</summary><p>Prepared ${stamp(s, e.created_at)}${e.checked_at ? ` · checked ${stamp(s, e.checked_at)}` : ''}</p><ul>${benefits(e)}</ul><p><a href="${x12Link('270', e.id)}">Download 270 inquiry</a></p>${e.status === 'superseded' ? '<p>The policy was corrected. Use the newest eligibility request.</p>' : ''}${desk(s) && !e.benefits && e.status !== 'superseded' ? form('insurance.eligibility.submit', path, hidden('id', e.id), 'Send eligibility inquiry through adapter', true) + x12Upload('insurance.eligibility.import', path, hidden('id', e.id), '271 response for this inquiry', 'Import eligibility response') : ''}</details>`).join('')
    const auths = i.authorizations.filter((a: any) => a.policy_id === p.id).map((a: any) => entry(`Authorization ${a.number}`, `<p>${status(`${a.remaining_allowance} of ${a.allowance_total} ${a.allowance_kind} left`)}<br>${a.used_allowance} used${a.reserved_allowance ? ` · ${a.reserved_allowance} reserved` : ''} · expires ${h(usDate(a.ends_on, zoneOf(s)))}<br>${h(JSON.parse(a.cpt_scope).length ? `CPT scope: ${JSON.parse(a.cpt_scope).join(', ')}` : 'All CPT codes')} · low warning at ${a.low_remainder}<br>${episodeLabel(f, a.episodeId ?? '')}</p>${desk(s) ? assignForm(f, 'authorization', a.id, a.episodeId ?? '', path) : ''}${desk(s) ? `<details><summary>Edit authorization</summary>${authorizationForm(s, p.id, path, a)}</details>` : ''}`, `authorization-${a.id}`)).join('')
    return entry(p.payer_name ?? s.insurance.payers.find((x: any) => x.id === p.payer_id)?.name ?? 'Insurance policy', `<p>${status(p.eligibility_status)} Member ${h(p.member_id)}${p.plan_name ? ` · ${h(p.plan_name)}` : ''}<br>${h(usDate(p.starts_on, zoneOf(s)))}${p.ends_on ? ` to ${h(usDate(p.ends_on, zoneOf(s)))}` : ''}</p>${p.eligibility_checked_at ? `<p class="help">Checked ${stamp(s, p.eligibility_checked_at)}. Benefits are not a guarantee of payment.</p>` : '<p class="help">Coverage has not been checked.</p>'}${elig}${desk(s) ? `<details><summary>Record an eligibility check made by phone or website</summary><p class="help">Call the payer’s provider line or look the member up on its website, then record what it said. This counts as the eligibility check for the patient’s case.</p>${form('insurance.eligibility.record', path, hidden('policyId', p.id) + field('serviceDate', 'For visits on', today, 'date', 'required') + select('status', 'Coverage', [['active', 'Active'], ['inactive', 'Not active']], 'active') + field('copay', 'Copay ($, if they said)', '', 'text', 'inputmode="decimal" maxlength="12" placeholder="30.00"') + field('source', 'Who said so, and the call or page reference', '', 'text', 'required maxlength="300" placeholder="UHC provider line, Dana, call ref 12345"'), 'Record eligibility check')}</details><details><summary>Prepare an electronic eligibility inquiry (270)</summary><p class="help">A 270 file goes to your clearinghouse; the payer’s 271 answer is uploaded back here.</p>${form('insurance.eligibility.prepare', path, hidden('policyId', p.id) + field('serviceDate', 'Service date', today, 'date', 'required'), 'Prepare 270 inquiry')}</details><details><summary>Edit policy</summary>${policyForm(s, f.client.id, path, p)}</details>` : ''}${auths || empty('No authorization recorded.')}${desk(s) ? `<details><summary>Add authorization</summary>${authorizationForm(s, p.id, path, undefined, episodeField(f))}</details>` : ''}`)
  }).join('')
  return panel('Coverage and authorizations', `<div>${coverageWarnings(s, f)}</div>` + (list || empty('No insurance policies yet.')) + (desk(s) ? s.insurance.payers.length ? `<details><summary>Add insurance policy</summary>${policyForm(s, f.client.id, path)}</details>` : '<p>Add a payer from the <a href="/app/insurance">Insurance page</a> first.</p>' : ''), '', 'insurance')
}
function claims(s: any, f: any, path: string) {
  const i = f.insurance
  const list = i.claims.map((c: any) => {
    const snapshot = typeof c.snapshot === 'string' ? JSON.parse(c.snapshot) : c.snapshot, kx = snapshot?.payer?.medicare ? snapshot.kx : null
    const clinical = owner(s) || s.actor.staffId && f.appointments.some((a: any) => a.id === c.appointment_id && a.practitioner_id === s.actor.staffId)
    const label = c.status === 'corrected' ? (i.claims.some((x: any) => x.replaces_id === c.id) ? 'replaced' : 'withdrawn') : c.status === 'draft' ? 'held: needs a fix' : c.status
    return entry(`${c.payer_name ?? snapshot?.payer?.name ?? 'Claim'} · ${usDate(c.service_date, zoneOf(s))}`, `<p>${status(label)} Billed ${money(c.amount_cents)}${c.payer_paid_cents !== null ? ` · Payer paid ${money(c.payer_paid_cents)} · Patient share ${money(c.patient_responsibility_cents)}` : ''}${kx?.required ? ` · ${status('KX required')}` : ''}</p><p class="help">Claim ${claimNumber(c.id)}${c.payer_control ? `<br>Payer control ${h(c.payer_control)}` : ''}</p>${c.status === 'corrected' ? '' : claimErrors({ ...c, client_id: f.client.id })}${kx ? `<p class="help">${h(kx.year)} ${kx.group === 'ot' ? 'OT' : 'PT + speech'} expenses: ${money(kx.usedCents)} before this visit; ${money(kx.projectedCents)} including it. KX threshold ${kx.thresholdCents === null ? 'not configured' : money(kx.thresholdCents)}. Targeted review ${kx.reviewCents==null?'not configured':money(kx.reviewCents)}.</p>${kx.targetedReview?'<p class="notice">Targeted medical review threshold exceeded. Keep supporting records ready; this flag does not mean Medicare selected the claim for review.</p>':''}` : ''}${(c.denials ?? []).map((d: any) => `<p class="notice"><strong>${h(d.reason ?? d.message)}</strong><br>${h(d.nextStep ?? d.fix)} (${h(d.code)})</p>`).join('')}${snapshot?.lines ? `<p>CPT ${snapshot.lines.map((l: any) => `${h(l.code)} ${h(l.modifiers?.join(' '))} × ${h(l.units)}`).join(', ')}<br>ICD-10 ${h(snapshot.diagnoses?.join(', '))}</p>` : ''}`
      + medicareClaimForms(c,snapshot,path,clinical,desk(s))
      + (['draft', 'ready'].includes(c.status) && desk(s) ? form('insurance.claim.scrub', path, hidden('id', c.id), 'Check the claim again') : '')
      + (['draft', 'ready'].includes(c.status) && clinical ? `<details><summary>Document KX medical necessity</summary><p>The treating clinician must support continued skilled care. This attestation is kept with the claim.</p>${form('insurance.claim.necessity', path, hidden('id', c.id) + textarea('medicalNecessity', 'Medical necessity', snapshot?.medicalNecessity ?? '', 'required maxlength="8000"'), 'Save medical necessity and validate')}</details>` : '')
      + (['draft', 'ready', 'denied', 'rejected', 'partial', 'accepted'].includes(c.status) && desk(s) ? `<details><summary>Correct and prepare a new claim</summary><p>Correct the patient, policy, visit codes or fee schedule first. This keeps the original attempt.</p>${form('insurance.claim.correct', path, hidden('id', c.id) + field('payerControl', 'Original payer control number (for replacement)', c.payer_control), 'Prepare corrected claim')}</details>` : '')
      + (['denied', 'rejected', 'partial'].includes(c.status) && clinical ? `<details><summary>Draft appeal letter</summary>${form('insurance.denial.appeal', path, hidden('id', c.id) + textarea('reason', 'Why the record supports payment', '', 'required maxlength="8000"'), 'Draft appeal for review')}</details>${c.appeal ? `<details><summary>Saved appeal draft</summary><pre>${h(c.appeal)}</pre></details>` : ''}` : ''), `claim-${c.id}`)
  }).join('')
  const visits = f.appointments.filter((a: any) => a.status === 'attended')
  const prepare = desk(s) && visits.length && i.policies.length ? `<details><summary>Prepare a claim from a signed visit</summary>${form('insurance.claim.prepare', path,
    select('appointmentId', 'Attended visit', visits.map((a: any) => [a.id, `${usDate(a.start_at, zoneOf(s))} · ${a.service} · ${a.practitioner}`])) + select('policyId', 'Policy', i.policies.map((p: any) => [p.id, `${p.payer_name ?? 'Payer'} · ${p.member_id}`]))
    + select('therapyGroup', 'Therapy accumulator', [['pt_slp', 'Physical therapy / speech'], ['ot', 'Occupational therapy']])
    + `<details><summary>Referring provider (if payer requires)</summary>${field('referringFirst', 'First name')}${field('referringLast', 'Last name')}${field('referringNpi', 'NPI')}</details>` + '<p class="help">Requires an approved visit invoice. CPT units come from the signed note; diagnoses come from the visit’s ICD-10 codes. Missing fields are named before batching.</p>', 'Prepare and validate claim')}</details>` : ''
  return panel('Insurance claims', list + prepare || empty('No claims yet. Complete and sign the visit note, record ICD-10 codes, and approve its invoice.'))
}
function medicare(s: any, f: any, path: string) {
  if (!f.insurance.policies.some((p: any) => p.medicare) && !f.insurance.medicare.length) return ''
  const i = f.insurance, year = new Date().getFullYear()
  const list = (i.medicare ?? []).map((m: any) => `<li>${h(m.year)} ${m.therapy_group === 'ot' ? 'OT' : 'PT + speech'} · outside clinic ${money(m.external_used_cents)}${m.usedCents !== undefined ? ` · tracked ${money(m.usedCents)}` : ''}<br><span class="help">${h(m.source)}</span></li>`).join('')
  return panel('Medicare therapy spending', `<p>Annual CMS KX and targeted-review amounts are held in Insurance settings. Include recognized care at other practices, excluding the claims Balm tracks here. Reconcile local allowed-fee estimates to Medicare’s recognized expenses.</p><ul>${list}</ul>${desk(s) ? `<details><summary>Record outside recognized expenses</summary>${form('insurance.medicare.save', path, hidden('clientId', f.client.id) + field('year', 'Calendar year', year, 'number', 'required min="2000" max="2100"') + select('therapyGroup', 'Therapy group', [['pt_slp', 'PT and speech combined'], ['ot', 'OT separately']]) + field('externalUsed', 'Recognized expenses outside this clinic ($)', '0.00', 'text', 'required inputmode="decimal"') + field('source', 'Source and date of these amounts', '', 'text', 'required maxlength="300"'), 'Save Medicare expenses')}</details>` : ''}`)
}
export function insurancePanels(s: any, f: any, notice: any) {
  if (!f.insurance) return ''
  const path = `/app/clients/${f.client.id}`
  return `<div class="full insurance">${insuranceResult(notice)}<div class="grid">${coverage(s, f, path)}${claims(s, f, path)}${medicare(s, f, path)}</div></div>`
}
