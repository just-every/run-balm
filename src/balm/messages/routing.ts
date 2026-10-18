import { guard, insist, one, practitionerId, rows, text, type Actor, type Data } from '../domain/model'

export interface Destination { route: 'practitioner' | 'front_desk'; practitionerId: string | null }
export const clinicalStaff = (who: Actor) => who.role === 'owner' || who.staffRole === 'practitioner'
export const destinationFields = (d: Destination) => [d.route, d.practitionerId]
export const destinationGuard = (db: D1Database, clientId: string, d: Destination) => guard(db,
  `?='front_desk' OR ? IS NULL OR EXISTS(SELECT 1 FROM bm_staff s JOIN bm_appointments a ON a.practitioner_id=s.id WHERE a.client_id=? AND s.id=? AND s.active=1 AND s.erased_at IS NULL AND s.role='practitioner')`,
  d.route, d.practitionerId, clientId, d.practitionerId)

/** Appointment membership is the source of truth for patient recipient choices. */
export const recipients = (db: D1Database, clientId: string) => rows<{ id: string; name: string }>(db,
  `SELECT s.id,s.name FROM bm_staff s WHERE s.role='practitioner' AND s.active=1 AND s.erased_at IS NULL
   AND EXISTS(SELECT 1 FROM bm_appointments a WHERE a.client_id=? AND a.practitioner_id=s.id) ORDER BY s.name`, clientId)

export async function destination(db: D1Database, clientId: string, input: Data, who?: Actor): Promise<Destination> {
  // A combined selector keeps native multipart forms simple; JSON may use the named fields.
  const recipient = input.recipient === undefined ? null : text(input.recipient, 'recipient', 100)
  const route = recipient === 'front_desk' ? 'front_desk' : input.route ?? 'practitioner'
  insist(route === 'practitioner' || route === 'front_desk', 'choose_a_message_recipient')
  insist(!who || who.role === 'owner' || (route === 'front_desk' ? who.staffRole === 'reception' : who.staffRole === 'practitioner'), 'clinical_messages_are_private', 403)
  if (route === 'front_desk') return { route, practitionerId: null }
  const choices = await recipients(db, clientId)
  const key = recipient ?? input.practitionerId ?? practitionerId(who ?? {} as Actor) ?? choices[0]?.id ?? null
  if (key !== null) {
    insist(typeof key === 'string' && choices.some(c => c.id === key), 'message_recipient_not_found', 404)
    insist(!who || who.role === 'owner' || practitionerId(who) === key, 'message_recipient_not_found', 404)
  }
  return { route, practitionerId: key }
}

/** Filters run in SQL before any content or attachment metadata is returned. */
export function staffScope(who: Actor, alias = 'm') {
  if (who.role === 'owner') return { sql: '1=1', values: [] as unknown[] }
  if (who.staffRole === 'reception') return { sql: `${alias}.route='front_desk'`, values: [] as unknown[] }
  return { sql: `${alias}.route='practitioner' AND (${alias}.practitioner_id IS NULL OR ${alias}.practitioner_id=?)`, values: [practitionerId(who) ?? ''] as unknown[] }
}

export async function messageDestination(db: D1Database, who: Actor, clientId: string, key: unknown): Promise<Destination> {
  const scope = staffScope(who)
  const message = await one<{ route: Destination['route']; practitionerId: string | null }>(db,
    `SELECT m.route,m.practitioner_id AS practitionerId FROM bm_messages m WHERE m.id=? AND m.client_id=? AND (${scope.sql})`, text(key, 'message', 100), clientId, ...scope.values)
  insist(message, 'message_not_found', 404)
  return message
}
