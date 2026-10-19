// CHART-013 care-team access on the client file and the owner's break-glass notices.
// Notices carry names, the reason given and times only; never clinical text.
import { empty, entry, form, h, hidden, owner, panel, practitioners, select, stamp, textarea } from './shared'

const reasonField = textarea('reason', 'Reason for opening this chart', '', 'required minlength="10" maxlength="500"')
const rule = '<p class="help">Emergency access opens this patient’s treatment notes and chart documents for 12 hours. Every read is recorded with your reason, and the owner is notified in Balm.</p>'

/** For a practitioner refused a chart: the only way in is a stated reason. */
export function breakGlassRequest(clientId: string) {
  const path = `/app/clients/${clientId}`
  return panel('Chart outside your care', '<p>You have no visit with this patient and no care-team access to their notes.</p>' + rule
    + form('chart.break_glass', path, hidden('clientId', clientId) + reasonField, 'Open in an emergency'), 'full', 'break-glass')
}

/** The owner manages grants; a practitioner sees how they read the notes, or may break glass. */
export function careTeamPanel(s: any, f: any) {
  const path = `/app/clients/${f.client.id}`
  if (owner(s)) {
    const team = f.careTeam ?? { grants: [], openings: [], now: '' }
    const granted = new Set(team.grants.map((g: any) => g.practitioner_id))
    const choices = practitioners(s).filter(p => !granted.has(p.id)).map(p => [p.id, p.name] as [string, string])
    const grants = team.grants.map((g: any) => entry(g.practitioner, `<p class="help">Reads every note, never edits. Granted ${stamp(s, g.granted_at)} by ${h(g.granted_by)}.</p>`
      + form('care_team.revoke', path, hidden('id', g.id), 'Revoke access', true), `grant-${g.id}`)).join('')
    const openings = team.openings.map((g: any) => {
      const open = !g.ended_at && g.expires_at > team.now
      return entry(`${g.practitioner} · break glass`, `<p><strong>Reason:</strong> ${h(g.reason)}</p><p class="help">Opened ${stamp(s, g.opened_at)}; ${open ? `open until ${stamp(s, g.expires_at)}` : g.ended_at ? `ended ${stamp(s, g.ended_at)}` : `closed ${stamp(s, g.expires_at)}`}.</p>`
        + (open ? form('chart.break_glass.end', path, hidden('id', g.id), 'End access now', true) : ''), `glass-${g.id}`)
    }).join('')
    return panel('Care team access', '<p>Co-treating and covering clinicians you grant here read every treatment note for this patient. They cannot edit or sign another clinician’s notes.</p>'
      + (grants || empty('No care-team grants.'))
      + (choices.length ? `<details><summary>Grant a clinician access</summary>${form('care_team.grant', path, hidden('clientId', f.client.id) + select('practitionerId', 'Clinician', choices), 'Grant access')}</details>` : '')
      + (openings ? `<h3>Emergency access</h3>${openings}` : ''), '', 'care-team')
  }
  const access = f.careAccess
  if (!access || s.actor.staffRole !== 'practitioner') return ''
  if (access.breakGlass) return panel('Emergency access', `<p role="status">You opened this chart in an emergency. Every read is recorded with your reason and the owner is notified in Balm.</p><p><strong>Your reason:</strong> ${h(access.breakGlass.reason)}</p>`, '', 'care-team')
  if (access.all) return panel('Care team access', '<p>The owner granted you access to every treatment note for this patient. You can read them; only their authors edit or sign them.</p>', '', 'care-team')
  return panel('Other clinicians’ notes', '<p>You see your own notes for this patient.</p>' + `<details><summary>Open every note in an emergency</summary>${rule}${form('chart.break_glass', path, hidden('clientId', f.client.id) + reasonField, 'Open in an emergency')}</details>`, '', 'care-team')
}

/** The owner's Today notice for each break glass not yet acknowledged. */
export function breakGlassNoticePanel(s: any) {
  const list = s.breakGlass
  if (!owner(s) || !list?.length) return ''
  return panel('Emergency chart access', '<p>Notified in Balm. Each clinician below opened a chart outside their care and gave a reason.</p>' + list.map((g: any) =>
    entry(`${g.practitioner} opened ${g.client}`, `<p><strong>Reason:</strong> ${h(g.reason)}</p><p class="help">Opened ${stamp(s, g.opened_at)}; ${g.ended_at ? `ended ${stamp(s, g.ended_at)}` : `access until ${stamp(s, g.expires_at)}`}. <a href="/app/clients/${h(encodeURIComponent(g.client_id))}#care-team">Open the file</a></p>`
      + form('chart.break_glass.acknowledge', '/app', hidden('id', g.id), 'Acknowledge'), `notice-${g.id}`)).join(''), 'full', 'break-glass-notices')
}
