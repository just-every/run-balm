import { check, field, form, hidden, h, owner, panel, select, textarea } from './shared'
import { medicareSettings } from './insurance-medicare'
import { insurancePath as path } from './insurance-shared'

export function insuranceSettings(s: any) {
  if (!owner(s)) return ''
  const i = s.insurance, st = i.settings ?? {}, payers = i.payers ?? [], staff = i.practitioners ?? []
  const billing = `<details><summary>Practice billing and submitter details</summary>${form('insurance.settings.save', path,
    field('billingNpi', 'Billing NPI', st.billing_npi, 'text', 'required maxlength="10" inputmode="numeric"') + field('taxId', 'Federal tax ID (EIN)', st.tax_id, 'text', 'required')
    + field('address', 'Billing street address', st.address, 'text', 'required') + field('city', 'City', st.city, 'text', 'required') + `<div class="pair">${field('state', 'State (2 letters)', st.state, 'text', 'required maxlength="2"')}${field('postalCode', 'ZIP code', st.postal_code, 'text', 'required')}</div>`
    + field('senderId', 'Clearinghouse submitter ID', st.sender_id, 'text', 'required maxlength="15"') + field('contactName', 'Billing contact', st.contact_name, 'text', 'required') + field('contactPhone', 'Contact phone', st.contact_phone, 'tel', 'required')
    + check('production', 'Use production X12 interchange indicator (only after enrollment testing)', st.production ? 'checked' : ''), 'Save billing details')}</details>`
  const payerForm = (p?: any) => form('insurance.payer.save', path, (p ? hidden('id', p.id) : '') + field('name', 'Payer name', p?.name, 'text', 'required') + field('payerId', 'Payer ID', p?.payer_id, 'text', 'required') + field('receiverId', 'Interchange receiver ID', p?.receiver_id, 'text', 'required maxlength="15"')
    + select('unitMethod', 'Timed-unit method', [['', 'Choose the payer’s method'], ['cms', 'CMS 8-minute rule'], ['ama', 'AMA per-code midpoint']], p?.unit_method ?? '') + check('medicare', 'Medicare', p?.medicare ? 'checked' : '') + check('requiresReferral', 'Requires referring provider', p?.requires_referral ? 'checked' : '')
    + textarea('feeSchedule', 'Fee schedule: CPT and dollars per unit, one per line', (i.fees ?? []).filter((f: any) => f.payer_id === p?.id).map((f: any) => `${f.code} ${(f.cents / 100).toFixed(2)}`).join('\n'), 'placeholder="97110 35.00&#10;97140 25.00"'), 'Save payer')
  const payerList = payers.map((p: any) => `<details><summary>${h(p.name)} · ${h(p.payer_id)}</summary>${payerForm(p)}</details>`).join('') + `<details><summary>Add a payer</summary>${payerForm()}</details>`
  const enrollments = payers.length && staff.length ? `<details><summary>Provider enrollment and taxonomy</summary><ul>${(i.enrollments ?? []).map((e: any) => `<li>${h(payers.find((p: any) => p.id === e.payer_id)?.name)} · ${h(staff.find((p: any) => p.id === e.practitioner_id)?.name)} · ${h(e.taxonomy)} · ${e.active ? 'active' : 'inactive'}</li>`).join('')}</ul>${form('insurance.enrollment.save', path,
    select('payerId', 'Payer', payers.map((p: any) => [p.id, p.name])) + select('practitionerId', 'Rendering practitioner', staff.map((p: any) => [p.id, p.name])) + field('taxonomy', 'Taxonomy code', '', 'text', 'required maxlength="10" placeholder="225100000X"') + check('active', 'Enrollment is active', 'checked'), 'Save enrollment')}</details>` : '<p>Add a payer and practitioner to record enrollment.</p>'
  return panel('Insurance settings', billing + payerList + enrollments + medicareSettings(s,path), 'full')
}
