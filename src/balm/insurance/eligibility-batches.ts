import { datePlus, firstInstantOfHostDate, hostDateAt, weekdayForDate } from '../availability/timezone'
import { audit, commit, day, guard, id, insist, now, one, rows, sha256, stmt, text, type Actor, type Data } from '../domain/model'
import { clientGuard } from './access'
import { eligibilityBasis, eligibilityRequest, eligibilityStatement } from './eligibility'

const owner = (who: Actor) => insist(who.role === 'owner', 'eligibility_cohorts_require_owner', 403)
const stamps = async (db:D1Database) => Promise.all(['bm_policies','bm_appointments','bm_clients','bm_payers'].map(async table => ({table,...(await one<{count:number;revision:number}>(db,`SELECT COUNT(*) AS count,COALESCE(SUM(version),0) AS revision FROM ${table}`))!})))

/** Explicit civil dates, recorded clinic holidays, and Monday through Friday.
 * Preparation is local only: it does not enroll, submit, or schedule sending. */
async function cohort(db:D1Database,input:Data) {
  const kind=String(input.kind),asOfDate=day(input.asOfDate,'as_of_date')
  insist(['next_business_day','monthly'].includes(kind),'invalid_eligibility_cohort')
  const settings=await one(db,'SELECT time_zone,holidays,version FROM bm_settings WHERE id=1')
  insist(settings,'clinic_settings_missing',409)
  const holidays=JSON.parse(settings.holidays) as {date:string;name:string}[]
  const business=(date:string)=>![0,6].includes(weekdayForDate(date))&&!holidays.some(h=>h.date===date)
  let serviceDate=kind==='monthly'?asOfDate.slice(0,7)+'-01':datePlus(asOfDate,1)
  for(let i=0;!business(serviceDate);i++){insist(i<370,'no_business_date_available',409);serviceDate=datePlus(serviceDate,1)}
  const start=firstInstantOfHostDate(serviceDate,settings.time_zone),end=firstInstantOfHostDate(datePlus(serviceDate,1),settings.time_zone)
  insist(start&&end,'cohort_date_unavailable_in_clinic_zone',409)
  const before=await stamps(db)
  const visits=kind==='next_business_day'?await rows(db,"SELECT id,client_id,version,start_at FROM bm_appointments WHERE status='booked' AND start_at>=? AND start_at<? ORDER BY id",start.toISOString(),end.toISOString()):[]
  const policies=await rows(db,`SELECT p.*,y.name AS payer_name,y.payer_id AS payer_code,y.receiver_id,y.version AS payer_version,c.version AS client_version,c.first_name||' '||c.last_name AS patient
    FROM bm_policies p JOIN bm_payers y ON y.id=p.payer_id JOIN bm_clients c ON c.id=p.client_id
    WHERE c.erased_at IS NULL AND p.starts_on<=? AND (p.ends_on IS NULL OR p.ends_on>=?) ORDER BY p.id`,serviceDate,serviceDate)
  const members=policies.filter(p=>kind==='monthly'||visits.some(v=>v.client_id===p.client_id))
  const config=await one(db,'SELECT version FROM bm_insurance_settings WHERE id=1')
  insist(config,'configure_insurance_billing_first',409)
  const source={kind,asOfDate,serviceDate,timeZone:settings.time_zone,holidays,settingsVersion:settings.version,configVersion:config.version,stamps:before,visits,members}
  return {...source,digest:await sha256(JSON.stringify(source))}
}
export async function previewEligibilityCohort(db:D1Database,who:Actor,input:Data) {
  owner(who)
  const c=await cohort(db,input)
  await commit(db,who,[...c.members.flatMap(p=>[clientGuard(db,who,p.client_id),audit(db,who,'insurance.eligibility_cohort_previewed',p.client_id,p.id)])])
  return {kind:c.kind,asOfDate:c.asOfDate,serviceDate:c.serviceDate,timeZone:c.timeZone,holidays:c.holidays,digest:c.digest,
    members:c.members.map(p=>({policyId:p.id,clientId:p.client_id,patient:p.patient,payer:p.payer_name,memberId:p.member_id,visits:c.visits.filter(v=>v.client_id===p.client_id).map(v=>v.id)}))}
}
export async function prepareEligibilityCohort(db:D1Database,who:Actor,input:Data) {
  owner(who)
  const c=await cohort(db,input)
  insist(text(input.digest,'cohort_digest',64)===c.digest,'eligibility_cohort_changed_preview_again',409)
  const previous=await one(db,'SELECT id FROM bm_eligibility_cohorts WHERE digest=?',c.digest)
  if(previous)return {id:previous.id,duplicate:true,status:'prepared'}
  const batchId=id(),statements=[
    guard(db,'EXISTS(SELECT 1 FROM bm_settings WHERE id=1 AND version=?)',c.settingsVersion),
    guard(db,'EXISTS(SELECT 1 FROM bm_insurance_settings WHERE id=1 AND version=?)',c.configVersion),
    ...c.stamps.map(s=>guard(db,`(SELECT COUNT(*) FROM ${s.table})=? AND (SELECT COALESCE(SUM(version),0) FROM ${s.table})=?`,s.count,s.revision)),
    stmt(db,'INSERT INTO bm_eligibility_cohorts(id,kind,as_of_date,service_date,time_zone,holidays,digest,prepared_at) VALUES(?,?,?,?,?,?,?,?)',batchId,c.kind,c.asOfDate,c.serviceDate,c.timeZone,JSON.stringify(c.holidays),c.digest,now())]
  const requests=[]
  for(const policy of c.members) {
    const key=policy.id+':'+c.serviceDate,basis=await eligibilityBasis(policy)
    const old=await one(db,'SELECT * FROM bm_eligibility WHERE cohort_key=?',key)
    let existing=old?.policy_basis===basis&&old.status!=='superseded'?old:await one(db,"SELECT * FROM bm_eligibility WHERE policy_id=? AND service_date=? AND policy_basis=? AND status<>'superseded' ORDER BY created_at,id LIMIT 1",policy.id,c.serviceDate,basis)
    if(old&&old.id!==existing?.id)statements.push(guard(db,'EXISTS(SELECT 1 FROM bm_eligibility WHERE id=? AND version=?)',old.id,old.version),stmt(db,"UPDATE bm_eligibility SET cohort_key=NULL,status=CASE WHEN response IS NULL THEN 'superseded' ELSE status END,version=version+1 WHERE id=?",old.id))
    let requestId:string,status:string
    if(existing){
      requestId=existing.id;status=existing.status
      statements.push(guard(db,'EXISTS(SELECT 1 FROM bm_eligibility WHERE id=? AND version=?)',existing.id,existing.version),stmt(db,'UPDATE bm_eligibility SET cohort_key=? WHERE id=?',key,existing.id))
    }else{
      const request=await eligibilityRequest(db,policy,c.serviceDate)
      requestId=request.id;status='prepared';statements.push(eligibilityStatement(db,request,key))
    }
    statements.push(clientGuard(db,who,policy.client_id),stmt(db,'INSERT INTO bm_eligibility_cohort_items(batch_id,policy_id,eligibility_id,client_id) VALUES(?,?,?,?)',batchId,policy.id,requestId,policy.client_id),audit(db,who,'insurance.eligibility_cohort_prepared',policy.client_id,requestId))
    requests.push({id:requestId,policyId:policy.id,status})
  }
  await commit(db,who,statements)
  return {id:batchId,serviceDate:c.serviceDate,status:'prepared',requests}
}
export async function eligibilityCohorts(db:D1Database,who:Actor) {
  if(who.role!=='owner')return null
  const batches=await rows(db,'SELECT * FROM bm_eligibility_cohorts ORDER BY prepared_at DESC,id DESC LIMIT 100')
  const items=await rows(db,`SELECT i.*,e.service_date,e.status,e.checked_at,p.member_id,y.name AS payer,c.first_name||' '||c.last_name AS patient
    FROM bm_eligibility_cohort_items i JOIN bm_eligibility e ON e.id=i.eligibility_id JOIN bm_policies p ON p.id=i.policy_id
    JOIN bm_payers y ON y.id=p.payer_id JOIN bm_clients c ON c.id=i.client_id WHERE c.erased_at IS NULL AND i.batch_id IN (SELECT value FROM json_each(?)) ORDER BY p.id`,JSON.stringify(batches.map(b=>b.id)))
  await commit(db,who,items.flatMap(i=>[clientGuard(db,who,i.client_id),audit(db,who,'insurance.eligibility_cohort_read',i.client_id,i.eligibility_id)]))
  return {today:hostDateAt(new Date(),(await one(db,'SELECT time_zone FROM bm_settings WHERE id=1'))!.time_zone),batches:batches.map(b=>({...b,items:items.filter(i=>i.batch_id===b.id)}))}
}
