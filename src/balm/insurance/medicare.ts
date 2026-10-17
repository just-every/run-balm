import { audit, commit, day, guard, insist, integer, now, one, rows, stmt, text, type Actor, type Data } from '../domain/model'
import { parseDollars } from '../payments/ledger'
import { claimFor, clientGuard, insuranceClient } from './access'

export const therapyGroup = (value:unknown) => { insist(value==='pt_slp'||value==='ot','invalid_therapy_group');return value }
const cents = (input:Data,key:string,min=0) => integer(input[key+'Cents']??parseDollars(input[key],key),key+'_cents',min)
export async function saveMedicareSettings(db:D1Database,who:Actor,input:Data) {
  insist(who.role==='owner','only_the_owner_can_change_medicare_settings',403)
  const year=integer(input.year,'year',2000,2100),group=therapyGroup(input.therapyGroup)
  const threshold=cents(input,'threshold',1),review=cents(input,'review',1),published=day(input.publishedOn,'published_on')
  insist(review>=threshold,'review_threshold_below_kx_threshold')
  const previous=await one(db,'SELECT * FROM bm_medicare_settings WHERE year=? AND therapy_group=?',year,group)
  await commit(db,who,[...(previous?[guard(db,'EXISTS(SELECT 1 FROM bm_medicare_settings WHERE year=? AND therapy_group=? AND version=?)',year,group,previous.version)]:[guard(db,'NOT EXISTS(SELECT 1 FROM bm_medicare_settings WHERE year=? AND therapy_group=?)',year,group)]),stmt(db,`INSERT INTO bm_medicare_settings(year,therapy_group,starts_on,ends_on,threshold_cents,review_cents,source,published_on) VALUES(?,?,?,?,?,?,?,?) ON CONFLICT(year,therapy_group) DO UPDATE SET threshold_cents=excluded.threshold_cents,review_cents=excluded.review_cents,source=excluded.source,published_on=excluded.published_on,version=bm_medicare_settings.version+1`,year,group,`${year}-01-01`,`${year}-12-31`,threshold,review,text(input.source,'cms_source',600),published),audit(db,who,'insurance.medicare_settings_saved',null)])
  return {saved:true}
}
export async function saveMedicareExpenses(db:D1Database,who:Actor,input:Data) {
  const client=await insuranceClient(db,who,input.clientId),year=integer(input.year,'year',2000,2100),group=therapyGroup(input.therapyGroup)
  const annual=await one(db,'SELECT * FROM bm_medicare_settings WHERE year=? AND therapy_group=?',year,group)
  insist(annual,'configure_the_service_year_medicare_settings_first',409)
  const used=input.externalUsedCents===undefined?parseDollars(input.externalUsed??'0','outside_expenses'):integer(input.externalUsedCents,'external_used_cents')
  await commit(db,who,[clientGuard(db,who,client.id),guard(db,'EXISTS(SELECT 1 FROM bm_medicare_settings WHERE year=? AND therapy_group=? AND version=?)',year,group,annual.version),stmt(db,`INSERT INTO bm_medicare_years(client_id,year,therapy_group,threshold_cents,external_used_cents,source) VALUES(?,?,?,?,?,?) ON CONFLICT(client_id,year,therapy_group) DO UPDATE SET threshold_cents=excluded.threshold_cents,external_used_cents=excluded.external_used_cents,source=excluded.source,version=bm_medicare_years.version+1`,client.id,year,group,annual.threshold_cents,used,text(input.source,'expense_source',300)),audit(db,who,'insurance.medicare_expenses_saved',client.id)])
  return {saved:true}
}
export async function saveRecognizedExpense(db:D1Database,who:Actor,input:Data) {
  const claim=await claimFor(db,who,input.id),snapshot=JSON.parse(claim.snapshot)
  insist(snapshot.payer.medicare,'claim_is_not_medicare')
  const previous=await one(db,'SELECT * FROM bm_medicare_expenses WHERE claim_id=?',claim.id)
  await commit(db,who,[clientGuard(db,who,claim.client_id),guard(db,'EXISTS(SELECT 1 FROM bm_claims WHERE id=? AND version=?)',claim.id,claim.version),...(previous?[guard(db,'EXISTS(SELECT 1 FROM bm_medicare_expenses WHERE claim_id=? AND version=?)',claim.id,previous.version)]:[guard(db,'NOT EXISTS(SELECT 1 FROM bm_medicare_expenses WHERE claim_id=?)',claim.id)]),stmt(db,`INSERT INTO bm_medicare_expenses(claim_id,recognized_cents,source,recorded_at) VALUES(?,?,?,?) ON CONFLICT(claim_id) DO UPDATE SET recognized_cents=excluded.recognized_cents,source=excluded.source,recorded_at=excluded.recorded_at,version=bm_medicare_expenses.version+1`,claim.id,cents(input,'recognized'),text(input.source,'expense_source',300),now()),audit(db,who,'insurance.medicare_recognized_saved',claim.client_id,claim.id)])
  return {saved:true}
}
export const incurredClaimWhere = `c.client_id=? AND y.medicare=1 AND c.therapy_group=? AND substr(c.service_date,1,4)=? AND c.appointment_id<>? AND (EXISTS(SELECT 1 FROM bm_claim_batch_items bi WHERE bi.claim_id=c.id) OR EXISTS(SELECT 1 FROM bm_remittance_claims ri WHERE ri.claim_id=c.id))`
export async function medicareSpending(db:D1Database,clientId:string,year:number,group:string,appointmentId:string) {
  const [annual,external,previous]=await Promise.all([
    one(db,'SELECT * FROM bm_medicare_settings WHERE year=? AND therapy_group=?',year,group),
    one(db,'SELECT * FROM bm_medicare_years WHERE client_id=? AND year=? AND therapy_group=?',clientId,year,group),
    rows(db,`SELECT c.id,c.appointment_id,c.snapshot,c.version,r.paid_cents,r.pr_cents,e.recognized_cents,e.version AS expense_version FROM bm_claims c JOIN bm_policies p ON p.id=c.policy_id JOIN bm_payers y ON y.id=p.payer_id LEFT JOIN bm_remittance_claims r ON r.claim_id=c.id LEFT JOIN bm_medicare_expenses e ON e.claim_id=c.id WHERE ${incurredClaimWhere} ORDER BY c.created_at DESC,c.id DESC`,clientId,group,String(year),appointmentId)
  ])
  const visits=new Map<string,Data[]>()
  for(const c of previous)visits.set(c.appointment_id,[...(visits.get(c.appointment_id)??[]),c])
  let local=0
  for(const claims of visits.values()){
    const recognized=claims.find(c=>c.recognized_cents!==null),adjudicated=claims.find(c=>c.paid_cents!==null)
    local+=recognized?.recognized_cents??(adjudicated?adjudicated.paid_cents+adjudicated.pr_cents:(JSON.parse(claims[0].snapshot).estimatedAllowedCents??0))
  }
  return {annual,external,previous,usedCents:(external?.external_used_cents??0)+local}
}

/** Audited patient/year position for charting and pre-sign warnings. The current
 * encounter is excluded so callers can add their own prospective allowed cost. */
export async function medicarePosition(db:D1Database,who:Actor,input:Data) {
  const client=await insuranceClient(db,who,input.clientId,'insurance.medicare_position_read')
  const year=integer(input.year,'year',2000,2100),group=therapyGroup(input.therapyGroup)
  const position=await medicareSpending(db,client.id,year,group,String(input.appointmentId??''))
  return {year,group,usedCents:position.usedCents,externalUsedCents:position.external?.external_used_cents??0,thresholdCents:position.annual?.threshold_cents??null,reviewCents:position.annual?.review_cents??null,source:position.annual?.source??null,startsOn:position.annual?.starts_on??null,endsOn:position.annual?.ends_on??null}
}
