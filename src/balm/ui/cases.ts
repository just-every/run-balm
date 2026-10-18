// The case agent's page: every referral as one case, where it stands stage by
// stage, and the next step lined up with the records it used, for a person to approve.
import { check, empty, field, form, h, hidden, panel, select, stamp, textarea } from './shared'
import { payerFileUploads } from './insurance-shared'

const path = '/app/cases'
const stateWord: Record<string, string> = { done: 'Done', waiting: 'Waiting', stalled: 'Stalled', none: 'Not started' }

const cites = (list: any[]) => `<ul class="case-cites">${list.map(c => `<li><a href="${h(c.href)}">${h(c.label)}</a></li>`).join('')}</ul>`

function outcome(r: any, kind: string) {
  if (r.error) return `Not done: ${r.error}`
  if (r.delivery === 'suppressed') return 'Not sent: email is suppressed on this install'
  if (kind === 'authorization.request') return r.delivery === 'sent' ? `Emailed to ${r.to}${r.attachment ? ` with ${r.attachment}` : ''}` : `Not sent (${String(r.delivery).replace(/_/g, ' ')})`
  if (kind === 'statement.send') return r.delivery === 'sent' ? `Statement link emailed to ${r.to}` : `Not sent (${String(r.delivery).replace(/_/g, ' ')})`
  if (kind === 'eligibility.check') return r.status === 'prepared' ? `270 inquiry prepared for export. ${r.line ?? ''}` : `270 inquiry ${r.status}`
  if (r.held?.length) return `${r.replaces ? 'Corrected claim' : 'Claim'} held by the scrubber: ${r.held.join(' ')}`
  return `${r.replaces ? 'Corrected claim' : 'Claim'} ${r.claimStatus}${r.reference ? ` (reference ${r.reference})` : ''}${r.line ? `. ${r.line}` : ''}`
}

function stepCard(c: any, step: any, wording: any) {
  const ids = hidden('caseId', c.referral.id) + hidden('key', step.key) + hidden('digest', step.digest)
  const sends = step.sends ? `<p class="case-sends">Sends to <strong>${h(step.sends.to)}</strong>: “${h(step.sends.subject)}”${step.sends.attachment ? `<br>Attached: ${h(step.sends.attachment.label)}` : ''}</p>` : ''
  const letter = step.sends?.fixed ? `<pre class="case-letter">${h(step.sends.fixed)}</pre>` : ''
  const words = step.draftable ? textarea('wording', 'Request paragraph (edit before you approve)', step.wording, 'required maxlength="4000" rows="5"') : ''
  const approve = step.blocked ? `<p class="notice" role="note">${h(step.blocked)}</p>`
    : form('case.approve', path, ids + words + check('reviewed', 'I reviewed this step and the records it cites.'), step.button)
  const draft = step.draftable && !step.blocked ? wording.ready ? form('case.draft', path, hidden('caseId', c.referral.id) + hidden('key', step.key), 'Draft wording with the AI key', true) : `<p class="help">${h(wording.line)}</p>` : ''
  return `<div class="case-step"><h4>${h(step.title)}</h4><p>${h(step.why)}</p><p class="help">Records used</p>${cites(step.citations)}${sends}${letter}${approve}${draft}</div>`
}

/** With nothing to approve, the case still names what moves it on and where. */
function nextUp(c: any) {
  const stage = c.stages.find((x: any) => x.state === 'stalled' && x.next) ?? [...c.stages].reverse().find((x: any) => x.state === 'waiting' && x.next)
  return stage ? `<section class="case-next"><h3>Next step</h3><p><strong>${h(stage.label)}</strong>: <a href="${h(stage.next.href)}">${h(stage.next.text)}</a></p><p class="help">Nothing here needs approval; the case moves on once that record changes.</p></section>`
    : '<p class="help">Nothing to approve. The agent lines up the next step when a record changes.</p>'
}

