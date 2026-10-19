import { clientVisible } from '../domain/clients'
import { audit, commit, guard, human, id, insist, integer, need, now, one, rows, stmt, text, type Actor, type Data } from '../domain/model'

export const followupKinds = { welcome: 'Post-evaluation welcome', missed: 'Missed-visit outreach', no_next: 'Open plan, no next visit', discharge: 'Discharge survey and review request', recall: 'Interval recall' }
const kindOf = (value: unknown) => { const kind = String(value); insist(Object.hasOwn(followupKinds, kind), 'invalid_sequence_kind'); return kind }
const destination = (value: unknown) => {
  if (!value) return null
  const url = new URL(text(value, 'destination', 1000))
  insist(url.protocol === 'https:' && !url.username && !url.password, 'use_a_public_https_feedback_address')
  return url.href
}
export async function followupCommand(db: D1Database, who: Actor, name: string, input: Data) {
  human(who)
  if (name === 'followups.settings') {
    need(who, 'owner')
    const kind = kindOf(input.kind), enabled = input.enabled === true || input.enabled === 'on'
    const survey = destination(input.surveyUrl), review = destination(input.reviewUrl)
    insist(kind !== 'discharge' || !enabled || (survey && review), 'set_both_survey_and_review_addresses')
    await commit(db, who, [stmt(db, 'UPDATE bm_followup_settings SET enabled=?,delay_days=?,repeat_days=?,max_sends=?,survey_url=?,review_url=?,version=version+1 WHERE kind=?', enabled ? 1 : 0,
      integer(input.delayDays, 'delay_days', 0, 3650), integer(input.repeatDays, 'repeat_days', 1, 3650), integer(input.maxSends, 'max_sends', 1, 20), survey, review, kind),
      stmt(db, 'UPDATE bm_settings SET followup_contact_limit=? WHERE id=1', integer(input.contactLimit, 'contact_limit', 1, 10)), audit(db, who, 'followup.settings', null, kind)])
    return { saved: true }
  }
  need(who, 'owner', 'reception')
  const client = await clientVisible(db, who, input.clientId)
  if (name === 'followups.enroll') {
    const kind = kindOf(input.kind)
    insist(input.consent === true || input.consent === 'on', 'record_patient_opt_in_for_this_sequence')
    const consent = text(input.consentRecord, 'consent_record', 500), at = now(), key = id()
    await commit(db, who, [guard(db, 'EXISTS(SELECT 1 FROM bm_clients WHERE id=? AND erased_at IS NULL AND version=?)', client.id, client.version),
      stmt(db, 'INSERT INTO bm_followups(id,client_id,kind,consent_by,consent_at,consent_record,enrolled_at) VALUES(?,?,?,?,?,?,?)', key, client.id, kind, who.email, at, consent, at),
      audit(db, who, 'followup.consent_recorded', client.id, key, kind)])
    return { id: key }
  }
  insist(name === 'followups.stop', 'unknown_command', 404)
  const key = text(input.id, 'sequence', 100)
  await commit(db, who, [stmt(db, "UPDATE bm_followups SET state='stopped',stopped_at=?,stopped_reason='Patient opt-out or staff stop',version=version+1 WHERE id=? AND client_id=? AND state='active'", now(), key, client.id), guard(db, 'changes()=1'), audit(db, who, 'followup.stopped', client.id, key)])
  return { stopped: true }
}
export async function followupSettings(db: D1Database, who: Actor) {
  if (who.role !== 'owner') return null
  return { sequences: await rows(db, 'SELECT * FROM bm_followup_settings ORDER BY kind'), contactLimit: (await one(db, 'SELECT followup_contact_limit FROM bm_settings WHERE id=1'))!.followup_contact_limit }
}
export async function followupsFor(db: D1Database, who: Actor, clientId: string) {
  human(who); await clientVisible(db, who, clientId)
  return { sequences: await rows(db, 'SELECT * FROM bm_followups WHERE client_id=? ORDER BY enrolled_at DESC', clientId),
    attempts: await rows(db, `SELECT a.*,f.kind,COALESCE(m.submission_state,a.state) AS state FROM bm_followup_attempts a JOIN bm_followups f ON f.id=a.followup_id LEFT JOIN bm_mail_attempts m ON m.id=a.id WHERE a.client_id=? ORDER BY a.attempted_at DESC`, clientId) }
}
