import type { Bindings } from '../../auth.server'
import { audit, commit, now, one, rows, stmt, type Actor } from '../domain/model'
import { clientAuthority, messageActor, messageClient } from './access'
import { patientActor, patientGuard, patientLink } from './links'

export interface SecureMessage {
  id: string; sender: 'clinic' | 'patient'; authorName: string; body: string; sentAt: string
  notification: 'pending' | 'sent' | 'shown' | 'no_email' | 'mail_unavailable'
}
export interface MessageAccess {
  id: string; createdAt: string; expiresAt: string; revokedAt: string | null; openedAt: string | null
  delivery: 'email' | 'shown'; deliveryState: string; active: boolean
}
export interface MessageFile {
  clientId: string; messages: SecureMessage[]; access: MessageAccess[]
}
export const thread = (db: D1Database, clientId: string) => rows<SecureMessage>(db, `SELECT id,sender,author_name AS authorName,body,sent_at AS sentAt,
  notification_state AS notification FROM bm_messages WHERE client_id=? ORDER BY sequence`, clientId)

/** Reception and agent file views get no thread or access metadata. */
export async function messageFile(db: D1Database, who: Actor, clientId: string): Promise<MessageFile | null> {
  if (who.role === 'agent') return null
  // Resolve before deciding so a stale reception/practitioner claim grants nothing.
  const live = await messageActor(db, who).catch(error => {
    if (error.code === 'clinical_messages_are_private') return null
    throw error
  })
  if (!live) return null
  const client = await messageClient(db, live, clientId)
  const [messages, links] = await Promise.all([
    thread(db, clientId),
    rows<MessageAccess>(db, `SELECT id,created_at AS createdAt,expires_at AS expiresAt,revoked_at AS revokedAt,opened_at AS openedAt,
      delivery,delivery_state AS deliveryState FROM bm_message_links WHERE client_id=? ORDER BY created_at DESC LIMIT 20`, clientId),
  ])
  await commit(db, live, [clientAuthority(db, live, client.id as string), audit(db, live, 'message.thread_read', clientId, clientId, `messages ${messages.length}`),
    ...messages.map(m => audit(db, live, 'message.read', clientId, m.id)),
  ])
  return { clientId, messages, access: links.map(l => ({ ...l, active: !l.revokedAt && Date.parse(l.expiresAt) > Date.now() })) }
}

export async function patientMessages(env: Bindings, token: string) {
  const db = env.DB, link = await patientLink(db, token)
  const [messages, clinic] = await Promise.all([thread(db, link.client_id), one<{ clinic_name: string; time_zone: string }>(db, 'SELECT clinic_name,time_zone FROM bm_settings WHERE id=1')])
  await commit(db, null, [patientGuard(db, link), stmt(db, 'UPDATE bm_message_links SET opened_at=? WHERE id=?', now(), link.id),
    audit(db, patientActor, 'message.thread_read', link.client_id, link.id, `messages ${messages.length}`),
    ...messages.map(m => audit(db, patientActor, 'message.read', link.client_id, m.id)),
  ])
  return { token, clinic: clinic!, expiresAt: link.expires_at,
    messages: messages.map(({ notification, ...message }) => message) }
}
