import { empty, entry, form, h, hidden, owner, panel, select, stamp, textarea } from './shared'

const kinds: [string, string][] = [['medical', 'Medical alert'], ['precaution', 'Precaution'], ['important', 'Important note']]
const label = (kind: string) => kinds.find(([key]) => key === kind)?.[1] ?? kind
const active = (alert: any) => alert.active === true || alert.active === 1

/** Compact active text for chart header, calendar visits, check-in and note composition. */
export function alertBadges(alerts: any[] = []) {
  const list = alerts.filter(active)
  return list.length ? `<div class="patient-alerts" role="note" aria-label="Patient alerts">${list.map(a => `<p><strong>${h(label(a.kind))}:</strong> ${h(a.text)}</p>`).join('')}</div>` : ''
}

export function clientAlertsPanel(s: any, f: any, path: string) {
  if (s.actor.role === 'agent') return ''
  const editable = owner(s) || s.actor.staffRole === 'practitioner'
  const fields = (alert?: any) => hidden('clientId', f.client.id)
    + (alert ? hidden('id', alert.id) + hidden('version', alert.version) : '')
    + select('kind', 'Kind', kinds, alert?.kind ?? 'precaution')
    + textarea('text', 'Alert or precaution', alert?.text ?? '', 'required maxlength="1000"')
    + select('active', 'Show on visits and notes', [['true', 'Active'], ['false', 'Inactive']], alert ? String(!!alert.active) : 'true')
  const list = (f.alerts ?? []).map((a: any) => entry(`${label(a.kind)}${active(a) ? '' : ' · Inactive'}`,
    `<p>${h(a.text)}</p><p class="help">Updated ${stamp(s, a.updated_at)} by ${h(a.updated_by)}.</p>`
    + (editable ? `<details><summary>Edit alert</summary>${form('client.alert.save', path, fields(a), 'Save alert')}</details>` : ''))).join('')
  return panel('Alerts and precautions', (list || empty('No alerts or precautions recorded.'))
    + (editable ? `<details><summary>Add alert or precaution</summary>${form('client.alert.save', path, fields(), 'Add alert')}</details>` : ''), 'full', 'alerts')
}
