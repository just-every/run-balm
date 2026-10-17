import { clientVisible } from '../domain/clients'
import { audit, guard, insist, one, stmt, text, type Actor, type Data } from '../domain/model'
import { policyRecord, policyStatement } from '../insurance/policy'
import { eligibilityRequest, eligibilityStatement } from '../insurance/eligibility'
import { hostDateAt } from '../availability/timezone'

/** Checking a captured card updates its linked claim policy, never just a display copy. */
export async function verifiedCoverage(db: D1Database, who: Actor, row: Data, input: Data) {
  insist(who.role === 'owner' || who.staffRole === 'reception', 'billing_access_required', 403)
  const native = await one(db, 'SELECT * FROM bm_policies WHERE id=?', row.policy_id)
  insist(native, 'insurance_policy_not_found', 404)
  const client = await clientVisible(db, who, row.client_id)
  const payer = await one(db, 'SELECT * FROM bm_payers WHERE id=?', text(input.payerId, 'payer', 100))
  insist(payer, 'choose_a_clinic_payer')
  const relationship = String(input.relationship), code = ({ self:'18',spouse:'01',child:'19' } as Record<string,string>)[relationship]
  insist(code, 'invalid_subscriber_relationship')
  const policy = policyRecord(client, {payerId:payer.id,memberId:input.memberId,groupNumber:input.group,planName:native.plan_name,relationship:code,
    subscriberFirst:input.subscriberFirst,subscriberLast:input.subscriberLast,subscriberDob:input.subscriberDob ?? native.subscriber_dob,
    subscriberSex:input.subscriberSex ?? native.subscriber_sex,patientSex:native.patient_sex,address:native.address,city:native.city,state:native.state,postalCode:native.postal_code,
    startsOn:native.starts_on,endsOn:native.ends_on,priority:native.priority}, native.id)
  const statements = [guard(db,'EXISTS(SELECT 1 FROM bm_policies WHERE id=? AND version=?)',native.id,native.version),guard(db,'EXISTS(SELECT 1 FROM bm_payers WHERE id=? AND version=?)',payer.id,payer.version)]
  if (['payer_id','member_id','group_number','relationship','subscriber_first','subscriber_last','subscriber_dob','subscriber_sex'].some(k => policy[k as keyof typeof policy] !== native[k])) {
    const visit = await one(db, 'SELECT a.start_at,s.time_zone FROM bm_intake_responses r JOIN bm_appointments a ON a.id=r.appointment_id, bm_settings s WHERE r.id=?', row.response_id)
    const request = await eligibilityRequest(db,{...policy,payer_name:payer.name,payer_code:payer.payer_id,receiver_id:payer.receiver_id},hostDateAt(new Date(visit!.start_at),visit!.time_zone))
    statements.push(guard(db,'EXISTS(SELECT 1 FROM bm_insurance_settings WHERE id=1 AND version=?)',request.configVersion),policyStatement(db,policy),
      stmt(db,"UPDATE bm_eligibility SET status='superseded',version=version+1 WHERE policy_id=? AND response IS NULL",policy.id),eligibilityStatement(db,request),audit(db,who,'insurance.eligibility_prepared',client.id,request.id))
  }
  return { statements, fields: { payer:payer.name,memberId:policy.member_id,group:policy.group_number,subscriber:`${policy.subscriber_first} ${policy.subscriber_last}`,relationship } }
}
