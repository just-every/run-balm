import { check, form, hidden, h, owner, panel, select, status } from './shared'
import { medicareSettings } from './insurance-medicare'
import { insurancePath as path } from './insurance-shared'

// Every field says what it is and where the owner finds the value. Forms skip the
// browser's own check so a missing value comes back as an error naming the field.
const hint = (text: string) => `<span class="hint">${text}</span>`
const input = (name: string, label: string, value: unknown, help: string, attrs = '', type = 'text') =>
  `<label>${h(label)}<input name="${h(name)}" type="${h(type)}" value="${h(value ?? '')}" ${attrs}>${hint(help)}</label>`
const named = (html: string) => html.replace('<form ', '<form novalidate ')
const choose = (name: string, label: string, choices: [unknown, unknown][], value: unknown, help: string) => select(name, label, choices, value, '').replace('</label>', `${hint(help)}</label>`)
const tick = (name: string, label: string, on: boolean, help: string) => check(name, label, on ? 'checked' : '') + `<p class="hint">${help}</p>`

function billing(st: any) {
  return named(form('insurance.settings.save', path,
    input('billingNpi', 'Billing NPI', st.billing_npi, 'Your practice’s 10-digit National Provider Identifier. Look it up by name at npiregistry.cms.hhs.gov. A solo practitioner who bills under their own name uses their own NPI.', 'maxlength="10" inputmode="numeric"')
    + input('taxId', 'Federal tax ID (EIN)', st.tax_id, 'The 9 digits on your IRS EIN letter (CP 575), like 12-3456789. Ask your accountant if you do not have it.')
    + input('address', 'Billing street address', st.address, 'Where payers send letters and checks: a street address, not a PO box.')
    + input('city', 'City', st.city, '') + `<div class="pair">${input('state', 'State', st.state, '2 letters, like TX.', 'maxlength="2"')}${input('postalCode', 'ZIP code', st.postal_code, '')}</div>`
    + input('contactName', 'Billing contact', st.contact_name, 'The person a payer calls about a claim.') + input('contactPhone', 'Contact phone', st.contact_phone, '10 digits.', '', 'tel')
    + `<fieldset><legend>Electronic sending (needs a clearinghouse)</legend><p class="help">Leave this off until a clearinghouse such as Claim.MD or Availity has enrolled your practice and tested with you. Until then you download claim files and upload payer files yourself.</p>`
    + tick('production', 'Send claims electronically', !!st.production, 'Turn on only after your clearinghouse finishes testing: files are then marked for production and need the submitter ID below and each payer’s receiver ID.')
    + input('senderId', 'Clearinghouse submitter ID (optional until sending is on)', st.sender_id, 'Your clearinghouse gives you this ID when it sets up your account; it is in their welcome email or account settings. Until you have one, claim files name your practice by its tax ID.', 'maxlength="15"')
    + '</fieldset>', 'Save billing details'))
}

function payerForm(i: any, p?: any) {
  const fees = (i.fees ?? []).filter((f: any) => f.payer_id === p?.id).map((f: any) => `${f.code} ${(f.cents / 100).toFixed(2)}`).join('\n')
  return named(form('insurance.payer.save', path, (p ? hidden('id', p.id) : '')
    + input('name', 'Payer name', p?.name, 'The insurance company as the patient’s card shows it, like UnitedHealthcare.')
    + input('payerId', 'Payer ID', p?.payer_id, 'The payer’s electronic ID, usually 5 characters (UnitedHealthcare is 87726). It is on the back of most insurance cards, in your clearinghouse’s payer list, or the payer’s provider line can tell you.', 'maxlength="50"')
    + choose('unitMethod', 'How this payer counts timed units', [['', 'Choose one'], ['cms', 'CMS 8-minute rule (Medicare and most plans)'], ['ama', 'AMA rule: each code counted on its own'], ['fixed', 'Fixed minutes per unit for each code']], p?.unit_method ?? '', 'Your contract or the payer’s provider manual says which. If unsure, choose the CMS 8-minute rule.')
    + input('fixedUnitMinutes', 'Minutes per unit (fixed method only)', p?.fixed_unit_minutes, 'Enter the positive whole-minute threshold from your payer contract. Each timed code bills only complete units of this length; minutes are never pooled. Untimed codes still bill one unit.', 'min="1" step="1"', 'number')
    + `<label>Fee schedule: what you charge this payer<textarea name="feeSchedule" rows="4" placeholder="97110 65.00&#10;97140 45.00">${h(fees)}</textarea>${hint('One CPT code and its dollar price per unit on each line. Claims charge these amounts, and invoices for this payer’s patients use them unless you type another amount.')}</label>`
    + tick('medicare', 'This payer is Medicare', !!p?.medicare, 'Medicare claims use the CMS 8-minute rule and track the yearly KX threshold.')
    + tick('requiresReferral', 'Claims need the referring provider', !!p?.requires_referral, 'Tick when this payer refuses claims without the referring physician’s name and NPI.')
    + input('receiverId', 'Interchange receiver ID (optional until sending is on)', p?.receiver_id, 'Only for electronic sending: your clearinghouse’s payer list or companion guide gives it. Until then claim files name the payer by its payer ID.', 'maxlength="15"'), p ? `Save ${p.name}` : 'Add payer'))
}

