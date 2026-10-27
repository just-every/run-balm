import { audit, commit, guard, insist, one, practitionerId, rows, type Actor, type Data } from '../domain/model'
import { mailHistorySql } from '../mail/history'
import { clientAuthority, messageActor, messageClient } from './access'
import { staffScope } from './routing'

export const historyAllowed = (who: Actor) => who.role === 'owner' || !who.staffKind || ['practitioner','reception','supervisor'].includes(who.staffKind)

/** Authorization precedes both matching and counting; queries never enter the audit. */
export async function communicationHistory(db: D1Database, who: Actor, clientId: string, input: Data = {}) {
  insist(historyAllowed(who), 'communication_history_is_private', 403)
  const live = await messageActor(db, who)
  insist(historyAllowed(live), 'communication_history_is_private', 403)
  const client = await messageClient(db, live, clientId)
  const query = String(input.communicationQuery ?? '').trim()
  insist(query.length <= 200 && !/[\u0000-\u001f\u007f]/.test(query), 'invalid_communication_query')
  const channel = String(input.communicationChannel ?? '')
  insist(['','call','email','secure_message'].includes(channel), 'invalid_communication_channel')
  const scope = staffScope(live)
  const appointments = (await rows(db, `SELECT id FROM bm_appointments WHERE client_id=? AND (?='owner' OR ?='reception' OR practitioner_id=?)`, client.id, live.role, live.staffRole ?? '', practitionerId(live) ?? '')).map(a => a.id)
  const sql = `WITH authorized AS (
    SELECT m.id,'call' AS channel,m.direction,m.occurred_at AS at,m.staff_name AS staff,m.disposition AS text,'manually_logged' AS state,m.route,m.practitioner_id AS practitionerId
      FROM bm_calls m WHERE m.client_id=? AND (${scope.sql})
    UNION ALL
    SELECT m.id,'secure_message',CASE WHEN m.sender='patient' THEN 'incoming' ELSE 'outgoing' END,m.sent_at,m.author_name,m.body,
      CASE WHEN m.sender='patient' THEN 'received_in_balm' ELSE 'saved_in_balm; notice '||m.notification_state END,m.route,m.practitioner_id
      FROM bm_messages m WHERE m.client_id=? AND (${scope.sql})
    UNION ALL
    SELECT id,'email','outgoing',created_at,'Clinic',kind||' '||provider,COALESCE(delivery_state,state),NULL,NULL FROM (${mailHistorySql})
  ), matched AS (SELECT * FROM authorized WHERE (?='' OR channel=?) AND instr(lower(text||' '||staff||' '||direction||' '||state||' '||at),lower(?))>0)`
  const args = [client.id,...scope.values,client.id,...scope.values,client.id,JSON.stringify(appointments),channel,channel,query]
  const results = await rows(db, sql + ' SELECT * FROM matched ORDER BY at DESC,channel,id LIMIT 50', ...args)
  const count = await one(db, sql + ' SELECT COUNT(*) AS n FROM matched', ...args)
  await commit(db, live, [clientAuthority(db, live, client.id as string),
    guard(db, `NOT EXISTS(SELECT 1 FROM bm_appointments WHERE id IN (SELECT value FROM json_each(?)) AND (client_id<>? OR (?<>'owner' AND ?<>'reception' AND practitioner_id<>?)))`, JSON.stringify(appointments),client.id,live.role,live.staffRole ?? '',practitionerId(live) ?? ''),
    audit(db, live, 'communication.searched', clientId, clientId, `results ${count!.n}`),
    ...results.map(r => audit(db, live, 'communication.' + r.channel + '_read', clientId, r.id as string)),
  ])
  return { query, channel, total: Number(count!.n), results, limit: 50 }
}
