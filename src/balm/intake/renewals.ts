import type { Bindings } from '../../auth.server'
import { audit, commit, guard, human, insist, now, one, sha256, stmt, text, type Actor, type Data } from '../domain/model'
import { clinicalClient } from './records'
import { pendingPolicies } from './policies'
import { consentStatements } from './signatures'
import { send } from '../mail-out'

export async function requestConsents(env: Bindings, who: Actor, input: Data) {
  const db = env.DB, clientId = text(input.clientId, 'client', 100)
  human(who); await clinicalClient(db, who, clientId)
  insist((await pendingPolicies(db, clientId)).length, 'consents_already_received', 409)
  const record = await one(db, `SELECT r.id,c.email,s.clinic_name FROM bm_intake_responses r JOIN bm_clients c ON c.id=r.client_id, bm_settings s WHERE r.client_id=? ORDER BY r.submitted_at DESC LIMIT 1`, clientId)
  insist(record, 'complete_intake_first', 409)
  insist(record.email, 'patient_email_required')
  const token = crypto.randomUUID().replace(/-/g, '') + crypto.randomUUID().replace(/-/g, ''), at = now()
  await commit(db, who, [stmt(db, 'INSERT INTO bm_consent_links(token_hash,response_id,expires_at,created_at) VALUES(?,?,?,?)', await sha256(token), record.id, new Date(Date.now() + 7 * 86400_000).toISOString(), at),
    audit(db, who, 'consent.requested', clientId)])
  const mail = await send(env, record.email, `Documents to review from ${record.clinic_name}`, `Your clinic has documents for you to review and sign.\n\nOpen your private link:\n${new URL('/consent/' + token, env.AUTH_ORIGIN)}\n\nOnly new or updated documents need your decision. This link expires in seven days.`)
  await commit(db, who, [audit(db, who, 'consent.request_delivery', clientId, null, mail)])
  return { mail }
}
async function linkRecord(db: D1Database, token: string) {
  insist(/^[a-zA-Z0-9_-]{32,64}$/.test(token), 'consent_link_not_found', 404)
  const row = await one(db, `SELECT l.*,r.client_id,r.form_id,r.answers,f.title,f.number,f.questions,s.clinic_name,c.first_name FROM bm_consent_links l JOIN bm_intake_responses r ON r.id=l.response_id JOIN bm_intake_forms f ON f.id=r.form_id JOIN bm_clients c ON c.id=r.client_id, bm_settings s WHERE l.token_hash=? AND l.expires_at>?`, await sha256(token), now())
  insist(row, 'consent_link_not_found', 404)
  return row
}
export async function consentView(db: D1Database, token: string) {
  const row = await linkRecord(db, token)
  return { appointment: { first_name: row.first_name, clinic_name: row.clinic_name }, policies: await pendingPolicies(db, row.client_id) }
}
export async function signRenewals(db: D1Database, token: string, input: Data, ip: string) {
  const row = await linkRecord(db, token)
  insist((await pendingPolicies(db, row.client_id)).length, 'consents_already_received', 409)
  const statements = await consentStatements(db, row, { id: row.form_id, title: row.title, number: row.number, questions: [] }, {}, row.response_id, input, { ip }, now())
  await commit(db, null, [guard(db, 'EXISTS(SELECT 1 FROM bm_consent_links WHERE token_hash=? AND expires_at>?)', row.token_hash, now()), ...statements])
  return { signed: true }
}