function caseCard(s: any, c: any, wording: any) {
  const r = c.referral
  const track = `<ol class="case-track">${c.stages.map((x: any) => `<li class="case-stage is-${h(x.state)}"><span class="case-dot" aria-hidden="true"></span><span class="case-stage-text"><strong>${h(x.label)}</strong> <span class="case-state">${h(stateWord[x.state])}</span><br>${x.cite ? `<a href="${h(x.cite.href)}">${h(x.text)}</a>` : h(x.text)}${x.next ? `<br><span class="case-todo">Next: <a href="${h(x.next.href)}">${h(x.next.text)}</a></span>` : ''}</span></li>`).join('')}</ol>`
  const next = c.steps.length ? `<section class="case-next"><h3>${c.steps.length === 1 ? 'Next step' : `Next steps (${c.steps.length})`}</h3>${c.steps.map((x: any) => stepCard(c, x, wording)).join('')}</section>` : nextUp(c)
  const history = c.history.length ? `<details class="case-history"><summary>Approved steps (${c.history.length})</summary><ul class="plain">${c.history.map((x: any) => `<li><strong>${h(x.title)}</strong><br>Approved by ${h(x.approved_by)} (${h(x.approved_role)}) ${stamp(s, x.approved_at)} · ${h(x.status === 'sending' ? 'in progress' : outcome(x.result, x.kind))}${x.wording ? `<details><summary>Wording sent</summary><p class="secure-body">${h(x.wording)}</p></details>` : ''}</li>`).join('')}</ul></details>` : ''
  return `<article class="case" id="case-${h(r.id)}"><header class="case-head"><div><h2><a href="/app/clients/${h(c.client.id)}">${h(c.client.name)}</a></h2><p class="help">${h(c.payer ?? 'Self-pay')} · referral from ${h(r.referring_first)} ${h(r.referring_last)}${r.diagnosis ? ` · ${h(r.diagnosis)}` : ''}${r.reason ? ` · ${h(r.reason)}` : ''}</p></div><p class="case-standing is-${h(c.standing.state)}">${h(c.standing.text)}</p></header>${track}${next}${history}</article>`
}

function openForm(s: any) {
  const choices = s.cases.choices, clients = [...new Map(choices.map((x: any) => [x.id, `${x.first_name} ${x.last_name}`])).entries()] as [unknown, unknown][]
  if (!clients.length) return panel('Open a case', empty('Add the patient first, from Clients.'))
  const policies: [unknown, unknown][] = [['', 'No insurance (self-pay)'], ...choices.filter((x: any) => x.policy_id).map((x: any) => [x.policy_id, `${x.first_name} ${x.last_name} · ${x.payer_name} · member ${x.member_id}`] as [unknown, unknown])]
  return panel('Open a case from a referral', `<details><summary>New referral</summary>${form('case.open', path, select('clientId', 'Patient', clients) + select('policyId', 'Insurance policy for this case', policies, '', '')
    + field('receivedOn', 'Referral received on', '', 'date', 'required') + `<div class="pair">${field('referringFirst', 'Referring provider first name', '', 'text', 'required maxlength="80"')}${field('referringLast', 'Last name', '', 'text', 'required maxlength="80"')}</div>`
    + field('referringNpi', 'Referring provider NPI', '', 'text', 'inputmode="numeric" maxlength="10" pattern="[0-9]{10}"') + field('diagnosis', 'Diagnosis (ICD-10 and words)', '', 'text', 'maxlength="200" placeholder="M23.611 · right knee ACL"')
    + textarea('reason', 'What was ordered', '', 'maxlength="2000"') + field('authorizationEmail', 'Where this payer takes authorization requests (email)', '', 'email', 'maxlength="254"')
    + '<p class="help">The case follows the patient’s visits from this date on. Authorization requests go to the address above only after a person approves them.</p>', 'Open case')}</details>`)
}

export function casesPage(s: any) {
  const data = s.cases, list = data.cases as any[], wording = data.wording
  const counts: [string, number][] = [['Open cases', list.filter(c => c.standing.state !== 'done').length], ['Steps to approve', list.reduce((n, c) => n + c.steps.filter((x: any) => !x.blocked).length, 0)], ['Stalled', list.filter(c => c.standing.state === 'stalled').length], ['Reconciled', list.filter(c => c.standing.state === 'done').length]]
  return `<div class="cases"><h1>Cases</h1><p>One case per referral, followed from referral to paid claim. Balm works out where each case stands from the clinic’s records and lines up the next step with the records it used. Nothing is sent until a person approves it, and every approval is kept with who gave it.</p>`
    + (wording.ready ? '' : `<p class="notice" role="note">${h(wording.line)}</p>`)
    + `<div class="stats">${counts.map(([label, value]) => `<div class="stat"><span class="label">${h(label)}</span><strong class="value">${h(value)}</strong></div>`).join('')}</div>`
    + (list.length ? list.map(c => caseCard(s, c, wording)).join('') : panel('Cases', empty('No cases yet. Open one from a referral below.'))) + openForm(s)
    + panel('How a case reaches paid or denied', '<p>A claim leaves Balm as an 837P claim file (or through your clearinghouse when one is connected). The payer answers with an 835, which your clearinghouse or the payer’s portal gives you. Upload it here or on the Insurance page: posting it marks each claim paid or denied, records any patient share, and moves the case on. A 277CA only says the claim was received or rejected.</p>')
    + `<div class="insurance">${payerFileUploads(s.insurance?.payers ?? [], path)}</div></div>`
}
