import { audit, commit, day, guard, id, insist, now, one, rows, sha256, stmt, text, type Actor, type Data } from '../domain/model'
import { policyFor } from './access'
import { cents, envelope, parseX12, segment, xdate } from './x12'
import { insuranceAdapter, adapterStatus } from './adapter'
import type { InsuranceEnv } from './types'

export async function prepareEligibility(db:D1Database,who:Actor,input:Data) {
  const policy=await policyFor(db,who,input.policyId),date=day(input.serviceDate,'service_date')
  const config=await one(db,'SELECT i.*,s.clinic_name FROM bm_insurance_settings i JOIN bm_settings s ON s.id=i.id')
  insist(config,'configure_insurance_billing_first',409)
  const key=id(),trace=key.replace(/-/g,'').toUpperCase()
  const parts=[segment('BHT','0022','13',trace,xdate(now().slice(0,10)),now().slice(11,16).replace(':','')),
    segment('HL',1,'',20,1),segment('NM1','PR',2,policy.payer_name,'','','','','PI',policy.payer_code),
    segment('HL',2,1,21,1),segment('NM1','1P',2,config.clinic_name,'','','','','XX',config.billing_npi),
    segment('HL',3,2,22,policy.relationship==='18'?0:1),segment('TRN',1,trace,config.sender_id),
    segment('NM1','IL',1,policy.subscriber_last,policy.subscriber_first,'','','','MI',policy.member_id),
    segment('DMG','D8',xdate(policy.subscriber_dob),policy.subscriber_sex)]
  if(policy.relationship!=='18') {
    const client=await one(db,'SELECT first_name,last_name,date_of_birth FROM bm_clients WHERE id=?',policy.client_id)
    insist(client?.date_of_birth,'patient_date_of_birth_required')
    parts.push(segment('HL',4,3,23,0),segment('TRN',1,trace,config.sender_id),segment('NM1','03',1,client.last_name,client.first_name),segment('DMG','D8',xdate(client.date_of_birth),policy.patient_sex))
  }
  parts.push(segment('DTP','291','D8',xdate(date)),segment('EQ','30'))
  const body=envelope('270','005010X279A1',{sender:config.sender_id,receiver:policy.receiver_id,production:!!config.production},parts)
  await commit(db,who,[guard(db,'EXISTS(SELECT 1 FROM bm_policies WHERE id=? AND version=?)',policy.id,policy.version),stmt(db,'INSERT INTO bm_eligibility(id,policy_id,service_date,trace,request,created_at) VALUES(?,?,?,?,?,?)',key,policy.id,date,trace,body,now()),audit(db,who,'insurance.eligibility_prepared',policy.client_id,key)])
  return {id:key,policyId:policy.id,status:'prepared'}
}
export async function submitEligibility(env:InsuranceEnv,who:Actor,input:Data) {
  const db=env.DB,row=await one(db,'SELECT * FROM bm_eligibility WHERE id=?',text(input.id,'eligibility',100))
  insist(row,'eligibility_not_found',404);const policy=await policyFor(db,who,row.policy_id)
  const status=adapterStatus(env);if(!status.available)return {status:'unavailable',reason:status.reason}
  insist(['prepared','exported'].includes(row.status),'eligibility_already_submitted',409)
  await commit(db,who,[stmt(db,"UPDATE bm_eligibility SET status='sending',version=version+1 WHERE id=? AND version=?",row.id,row.version),guard(db,'changes()=1'),audit(db,who,'insurance.eligibility_submission_started',policy.client_id,row.id)])
  let result
  try {result=await insuranceAdapter(env).submit({kind:'270',id:row.id,body:row.request,sha256:await sha256(row.request)})}
  catch(error){await commit(db,who,[stmt(db,"UPDATE bm_eligibility SET status='uncertain',version=version+1 WHERE id=? AND status='sending'",row.id),audit(db,who,'insurance.eligibility_submission_uncertain',policy.client_id,row.id)]);throw error}
  await commit(db,who,[stmt(db,'UPDATE bm_eligibility SET status=?,version=version+1 WHERE id=? AND status=?',result.status,row.id,'sending'),audit(db,who,'insurance.eligibility_submitted',policy.client_id,row.id)])
  return result
}
export async function importEligibility(db:D1Database,who:Actor,input:Data) {
  const row=await one(db,'SELECT * FROM bm_eligibility WHERE id=?',text(input.id,'eligibility',100));insist(row,'eligibility_not_found',404)
  const policy=await policyFor(db,who,row.policy_id),parsed=parseX12(input.x12,'271'),hash=await sha256(parsed.body)
  if(row.response_sha256===hash)return {id:row.id,status:row.status,duplicate:true}
  insist(!row.response,'eligibility_response_already_imported',409)
  insist(parsed.segments.some(s=>s[0]==='TRN'&&s[2]===row.trace),'eligibility_trace_does_not_match')
  const members=parsed.segments.filter(s=>s[0]==='NM1'&&s[1]==='IL'&&s[8]==='MI')
  insist(members.some(s=>s[9]===policy.member_id),'eligibility_member_does_not_match')
  const errors=parsed.segments.filter(s=>s[0]==='AAA'&&s[1]==='N').map(s=>({reason:s[3],followup:s[4]}))
  const benefits=parsed.segments.filter(s=>s[0]==='EB').map(s=>({information:s[1],coverageLevel:s[2]??'',serviceTypes:(s[3]??'').split(parsed.component),insuranceType:s[4]??'',plan:s[5]??'',timePeriod:s[6]??'',amountCents:s[7]?cents(s[7],'benefit'):null,percent:s[8]?Number(s[8]):null,quantityQualifier:s[9]??'',quantity:s[10]?Number(s[10]):null,network:s[12]??''}))
  insist(errors.length>0||benefits.length>0,'eligibility_response_has_no_benefits')
  insist(benefits.every(b=>(b.percent===null||(Number.isFinite(b.percent)&&b.percent>=0&&b.percent<=1))&&(b.quantity===null||(Number.isFinite(b.quantity)&&b.quantity>=0))),'invalid_eligibility_numeric_benefit')
  // Benefit amounts are scoped: select only explicit individual health-plan
  // benefits. Preserve every EB for review; never add visit counts across codes.
  const planBenefits=benefits.filter(b=>b.serviceTypes.includes('30')&&['','IND'].includes(b.coverageLevel))
  const changed=benefits.some(b=>b.information==='R'),inactive=planBenefits.some(b=>['6','7','8'].includes(b.information)),active=planBenefits.some(b=>['1','2','3','4','5'].includes(b.information))
  const status=errors.length?'error':changed?'changed':inactive?'inactive':active?'active':'unknown'
  const copays=planBenefits.filter(b=>b.information==='B'&&b.network!=='N'&&b.amountCents!==null),deductibles=planBenefits.filter(b=>b.information==='C'&&b.timePeriod==='29'&&b.network!=='N'&&b.amountCents!==null)
  const copay=copays.length===1?copays[0].amountCents:null,deductible=deductibles.length===1?deductibles[0].amountCents:null,at=now()
  await commit(db,who,[guard(db,'EXISTS(SELECT 1 FROM bm_policies WHERE id=? AND version=?)',policy.id,policy.version),stmt(db,'UPDATE bm_eligibility SET response=?,response_sha256=?,benefits=?,status=?,checked_at=?,version=version+1 WHERE id=? AND response IS NULL',parsed.body,hash,JSON.stringify({benefits,errors}),status,at,row.id),guard(db,'changes()=1'),stmt(db,'UPDATE bm_policies SET eligibility_status=?,eligibility_checked_at=?,copay_cents=?,deductible_cents=?,version=version+1 WHERE id=?',status,at,copay,deductible,policy.id),audit(db,who,'insurance.eligibility_imported',policy.client_id,row.id)])
  return {id:row.id,policyId:policy.id,status,benefits,errors,copayCents:copay,deductibleCents:deductible}
}