function datedBilling(i:any,payers:any[],staff:any[]){
 if(!payers.length)return ''
 const history=(i.schedules??[]).map((r:any)=>`<li>${h(payers.find((p:any)=>p.id===r.payer_id)?.name)} · ${h(r.plan_name||'All plans')} · ${h(r.effective_on)} · ${h(r.kind)} · ${h(r.unit_method||'Method missing')} ${h(r.fixed_unit_minutes??'')} · ${h(r.source)}</li>`).join('')
 const licenses=(i.licenses??[]).map((l:any)=>`<li>${h(staff.find((p:any)=>p.id===l.practitioner_id)?.name)} · ${h(l.state)} ${h(l.number)} · ${h(l.starts_on)} to ${h(l.ends_on)} · ${h(l.source)}</li>`).join('')
 return `<details id="dated-billing"><summary>Dated plans and fee schedules</summary><p>Record a complete revision from the payer contract. Exact plan names match the patient’s policy. A plan revision overrides the payer baseline; within each scope a contracted schedule takes priority over standard, then the latest effective date wins. Existing setup is the baseline until a dated revision applies. Revisions stay in history; record a later revision for a change.</p><ul>${history}</ul>`
 +named(form('insurance.schedule.save',path,select('payerId','Payer',payers.map((p:any)=>[p.id,p.name]))
 +input('planName','Plan name (blank for all plans)','','Copy the plan name exactly from the patient’s policy.')
 +input('effectiveOn','Effective date','','The first service date covered by this contract revision.','','date')
 +select('kind','Fee schedule type',[['contracted','Contracted'],['standard','Standard']])
 +select('unitMethod','Timed-unit method',[['','Method not yet recorded'],['cms','CMS total-time'],['ama','AMA per-service'],['fixed','Fixed minutes per unit']])
 +input('fixedUnitMinutes','Fixed minutes per unit','','Positive whole minutes from the contract; only for the fixed method.','min="1" step="1"','number')
 +'<label>Complete fee schedule<textarea name="feeSchedule" rows="4" required></textarea><span class="hint">One CPT code and dollar price per unit on each line.</span></label>'
 +input('source','Contract source','','Name the contract or provider manual, version and section.'),'Record dated schedule'))+'</details>'
 +`<details id="provider-licenses"><summary>Provider licenses</summary><p>Owner-recorded license facts only; Balm does not verify licensure with a state board. Earlier records stay in history.</p><ul>${licenses}</ul>`
 +named(form('insurance.license.save',path,select('practitionerId','Practitioner',staff.map((p:any)=>[p.id,p.name]))
 +input('state','License state','','Two-letter state code.','maxlength="2"')+input('number','License number','','From the licensing board’s certificate.')
 +input('startsOn','License starts','','First valid day.','','date')+input('endsOn','License expires','','Last valid day.','','date')
 +input('source','License source','','Name the board and certificate or verification record.'),'Record provider license'))+'</details>'
}

