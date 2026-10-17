import { form, h, hidden, result, check } from './shared'

export const insurancePath = '/app/insurance'
export const x12Link = (kind: '270' | '837P', id: string) => `/api/balm/insurance/${kind}/${encodeURIComponent(id)}`
export function x12Upload(command: string, path: string, fields: string, label: string, button: string) {
  return `<form class="upload" method="post" enctype="multipart/form-data" action="/app/action?name=${encodeURIComponent(command)}&amp;returnTo=${encodeURIComponent(path)}">${fields}<label>${h(label)}<input name="x12" type="file" accept=".txt,.edi,.x12,.271,.277,.835" required></label><button type="submit">${h(button)}</button></form>`
}
export function insuranceResult(notice: any) {
  const r = result(notice)
  if (r?.status === 'unavailable') return `<div class="notice" role="status">${h(r.reason)}</div>`
  if (r?.reference) return `<div class="notice" role="status">Submitted to the configured adapter. Reference ${h(r.reference)}. Await the payer’s acknowledgment.</div>`
  if (r?.appeal) return `<section class="panel"><h2>Appeal letter draft</h2><pre>${h(r.appeal)}</pre><p>Review and send through your payer’s appeal channel.</p></section>`
  return ''
}
export function insuranceBookingNotice(notice: any, path: string) {
  const r = result(notice)?.insuranceBooking
  if (!r) return ''
  const warnings = `<ul>${r.warnings.map((w: any) => `<li>${h(w.message)}${w.expiresOn ? ` Expiry: ${h(w.expiresOn)}.` : ''}</li>`).join('')}</ul>`
  const occurrences = Array.isArray(r.input.occurrences) ? r.input.occurrences.flatMap((o: any, n: number) => [hidden('date_' + n, o.date), hidden('time_' + n, o.time), ...(o.skip ? [hidden('skip_' + n, 'on')] : [])]).join('') : ''
  const body = occurrences + Object.entries(r.input).flatMap(([key, value]) => typeof value === 'string' || typeof value === 'number' ? [hidden(key, value)] : []).join('')
  return `<div class="notice" role="alert"><h2>Review insurance before booking</h2>${warnings}${r.warnings.some((w: any) => w.blocking) ? '<p>Update the authorization in the patient file before booking.</p>' : form(r.name, path, body + check('acknowledgeInsurance', 'I reviewed these warnings and want to book this visit.'), 'Book after review')}</div>`
}
