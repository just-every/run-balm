import { intakeToken } from './booking'
import { audit, commit, guard, human, insist, now, one, practitionerId, rows, sha256, stmt, type Actor } from './model'

/** Each clinician controls only their own subscription. Bearer values are shown once. */
export async function feedState(db: D1Database, who: Actor) {
  const practitioner = practitionerId(who)
  if (!practitioner || who.role === 'agent') return null
  return { active: !!await one(db, 'SELECT 1 FROM bm_calendar_feeds WHERE practitioner_id=?', practitioner) }
}

export async function feedCommand(db: D1Database, who: Actor, name: string) {
  human(who)
  const practitioner = practitionerId(who)
  insist(practitioner, 'only_practitioners_manage_their_calendar_feed', 403)
  insist(name === 'calendar.feed.create' || name === 'calendar.feed.revoke', 'unknown_calendar_command')
  const token = name === 'calendar.feed.create' ? intakeToken() : null
  await commit(db, who, [
    guard(db, "EXISTS(SELECT 1 FROM bm_staff WHERE id=? AND role='practitioner' AND active=1 AND erased_at IS NULL)", practitioner),
    stmt(db, 'DELETE FROM bm_calendar_feeds WHERE practitioner_id=?', practitioner),
    ...(token ? [stmt(db, 'INSERT INTO bm_calendar_feeds(practitioner_id,token_hash,created_at) VALUES(?,?,?)', practitioner, await sha256(token), now())] : []),
    audit(db, who, token ? 'calendar.feed.created' : 'calendar.feed.revoked', null, practitioner),
  ])
  return token ? { calendarFeedPath: `/calendar/${token}.ics` } : { revoked: true }
}

const instant = (value: string) => new Date(value).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z')
const initial = (value: string) => [...value.trim()][0]?.match(/\p{L}|\p{N}/u)?.[0] ?? ''

/** Deliberate allowlist: no service, practitioner name, diagnosis, address or free text reaches a calendar app. */
export async function calendarFeed(db: D1Database, token: string) {
  const feed = await one(db, `SELECT f.practitioner_id FROM bm_calendar_feeds f JOIN bm_staff s ON s.id=f.practitioner_id
    JOIN oa_operators o ON lower(o.email)=lower(s.email)
    WHERE f.token_hash=? AND s.role='practitioner' AND s.active=1 AND s.erased_at IS NULL AND o.status='active'`, await sha256(token))
  insist(feed, 'calendar_feed_not_found', 404)
  const visits = await rows(db, `SELECT a.id,a.start_at,a.end_at,a.created_at,a.version,a.status,c.first_name,c.last_name
    FROM bm_appointments a JOIN bm_clients c ON c.id=a.client_id
    WHERE a.practitioner_id=? AND c.erased_at IS NULL ORDER BY a.start_at,a.id`, feed.practitioner_id)
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Balm//Private schedule//EN', 'CALSCALE:GREGORIAN']
  for (const visit of visits) lines.push('BEGIN:VEVENT', `UID:${visit.id}@balm`, `DTSTAMP:${instant(visit.created_at)}`,
    `DTSTART:${instant(visit.start_at)}`, `DTEND:${instant(visit.end_at)}`, `SEQUENCE:${visit.version}`,
    `SUMMARY:${initial(visit.first_name)}.${initial(visit.last_name)}.`,
    `STATUS:${['cancelled', 'no_show'].includes(visit.status) ? 'CANCELLED' : 'CONFIRMED'}`, 'END:VEVENT')
  lines.push('END:VCALENDAR')
  return new Response(lines.join('\r\n') + '\r\n', { headers: {
    'content-type': 'text/calendar; charset=utf-8', 'cache-control': 'no-store', 'referrer-policy': 'no-referrer',
    'x-content-type-options': 'nosniff', 'content-disposition': 'inline; filename="balm-schedule.ics"',
  } })
}
