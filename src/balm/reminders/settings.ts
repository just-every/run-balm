import type { Bindings } from '../../auth.server'
import { clientVisible } from '../domain/clients'
import { audit, commit, human, insist, integer, need, one, rows, stmt, type Actor, type Data } from '../domain/model'
import { smsBlock } from '../sms'

export async function reminderSettings(env: Bindings, who: Actor) {
  if (who.role === 'agent') return null
  return { ...await one(env.DB, 'SELECT reminder_leads,reminder_sms FROM bm_settings WHERE id=1'), smsBlocked: smsBlock(env) }
}
export async function reminderCommand(env: Bindings, who: Actor, name: string, input: Data) {
  human(who)
  if (name === 'reminders.settings') {
    need(who, 'owner')
    const leads = [...new Set(String(input.leadMinutes ?? '').split(',').filter(x => x.trim()).map(x => integer(x.trim(), 'lead_minutes', 1, 43_200)))].sort((a,b) => b-a)
    insist(leads.length <= 3, 'Choose up to three reminder lead times')
    const sms = input.sms === true || input.sms === 'on'
    if (sms) insist(!smsBlock(env), smsBlock(env)!, 409)
    await commit(env.DB, who, [
      stmt(env.DB, 'UPDATE bm_settings SET reminder_leads=?,reminder_sms=?,version=version+1 WHERE id=1', JSON.stringify(leads), sms ? 1 : 0),
      stmt(env.DB, "UPDATE bm_visit_reminders SET state='cancelled' WHERE state='pending' AND (lead_minutes NOT IN (SELECT value FROM json_each(?)) OR (channel='sms' AND ?=0))", JSON.stringify(leads), sms ? 1 : 0),
      audit(env.DB, who, 'reminders.settings', null, null, 'automatic reminder schedule changed'),
    ])
    return { saved: true }
  }
  if (name === 'reminders.consent') {
    need(who, 'owner', 'reception')
    const client = await clientVisible(env.DB, who, input.clientId)
    const consent = input.consent === true || input.consent === 'on'
    await commit(env.DB, who, [stmt(env.DB, 'UPDATE bm_clients SET sms_reminder_consent=?,version=version+1 WHERE id=?', consent ? 1 : 0, client.id), audit(env.DB, who, consent ? 'sms.consent_recorded' : 'sms.consent_removed', client.id)])
    return { saved: true }
  }
  insist(false, 'unknown_command', 404)
}
export async function reminderHistory(db: D1Database, appointmentIds: string[]) {
  if (!appointmentIds.length) return []
  return rows(db, `SELECT id,appointment_id,start_at,lead_minutes,channel,due_at,state,attempted_at,sent_at,outcome FROM bm_visit_reminders WHERE appointment_id IN (SELECT value FROM json_each(?)) ORDER BY due_at DESC LIMIT 200`, JSON.stringify(appointmentIds))
}
