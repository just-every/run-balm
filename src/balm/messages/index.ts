import type { Bindings } from '../../auth.server'
import { runtimeBindings } from '../../auth.server'
import { audit, commit, guard, id, insist, now, one, stmt, text, type Actor, type Data } from '../domain/model'
import { send } from '../mail-out'
import { clientAuthority, messageActor, messageClient } from './access'
import { linkWrites, newLink, notifyPatient, patientActor, patientGuard, patientLink, revokeLinks } from './links'

export { messageFile, patientMessages } from './thread'
export type { MessageFile, SecureMessage, MessageAccess } from './thread'

/** Native humans only; clinic commands cannot be prepared through agent keys. */
export async function messageCommand(env: Bindings, who: Actor, name: string, input: Data) {
  const db = env.DB, live = await messageActor(db, who)
  insist(['message.link', 'message.send', 'message.revoke'].includes(name), 'unknown_command', 404)
  const client = await messageClient(db, live, input.clientId)
  if (name === 'message.revoke') return revokeLinks(db, live, client)
  const body = name === 'message.send' ? text(input.body, 'message', 10000) : null
  const link = await newLink(client.id as string, live, input.delivery)
  if (link.delivery === 'email') insist(client.email, 'the_patient_has_no_email_address', 409)
  const messageId = body ? id() : null
  const author = live.staffId ? await one(db, 'SELECT name FROM bm_staff WHERE id=?', live.staffId) : null
  await commit(db, live, [clientAuthority(db, live, client.id as string),
    // Avoid delivering a private link to an email concurrently replaced on the file.
    guard(db, 'EXISTS(SELECT 1 FROM bm_clients WHERE id=? AND version=?)', client.id, client.version),
    ...linkWrites(db, link),
    ...(messageId ? [stmt(db, 'INSERT INTO bm_messages(id,client_id,sender,author_name,body,sent_at,notification_state) VALUES(?,?,?,?,?,?,?)',
      messageId, client.id, 'clinic', author?.name ?? 'Clinic', body, link.createdAt, link.delivery === 'shown' ? 'shown' : 'pending'),
    audit(db, live, 'message.sent', client.id as string, messageId)] : []),
    audit(db, live, 'message.link_rotated', client.id as string, link.id, link.delivery),
  ])
  return { clientId: client.id, messageId, ...await notifyPatient(env, client.email as string | null, link, messageId) }
}

/** A reply authenticates with the random credential, never with a posted client id. */
export async function patientSend(env: Bindings, token: string, input: Data) {
  const db = env.DB, link = await patientLink(db, token), body = text(input.body, 'message', 10000), messageId = id(), at = now()
  await commit(db, null, [patientGuard(db, link),
    stmt(db, 'INSERT INTO bm_messages(id,client_id,sender,author_name,body,sent_at,notification_state) VALUES(?,?,?,?,?,?,?)',
      messageId, link.client_id, 'patient', 'Patient', body, at, 'pending'),
    audit(db, patientActor, 'message.sent', link.client_id, messageId),
  ])
  const owner = await one<{ email: string }>(db, "SELECT email FROM oa_operators WHERE role='owner' AND status='active' ORDER BY id LIMIT 1")
  const mail = await send(env, owner?.email, 'A secure message needs your attention',
    `A patient has sent a secure message. Sign in to the clinic to read and reply:\n${new URL('/app/clients/' + encodeURIComponent(link.client_id), runtimeBindings(env).AUTH_ORIGIN).href}\n\nClinical content is available only after signing in. Please do not reply to this email.`)
  await commit(db, null, [stmt(db, 'UPDATE bm_messages SET notification_state=?,notified_at=? WHERE id=?', mail, now(), messageId),
    audit(db, { email: 'clinic-mail', role: 'system' }, 'message.notification', link.client_id, messageId, mail),
  ])
  return { messageId, sent: true, notice: 'Your message is saved for the clinic. This inbox is not for emergencies. For an emergency, call 911.' }
}
