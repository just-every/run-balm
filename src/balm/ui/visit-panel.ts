import { alertBadges } from './alerts'
// The day view's patient panel for the selected visit, as the owner-picked screen
// lays it out: who and how they pay, then authorization, eligibility, copay and
// plan of care, the visit's next action, a denied claim as a coral card with its
// dated trail and the case agent's proposed fix waiting for a person's approval,
// and a quiet case agent strip that cites the records it used.
import { usDay } from '../cases/stages'
import { payerReason } from '../insurance/codes'
import { icon } from './icons'
import { avatar } from './shell'
import { check, desk, h, hidden, money, status, usDate, zoneOf } from './shared'

const ageOn = (dob: string | null, today: string) => {
  if (!dob) return null
  const [y, m, d] = dob.split('-').map(Number), [ty, tm, td] = today.split('-').map(Number)
  return ty - y - (tm < m || (tm === m && td < d) ? 1 : 0)
}
const clock = (s: any, iso: string) => new Intl.DateTimeFormat('en-US', { timeZone: zoneOf(s), month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' }).format(new Date(iso))
const fact = (glyph: string, tone: string, title: string, line: string) => `<li class="fact">${`<span class="disc ${tone}">${icon(glyph)}</span>`}<div><strong>${h(title)}</strong><p>${line}</p></div></li>`

/** Authorization, eligibility, copay and plan of care, from the patient's own records. */
function facts(s: any, a: any, sum: any, today: string) {
  const i = sum?.insurance, policy = i?.policies?.[0], pay = s.payments?.visits?.[a.id], out: string[] = []
  if (i) {
    if (!policy) out.push(fact('shield', 'muted', 'Coverage', 'Self-pay: no insurance policy on file'))
    else {
      const auth = a.authorization
      out.push(fact('shield', auth ? 'sky' : 'muted', 'Authorization', auth ? `${h(auth.left)} of ${h(auth.total)} ${h(auth.kind)} left · Expires ${h(usDate(auth.endsOn, zoneOf(s)))}${auth.covered === false ? ' · Not covered by the current authorization' : ''}` : 'No authorization on file'))
      const active = policy.eligibility_status === 'active'
      out.push(fact('checked', active ? 'sage' : 'honey', 'Eligibility', policy.eligibility_checked_at ? `${h(String(policy.eligibility_status).replace(/^./, (x: string) => x.toUpperCase()))} · Verified ${h(clock(s, policy.eligibility_checked_at))}` : 'Coverage has not been checked'))
    }
  }
  if (pay && desk(s)) {
    const c = pay.copay, paid = c?.status === 'succeeded', card = pay.card ? ` · ${h(pay.card.brand)} ending ${h(pay.card.last4)}` : ''
    out.push(fact('money', 'sage', 'Copay', paid ? `${h(money(c.amount))} paid${card}` : !(pay.copayCents > 0) ? 'No copay set for this patient'
      : a.status === 'booked' && !pay.checkedInAt ? `${h(money(pay.copayCents))} due at check-in${pay.card ? ' · card on file' : ''}` : `${h(money(pay.copayCents))} per visit${card}`))
  }
  if (a.plan_of_care) {
    const [state, at, physician] = String(a.plan_of_care).split('|')
    out.push(fact('note', 'ink', 'Plan of care', state === 'certified' ? `Signed by ${h(physician)} · ${h(usDate(at, zoneOf(s)))}` : `Sent to ${h(physician)} · not signed yet`))
  } else if (i) out.push(fact('note', 'muted', 'Plan of care', 'No plan of care on file'))
  return out.length ? `<ul class="facts">${out.join('')}</ul>` : ''
}

/** The denied claim: the payer's reason, the dated trail, and the proposed fix with its approval. */
function denial(s: any, sum: any, a: any) {
  const d = sum?.denied
  if (!d) return ''
  const c = d.claim, snapshot = c.snapshot ?? {}, file = `/app/clients/${a.client_id}`
  // The payer's reason in plain words, with its codes (CO-4, remark codes) kept for small print.
  const first = c.errors?.[0], payer = /^carc_/.test(String(first?.code)) ? payerReason(first.code, first.message) : null
  const reason = payer?.reason ?? String(first?.message ?? 'See the payer reason in the claim'), code = payer?.codes.join(', ') ?? ''
  const lines = (snapshot.lines ?? []).map((l: any) => `${l.code} ×${l.units}`).join(', ')
  const word = c.status === 'rejected' ? 'Claim rejected' : c.status === 'partial' ? 'Claim partly denied' : 'Claim denied'
  const step = (sum.case?.steps ?? []).find((x: any) => x.kind === 'denial.fix' && x.key === `denial.fix:${c.id}`)
  const trail = `<ol class="trail">${d.trail.map((t: any) => `<li${t.fault ? ' class="fault"' : ''}><span class="dot" aria-hidden="true"></span><time datetime="${h(t.at)}">${h(usDay(t.at, zoneOf(s)))}</time><span>${h(t.text)}</span></li>`).join('')}</ol>`
  const next = payer ? [...payer.remarks.map(x => `${x}.`), payer.next].join(' ') : ''
  const back = `/app?${new URLSearchParams({ view: 'day', date: s.calendar.date, appt: a.id })}`
  const fix = step
    ? `<div class="fix"><strong>Proposed fix</strong><p>${h(step.title)}.${next ? ` ${h(next)}` : ''}</p>${step.blocked ? `<p class="help">${h(step.blocked)}</p>`
      : `<form method="post" action="/app/action?name=case.approve&amp;returnTo=${encodeURIComponent(back)}">${hidden('caseId', sum.case.referral.id) + hidden('key', step.key) + hidden('digest', step.digest) + check('reviewed', 'I reviewed this step and the records it cites.')}<div class="fix-actions"><button type="submit">${h(step.button)}</button><span class="approval">Needs your approval</span></div></form>`}</div>`
    : `<div class="fix"><strong>Next step</strong><p>${h(c.nextStep ?? 'Review the payer reason, then correct and resubmit or draft an appeal.')}</p><a href="${h(file)}#claim-${h(c.id)}">Open the claim to correct or draft an appeal</a></div>`
  return `<section class="claim-alert" aria-label="${h(word)}"><header>${icon('warning')}<div><strong>${h(word)}${code ? ` <small class="code">${h(code)}</small>` : ''}</strong><p class="why">${h(reason)}</p><p>${h(a.client)}${lines ? ` · ${h(lines)}` : ''} · ${h(money(c.amount_cents))}</p></div><a class="go" href="${h(file)}#claim-${h(c.id)}" aria-label="Open the claim in the patient file">${icon('chevron')}</a></header>${trail}${fix}</section>`
}

/** The case agent: where the case stands, the records it cited, and the next step a person approves. */
function agentStrip(s: any, sum: any) {
  const k = sum?.case
  if (!k) return ''
  const done = k.stages.filter((x: any) => x.cite && (x.state === 'done' || x.state === 'stalled') && ['eligibility', 'era', 'outcome'].includes(x.id)).slice(-3)
  const rows = done.map((x: any) => `<li>${`<span class="disc ${x.state === 'stalled' ? 'coral' : 'sage'}">${icon(x.state === 'stalled' ? 'warning' : 'check')}</span>`}<div><strong>${h(x.label)}</strong><p>${h(x.text)} <a href="${h(x.cite.href)}" title="${h(x.cite.label)}">${icon('external', 'small')}<span class="sr-only">${h(x.cite.label)}</span></a></p></div></li>`).join('')
  const next = k.steps[0] ? `<li><span class="disc ink">${icon('arrow')}</span><div><strong>Next step</strong><p>${h(k.steps[0].title)} (${k.steps[0].blocked ? 'blocked until the record is fixed' : 'waits for a person’s approval'})</p></div></li>` : ''
  return `<section class="agent" aria-label="Case agent"><header>${icon('leaf', 'leaf')}<strong>Case agent</strong><span class="standing">${status(k.standing.state === 'stalled' ? 'Needs a person' : k.standing.state === 'done' ? 'Reconciled' : 'Waiting')}</span><a class="go" href="/app/cases#case-${h(k.referral.id)}" aria-label="Open the case">${icon('chevron')}</a></header><ul>${rows}${next}</ul><p class="agent-note">Nothing is sent until a person approves it.</p></section>`
}

export function patientPanel(s: any, c: any, a: any, body: { visit: string; primary: string; actions: string }) {
  const sum = c.summary, file = `/app/clients/${a.client_id}`, age = ageOn(a.date_of_birth, c.today)
  const payer = sum?.insurance ? (sum.insurance.policies[0]?.payer_name ?? 'Self-pay') : a.payer ?? null
  const tabs = [['Overview', ''], ['Notes', '#notes'], ['Billing', '#billing'], ['Messages', '#messages']]
  return `<section class="patient" id="visit" aria-label="Selected visit"><header class="profile">${avatar(a.client, 'lg')}<div><h2>${h(a.client)}</h2><p>${[age !== null ? String(age) : '', payer ?? ''].filter(Boolean).map(h).join(' · ')}</p></div><a class="more" href="${h(file)}" aria-label="Open client file" title="Open client file">${icon('chevron')}</a></header>`
    + `<nav class="tabs" aria-label="Patient file">${tabs.map(([label, anchor]) => anchor ? `<a href="${h(file + anchor)}">${label}</a>` : `<span aria-current="true">${label}</span>`).join('')}</nav>`
    + alertBadges(a.alerts) + body.visit + facts(s, a, sum, c.today) + body.primary + denial(s, sum, a) + body.actions + agentStrip(s, sum) + '</section>'
}
