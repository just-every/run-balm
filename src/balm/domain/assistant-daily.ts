import {audit,commit,day,guard,human,id,insist,need,now,one,practitionerId,rows,sha256,stmt,text,type Actor,type Data} from './model'
import {licensedSql,submissionContext} from './supervision'
import {hostDateAt} from '../availability/timezone'

export async function dailyRules(db:D1Database,who:Actor){
 if(who.role!=='owner'&&who.staffKind!=='assistant')return []
 return rows(db,`SELECT r.* FROM bm_assistant_daily_rules r WHERE (?=1 OR r.staff_id=?) AND NOT EXISTS(SELECT 1 FROM bm_assistant_daily_revocations v WHERE v.rule_id=r.id) ORDER BY r.recorded_at,r.id`,who.role==='owner'?1:0,who.staffId??'')
}
export async function dailyRuleCommand(db:D1Database,who:Actor,name:string,input:Data){
 human(who);need(who,'owner')
 if(name==='assistant_daily.revoke'){
  const key=text(input.id,'rule',100)
  await commit(db,who,[stmt(db,'INSERT INTO bm_assistant_daily_revocations(rule_id,revoked_at,revoked_by) VALUES(?,?,?)',key,now(),who.email),audit(db,who,'supervision.daily_rule_revoked',null,key)])
  return {revoked:true}
 }
 insist(input.attest===true||input.attest==='on','confirm_both_state_and_payer_allow_assistant_daily_signing')
 const staffId=text(input.staffId,'assistant',100),state=text(input.state,'state',2).toUpperCase(),payerId=input.payerId?text(input.payerId,'payer',100):null
 insist(/^[A-Z]{2}$/.test(state),'record_the_state_abbreviation')
 const starts=day(input.startsOn,'rule_starts'),ends=day(input.endsOn,'rule_ends');insist(ends>=starts,'invalid_rule_date_range')
 const stateSource=text(input.stateSource,'state_rule_source',1000),payerSource=text(input.payerSource,'payer_rule_source',1000),key=id()
 await commit(db,who,[guard(db,"EXISTS(SELECT 1 FROM bm_staff_access a JOIN bm_staff s ON s.id=a.staff_id WHERE s.id=? AND a.kind='assistant' AND s.active=1 AND s.discipline<>'')",staffId),...(payerId?[guard(db,'EXISTS(SELECT 1 FROM bm_payers WHERE id=?)',payerId)]:[]),stmt(db,'INSERT INTO bm_assistant_daily_rules(id,staff_id,state,payer_id,starts_on,ends_on,state_source,payer_source,recorded_at,recorded_by) VALUES(?,?,?,?,?,?,?,?,?,?)',key,staffId,state,payerId,starts,ends,stateSource,payerSource,now(),who.email),audit(db,who,'supervision.daily_rule_recorded',null,key)])
 return {id:key}
}
/** Clinical signature permission is separate from rendering and supervision/billability rules. */
export async function dailySignature(db:D1Database,who:Actor,note:Data,input:Data,payerId:string|null){
 insist(who.staffKind==='assistant','assistant_daily_rule_required',403)
 const rule=await one(db,`SELECT r.* FROM bm_assistant_daily_rules r WHERE r.id=? AND r.staff_id=? AND NOT EXISTS(SELECT 1 FROM bm_assistant_daily_revocations v WHERE v.rule_id=r.id)`,text(input.ruleId,'daily_rule',100),who.staffId)
 insist(rule&&rule.payer_id===payerId,'recorded_state_and_current_payer_daily_rule_required',403)
 const visit=await one(db,'SELECT a.start_at,s.time_zone FROM bm_appointments a JOIN bm_settings s ON s.id=1 WHERE a.id=?',note.appointment_id)
 insist(visit,'assistant_daily_signing_requires_a_visit',409)
 const on=hostDateAt(new Date(visit.start_at),visit.time_zone)
 insist(rule.starts_on<=on&&rule.ends_on>=on,'daily_signing_rule_does_not_cover_the_visit',403)
 insist(who.supervisorId&&await one(db,'SELECT 1 WHERE '+licensedSql,who.supervisorId,who.staffId),'active_same_discipline_supervisor_required',409)
 const context=await submissionContext(db,note,input)
 return [guard(db,'EXISTS(SELECT 1 FROM bm_assistant_daily_rules r WHERE r.id=? AND NOT EXISTS(SELECT 1 FROM bm_assistant_daily_revocations v WHERE v.rule_id=r.id))',rule.id),guard(db,licensedSql,who.supervisorId,who.staffId),
 guard(db,'NOT EXISTS(SELECT 1 FROM bm_note_submissions WHERE note_id=?)',note.id),stmt(db,'INSERT INTO bm_assistant_signed_notes(note_id,supervisor_id,rule_id,rule_snapshot,author_discipline,plan_id) VALUES(?,?,?,?,?,?)',note.id,who.supervisorId,rule.id,JSON.stringify(rule),(await one(db,'SELECT discipline FROM bm_staff WHERE id=?',who.staffId))!.discipline,context.planId)]
}
export async function attestAssistantSupervision(db:D1Database,who:Actor,input:Data){
 human(who)
 const note=await one(db,`SELECT n.*,s.supervisor_id FROM bm_assistant_signed_notes s JOIN bm_notes n ON n.id=s.note_id WHERE n.id=?`,text(input.id,'note',100))
 insist(note&&note.supervisor_id===practitionerId(who)&&await one(db,'SELECT 1 WHERE '+licensedSql,who.staffId,note.author_id),'supervision_not_found',404)
 const staff=(await one(db,'SELECT name,credentials FROM bm_staff WHERE id=?',who.staffId))!
 insist(text(input.signature,'signature',160).trim().toLowerCase()===staff.name.trim().toLowerCase(),'type_your_full_name_as_it_appears_on_your_staff_record')
 const credentials=text(input.credentials||staff.credentials,'credentials',60),given=text(input.supervisionGiven,'supervision_given',20)
 insist(['in_room','on_site','general'].includes(given),'record_the_supervision_given')
 insist(input.attest===true||input.attest==='on','confirm_the_supervision_given')
 const at=now(),digest=await sha256(JSON.stringify({note:note.id,noteDigest:note.signed_sha256,supervisor:staff.name,credentials,supervisionGiven:given,at}))
 await commit(db,who,[guard(db,licensedSql,who.staffId,note.author_id),stmt(db,'INSERT INTO bm_assistant_supervision(note_id,supervision_given,supervisor_name,supervisor_credentials,attested_at,sha256) VALUES(?,?,?,?,?,?)',note.id,given,staff.name,credentials,at,digest),audit(db,who,'supervision.assistant_attested',note.client_id,note.id)])
 return {id:note.id,sha256:digest}
}
