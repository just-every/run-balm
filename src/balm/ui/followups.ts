import { followupKinds } from '../followups/settings'
import { desk, empty, entry, field, form, h, hidden, panel, select, stamp, status } from './shared'
const kinds = Object.entries(followupKinds)
const optIn = '<label class="check"><input type="checkbox" name="consent" required><span>The patient explicitly opted in to this kind of follow-up.</span></label>'
export function followupSettingsPanel(s: any) {
  if (!s.followups) return ''
  return panel('Follow-up sequences', '<p>Enroll only patients who opted in on their file. The contact cap is shared across all follow-up kinds in each rolling 24 hours; even failed or unknown attempts count. Days mean elapsed 24-hour periods. Welcome and discharge send once; the other kinds stop on a future booking. An open-plan sequence also stops on discharge or plan expiry.</p>' + s.followups.sequences.map((r: any) => `<details><summary>${h(followupKinds[r.kind as keyof typeof followupKinds])} · ${r.enabled ? 'On' : 'Off'}</summary>${form('followups.settings', '/app/clinic', hidden('kind', r.kind)
    + `<label class="check"><input type="checkbox" name="enabled"${r.enabled ? ' checked' : ''}><span>Enable this sequence</span></label>`
    + field('delayDays', 'Days after the triggering event', r.delay_days, 'number', 'required min="0" max="3650"')
    + field('repeatDays', 'Days between follow-ups', r.repeat_days, 'number', 'required min="1" max="3650"')
    + field('maxSends', 'Maximum attempts per enrollment', r.max_sends, 'number', 'required min="1" max="20"')
    + field('contactLimit', 'Shared maximum follow-up attempts per patient in 24 hours', s.followups.contactLimit, 'number', 'required min="1" max="10"')
    + (r.kind === 'discharge' ? field('surveyUrl', 'Survey address (public HTTPS)', r.survey_url, 'url') + field('reviewUrl', 'Review address (public HTTPS)', r.review_url, 'url') : ''), 'Save sequence')}</details>`).join(''))
}
export function followupPanel(s: any, f: any) {
  if (!f.followups) return ''
  const path = '/app/clients/' + f.client.id
  const sequences = f.followups.sequences.map((r: any) => entry(followupKinds[r.kind as keyof typeof followupKinds], `<p>${status(r.state)} · opted in ${stamp(s, r.consent_at)} by ${h(r.consent_by)}<br>${h(r.consent_record)}${r.stopped_reason ? `<br>${h(r.stopped_reason)}` : ''}</p>`
    + (desk(s) && r.state === 'active' ? form('followups.stop', path, hidden('clientId', f.client.id) + hidden('id', r.id), 'Stop and withdraw consent', true) : ''))).join('')
  const labels: Record<string, string> = { accepted: 'Accepted by mail provider; delivery not yet reported', uncertain: 'Outcome unknown; never automatically resent', sending: 'Outcome unknown; never automatically resent', suppressed: 'Not sent: email suppressed', no_email: 'Not sent: no email address', unavailable: 'Not sent: no mail provider', failed: 'Not sent: provider refused', cancelled: 'Not sent: goal or consent changed' }
  const history = f.followups.attempts.map((r: any) => `<li>${h(followupKinds[r.kind as keyof typeof followupKinds])} · ${stamp(s, r.attempted_at)} · ${h(labels[r.state] ?? r.state)}</li>`).join('')
  return panel('Follow-ups and recalls', sequences + (history ? `<ul class="plain">${history}</ul>` : empty('No follow-up attempts yet.')) + (desk(s) ? `<details><summary>Record consent and enroll</summary>${form('followups.enroll', path, hidden('clientId', f.client.id) + select('kind', 'Sequence', kinds) + optIn + field('consentRecord', 'How and when the patient opted in', '', 'text', 'required maxlength="500"'), 'Enroll with recorded consent')}</details>` : ''))
}
