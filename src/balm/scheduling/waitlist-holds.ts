import { guard, rows, type Data } from '../domain/model'

// Archived recipients have no authority, so historical offers cannot reserve a
// time or restart outbound messages after a restore. Removal releases a turn.
const active = `o.status='open' AND o.ordered=1 AND o.hold_until>strftime('%Y-%m-%dT%H:%M:%fZ','now')
 AND EXISTS(SELECT 1 FROM bm_offer_recipients r JOIN bm_waitlist w ON w.id=r.entry_id JOIN bm_clients c ON c.id=w.client_id
 WHERE r.offer_id=o.id AND r.entry_id=o.active_entry_id AND r.offer_authority=1 AND r.outcome IS NULL AND w.status='waiting' AND c.erased_at IS NULL)`

export function waitlistHoldGuard(db: D1Database, v: Data) {
 if(!v.offerId)return guard(db, `NOT EXISTS(SELECT 1 FROM bm_offers o WHERE ${active} AND o.start_at<? AND o.hold_end_at>?
 AND (o.practitioner_id=? OR (? IS NOT NULL AND o.room_id=?)))`,v.endAt,v.startAt,v.practitionerId,v.roomId??null,v.roomId??null)
 // An offer reserves one capacity place; another offer may reserve the next.
 // Other placing doors still leave active turns undisturbed, and rooms remain exclusive.
 return guard(db, `WITH held AS (
 SELECT o.id,o.practitioner_id,o.room_id,o.start_at,o.hold_end_at AS end_at,s.capacity,w.client_id
 FROM bm_offers o JOIN bm_waitlist w ON w.id=o.active_entry_id JOIN bm_services s ON s.id=w.service_id
 WHERE ${active} AND o.id<>?4), visits AS (
 SELECT a.start_at,a.end_at,s.capacity FROM bm_appointments a JOIN bm_services s ON s.id=a.service_id
 WHERE a.practitioner_id=?1 AND a.status IN ('booked','attended') AND a.id<>?7
 UNION ALL SELECT start_at,end_at,capacity FROM held WHERE practitioner_id=?1)
 SELECT NOT EXISTS(SELECT 1 FROM held WHERE start_at<?3 AND end_at>?2
 AND ((?6 IS NOT NULL AND room_id=?6) OR client_id=?8))
 AND NOT EXISTS(SELECT 1 FROM (SELECT ?2 AS t UNION SELECT start_at FROM visits WHERE start_at>?2 AND start_at<?3) p
 WHERE (SELECT COUNT(*) FROM visits WHERE start_at<=p.t AND end_at>p.t)+1>
 MIN((SELECT capacity FROM bm_staff WHERE id=?1),(SELECT capacity FROM bm_services WHERE id=?5),
 COALESCE((SELECT MIN(capacity) FROM visits WHERE start_at<=p.t AND end_at>p.t),10)))`,
 v.practitionerId,v.startAt,v.endAt,v.offerId??'',v.serviceId,v.roomId??null,v.except??'',v.clientId??null)
}
type HeldVisit = { id: string; practitioner_id: string; room_id: string | null; start_at: string; end_at: string; capacity: number; client_id: string }
export async function waitlistHolds(db: D1Database, practitioner: string | null, room: string | null = null, except = '') {
 return rows<HeldVisit>(db, `SELECT o.id,o.practitioner_id,o.room_id,o.start_at,o.hold_end_at AS end_at,s.capacity,w.client_id FROM bm_offers o JOIN bm_waitlist w ON w.id=o.active_entry_id JOIN bm_services s ON s.id=w.service_id WHERE ${active} AND o.id<>?
 AND (o.practitioner_id=? OR (? IS NOT NULL AND o.room_id=?))`,except,practitioner,room,room)
}
