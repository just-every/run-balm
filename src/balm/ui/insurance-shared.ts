import { payerReason } from '../insurance/codes'
import { form, h, hidden, panel, result, check, select } from './shared'

/** A claim's short number for people: the first eight characters of its id, upper case. The full id stays in the title and in the 837P. */
export const claimNumber = (id: string) => `<span title="${h(id)}">${h(String(id).slice(0, 8).toUpperCase())}</span>`
/** A claim problem in plain words. A payer's denial (carc_<code>) reads as its reason, the remarks and the next step, with the payer's
 * codes in small print; Balm's own checks are already a plain sentence and carry no code. */
export function reasonHtml(e: any) {
  if (!/^carc_/.test(String(e.code))) return `<strong>${h(e.message ?? e.reason ?? '')}</strong>`
  const r = payerReason(e.code, e.message)
  return `<strong>${h(r.reason)}.</strong> ${r.remarks.map(x => `${h(x)}.`).join(' ')} ${h(r.next)} <small class="code">Payer ${r.codes.length > 1 ? 'codes' : 'code'} ${h(r.codes.join(', '))}</small>`
}

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

/** Where each scrubber reason is fixed, so a held claim always shows its way out. */
function fixes(e: any, c: any): [string, string][] {
  const file = `/app/clients/${c.client_id}`, payer = c.snapshot?.payer, editPayer: [string, string] = [`/app/insurance#payer-${payer?.id}`, `Edit ${payer?.name ?? 'the payer'}`]
  const field = String(e.field ?? '')
  if (field === 'rendering.name') return [[`/app/clinic#staff-${c.practitioner_id}`, 'Edit the staff name']]
  if (field === 'rendering.npi') return [['/app/clinic', 'Billing identifiers in Clinic']]
  if (field.startsWith('billing.')) return [['/app/insurance#billing', 'Practice billing details']]
  if (field === 'rendering.enrollment' || field === 'rendering.taxonomy') return [['/app/insurance#enrollment', 'Provider enrollment']]
  if (field === 'lines.amountCents') return [[`/app/insurance#payer-${payer?.id}`, `Edit ${payer?.name ?? 'the payer'}’s fee schedule`], [`${file}#invoice-${c.invoice_id}`, 'Void and prepare the invoice again']]
  if (field.startsWith('payer.')) return [editPayer]
  if (field === 'patient.dob') return [[file, 'Edit the patient’s details']]
  if (field === 'diagnoses') return [[`${file}#codes-${c.appointment_id}`, 'Record ICD-10 codes for the visit']]
  if (field === 'note' || field === 'lines') return [[`${file}#visit-${c.appointment_id}`, 'Open the visit and its note']]
  if (field === 'policy' || field === 'authorization') return [[`${file}#insurance`, 'Coverage and authorizations']]
  if (field.startsWith('medicare')) return [[`${file}#insurance`, 'Medicare KX threshold']]
  return []
}
export function claimErrors(c: any) {
  if (!c.errors?.length) return ''
  const held = c.status === 'draft' ? '<p class="help">Fix each item below, then press “Check the claim again” in the patient file.</p>' : ''
  const proposals=c.snapshot?.coding?.proposals??[]
  const proposed=proposals.length&&c.errors.some((e:any)=>e.code==='ncci_ptp')?`<section data-code-proposals><h4>Modifier proposals for review</h4><p>The signed note records distinct services. Review the edit and apply a modifier only if appropriate; Balm has not applied it.</p><ul>${proposals.map((p:any)=>`<li>${h(p.code)} · modifier ${h(p.modifier)} · NCCI ${h(p.version)}</li>`).join('')}</ul><a href="/app/clients/${h(c.client_id)}#codes-${h(c.appointment_id)}">Review the visit’s procedure codes</a></section>`:''
  return `${held}<ul class="insurance-errors">${c.errors.map((e: any) => `<li>${reasonHtml(e)}${e.children?.length?`<ul data-billable-children>${e.children.map((child:any)=>`<li>${h(child.code)} · ${h(child.description)}</li>`).join('')}</ul>`:''}${fixes(e, c).map(([href, text]) => ` <a href="${h(href)}">${h(text)}</a>`).join(' ·')}</li>`).join('')}</ul>${proposed}`
}
/** Where the payer's files go: an 835 moves claims to paid or denied, a 277CA to received or rejected. */
export function payerFileUploads(payers: any[], path: string) {
  if (!payers.length) return panel('Payer files', '<p>Add a payer under Insurance setup before uploading payer files.</p>')
  const from = select('payerId', 'Payer that sent this file', payers.map((p: any) => [p.id, p.name]))
  return `<div id="era">${panel('Upload a payment or denial (835)', '<p>The payer’s 835 (also called an ERA or electronic remittance) says what it paid, adjusted or denied. It comes from your clearinghouse or the payer’s portal. Posting it moves each claim to paid or denied. The whole file must balance before anything posts.</p>' + x12Upload('insurance.remittance.import', path, from, '835 file from the payer', 'Check and post 835'))}</div>`
    + panel('Upload a claim acknowledgment (277CA)', '<p>A 277CA says the payer received a claim, accepted it for review or rejected it. It is not a payment.</p>' + x12Upload('insurance.acknowledgment.import', path, from, '277CA file from the payer', 'Import acknowledgment'))
}
