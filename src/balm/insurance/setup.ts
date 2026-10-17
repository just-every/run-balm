import { audit, commit, day, guard, id, insist, integer, now, one, optional, rows, stmt, text, type Actor, type Data } from '../domain/model'
import { validNpi } from '../payments/codes'
import { insuranceClient, policyFor, yes } from './access'

import { policyRecord, policyStatement, postal, stateCode } from './policy'

export async function saveInsuranceSettings(db: D1Database, who: Actor, input: Data) {
  insist(who.role === 'owner', 'only_the_owner_can_change_insurance_settings', 403)
  const npi = text(input.billingNpi, 'billing_npi', 10), tax = text(input.taxId, 'tax_id', 12).replace(/-/g, '')
  insist(validNpi(npi), 'invalid_billing_npi'); insist(/^\d{9}$/.test(tax), 'invalid_tax_id')
  const phone = text(input.contactPhone, 'contact_phone', 20).replace(/\D/g, '')
  insist(/^\d{10}$/.test(phone), 'invalid_contact_phone')
  const sender = text(input.senderId, 'sender_id', 15).toUpperCase(); insist(/^[A-Za-z0-9]+$/.test(sender), 'invalid_sender_id')
  await commit(db, who, [stmt(db, `INSERT INTO bm_insurance_settings(id,billing_npi,tax_id,address,city,state,postal_code,sender_id,contact_name,contact_phone,production) VALUES(1,?,?,?,?,?,?,?,?,?,?)
    ON CONFLICT(id) DO UPDATE SET billing_npi=excluded.billing_npi,tax_id=excluded.tax_id,address=excluded.address,city=excluded.city,state=excluded.state,postal_code=excluded.postal_code,sender_id=excluded.sender_id,contact_name=excluded.contact_name,contact_phone=excluded.contact_phone,production=excluded.production,version=bm_insurance_settings.version+1`,
  npi,tax,text(input.address,'address',100),text(input.city,'city',30),stateCode(input.state),postal(input.postalCode),sender,text(input.contactName,'contact_name',60),phone,yes(input.production)?1:0), audit(db,who,'insurance.settings_saved',null)])
  return { saved: true }
}
export async function savePayer(db: D1Database, who: Actor, input: Data) {
  insist(who.role === 'owner', 'only_the_owner_can_change_payers', 403)
  const key = input.id ? text(input.id,'payer',100) : id(), medicare = yes(input.medicare)
  const method = input.unitMethod || (medicare ? 'cms' : null)
  insist(method === null || method === 'cms' || method === 'ama', 'invalid_unit_method')
  insist(!medicare || method === 'cms', 'medicare_requires_cms_units')
  const payerCode = text(input.payerId,'payer_id',50).toUpperCase(), receiver = text(input.receiverId,'receiver_id',15).toUpperCase()
  insist(/^[A-Za-z0-9]+$/.test(receiver) && /^[A-Za-z0-9]+$/.test(payerCode), 'invalid_payer_identifiers')
  const fees = input.fees === undefined ? null : input.fees
  insist(fees === null || (Array.isArray(fees) && fees.length <= 200), 'invalid_fee_schedule')
  await commit(db,who,[stmt(db,`INSERT INTO bm_payers(id,name,payer_id,receiver_id,medicare,unit_method,requires_referral) VALUES(?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET name=excluded.name,payer_id=excluded.payer_id,receiver_id=excluded.receiver_id,medicare=excluded.medicare,unit_method=excluded.unit_method,requires_referral=excluded.requires_referral,version=bm_payers.version+1`,key,text(input.name,'payer_name',100),payerCode,receiver,medicare?1:0,method,yes(input.requiresReferral)?1:0),
    ...(fees === null ? [] : [stmt(db,'DELETE FROM bm_payer_fees WHERE payer_id=?',key), ...fees.map((f: Data) => { const code = text(f.code,'cpt',5); insist(/^\d{4}[\dA-Z]$/.test(code),'invalid_cpt'); return stmt(db,'INSERT INTO bm_payer_fees(payer_id,code,cents) VALUES(?,?,?)',key,code,integer(f.cents,'fee_cents',1)) })]),audit(db,who,'insurance.payer_saved',null,key)])
  return { id:key }
}
export async function saveEnrollment(db: D1Database, who: Actor, input: Data) {
  insist(who.role === 'owner', 'only_the_owner_can_change_enrollments',403)
  const payer = text(input.payerId,'payer',100), staff = text(input.practitionerId,'practitioner',100), taxonomy = text(input.taxonomy,'taxonomy',10).toUpperCase()
  insist(/^\d{9}[A-Z]$/.test(taxonomy),'invalid_taxonomy')
  await commit(db,who,[guard(db,"EXISTS(SELECT 1 FROM bm_staff WHERE id=? AND role='practitioner' AND erased_at IS NULL)",staff),stmt(db,'INSERT INTO bm_payer_enrollments(payer_id,practitioner_id,taxonomy,active) VALUES(?,?,?,?) ON CONFLICT(payer_id,practitioner_id) DO UPDATE SET taxonomy=excluded.taxonomy,active=excluded.active',payer,staff,taxonomy,yes(input.active)?1:0),stmt(db,'UPDATE bm_payers SET version=version+1 WHERE id=?',payer),audit(db,who,'insurance.enrollment_saved',null,staff)])
  return { saved:true }
}
export async function savePolicy(db: D1Database, who: Actor, input: Data) {
  const client = await insuranceClient(db,who,input.clientId), key = input.id ? text(input.id,'policy',100) : id()
  const previous = input.id ? await policyFor(db,who,key) : null
  insist(!previous || previous.client_id === client.id,'policy_patient_cannot_change')
  const policy = policyRecord(client, input, key)
  await commit(db,who,[guard(db,'EXISTS(SELECT 1 FROM bm_clients WHERE id=? AND erased_at IS NULL)',client.id),
    ...(previous ? [guard(db,'EXISTS(SELECT 1 FROM bm_policies WHERE id=? AND version=?)',key,previous.version)] : []),
    policyStatement(db,policy),audit(db,who,'insurance.policy_saved',client.id,key)])
  return { id:key,clientId:client.id }
}
export async function saveAuthorization(db: D1Database, who: Actor, input: Data) {
  const policy = await policyFor(db,who,input.policyId), key = input.id ? text(input.id,'authorization',100) : id()
  const start = day(input.startsOn,'starts_on'), end = day(input.endsOn,'ends_on')
  insist(end >= start,'authorization_end_precedes_start')
  const action = input.bookingAction??'warn'; insist(['warn','block'].includes(action),'invalid_booking_action')
  const previous = input.id ? await one(db,'SELECT * FROM bm_authorizations WHERE id=?',key) : null
  insist(!input.id || previous?.policy_id === policy.id,'authorization_not_found',404)
  const staff = optional(input.practitionerId,'practitioner',100)
  await commit(db,who,[...(staff?[guard(db,"EXISTS(SELECT 1 FROM bm_staff WHERE id=? AND role='practitioner' AND active=1 AND erased_at IS NULL)",staff)]:[]),...(previous?[guard(db,'EXISTS(SELECT 1 FROM bm_authorizations WHERE id=? AND version=?)',key,previous.version)]:[]),stmt(db,`INSERT INTO bm_authorizations(id,policy_id,number,starts_on,ends_on,visits,practitioner_id,booking_action) VALUES(?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET number=excluded.number,starts_on=excluded.starts_on,ends_on=excluded.ends_on,visits=excluded.visits,practitioner_id=excluded.practitioner_id,booking_action=excluded.booking_action,version=bm_authorizations.version+1`,key,policy.id,text(input.number,'authorization_number',50),start,end,integer(input.visits,'visits',1,10000),staff,action),stmt(db,'UPDATE bm_policies SET version=version+1 WHERE id=?',policy.id),audit(db,who,'insurance.authorization_saved',policy.client_id,key)])
  return { id:key }
}
