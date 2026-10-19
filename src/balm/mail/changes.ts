import type { Bindings } from '../../auth.server'
import { intakeToken } from '../domain/booking'
import { localTime } from '../domain/invoices'
import { sha256 } from '../domain/model'
import { dispatchPatientMail, submissionDelivery } from './dispatch'

/** One message covers the changed dates. Only clinic, times and private reply links leave Balm. */
export async function sendVisitChange(env: Bindings, appointmentIds: string[], kind: 'moved' | 'cancelled') {
  if (!appointmentIds.length) return 'no_email' as const
  const list = (await env.DB.prepare(`SELECT a.id,a.client_id,a.start_at,c.email,c.first_name,s.clinic_name,s.time_zone FROM bm_appointments a
    JOIN bm_clients c ON c.id=a.client_id,bm_settings s WHERE a.id IN (SELECT value FROM json_each(?)) AND c.erased_at IS NULL ORDER BY a.start_at`).bind(JSON.stringify(appointmentIds)).all<any>()).results
  if (!list.length) return 'no_email' as const
  const first = list[0], dates = []
  for (const visit of list) {
    let line = localTime(visit.start_at, visit.time_zone)
    if (kind === 'moved') {
      const token = intakeToken()
      await env.DB.prepare('INSERT INTO bm_mail_reply_links(token_hash,appointment_id,start_at) VALUES(?,?,?)').bind(await sha256(token), visit.id, visit.start_at).run()
      line += '\nConfirm or ask for a new time: ' + new URL('/visit/' + token, env.AUTH_ORIGIN).href
    }
    dates.push(line)
  }
  const action = kind === 'moved' ? 'changed' : 'canceled'
  return submissionDelivery(await dispatchPatientMail(env, first.email, `Your appointment at ${first.clinic_name} is ${action}`,
    `Hello ${first.first_name},\n\n${first.clinic_name} has ${action} ${list.length === 1 ? 'your appointment' : 'these appointments'}:\n${dates.join('\n\n')}\n\n${kind === 'moved' ? 'These are your new appointment times. Each private link expires when its visit starts and stops working if the visit changes again.' : 'Please contact the clinic to book a new time.'}\n`,
    { clientId: first.client_id, appointmentIds: list.map(v => v.id), kind }))
}
