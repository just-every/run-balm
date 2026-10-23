import { noteAccess } from '../domain/care-team'
import { audit, commit, guard, one, practitionerId, rows, type Actor, type Data } from '../domain/model'
import { emptyClinical, type Clinical, type Flow } from './clinical-input'
import { noteTemplate } from './template-catalog'
import type { Template } from './templates'

/** Read only entitled, signed, earlier care in the visit's explicit episode and discipline. */
export async function carryForward(db: D1Database, who: Actor, clientId: string, appointmentId: string | null, t: Template) {
  const blank = { sections: {} as Record<string,string>, clinical: emptyClinical(), guards: [] as D1PreparedStatement[] }
  if (!appointmentId) return blank
  const target = await one(db, `SELECT a.start_at,r.episode_id FROM bm_appointments a LEFT JOIN bm_episode_records r ON r.record_kind='visit' AND r.record_id=a.id WHERE a.id=? AND a.client_id=?`, appointmentId, clientId)
  if (!target?.episode_id) return blank
  const access = await noteAccess(db, who, clientId)
  const candidates = await rows(db, `SELECT n.*,v.start_at,r.sections,r.clinical FROM bm_notes n JOIN bm_appointments v ON v.id=n.appointment_id JOIN bm_episode_records e ON e.record_kind='visit' AND e.record_id=v.id JOIN bm_note_revisions r ON r.note_id=n.id AND r.number=n.signed_revision WHERE n.client_id=? AND n.signed_at IS NOT NULL AND e.episode_id=? AND v.start_at<? AND (? OR n.author_id=?) ORDER BY v.start_at DESC,n.signed_at DESC,n.id`, clientId, target.episode_id, target.start_at, access.all ? 1 : 0, practitionerId(who) ?? '')
  const previous = candidates.find(n => noteTemplate(n)?.discipline === t.discipline)
  if (!previous) return blank
  const sections = Object.fromEntries((JSON.parse(previous.sections ?? '[]') as Data[]).filter(s => ['diagnosis','goals','plan','frequency','duration','planned_interventions'].includes(s.id)).map(s => [s.id,s.text])) as Record<string,string>
  const clinical: Clinical = previous.clinical ? JSON.parse(previous.clinical) : emptyClinical()
  const sourceMeasures = await rows(db, "SELECT kind,name,side,value,unit,sets,reps FROM bm_measures WHERE note_id=? AND kind='flowsheet' ORDER BY recorded_at,id", previous.id)
  const values = new Map<string,Flow>()
  for (const flow of [...clinical.flowsheet, ...sourceMeasures as Flow[]]) values.set([flow.kind,flow.name.toLowerCase(),flow.side,flow.unit].join('|'), flow)
  clinical.flowsheet = [...values.values()]; clinical.sourceNoteId = previous.id
  const guards = [
    guard(db, 'EXISTS(SELECT 1 FROM bm_clients WHERE id=? AND erased_at IS NULL)', clientId),
    guard(db, `EXISTS(SELECT 1 FROM bm_episode_records WHERE record_kind='visit' AND record_id=? AND episode_id=?) AND EXISTS(SELECT 1 FROM bm_episode_records WHERE record_kind='visit' AND record_id=? AND episode_id=?)`, appointmentId,target.episode_id,previous.appointment_id,target.episode_id),
    guard(db, `?='owner' OR ?=? OR EXISTS(SELECT 1 FROM bm_care_grants WHERE client_id=? AND practitioner_id=? AND revoked_at IS NULL) OR EXISTS(SELECT 1 FROM bm_break_glass WHERE client_id=? AND practitioner_id=? AND ended_at IS NULL AND expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now'))`, who.role, previous.author_id, practitionerId(who) ?? '', clientId,practitionerId(who) ?? '',clientId,practitionerId(who) ?? ''),
  ]
  await commit(db, who, [...guards, audit(db, who, access.breakGlass ? 'note.break_glass_read' : 'note.carry_forward_read', clientId, previous.id, access.breakGlass ? 'carry forward under break glass' : '')])
  return { sections, clinical, guards }
}
