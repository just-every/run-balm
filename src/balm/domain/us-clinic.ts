import { insist, optional, type Data } from './model'
import { validNpi } from '../payments/codes'

export const usStates = 'AL AK AZ AR CA CO CT DE DC FL GA HI ID IL IN IA KS KY LA ME MD MA MI MN MS MO MT NE NV NH NJ NM NY NC ND OH OK OR PA RI SC SD TN TX UT VT VA WA WV WI WY AS GU MP PR VI'.split(' ')

/** Optional during first-run setup; supplied identifiers and addresses must be valid. */
export function clinicIdentity(input: Data, current: Data) {
  const taxId = input.taxId === undefined ? String(current.abn) : String(input.taxId).trim()
  insist(!taxId || /^\d{9}$|^\d{2}-\d{7}$|^\d{3}-\d{2}-\d{4}$/.test(taxId), 'enter_a_nine_digit_EIN_or_SSN')
  const taxType = input.taxIdType === undefined ? current.tax_id_type : input.taxIdType
  insist(taxType === 'EIN' || taxType === 'SSN', 'choose_EIN_or_SSN')
  const npi = input.practiceNpi === undefined ? String(current.practice_npi) : String(input.practiceNpi).trim()
  insist(!npi || validNpi(npi), 'enter_a_valid_ten_digit_practice_NPI')
  const street = input.streetAddress === undefined ? String(current.street_address) : optional(input.streetAddress, 'street_address', 180) ?? ''
  const city = input.city === undefined ? String(current.city) : optional(input.city, 'city', 80) ?? ''
  const state = input.state === undefined ? String(current.state) : String(input.state).trim().toUpperCase()
  const zip = input.postalCode === undefined ? String(current.postal_code) : String(input.postalCode).trim()
  insist(!state || usStates.includes(state), 'choose_a_US_state_or_territory')
  insist(!zip || /^\d{5}(-\d{4})?$/.test(zip), 'enter_a_five_digit_ZIP_or_ZIP_plus_four')
  const structured = [street, city, state, zip].some(Boolean)
  insist(!structured || [street, city, state, zip].every(Boolean), 'complete_the_street_city_state_and_ZIP')
  // Existing free-text addresses remain readable until the owner supplies structured fields.
  const address = structured ? `${street}, ${city}, ${state} ${zip}` : input.address === undefined ? current.address : optional(input.address, 'address', 300) ?? ''
  return { taxId, taxType, npi, street, city, state, zip, address }
}

/** US numbers are stored with +1; an explicitly international number keeps its country code. */
export function phoneNumber(value: unknown) {
  const phone = optional(value, 'phone', 40)
  if (!phone) return null
  const digits = phone.replace(/\D/g, '')
  if (/^\d{10}$/.test(digits)) return '+1' + digits
  if (/^1\d{10}$/.test(digits)) return '+' + digits
  insist(/^\+\d[\d ()-]{6,38}$/.test(phone), 'enter_a_US_phone_number_or_include_the_country_code')
  return '+' + digits
}
