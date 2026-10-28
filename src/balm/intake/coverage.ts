import { audit, guard, id, insist, one, rows, stmt, type Data } from '../domain/model'
import { policyRecord, policyStatement } from '../insurance/policy'
import { eligibilityRequest, eligibilityStatement } from '../insurance/eligibility'
import { hostDateAt } from '../availability/timezone'
import { photo } from './input'

export async function intakePayers(db: D1Database) {
  const configured = !!await one(db, 'SELECT 1 FROM bm_insurance_settings WHERE id=1')
  return { configured, payers: configured ? await rows(db, 'SELECT id,name FROM bm_payers ORDER BY name') : [] }
}
const relationCodes: Record<string,string> = { self:'18',spouse:'01',child:'19' }
/** The intake token supplies the patient and visit. Patients never choose either ID. */
export async function coverageStatements(db: D1Database, appointment: Data, responseId: string, input: Data, at: string) {
  const statements: D1PreparedStatement[] = []
  const client = await one(db, 'SELECT * FROM bm_clients WHERE id=? AND erased_at IS NULL', appointment.client_id)
  insist(client, 'client_not_found', 404)
  const serviceDate = hostDateAt(new Date(appointment.start_at), appointment.time_zone)
  const selected = ['insurance', 'secondary'].filter(prefix => !!input[prefix + 'PayerId'])
  insist(!selected.includes('secondary') || selected.includes('insurance'), 'add_primary_insurance_first')
  for (const prefix of ['insurance','secondary']) {
    const get = (name: string) => input[prefix + name]
    if (!selected.includes(prefix)) {
      insist(!['Payer','Subscriber','MemberId','Group','SubscriberFirst','SubscriberLast','SubscriberDob','Front','Back'].some(k => !!get(k)), 'choose_the_insurance_payer')
      continue
    }
    const payer = await one(db, 'SELECT * FROM bm_payers WHERE id=?', get('PayerId'))
    insist(payer, 'choose_a_clinic_payer')
    const front = photo(get('Front')), back = photo(get('Back'))
    insist(front && back, 'add_both_sides_of_the_insurance_card')
    const relationship = String(get('Relationship'))
    insist(Object.hasOwn(relationCodes, relationship), 'invalid_subscriber_relationship')
    const policy = policyRecord(client, { payerId:payer.id,memberId:get('MemberId'),groupNumber:get('Group'),relationship:relationCodes[relationship],
      subscriberFirst:get('SubscriberFirst'),subscriberLast:get('SubscriberLast'),subscriberDob:get('SubscriberDob'),subscriberSex:get('SubscriberSex'),
      patientSex:input.insurancePatientSex,address:input.insuranceAddress,city:input.insuranceCity,state:input.insuranceState,postalCode:input.insurancePostalCode,
      startsOn:get('StartsOn'), endsOn:get('EndsOn'),priority:prefix==='insurance'?1:2 })
    const request = await eligibilityRequest(db, { ...policy,payer_name:payer.name,payer_code:payer.payer_id,receiver_id:payer.receiver_id }, serviceDate)
    const cardId = id(), frontId=id(), backId=id()
    statements.push(guard(db,'EXISTS(SELECT 1 FROM bm_clients WHERE id=? AND version=? AND erased_at IS NULL)',client.id,client.version),
      guard(db,'EXISTS(SELECT 1 FROM bm_payers WHERE id=? AND version=?)',payer.id,payer.version),
      guard(db,'EXISTS(SELECT 1 FROM bm_insurance_settings WHERE id=1 AND version=?)',request.configVersion),
      policyStatement(db,policy),eligibilityStatement(db,request),
      stmt(db,'INSERT INTO bm_intake_photos(id,bytes,mime) VALUES(?,?,?)',frontId,front.bytes,front.mime),
      stmt(db,'INSERT INTO bm_intake_photos(id,bytes,mime) VALUES(?,?,?)',backId,back.bytes,back.mime),
      stmt(db,`INSERT INTO bm_intake_insurance(id,response_id,client_id,payer,member_id,group_number,subscriber_name,relationship,front,front_mime,back,back_mime,received_at,priority,policy_id) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        cardId,responseId,client.id,payer.name,policy.member_id,policy.group_number,`${policy.subscriber_first} ${policy.subscriber_last}`,get('Relationship'),frontId,front.mime,backId,back.mime,at,policy.priority,policy.id),
      audit(db,{email:'intake link holder',role:'client'},'insurance.submitted',client.id,cardId),
      audit(db,{email:'intake link holder',role:'client'},'insurance.eligibility_prepared',client.id,request.id))
  }
  const identity = photo(input.identityPhoto)
  insist(!selected.length || identity, 'add_a_photo_id')
  if (identity) {
    const key=id(),photoId=id()
    statements.push(stmt(db,'INSERT INTO bm_intake_photos(id,bytes,mime) VALUES(?,?,?)',photoId,identity.bytes,identity.mime),stmt(db,'INSERT INTO bm_intake_identity(id,response_id,client_id,photo_id,received_at) VALUES(?,?,?,?,?)',key,responseId,client.id,photoId,at),
      audit(db,{email:'intake link holder',role:'client'},'identity.submitted',client.id,key))
  }
  return statements
}
