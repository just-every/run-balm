import type { Bindings } from '../../auth.server'
import { runtimeBindings } from '../../auth.server'
import { audit, commit, guard, id, now, rows, stmt, text, type Data } from '../domain/model'
import { send } from '../mail-out'
import { attachment, attachmentWrites } from './attachments'
import { destinationFields, destinationGuard, type Destination } from './routing'

export const emergencyReply = 'This inbox is not for emergencies. For an emergency, call 911. The clinic may not read messages immediately.'

/** Patient credential guards and every original/automatic reply share one transaction. */
export async function savePatientMessage(env: Bindings, clientId: string, input: Data, target: Destination, credential: D1PreparedStatement, patientActor: { email: string; role: string }) {
  const db = env.DB, body = text(input.body, 'message', 10000), upload = await attachment(input), messageId = id(), replyId = id(), at = now()
  await commit(db, null, [credential, destinationGuard(db, clientId, target),
    guard(db, "(SELECT COUNT(*) FROM bm_messages WHERE client_id=? AND sender='patient' AND sent_at>?)<20", clientId, new Date(Date.now() - 10 * 60_000).toISOString()),
    stmt(db, `INSERT INTO bm_messages(id,client_id,sender,author_name,body,sent_at,notification_state,route,practitioner_id) VALUES(?,?,'patient','Patient',?,?,'pending',?,?)`,
      messageId, clientId, body, at, ...destinationFields(target)),
    ...attachmentWrites(db, messageId, upload),
    audit(db, patientActor, 'message.sent', clientId, messageId),
    ...(upload ? [audit(db, patientActor, 'message.attachment_added', clientId, upload.id)] : []),
    stmt(db, `INSERT INTO bm_messages(id,client_id,sender,author_name,body,sent_at,notification_state,route,practitioner_id,reply_to,automated) VALUES(?,?,'clinic','Clinic automatic reply',?,?,'shown',?,?,?,1)`,
      replyId, clientId, emergencyReply, at, ...destinationFields(target), messageId),
    audit(db, { email: 'clinic-auto-reply', role: 'system' }, 'message.auto_replied', clientId, replyId),
  ])
  await notifyClinic(env, clientId, messageId, target)
  return { messageId, sent: true, notice: 'Your message is saved for the clinic. ' + emergencyReply }
}

/** Notify the chosen destination and owner, without clinical text or filenames. */
async function notifyClinic(env: Bindings, clientId: string, messageId: string, target: Destination) {
  const db = env.DB
  const recipients = await rows<{ email: string }>(db, `SELECT DISTINCT o.email FROM oa_operators o LEFT JOIN bm_staff s ON lower(s.email)=lower(o.email)
    WHERE o.status='active' AND (o.role='owner' OR (s.active=1 AND s.erased_at IS NULL AND
      ((?='front_desk' AND s.role='reception') OR (?='practitioner' AND s.role='practitioner' AND s.id=?))))`, target.route, target.route, target.practitionerId)
  const outcomes = await Promise.all(recipients.map(recipient => send(env, recipient.email, 'A secure message needs your attention',
    `A patient has sent a secure message. Sign in to the clinic to read and reply:\n${new URL('/app/clients/' + encodeURIComponent(clientId), runtimeBindings(env).AUTH_ORIGIN).href}\n\nMessage content is available only after signing in. Please do not reply to this email.`)))
  const delivery = outcomes.length && outcomes.every(o => o === 'sent') ? 'sent' : 'mail_unavailable'
  await commit(db, null, [stmt(db, 'UPDATE bm_messages SET notification_state=?,notified_at=? WHERE id=?', delivery, now(), messageId),
    audit(db, { email: 'clinic-mail', role: 'system' }, 'message.notification', clientId, messageId, delivery),
  ])
}
