import { field, form, h, hidden, select } from './shared'

export function policyForm(s: any, clientId: string, path: string, p?: any) {
  return form('insurance.policy.save', path, hidden('clientId', clientId) + (p ? hidden('id', p.id) : '')
    + select('payerId', 'Payer', (s.insurance.payers ?? []).map((p: any) => [p.id, p.name]), p?.payer_id)
    + field('memberId', 'Member ID', p?.member_id, 'text', 'required') + field('planName', 'Plan name', p?.plan_name) + field('groupNumber', 'Group number', p?.group_number)
    + select('priority', 'Coverage order', [[1, 'Primary'], [2, 'Secondary'], [3, 'Tertiary']], p?.priority ?? 1)
    + select('relationship', 'Patient is the subscriber’s', [['18', 'Self'], ['01', 'Spouse'], ['19', 'Child']], p?.relationship ?? '18')
    + select('patientSex', 'Patient sex for payer', [['F', 'Female'], ['M', 'Male'], ['U', 'Unknown']], p?.patient_sex ?? 'U')
    + `<details><summary>Subscriber details (if not self)</summary>${field('subscriberFirst', 'Subscriber first name', p?.subscriber_first)}${field('subscriberLast', 'Subscriber last name', p?.subscriber_last)}${field('subscriberDob', 'Subscriber date of birth', p?.subscriber_dob, 'date')}${select('subscriberSex', 'Subscriber sex for payer', [['F', 'Female'], ['M', 'Male'], ['U', 'Unknown']], p?.subscriber_sex ?? 'U')}</details>`
    + field('address', 'Patient street address', p?.address, 'text', 'required') + field('city', 'City', p?.city, 'text', 'required') + `<div class="pair">${field('state', 'State', p?.state, 'text', 'required maxlength="2"')}${field('postalCode', 'ZIP code', p?.postal_code, 'text', 'required')}</div>`
    + `<div class="pair">${field('startsOn', 'Coverage starts', p?.starts_on, 'date', 'required')}${field('endsOn', 'Coverage ends (if known)', p?.ends_on, 'date')}</div>`, 'Save insurance policy')
}
export function authorizationForm(s: any, policyId: string, path: string, a?: any, episode = '') {
  return form('insurance.authorization.save', path, hidden('policyId', policyId) + (a ? hidden('id', a.id) : '') + episode + field('number', 'Authorization number', a?.number, 'text', 'required')
    + `<div class="pair">${field('startsOn', 'Authorized from', a?.starts_on, 'date', 'required')}${field('endsOn', 'Expires on', a?.ends_on, 'date', 'required')}</div>` + field('visits', 'Authorized visits', a?.visits, 'number', 'required min="1" max="10000"')
    + select('practitionerId', 'Practitioner', [['', 'Any treating practitioner'], ...(s.insurance.practitioners ?? []).map((p: any) => [p.id, p.name])], a?.practitioner_id ?? '', '')
    + select('bookingAction', 'When expired or exhausted', [['warn', 'Warn and ask staff to review'], ['block', 'Block booking until updated']], a?.booking_action ?? 'warn'), 'Save authorization')
}
