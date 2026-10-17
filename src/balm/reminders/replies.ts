import type { Bindings } from '../../auth.server'
import { audit, commit, guard, insist, now, one, sha256, stmt, type Data } from '../domain/model'
import { send } from '../mail-out'

export async function visitReplyView(env: Bindings, token: string) {
  const hash = await sha256(token)
  const appointment = await one(env.DB, `SELECT a.id,a.client_id,a.start_at,a.patient_response,a.patient_response_at,s.clinic_name,s.time_zone
    FROM bm_visit_reply_links l JOIN bm_visit_reminders r ON r.id=l.reminder_id JOIN bm_appointments a ON a.id=r.appointment_id,bm_settings s
    WHERE l.token_hash=? AND l.revoked_at IS NULL AND r.start_at=a.start_at AND a.status='booked' AND a.start_at>?`, hash, now())
  insist(appointment, 'This visit link expired or the appointment changed. Please contact the clinic.', 404)
  return { appointment, token }
}
export async function visitReply(env: Bindings, token: string, input: Data) {
  const { appointment: a } = await visitReplyView(env, token)
  insist(input.reply === 'confirmed' || input.reply === 'change_requested', 'Choose confirm or ask for a new time')
  if (a.patient_response === input.reply) return { response: input.reply }
  await commit(env.DB, null, [
    guard(env.DB, "EXISTS(SELECT 1 FROM bm_visit_reply_links l JOIN bm_visit_reminders r ON r.id=l.reminder_id JOIN bm_appointments a ON a.id=r.appointment_id WHERE l.token_hash=? AND l.revoked_at IS NULL AND r.start_at=a.start_at AND a.status='booked' AND a.start_at>?)", await sha256(token), now()),
    stmt(env.DB, 'UPDATE bm_appointments SET patient_response=?,patient_response_at=?,version=version+1 WHERE id=?', input.reply, now(), a.id),
    audit(env.DB, { email: 'Patient via private visit link', role: 'patient' }, 'appointment.' + input.reply, a.client_id, a.id),
  ])
  if (input.reply === 'change_requested') await send(env, env.OWNER_EMAIL, 'A patient requested a new appointment time', `A patient asked for a new time. Review the request securely in Balm:\n${new URL('/app/clients/' + a.client_id, env.AUTH_ORIGIN).href}\n\nPatient details stay in Balm.`)
  return { response: input.reply }
}
