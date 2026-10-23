import {parseDollars} from '../payments/ledger'
import {audit,commit,day,guard,id,insist,integer,now,optional,rows,stmt,text,type Actor,type Data} from '../domain/model'
import {stateCode} from './policy'

/** Exact plan names match the policy. A complete plan revision overrides the
 * payer baseline; within a scope contracted beats standard, then latest date.
 * Records are append-only: a correction is another dated contract revision. */
export function chooseSchedule(schedules:Data[],payerId:string,plan:string,date:string){
 return schedules.filter(s=>s.payer_id===payerId&&(!s.plan_name||s.plan_name===plan)&&s.effective_on<=date)
 .sort((a,b)=>Number(!!b.plan_name)-Number(!!a.plan_name)||Number(b.kind==='contracted')-Number(a.kind==='contracted')||b.effective_on.localeCompare(a.effective_on))[0]??null
}
export async function scheduleBasis(db:D1Database,payer:Data,plan:string,date:string){
 const schedule=chooseSchedule(await rows(db,'SELECT * FROM bm_billing_schedules WHERE payer_id=?',payer.id??payer.payer_id),payer.id??payer.payer_id,plan,date)
 return {schedule,unit_method:schedule?schedule.unit_method:payer.unit_method,fixed_unit_minutes:schedule?schedule.fixed_unit_minutes:payer.fixed_unit_minutes}
}
export async function scheduleFees(db:D1Database,payerId:string,schedule:Data|null){
 return schedule?JSON.parse(schedule.fees) as {code:string;cents:number}[]:await rows(db,'SELECT code,cents FROM bm_payer_fees WHERE payer_id=?',payerId)
}
export async function saveBillingSchedule(db:D1Database,who:Actor,input:Data){
 insist(who.role==='owner','only_the_owner_can_change_billing_schedules',403)
 const payer=text(input.payerId,'payer',100),plan=optional(input.planName,'plan_name',100)??'',date=day(input.effectiveOn,'effective_on'),kind=input.kind??'contracted'
 insist(['standard','contracted'].includes(kind),'invalid_schedule_kind')
 const method=input.unitMethod||null;insist(method===null||['cms','ama','fixed'].includes(method),'invalid_unit_method')
 const fixed=method==='fixed'?integer(input.fixedUnitMinutes,'fixed_unit_minutes',1):null
 const fees=typeof input.feeSchedule==='string'?input.feeSchedule.split(/\r?\n/).filter((l:string)=>l.trim()).map((l:string)=>{const [code,amount]=l.trim().split(/\s+/);return {code,cents:parseDollars(amount,'fee')}}):input.fees;insist(Array.isArray(fees)&&fees.length>0&&fees.length<=200,'invalid_fee_schedule')
 const values=fees.map((f:Data)=>{const code=text(f.code,'cpt',5);insist(/^(?:\d{4}[\dA-Z]|[A-Z]\d{4})$/.test(code),'invalid_cpt');return {code,cents:integer(f.cents,'fee_cents',1)}})
 insist(new Set(values.map(f=>f.code)).size===values.length,'duplicate_fee_code')
 const key=id()
 await commit(db,who,[guard(db,'EXISTS(SELECT 1 FROM bm_payers WHERE id=? AND (medicare=0 OR ?=\'cms\'))',payer,method),
 stmt(db,'INSERT INTO bm_billing_schedules(id,payer_id,plan_name,effective_on,kind,unit_method,fixed_unit_minutes,fees,source,recorded_by,recorded_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)',key,payer,plan,date,kind,method,fixed,JSON.stringify(values),text(input.source,'contract_source',2000),who.email,now()),
 stmt(db,'UPDATE bm_payers SET version=version+1 WHERE id=?',payer),audit(db,who,'insurance.billing_schedule_recorded',null,key)])
 return {id:key}
}
export async function saveProviderLicense(db:D1Database,who:Actor,input:Data){
 insist(who.role==='owner','only_the_owner_can_record_provider_licenses',403)
 const key=id(),staff=text(input.practitionerId,'practitioner',100),start=day(input.startsOn,'starts_on'),end=day(input.endsOn,'ends_on');insist(end>=start,'license_end_precedes_start')
 await commit(db,who,[guard(db,"EXISTS(SELECT 1 FROM bm_staff WHERE id=? AND role='practitioner' AND erased_at IS NULL)",staff),
 stmt(db,'INSERT INTO bm_provider_licenses(id,practitioner_id,state,number,starts_on,ends_on,source,recorded_by,recorded_at) VALUES(?,?,?,?,?,?,?,?,?)',key,staff,stateCode(input.state),text(input.number,'license_number',100),start,end,text(input.source,'license_source',2000),who.email,now()),audit(db,who,'insurance.provider_license_recorded',null,key)])
 return {id:key}
}
/** Bulk authorization/daily-close accounting resolves each visit independently. */
export async function attachBillingSchedules(db:D1Database,auths:Data[]){
 const [schedules,policies]=await Promise.all([rows(db,'SELECT * FROM bm_billing_schedules'),rows(db,'SELECT id,payer_id,plan_name FROM bm_policies')])
 return auths.map(a=>({...a,billingSchedules:schedules,billingPolicy:policies.find(p=>p.id===a.policy_id)}))
}
