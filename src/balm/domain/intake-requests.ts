import { now,one,stmt } from './model'
import { currentForm } from './intake'
import { chosenFormSql } from '../intake/outcomes'
export type IntakeRequest='ask'|'past'|'on_file'|'link_open'
export async function intakeAsk(db:D1Database,clientId:string,startAt:string,booked:string[]):Promise<IntakeRequest>{
 if(Date.parse(startAt)<=Date.now())return 'past'
 const visit=await one(db,'SELECT service_id FROM bm_appointments WHERE id=?',booked[0]??''),form=await currentForm(db,visit?.service_id)
 if(await one(db,'SELECT 1 FROM bm_intake_responses WHERE client_id=? AND form_id=?',clientId,form.id))return 'on_file'
 const open=await one(db,`SELECT 1 FROM bm_appointments a WHERE a.client_id=? AND a.status='booked' AND a.end_at>? AND a.intake_token_hash IS NOT NULL AND a.id NOT IN (SELECT value FROM json_each(?)) AND NOT EXISTS(SELECT 1 FROM bm_intake_responses r WHERE r.appointment_id=a.id) AND ${chosenFormSql('a.service_id')}=?`,clientId,now(),JSON.stringify(booked),form.id)
 return open?'link_open':'ask'
}
export function allocateIntake(db:D1Database,appointmentId:string,clientId:string,startAt:string,hash:string){
 const at=now()
 return stmt(db,`UPDATE bm_appointments AS target SET intake_token_hash=CASE WHEN ?>?
 AND NOT EXISTS(SELECT 1 FROM bm_intake_responses r WHERE r.client_id=target.client_id AND r.form_id=${chosenFormSql('target.service_id')})
 AND NOT EXISTS(SELECT 1 FROM bm_appointments a WHERE a.client_id=target.client_id AND a.id<>target.id AND a.status='booked' AND a.end_at>? AND a.intake_token_hash IS NOT NULL AND NOT EXISTS(SELECT 1 FROM bm_intake_responses r WHERE r.appointment_id=a.id) AND ${chosenFormSql('a.service_id')}=${chosenFormSql('target.service_id')})
 THEN ? ELSE NULL END WHERE id=?`,startAt,at,at,hash,appointmentId)
}
export async function bookedIntake(db:D1Database,clientId:string,appointmentId:string,startAt:string,booked:string[]):Promise<IntakeRequest>{
 if((await one(db,'SELECT intake_token_hash FROM bm_appointments WHERE id=?',appointmentId))?.intake_token_hash)return 'ask'
 return intakeAsk(db,clientId,startAt,booked)
}
