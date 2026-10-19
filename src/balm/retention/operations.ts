import { stmt, type Data } from '../domain/model'

/** Only the dimensions already used by aggregate operational reports survive. */
export function preserveOperations(db:D1Database,clientId:string,anonymousGroup:string) {
  return [
    stmt(db,`INSERT INTO bm_destroyed_operations(id,anonymous_group,practitioner_id,service_id,service,start_at,end_at,status,episode_id)
      SELECT a.id,?,a.practitioner_id,a.service_id,s.name,a.start_at,a.end_at,a.status,(SELECT episode_id FROM bm_episode_records WHERE record_kind='visit' AND record_id=a.id)
      FROM bm_appointments a JOIN bm_services s ON s.id=a.service_id WHERE a.client_id=?`,anonymousGroup,clientId),
    stmt(db,`INSERT INTO bm_destroyed_evaluations(id,author_id,template,performed_at)
      SELECT n.id,n.author_id,n.template,COALESCE(a.start_at,n.signed_at) FROM bm_notes n LEFT JOIN bm_appointments a ON a.id=n.appointment_id
      WHERE n.client_id=? AND n.signed_at IS NOT NULL AND n.template LIKE '%.evaluation'`,clientId),
    stmt(db,`INSERT INTO bm_destroyed_plans(id,anonymous_group,author_id,start_date,per_week,weeks,episode_id)
      SELECT id,?,author_id,json_extract(content,'$.startDate'),json_extract(content,'$.frequencyPerWeek'),json_extract(content,'$.durationWeeks'),
      (SELECT episode_id FROM bm_episode_records WHERE record_kind='plan' AND record_id=bm_plans_of_care.id)
      FROM bm_plans_of_care WHERE client_id=?`,anonymousGroup,clientId),
  ]
}
export async function anonymousOperationalFacts(db:D1Database,range:Data) {
  const [visits,evaluations,plans,planVisits]=(await db.batch<Data>([
    stmt(db,`SELECT practitioner_id,service_id,service,start_at,end_at,status FROM bm_destroyed_operations
      WHERE julianday(start_at)>=julianday(?) AND julianday(start_at)<julianday(?) ORDER BY start_at,id`,range.start,range.end),
    stmt(db,`SELECT author_id,template FROM bm_destroyed_evaluations WHERE julianday(performed_at)>=julianday(?) AND julianday(performed_at)<julianday(?)`,range.start,range.end),
    // Episode plans come whole: an episode counts in the range its first plan starts in.
    stmt(db,`SELECT id,anonymous_group AS client_id,author_id,start_date,per_week,weeks,COALESCE(episode_id,'') AS episode_id FROM bm_destroyed_plans
      WHERE (episode_id IS NULL AND start_date BETWEEN ? AND ?) OR episode_id IS NOT NULL`,range.from,range.to),
    stmt(db,`SELECT anonymous_group AS client_id,practitioner_id,start_at,status,COALESCE(episode_id,'') AS episode_id FROM bm_destroyed_operations WHERE status IN ('attended','booked')
      AND (anonymous_group IN (SELECT anonymous_group FROM bm_destroyed_plans WHERE start_date BETWEEN ? AND ?) OR episode_id IN (SELECT episode_id FROM bm_destroyed_plans))`,range.from,range.to),
  ])).map(r=>r.results)
  return {visits,evaluations,plans,planVisits}
}
