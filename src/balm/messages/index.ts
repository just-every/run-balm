import type { Bindings } from '../../auth.server'
import { audit, commit, guard, id, insist, one, stmt, text, type Actor, type Data } from '../domain/model'
import { clientAuthority, messageActor, messageClient } from './access'
import { attachment, attachmentWrites } from './attachments'
import { linkWrites, newLink, notifyPatient, patientActor, patientGuard, patientLink, revokeLinks } from './links'
import { savePatientMessage } from './patient'
import { destination, destinationFields, destinationGuard, messageDestination } from './routing'

export { messageFile, patientMessages } from './thread'
export type { MessageFile, SecureMessage, MessageAccess } from './thread'

/** Native humans only; clinic commands cannot be prepared through agent keys. */
export async function messageCommand(env: Bindings, who: Actor, name: string, input: Data) {
  const db = env.DB, live = await messageActor(db, who)
  insist(['message.link', 'message.send', 'message.revoke'].includes(name), 'unknown_command', 404)
  const client = await messageClient(db, live, input.clientId)
  if (name === 'message.revoke') return revokeLinks(db, live, client)
  const target = input.replyTo ? await messageDestination(db, live, client.id as string, input.replyTo) : await destination(db, client.id as string, input, live)
  const body = name === 'message.send' ? text(input.body, 'message', 10000) : null
  const upload = body ? await attachment(input) : null
  const link = await newLink(client.id as string, live, input.delivery, target)
  if (link.delivery === 'email') insist(client.email, 'the_patient_has_no_email_address', 409)
  const messageId = body ? id() : null
  const author = live.staffId ? await one(db, 'SELECT name FROM bm_staff WHERE id=?', live.staffId) : null
  await commit(db, live, [clientAuthority(db, live, client.id as string), destinationGuard(db, client.id as string, target),
    guard(db, 'EXISTS(SELECT 1 FROM bm_clients WHERE id=? AND version=?)', client.id, client.version),
    ...linkWrites(db, link),
    ...(messageId ? [stmt(db, 'INSERT INTO bm_messages(id,client_id,sender,author_name,body,sent_at,notification_state,route,practitioner_id,reply_to) VALUES(?,?,?,?,?,?,?,?,?,?)',
      messageId, client.id, 'clinic', author?.name ?? 'Clinic', body, link.createdAt, link.delivery === 'shown' ? 'shown' : 'pending', ...destinationFields(target), input.replyTo ? text(input.replyTo, 'message', 100) : null),
    ...attachmentWrites(db, messageId, upload),
    audit(db, live, 'message.sent', client.id as string, messageId),
    ...(upload ? [audit(db, live, 'message.attachment_added', client.id as string, upload.id)] : [])] : []),
    audit(db, live, 'message.link_rotated', client.id as string, link.id, link.delivery),
  ])
  return { clientId: client.id, messageId, ...await notifyPatient(env, client.email as string | null, link, messageId) }
}

/** The private link grants only its own destination, never a posted client or recipient. */
export async function patientSend(env: Bindings, token: string, input: Data) {
  const link = await patientLink(env.DB, token)
  return savePatientMessage(env, link.client_id, input, { route: link.route, practitionerId: link.practitioner_id }, patientGuard(env.DB, link), patientActor)
}
