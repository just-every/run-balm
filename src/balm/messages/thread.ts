import type { Bindings } from '../../auth.server'
import { audit, commit, now, one, rows, stmt, type Actor } from '../domain/model'
import { clientAuthority, messageActor, messageClient } from './access'
import type { MessageAttachment } from './attachments'
import { patientActor, patientGuard, patientLink } from './links'
import { recipients, staffScope, type Destination } from './routing'

export interface SecureMessage {
  id: string; sender: 'clinic' | 'patient'; authorName: string; body: string; sentAt: string
  route: Destination['route']; practitionerId: string | null; recipientName: string | null; replyTo: string | null; automated: boolean
  attachments: MessageAttachment[]
  notification: 'pending' | 'sent' | 'shown' | 'no_email' | 'mail_unavailable'
}
export interface MessageAccess {
  id: string; createdAt: string; expiresAt: string; revokedAt: string | null; openedAt: string | null
  delivery: 'email' | 'shown'; deliveryState: string; active: boolean; route: Destination['route']; practitionerId: string | null
}
export interface MessageFile {
  clientId: string; messages: SecureMessage[]; access: MessageAccess[]; recipients: { id: string; name: string }[]
}
export async function thread(db: D1Database, clientId: string, scope = { sql: '1=1', values: [] as unknown[] }) {
  const messages = await rows<SecureMessage>(db, `SELECT m.id,m.sender,m.author_name AS authorName,m.body,m.sent_at AS sentAt,
    m.notification_state AS notification,m.route,m.practitioner_id AS practitionerId,s.name AS recipientName,m.reply_to AS replyTo,m.automated
    FROM bm_messages m LEFT JOIN bm_staff s ON s.id=m.practitioner_id WHERE m.client_id=? AND (${scope.sql}) ORDER BY m.sequence`, clientId, ...scope.values)
  const files = await rows<MessageAttachment & { messageId: string }>(db, `SELECT f.id,f.message_id AS messageId,f.filename,f.mime,f.byte_length AS byteLength
    FROM bm_message_attachments f JOIN bm_messages m ON m.id=f.message_id WHERE m.client_id=? AND (${scope.sql}) ORDER BY f.rowid`, clientId, ...scope.values)
  return messages.map(m => ({ ...m, automated: Boolean(m.automated), attachments: files.filter(f => f.messageId === m.id).map(({ messageId, ...f }) => f) }))
}

/** Reception gets only the front desk conversation; clinicians get their own destinations. */
export async function messageFile(db: D1Database, who: Actor, clientId: string): Promise<MessageFile | null> {
  if (who.role === 'agent') return null
  const live = await messageActor(db, who), client = await messageClient(db, live, clientId), scope = staffScope(live)
  const linkScope = staffScope(live, 'l')
  const [messages, links, choices] = await Promise.all([
    thread(db, clientId, scope),
    rows<MessageAccess>(db, `SELECT l.id,l.created_at AS createdAt,l.expires_at AS expiresAt,l.revoked_at AS revokedAt,l.opened_at AS openedAt,
      l.delivery,l.delivery_state AS deliveryState,l.route,l.practitioner_id AS practitionerId FROM bm_message_links l WHERE l.client_id=? AND (${linkScope.sql}) ORDER BY l.created_at DESC LIMIT 20`, clientId, ...linkScope.values),
    recipients(db, clientId),
  ])
  await commit(db, live, [clientAuthority(db, live, client.id as string), audit(db, live, 'message.thread_read', clientId, clientId, `messages ${messages.length}`),
    ...messages.map(m => audit(db, live, 'message.read', clientId, m.id)),
  ])
  return { clientId, messages, recipients: choices.filter(c => live.role === 'owner' || c.id === live.staffId), access: links.map(l => ({ ...l, active: !l.revokedAt && Date.parse(l.expiresAt) > Date.now() })) }
}

export async function patientMessages(env: Bindings, token: string) {
  const db = env.DB, link = await patientLink(db, token)
  const [messages, clinic] = await Promise.all([thread(db, link.client_id, { sql: 'm.route=? AND (m.practitioner_id IS ? OR (? IS NOT NULL AND m.practitioner_id IS NULL))', values: [link.route, link.practitioner_id, link.practitioner_id] }), one<{ clinic_name: string; time_zone: string }>(db, 'SELECT clinic_name,time_zone FROM bm_settings WHERE id=1')])
  await commit(db, null, [patientGuard(db, link), stmt(db, 'UPDATE bm_message_links SET opened_at=? WHERE id=?', now(), link.id),
    audit(db, patientActor, 'message.thread_read', link.client_id, link.id, `messages ${messages.length}`),
    ...messages.map(m => audit(db, patientActor, 'message.read', link.client_id, m.id)),
  ])
  return { token, clinic: clinic!, expiresAt: link.expires_at, route: link.route,
    messages: messages.map(({ notification, ...message }) => message) }
}
