import type { Bindings } from '../../auth.server'
import { runtimeBindings } from '../../auth.server'
import { audit, commit, guard, id, insist, now, one, sha256, stmt, type Actor, type Data } from '../domain/model'
import { send, type Delivery } from '../mail-out'
import { clientAuthority } from './access'

export const MESSAGE_LINK_DAYS = 7
export const patientActor = { email: 'patient-link', role: 'patient' }
export const messageUrl = (env: Bindings, value: string) => new URL('/messages/' + value, runtimeBindings(env).AUTH_ORIGIN).href

export async function newLink(clientId: string, who: Actor, delivery: unknown) {
  insist(delivery === undefined || delivery === 'email' || delivery === 'shown', 'invalid_delivery')
  const value = btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(32)))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
  return { id: id(), clientId, createdBy: who.email, token: value, hash: await sha256(value),
    createdAt: now(), expiresAt: new Date(Date.now() + MESSAGE_LINK_DAYS * 86400_000).toISOString(), delivery: delivery ?? 'email' }
}
export type NewLink = Awaited<ReturnType<typeof newLink>>

/** Rotation invalidates every earlier link in the same guarded batch. */
export function linkWrites(db: D1Database, link: NewLink) {
  return [
    stmt(db, 'UPDATE bm_message_links SET revoked_at=? WHERE client_id=? AND revoked_at IS NULL', link.createdAt, link.clientId),
    stmt(db, 'INSERT INTO bm_message_links(id,client_id,token_hash,created_by,created_at,expires_at,delivery,delivery_state) VALUES(?,?,?,?,?,?,?,?)',
      link.id, link.clientId, link.hash, link.createdBy, link.createdAt, link.expiresAt, link.delivery, link.delivery === 'shown' ? 'shown' : 'pending'),
  ]
}

/** The notice contains neither patient identity nor any clinical content. */
export async function notifyPatient(env: Bindings, to: string | null, link: NewLink, messageId: string | null) {
  const delivery: Delivery | 'shown' = link.delivery === 'shown' ? 'shown' : await send(env, to, 'You have a secure message',
    `Your clinic has made a secure message page available. Open your private page:\n${messageUrl(env, link.token)}\n\nThis private link expires in ${MESSAGE_LINK_DAYS} days. Keep it private and use the newest link from the clinic. Please do not reply to this email.`)
  const at = now()
  await commit(env.DB, null, [
    stmt(env.DB, 'UPDATE bm_message_links SET delivery_state=? WHERE id=?', delivery, link.id),
    ...(messageId ? [stmt(env.DB, 'UPDATE bm_messages SET notification_state=?,notified_at=? WHERE id=?', delivery, at, messageId)] : []),
    audit(env.DB, { email: 'clinic-mail', role: 'system' }, 'message.notification', link.clientId, messageId ?? link.id, delivery),
  ])
  return { linkId: link.id, expiresAt: link.expiresAt, delivery: link.delivery, mail: delivery,
    ...(link.delivery === 'shown' ? { url: messageUrl(env, link.token) } : {}) }
}

export async function revokeLinks(db: D1Database, who: Actor, client: Data) {
  const at = now()
  await commit(db, who, [clientAuthority(db, who, client.id as string),
    stmt(db, 'UPDATE bm_message_links SET revoked_at=? WHERE client_id=? AND revoked_at IS NULL', at, client.id),
    audit(db, who, 'message.link_revoked', client.id as string),
  ])
  return { clientId: client.id, revoked: true }
}

export type PatientLink = { id: string; client_id: string; expires_at: string }
export async function patientLink(db: D1Database, value: string): Promise<PatientLink> {
  insist(typeof value === 'string' && /^[\w-]{43}$/.test(value), 'message_link_not_available', 404)
  const link = await one<PatientLink>(db, `SELECT l.id,l.client_id,l.expires_at FROM bm_message_links l JOIN bm_clients c ON c.id=l.client_id
    WHERE l.token_hash=? AND l.revoked_at IS NULL AND l.expires_at>? AND c.erased_at IS NULL`, await sha256(value), now())
  insist(link, 'message_link_not_available', 404)
  return link
}
export const patientGuard = (db: D1Database, link: PatientLink) => guard(db, `EXISTS(SELECT 1 FROM bm_message_links l JOIN bm_clients c ON c.id=l.client_id
  WHERE l.id=? AND l.client_id=? AND l.revoked_at IS NULL AND l.expires_at>? AND c.erased_at IS NULL)`, link.id, link.client_id, now())
