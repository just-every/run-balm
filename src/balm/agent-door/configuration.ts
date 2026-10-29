import type { Bindings } from '../../auth.server.ts'
import { ToolRefusal, type ToolContext } from '../../modules/agent-door/index.ts'
import { need, one, rows } from '../domain/model.ts'
import { sponsor } from './native.ts'

export async function owner(env:Bindings,ctx:ToolContext) {
  const who=await sponsor(env,ctx)
  need(who,'owner')
  return who
}
const fields=['id','version','clinic_name','time_zone','tax_id_type','abn','address','practice_npi','street_address','city','state','postal_code','booking_open']
/** Only the explicit identity read and identity mutation inspect the full tax id. */
export async function clinic(env:Bindings,ctx:ToolContext) {
  await owner(env,ctx)
  const record=await one(env.DB,'SELECT '+fields.join(',')+' FROM bm_settings WHERE id=1')
  if(!record)throw new ToolRefusal('resource_unavailable')
  return record
}
/** A native configuration projection never loads appointments, patient files or full SSNs. */
export async function configuration(env:Bindings,ctx:ToolContext) {
  await owner(env,ctx)
  const projected=fields.map(field=>field==='abn'?"CASE WHEN tax_id_type='SSN' THEN '[restricted]' ELSE abn END AS abn":field)
  const [settings,services,staff,rooms,equipment,forms,drafts,hours]=await Promise.all([
    one(env.DB,'SELECT '+projected.join(',')+' FROM bm_settings WHERE id=1'),
    rows(env.DB,'SELECT * FROM bm_services ORDER BY name'),
    rows(env.DB,`SELECT s.*,COALESCE(a.kind,s.role) AS kind,a.supervisor_id,a.location_id FROM bm_staff s LEFT JOIN bm_staff_access a ON a.staff_id=s.id WHERE s.erased_at IS NULL ORDER BY s.name`),
    rows(env.DB,'SELECT * FROM bm_rooms ORDER BY name'),
    rows(env.DB,'SELECT * FROM bm_equipment ORDER BY name'),
    rows(env.DB,'SELECT * FROM bm_intake_forms ORDER BY number DESC'),
    rows(env.DB,"SELECT * FROM bm_drafts WHERE type='intake' ORDER BY prepared_at DESC LIMIT 200"),
    rows(env.DB,'SELECT practitioner_id,weekday,start_minute,end_minute FROM bm_hours ORDER BY practitioner_id,weekday,start_minute'),
  ])
  if(!settings)throw new ToolRefusal('resource_unavailable')
  return {settings,services,staff,rooms,equipment,forms:forms.map(form=>({...form,questions:JSON.parse(form.questions)})),drafts:drafts.map(draft=>({...draft,payload:JSON.parse(draft.payload)})),hours}
}