function enrollment(i: any, payers: any[], staff: any[]) {
  if (!payers.length || !staff.length) return '<p>Add a payer here and a practitioner in <a href="/app/clinic">Clinic</a> first.</p>'
  const list = (i.enrollments ?? []).map((e: any) => `<li>${h(payers.find((p: any) => p.id === e.payer_id)?.name)} · ${h(staff.find((p: any) => p.id === e.practitioner_id)?.name)} · ${h(e.taxonomy)} · ${e.active ? 'active' : 'inactive'}</li>`).join('')
  return `${list ? `<ul>${list}</ul>` : ''}${named(form('insurance.enrollment.save', path,
    select('payerId', 'Payer', payers.map((p: any) => [p.id, p.name])) + select('practitionerId', 'Practitioner who treats the patient', staff.map((p: any) => [p.id, p.name]))
    + input('taxonomy', 'Taxonomy code', '', 'The 10-character specialty code on the practitioner’s NPI Registry record: 225100000X physical therapist, 225X00000X occupational therapist, 235Z00000X speech-language pathologist.', 'maxlength="10" placeholder="225100000X"')
    + tick('active', 'The payer has enrolled this practitioner', true, 'Untick while the payer is still credentialing them.'), 'Save enrollment'))}`
}

export function insuranceSettings(s: any) {
  if (!owner(s)) return ''
  const i = s.insurance, st = i.settings ?? {}, payers = i.payers ?? [], staff = i.practitioners ?? []
  const done = (yes: boolean) => status(yes ? 'Done' : 'To do')
  const payerList = payers.map((p: any) => `<details id="payer-${h(p.id)}"><summary>Edit ${h(p.name)} · payer ID ${h(p.payer_id)} · ${(i.fees ?? []).filter((f: any) => f.payer_id === p.id).length} fee lines</summary>${payerForm(i, p)}</details>`).join('')
  return panel('Insurance setup', `<p>Three things to fill in once. Each field says where to find its value; the <a href="https://run-balm.com/docs/insurance">insurance setup guide</a> walks through them.</p>`
    + `<details id="billing"${i.settings ? '' : ' open'}><summary>1. Practice billing details ${done(!!i.settings)}</summary>${billing(st)}</details>`
    + `<details id="payers"${i.settings && !payers.length ? ' open' : ''}><summary>2. Payers you bill and your fee schedule ${done(payers.length > 0)}</summary>${payerList}<details${payers.length ? '' : ' open'}><summary>Add a payer</summary>${payerForm(i)}</details></details>`
    + `<details id="enrollment"${payers.length && !(i.enrollments ?? []).length ? ' open' : ''}><summary>3. Provider enrollment ${done((i.enrollments ?? []).length > 0)}</summary><p class="help">Record each practitioner the payer has accepted (enrolled) to treat its members.</p>${enrollment(i, payers, staff)}</details>` + datedBilling(i,payers,staff) + medicareSettings(s, path), 'full')
}


/** Configuration lives in the existing clinic Settings screen. */
export function institutionalSettingsPanel(s:any){
 if(!owner(s))return ''
 const st=s.insurance?.institutionalSettings
 const mappings=st?JSON.parse(st.revenue_mappings).map((m:any)=>m.code+' '+m.revenueCode).join('\n'):''
 return panel('Rehab agency institutional claims',`<details id="institutional-settings"><summary>Institutional claim settings</summary><p>Record the agency enrollment reference and written payer instructions. Balm does not verify enrollment or payer rules. Only original, single-visit outpatient Medicare test files are available; submission stays unavailable.</p>${st?'<p>Current instructions: '+h(st.source)+' · '+(st.active?'active':'inactive')+'</p>':''}`
 +named(form('insurance.institutional.settings','/app/clinic',select('billType','Bill type',[['741','741 · Original outpatient rehabilitation']])
 +input('enrollmentReference','Recorded agency enrollment reference',st?.enrollment_reference,'Your existing enrollment record; entering it grants no provider authority.')
 +`<label>Procedure to revenue mappings<textarea name="revenueLines" rows="4" required>${h(mappings)}</textarea><span class="hint">One procedure code and four-digit revenue code per line, from the written payer instructions.</span></label>`
 +input('planSpanCode','Plan period occurrence span code',st?.plan_span_code,'The two-character code your written payer instructions use for the signed plan period. Balm does not choose one.','required maxlength="2"')
 +input('source','Written institutional instruction source',st?.source,'Name the payer guide, version and section.','required')
 +tick('active','Use these recorded instructions',!!st?.active,'A new revision keeps earlier claim originals intact.')
 +check('attest','I reviewed these facts against the agency enrollment record and written payer instructions.','required'),'Record institutional instructions'))+'</details>','full','rehab-agency')
}
