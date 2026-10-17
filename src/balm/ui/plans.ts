// Plan of care on a client file: its physician signature status and dates for
// everyone who opens the file, its content for the owner and practitioners, and
// the therapist's form to sign it and send it to the referring physician.
import { hostDateAt } from '../availability/timezone'
import { clinician, empty, entry, field, form, h, hidden, panel, result, status, textarea, usDate, when, zoneOf } from './shared'

export const frequency = (c: any) => `${c.frequencyPerWeek} ${c.frequencyPerWeek === 1 ? 'time' : 'times'} a week for ${c.durationWeeks} ${c.durationWeeks === 1 ? 'week' : 'weeks'}`

/** One line for the case: signed by whom and when, or sent and waiting. */
export function planLine(p: any, zone: string) {
  return p.status === 'certified'
    ? `${status('Plan of care signed')} by ${h(p.certifierName)}${p.certifierCredentials ? ', ' + h(p.certifierCredentials) : ''} on ${h(usDate(p.certifiedAt, zone))}`
    : `${status('Plan of care not signed yet')} sent to ${h(p.physicianName)} on ${h(usDate(p.sentAt, zone))}`
}

export function planContent(c: any, zone: string) {
  return `<dl class="answers"><dt>Diagnoses</dt><dd>${h(c.diagnoses)}</dd><dt>Short-term goals</dt><dd>${h(c.shortTermGoals)}</dd><dt>Long-term goals</dt><dd>${h(c.longTermGoals)}</dd>`
    + `<dt>Frequency and duration</dt><dd>${h(frequency(c))}, from ${h(usDate(c.startDate, zone))}; certification period through ${h(usDate(c.certifiedThrough, zone))}</dd><dt>Planned interventions</dt><dd>${h(c.interventions)}</dd></dl>`
    + `<p class="signature">Signed by the treating therapist <strong>${h(c.therapist.name)}, ${h(c.therapist.credentials)}</strong></p>`
}

function planEntry(s: any, f: any, p: any) {
  const path = `/app/clients/${f.client.id}`, zone = zoneOf(s)
  const sent = p.status === 'sent' ? `<p class="help">Sent to ${h(p.physicianName)} (${h(p.physicianEmail)}) ${h(usDate(p.sentAt, zone))}; the link expires ${h(usDate(p.linkExpiresAt, zone))}.</p>` : `<p class="help">Certified ${p.certifierNpi ? `· NPI ${h(p.certifierNpi)} ` : ''}· ${when(s, p.certifiedAt)}</p>`
  return entry(p.content ? `Plan of care from ${usDate(p.content.startDate, zone)}` : 'Plan of care', `<p>${planLine(p, zone)}</p>${sent}${p.content ? planContent(p.content, zone) : ''}`
    + (p.mine && p.status === 'sent' ? form('plan.resend', path, hidden('id', p.id) + '<p class="help">A new link replaces the one sent before.</p>', 'Send a new link to the physician', true) : ''))
}

/** What a send returned: the link went by email, or is shown once to pass on. */
export function planResult(s: any, notice: any) {
  const r = result(notice)
  if (!r?.token || !r.physicianEmail) return ''
  return r.mail === 'sent' && !s.local
    ? `<div class="notice" role="status"><strong>Plan of care sent.</strong> ${h(r.physicianName)} was emailed a private link to sign it at ${h(r.physicianEmail)}.</div>`
    : `<div class="notice" role="status"><strong>Plan of care signed and ready.</strong> ${s.local ? 'Balm on this computer sends no email' : 'Mail is not configured'}, so send ${h(r.physicianName)} this private link yourself (shown once): <a href="/plan/${h(r.token)}">/plan/${h(r.token)}</a></div>`
}

function writePlan(s: any, f: any) {
  if (!clinician(s) || !f.appointments.some((a: any) => a.practitioner_id === s.actor.staffId)) return ''
  const me = (s.staff ?? []).find((x: any) => x.id === s.actor.staffId) ?? {}
  // The latest signed evaluation of mine fills the diagnoses and goals.
  const evaluation = (f.notes ?? []).find((n: any) => n.mine && n.status === 'signed' && /\.evaluation$/.test(n.template))
  const part = (id: string) => evaluation?.revisions[0].sections?.find((x: any) => x.id === id)?.text ?? ''
  const today = hostDateAt(new Date(), zoneOf(s))
  const weekly = Array.from({ length: 7 }, (_, n) => `<option value="${n + 1}"${n === 1 ? ' selected' : ''}>${n + 1} ${n ? 'times' : 'time'} a week</option>`).join('')
  return `<details><summary>Write a plan of care</summary>${form('plan.send', `/app/clients/${f.client.id}`, hidden('clientId', f.client.id) + hidden('noteId', evaluation?.id ?? '')
    + (evaluation ? '<p class="help">Diagnoses and goals are filled from your signed evaluation; edit them as needed.</p>' : '')
    + textarea('diagnoses', 'Diagnoses (ICD-10)', part('diagnosis'), 'required maxlength="2000"') + textarea('shortTermGoals', 'Short-term goals', part('goals'), 'required maxlength="4000"')
    + textarea('longTermGoals', 'Long-term goals', '', 'required maxlength="4000"')
    + `<div class="pair"><label>Frequency<select name="frequencyPerWeek" required>${weekly}</select></label>${field('durationWeeks', 'Duration (weeks)', 6, 'number', 'required min="1" max="52" step="1"')}</div>`
    + field('startDate', 'Start of care', today, 'date', 'required') + textarea('interventions', 'Planned interventions', '', 'required maxlength="2000" placeholder="Therapeutic exercise (97110), manual therapy (97140), gait training (97116), home exercise program"')
    + `<div class="pair">${field('physicianName', 'Referring physician', '', 'text', 'required maxlength="160" placeholder="Dr. Anika Patel"')}${field('physicianEmail', 'Physician email', '', 'email', 'required maxlength="254"')}</div>`
    + `<div class="pair">${field('signature', 'Type your full name to sign', '', 'text', `required maxlength="160" placeholder="${h(me.name ?? '')}"`)}${field('credentials', 'Credentials', me.credentials ?? '', 'text', 'required maxlength="60" placeholder="PT, DPT"')}</div>`
    + '<label class="check"><input type="checkbox" name="attest" value="on" required><span>I established this plan of care and sign it as the treating therapist.</span></label>'
    + '<p class="help">The physician gets an email with a private link to read and sign the plan; no account is needed. The plan cannot change once sent.</p>', 'Sign and send to physician')}</details>`
}

export function plansPanel(s: any, f: any) {
  const list = f.plans.map((p: any) => planEntry(s, f, p)).join('')
  return panel('Plan of care', (list || empty('No plan of care yet.')) + writePlan(s, f))
}
