import type { Bindings } from '../../auth.server'
import { dispatchPatientMail } from '../mail/dispatch'
import { audit, commit, guard, id, one, rows, stmt } from '../domain/model'
import { sequenceGoal } from './goals'
const DAY = 86400_000, system = { email: 'Balm scheduler', role: 'system' }

export async function sendDueFollowups(env: Bindings, scheduledTime = Date.now()) {
  if (env.RER_DEMO === '1') return
  const db = env.DB, at = new Date(scheduledTime).toISOString()
  const candidates = await rows(db, `SELECT f.*,s.delay_days,s.repeat_days,s.max_sends,s.survey_url,s.review_url,s.version AS settings_version,
    c.email,c.version AS client_version,b.clinic_name,b.followup_contact_limit,
    (SELECT COUNT(*) FROM bm_followup_attempts a WHERE a.followup_id=f.id) AS sent_count,
    (SELECT MAX(attempted_at) FROM bm_followup_attempts a WHERE a.followup_id=f.id) AS last_attempt,
    (SELECT COUNT(*) FROM bm_followup_attempts a WHERE a.followup_id=f.id AND (a.state='uncertain' OR (a.state='reserved' AND a.attempted_at<=?))) AS unknown_count
    FROM bm_followups f JOIN bm_followup_settings s ON s.kind=f.kind JOIN bm_clients c ON c.id=f.client_id,bm_settings b
    WHERE f.state='active' AND s.enabled=1 AND c.erased_at IS NULL ORDER BY f.enrolled_at,f.id`, new Date(scheduledTime - 15 * 60_000).toISOString())
  for (const f of candidates) {
    const goal = await sequenceGoal(db, f, at)
    if (f.unknown_count && !goal.met) {
      await commit(db, null, [stmt(db, "UPDATE bm_followups SET state='stopped',stopped_at=?,stopped_reason='Unknown provider outcome; contact the patient before further outreach',version=version+1 WHERE id=? AND state='active'", at, f.id), audit(db, system, 'followup.stopped', f.client_id, f.id, 'unknown provider outcome')])
      continue
    }
    if (goal.met || f.sent_count >= f.max_sends || (f.sent_count && ['welcome','discharge'].includes(f.kind))) {
      const accepted = await one(db, "SELECT id FROM bm_followup_attempts WHERE followup_id=? AND state='accepted' LIMIT 1", f.id)
      const met = goal.met || (accepted && ['welcome','discharge'].includes(f.kind))
      await commit(db, null, [stmt(db, "UPDATE bm_followups SET state=?,stopped_at=?,stopped_reason=?,version=version+1 WHERE id=? AND state='active'", met ? 'goal_met' : 'stopped', at, goal.met ? 'Goal met' : met ? 'Request accepted by mail provider' : 'Attempt limit reached; review outcomes before further contact', f.id), audit(db, system, met ? 'followup.goal_met' : 'followup.stopped', f.client_id, f.id, f.kind)])
      continue
    }
    if (!goal.trigger) continue
    const due = f.last_attempt ? Date.parse(f.last_attempt) + f.repeat_days * DAY : Math.max(Date.parse(goal.trigger) + f.delay_days * DAY, Date.parse(f.enrolled_at))
    if (due > scheduledTime) continue
    // Reserve the rolling contact budget and immutable attempt together, before any provider request.
    const attempt = id(), since = new Date(scheduledTime - DAY).toISOString()
    try {
      await commit(db, null, [
        guard(db, "EXISTS(SELECT 1 FROM bm_followups WHERE id=? AND state='active' AND version=?)", f.id, f.version),
        guard(db, 'EXISTS(SELECT 1 FROM bm_followup_settings WHERE kind=? AND enabled=1 AND version=?)', f.kind, f.settings_version),
        guard(db, 'EXISTS(SELECT 1 FROM bm_clients WHERE id=? AND version=? AND erased_at IS NULL)', f.client_id, f.client_version),
        guard(db, 'NOT EXISTS(SELECT 1 FROM bm_appointments WHERE client_id=? AND status=\'booked\' AND start_at>?) OR ? IN (\'welcome\',\'discharge\')', f.client_id, at, f.kind),
        guard(db, '((SELECT COUNT(*) FROM bm_followup_attempts WHERE client_id=? AND attempted_at>?) < (SELECT followup_contact_limit FROM bm_settings WHERE id=1))', f.client_id, since),
        stmt(db, 'INSERT INTO bm_followup_attempts(id,followup_id,client_id,sequence,attempted_at) VALUES(?,?,?,?,?)', attempt, f.id, f.client_id, f.sent_count + 1, at),
        audit(db, system, 'followup.attempted', f.client_id, attempt, f.kind),
      ])
    } catch (error) { if ((error as any).code === 'changed_refresh_and_retry') continue; throw error }
    const current = await one(db, "SELECT * FROM bm_followups WHERE id=? AND state='active'", f.id)
    if (!current || (await sequenceGoal(db, { ...f, ...current }, at)).met) {
      await stmt(db, "UPDATE bm_followup_attempts SET state='cancelled' WHERE id=?", attempt).run(); continue
    }
    const portal = new URL('/portal', env.AUTH_ORIGIN).href
    const instructions: Record<string, string> = {
      welcome: 'Welcome. Please sign in for your clinic information and secure messages.',
      missed: 'Please contact the clinic if you would like to arrange another appointment.',
      no_next: 'Please contact the clinic to arrange your next appointment.',
      discharge: `Please share feedback using our survey:\n${f.survey_url}\n\nIf you wish, you can leave a review:\n${f.review_url}`,
      recall: 'It may be time to arrange another appointment. Please contact the clinic if you would like to book.',
    }
    const result = await dispatchPatientMail(env, f.email, `A follow-up from ${f.clinic_name}`, `${instructions[f.kind]}\n\nSign in securely:\n${portal}\n\nTo stop these messages, contact the clinic.`, { clientId: f.client_id, appointmentIds: [], kind: 'reminder', deliveryId: attempt })
    await commit(db, null, [stmt(db, 'UPDATE bm_followup_attempts SET state=? WHERE id=?', result.state, attempt), audit(db, system, 'followup.' + result.state, f.client_id, attempt, f.kind)])
  }
}
