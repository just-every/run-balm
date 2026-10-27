import { wallClockInstants } from '../availability/timezone'
import { audit, commit, day, id, insist, now, one, stmt, text, type Actor, type Data } from '../domain/model'
import { clientAuthority, messageActor, messageClient } from './access'
import { historyAllowed } from './history'
import { destination, destinationFields, destinationGuard } from './routing'

/** A manual record grants no transport or recording authority. */
export async function logCall(db: D1Database, who: Actor, input: Data) {
  const live = await messageActor(db, who)
  insist(historyAllowed(live), 'communication_history_is_private', 403)
  const client = await messageClient(db, live, input.clientId)
  const target = await destination(db, client.id as string, input, live)
  insist(input.direction === 'incoming' || input.direction === 'outgoing', 'choose_call_direction')
  const raw = text(input.occurredAt, 'call_time', 40)
  let instant: Date
  if (/^\d{4}-\d\d-\d\dT\d\d:\d\d$/.test(raw)) {
    const date = day(raw.slice(0,10), 'call_date'), hour = Number(raw.slice(11,13)), minute = Number(raw.slice(14,16))
    insist(hour < 24 && minute < 60, 'invalid_call_time')
    const zone = (await one(db, 'SELECT time_zone FROM bm_settings WHERE id=1'))!.time_zone as string
    const choices = wallClockInstants(date, hour * 60 + minute, zone)
    insist(choices.length === 1, 'call_time_needs_an_unambiguous_offset')
    instant = choices[0]
  } else {
    insist(/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{3})?(?:Z|[+-]\d\d:\d\d)$/.test(raw), 'invalid_call_time')
    day(raw.slice(0,10), 'call_date')
    instant = new Date(raw)
  }
  insist(Number.isFinite(instant.getTime()) && instant.getTime() <= Date.now(), 'call_time_must_be_in_the_past')
  const disposition = text(input.disposition, 'call_disposition', 500)
  const author = live.staffId ? await one(db, 'SELECT name FROM bm_staff WHERE id=?', live.staffId) : await one(db, 'SELECT display_name AS name FROM oa_operators WHERE id=?', live.id)
  const callId = id(), recordedAt = now()
  await commit(db, live, [clientAuthority(db, live, client.id as string), destinationGuard(db, client.id as string, target),
    stmt(db, `INSERT INTO bm_calls(id,client_id,direction,occurred_at,staff_id,staff_name,recorded_by,recorded_at,disposition,route,practitioner_id)
      VALUES(?,?,?,?,?,?,?,?,?,?,?)`, callId, client.id, input.direction, instant.toISOString(), live.staffId ?? null, author?.name ?? 'Clinic owner', live.email, recordedAt, disposition, ...destinationFields(target)),
    audit(db, live, 'call.logged', client.id as string, callId),
  ])
  return { id: callId, clientId: client.id }
}
