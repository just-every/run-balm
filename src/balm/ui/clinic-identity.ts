import { usStates } from '../domain/us-clinic'
import { field, h, select } from './shared'

export function clinicIdentityFields(st: any) {
  return `<div class="pair">${select('taxIdType', 'Federal tax ID type', [['EIN', 'EIN'], ['SSN', 'SSN']], st.tax_id_type)}${field('taxId', 'Federal tax ID (shown on invoices)', st.abn, 'text', 'maxlength="11" placeholder="12-3456789"')}</div>`
    + field('practiceNpi', 'Practice NPI', st.practice_npi, 'text', 'maxlength="10" inputmode="numeric" placeholder="10-digit NPI"')
    + '<p class="help">Use the practice’s NPI, or your individual NPI if you bill as a solo practitioner. Identifiers are optional while setting up.</p>'
    + (st.address && !st.street_address ? `<p class="help">Current address: ${h(st.address)}. Fill all four fields below to replace it.</p>` : '')
    + field('streetAddress', 'Street address', st.street_address, 'text', 'maxlength="180" autocomplete="street-address"')
    + field('city', 'City', st.city, 'text', 'maxlength="80" autocomplete="address-level2"')
    + `<div class="pair">${select('state', 'State or territory', [['', 'Choose a state'], ...usStates.map(s => [s, s] as [string, string])], st.state, '')}${field('postalCode', 'ZIP code', st.postal_code, 'text', 'maxlength="10" inputmode="numeric" placeholder="60601 or 60601-1234" autocomplete="postal-code"')}</div>`
}
