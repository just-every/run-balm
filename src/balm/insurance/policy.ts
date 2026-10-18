import { day, id, insist, integer, optional, stmt, text, type Data } from '../domain/model'

export const stateCode = (v: unknown) => { const s = text(v, 'state', 2).toUpperCase(); insist(/^[A-Z]{2}$/.test(s), 'invalid_state'); return s }
export const postal = (v: unknown) => { const s = text(v, 'postal_code', 10).replace(/-/g, ''); insist(/^\d{5}(\d{4})?$/.test(s), 'invalid_postal_code'); return s }
const sex = (v: unknown) => { insist(['M','F','U'].includes(String(v)), 'invalid_sex'); return String(v) }
const columns = ['id','client_id','payer_id','member_id','group_number','plan_name','relationship','subscriber_first','subscriber_last','subscriber_dob','subscriber_sex','patient_sex','address','city','state','postal_code','starts_on','ends_on','priority']

/** Shared claim-field validation, independent of the staff or private intake door. */
export function policyRecord(client: Data, input: Data, key: string = id()) {
  const relationship = String(input.relationship ?? '18')
  insist(['18','01','19'].includes(relationship), 'invalid_relationship')
  const starts = day(input.startsOn, 'starts_on'), ends = input.endsOn ? day(input.endsOn, 'ends_on') : null
  insist(!ends || ends >= starts, 'policy_end_precedes_start')
  const self = relationship === '18', patientSex = sex(input.patientSex)
  return { id: key, client_id: client.id, payer_id: text(input.payerId, 'payer', 100),
    member_id: text(input.memberId, 'member_id', 80).toUpperCase(), group_number: optional(input.groupNumber, 'group_number', 50) ?? '', plan_name: optional(input.planName, 'plan_name', 100) ?? '',
    relationship, subscriber_first: self ? client.first_name : text(input.subscriberFirst, 'subscriber_first', 35),
    subscriber_last: self ? client.last_name : text(input.subscriberLast, 'subscriber_last', 60), subscriber_dob: day(self ? client.date_of_birth : input.subscriberDob, 'subscriber_dob'),
    subscriber_sex: self ? patientSex : sex(input.subscriberSex), patient_sex: patientSex,
    address: text(input.address, 'address', 100), city: text(input.city, 'city', 30), state: stateCode(input.state), postal_code: postal(input.postalCode),
    starts_on: starts, ends_on: ends, priority: integer(input.priority ?? 1, 'priority', 1, 3), version: 1 }
}
export function policyStatement(db: D1Database, policy: Data) {
  const mutable = columns.filter(c => c !== 'id' && c !== 'client_id')
  return stmt(db, `INSERT INTO bm_policies(${columns.join(',')}) VALUES(${columns.map(() => '?').join(',')})
    ON CONFLICT(id) DO UPDATE SET ${mutable.map(c => `${c}=excluded.${c}`).join(',')},eligibility_status='unknown',eligibility_checked_at=NULL,copay_cents=NULL,deductible_cents=NULL,version=bm_policies.version+1`, ...columns.map(c => policy[c]))
}
