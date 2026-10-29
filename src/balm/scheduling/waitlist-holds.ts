import { guard, rows, type Data } from '../domain/model'

// Archived recipients have no authority, so historical offers cannot reserve a
// time or restart outbound messages after a restore. Removal releases a turn.
const active = `o.status='open' AND o.ordered=1 AND o.hold_until>strftime('%Y-%m-%dT%H:%M:%fZ','now')
 AND EXISTS(SELECT 1 FROM bm_offer_recipients r JOIN bm_waitlist w ON w.id=r.entry_id JOIN bm_clients c ON c.id=w.client_id
 WHERE r.offer_id=o.id AND r.entry_id=o.active_entry_id AND r.offer_authority=1 AND r.outcome IS NULL AND w.status='waiting' AND c.erased_at IS NULL)`

export function waitlistHoldGuard(db: D1Database, v: Data) {
 return guard(db, `NOT EXISTS(SELECT 1 FROM bm_offers o WHERE ${active} AND o.id<>? AND o.start_at<? AND o.hold_end_at>?
 AND (o.practitioner_id=? OR (? IS NOT NULL AND o.room_id=?)))`, v.offerId??'',v.endAt,v.startAt,v.practitionerId,v.roomId??null,v.roomId??null)
}
export async function waitlistHolds(db: D1Database, practitioner: string | null, room: string | null = null, except = '') {
 return rows(db, `SELECT o.id,o.start_at,o.hold_end_at AS end_at FROM bm_offers o WHERE ${active} AND o.id<>?
 AND (o.practitioner_id=? OR (? IS NOT NULL AND o.room_id=?))`,except,practitioner,room,room)
}
