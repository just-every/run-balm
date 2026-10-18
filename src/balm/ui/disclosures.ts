import { hostDateAt } from '../availability/timezone'
import { empty, entry, field, form, h, hidden, owner, panel, stamp, textarea } from './shared'

/** Records completed external releases; no email or fax is sent by this form. */
export function disclosuresPanel(s: any, f: any, path: string) {
  if (!owner(s)) return ''
  const records = (f.disclosures ?? []).map((d: any) => entry(d.recipient,
    `<p>Released ${stamp(s, d.released_at)}</p><p><strong>Records:</strong> ${h(d.records)}</p><p><strong>Purpose:</strong> ${h(d.purpose)}</p><p><strong>Authority or basis:</strong> ${h(d.basis)}</p><p class="help">Recorded ${stamp(s, d.recorded_at)} by ${h(d.recorded_by)}.</p>`)).join('')
  const date = hostDateAt(new Date(), s.settings.time_zone), endpoint = `/api/balm/clients/${encodeURIComponent(f.client.id)}`
  const report = (suffix: string, label: string) => `<form method="get" action="${h(endpoint + suffix)}">`
    + `<div class="pair">${field('from', 'From', '1900-01-01', 'date', 'required')}${field('to', 'Through', date, 'date', 'required')}</div>`
    + hidden('format', 'csv') + `<button type="submit" class="secondary">${h(label)}</button></form>`
  return panel('Record disclosures', '<p>Record a release of records already completed outside Balm. This form does not send records. Record the recipient, what was released, why, and the authority or basis for that release. Entries are permanent.</p>'
    + `<details><summary>Record a completed release</summary>${form('disclosure.record', path, hidden('clientId', f.client.id)
      + field('recipient', 'Recipient name and contact details', '', 'text', 'required maxlength="300"')
      + textarea('records', 'Records released', '', 'required maxlength="2000"')
      + textarea('purpose', 'Purpose of release', '', 'required maxlength="1000"')
      + textarea('basis', 'Authority or basis for release', '', 'required maxlength="1000"')
      + `<p class="help">Actual release date and time in ${h(s.settings.time_zone)}.</p><div class="pair">${field('releasedDate', 'Release date', '', 'date', 'required')}${field('releasedTime', 'Release time', '', 'time', 'required')}</div>`, 'Record completed release')}</details>`
    + (records || empty('No external releases recorded.'))
    + `<details><summary>Patient reports</summary><p>Dates include the whole day in ${h(s.settings.time_zone)}. The access report lists individual recorded reads and downloads, together with recorded disclosures.</p>`
    + report('/disclosures', 'Download disclosure accounting') + report('/access-report', 'Download access report') + '</details>', 'full')
}
