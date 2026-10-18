import { actor, guard, human, insist, one, practitionerId, text, type Actor } from '../domain/model'

/** Resolve again here: callers cannot promote a stale or fabricated actor. */
export async function messageActor(db: D1Database, who: Actor) {
  human(who)
  const live = await actor(db, who.id)
  insist(live.role === 'owner' || live.staffRole === 'practitioner' || live.staffRole === 'reception', 'clinical_messages_are_private', 403)
  return live
}

/** An appointment is the clinic's existing treating-practitioner assignment. */
export function clientAuthority(db: D1Database, who: Actor, clientId: string) {
  return guard(db, `EXISTS(SELECT 1 FROM bm_clients c WHERE c.id=? AND c.erased_at IS NULL
    AND (?='owner' OR ?='reception' OR EXISTS(SELECT 1 FROM bm_appointments a WHERE a.client_id=c.id AND a.practitioner_id=?)))`,
  clientId, who.role, who.staffRole ?? '', practitionerId(who) ?? '')
}

export async function messageClient(db: D1Database, who: Actor, key: unknown) {
  const client = await one(db, `SELECT c.id,c.email,c.version FROM bm_clients c WHERE c.id=? AND c.erased_at IS NULL
    AND (?='owner' OR ?='reception' OR EXISTS(SELECT 1 FROM bm_appointments a WHERE a.client_id=c.id AND a.practitioner_id=?))`,
  text(key, 'client', 100), who.role, who.staffRole ?? '', practitionerId(who) ?? '')
  insist(client, 'client_not_found', 404)
  return client
}
