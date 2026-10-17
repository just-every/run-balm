import { field, h, select } from './shared'

const sexes: [string,string][] = [['U','Unknown'],['F','Female'],['M','Male']]
const file = (name: string, label: string, required = false) => `<label>${h(label)} (JPEG, PNG or WebP; up to 1.9 MB)<input type="file" name="${name}" accept="image/jpeg,image/png,image/webp"${required ? ' data-insurance-required' : ''}></label>`
function policy(prefix: string, title: string, payers: any[]) {
  const required = 'data-insurance-required'
  return `<fieldset data-intake-policy="${prefix}" class="intake-policy"><legend>${title}</legend>`
    + select(prefix+'PayerId','Payer',[['','No '+title.toLowerCase()],...payers.map((p: any): [string,string]=>[p.id,p.name])],'','')
    + `<div data-policy-fields>${field(prefix+'MemberId','Member ID','','text',required+' maxlength="80"')}${field(prefix+'Group','Group number (if listed)','','text','maxlength="50"')}`
    + select(prefix+'Relationship','Patient’s relationship to subscriber',[['self','Self'],['spouse','Spouse'],['child','Child']],'self','')
    + `<details data-subscriber><summary>Subscriber details when someone else holds the policy</summary>${field(prefix+'SubscriberFirst','Subscriber first name','','text','data-subscriber-required maxlength="35"')}${field(prefix+'SubscriberLast','Subscriber last name','','text','data-subscriber-required maxlength="60"')}${field(prefix+'SubscriberDob','Subscriber date of birth','','date','data-subscriber-required')}${select(prefix+'SubscriberSex','Subscriber sex for payer',sexes,'U','')}</details>`
    + field(prefix+'StartsOn','Coverage starts','','date',required) + field(prefix+'EndsOn','Coverage ends (if known)','','date','')
    + file(prefix+'Front','Card front',true) + file(prefix+'Back','Card back',true) + '</div></fieldset>'
}
export function insuranceCapture(data: any) {
  const info = data.insurance
  return `<fieldset><legend>Insurance and photo ID</legend><p>If you use insurance, select the payer your clinic has configured, add both sides of each card and your photo ID (a parent’s or guardian’s ID for a child). The clinic verifies your details. Balm creates an eligibility request; this does not confirm coverage.</p>`
    + (info?.payers?.length ? `<div class="intake-policies">${policy('insurance','Primary insurance',info.payers)}${policy('secondary','Secondary insurance',info.payers)}</div><div data-insurance-shared>`
      + select('insurancePatientSex','Patient sex for payer',sexes,'U','')
      + field('insuranceAddress','Patient street address','','text','data-insurance-required maxlength="100" autocomplete="street-address"')
      + field('insuranceCity','City','','text','data-insurance-required maxlength="30" autocomplete="address-level2"')
      + field('insuranceState','State','','text','data-insurance-required maxlength="2" autocomplete="address-level1"')
      + field('insurancePostalCode','ZIP code','','text','data-insurance-required maxlength="10" autocomplete="postal-code"') + '</div>'
      : '<p>The clinic has not configured insurance intake yet. Contact the clinic to provide your coverage details.</p>')
    + file('identityPhoto','Photo ID') + '</fieldset>'
}
export const insuranceCaptureScript = `(()=>{const policies=[...document.querySelectorAll('[data-intake-policy]')];if(!policies.length)return;const form=policies[0].closest('form');const update=()=>{const primary=form.elements.insurancePayerId;form.elements.secondaryPayerId.disabled=!primary.value;let any=false;for(const box of policies){const prefix=box.dataset.intakePolicy,payer=form.elements[prefix+'PayerId'],active=!payer.disabled&&!!payer.value;any=any||active;const dependent=form.elements[prefix+'Relationship'].value!=='self';for(const input of box.querySelectorAll('[data-policy-fields] input,[data-policy-fields] select')){const subscriber=input.closest('[data-subscriber]');input.disabled=!active||!!subscriber&&!dependent;input.required=!input.disabled&&(input.hasAttribute('data-insurance-required')||input.hasAttribute('data-subscriber-required'))}box.querySelector('[data-subscriber]').open=active&&dependent}for(const input of form.querySelectorAll('[data-insurance-shared] input,[data-insurance-shared] select')){input.disabled=!any;input.required=any&&input.hasAttribute('data-insurance-required')}form.elements.identityPhoto.required=any};form.addEventListener('change',update);update()})();`
