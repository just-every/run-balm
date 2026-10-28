import { quietHoursBlock } from '../sms/quiet-hours'
import { runPaymentSchedules } from '../payments/plans'
import { sendDueFollowups } from '../followups/scheduler'
import type { Bindings } from '../../auth.server'
import { dispatchPatientMail } from '../mail/dispatch'
import { intakeToken } from '../domain/booking'
import { localTime } from '../domain/invoices'
import { audit, commit, guard, now, one, rows, sha256, stmt } from '../domain/model'
import { smsSender, usMobile } from '../sms'

const system = { email: 'Balm scheduler', role: 'system' }
/** A provider call is claimed once. Unknown outcomes stay visible and are never blindly re-sent. */
export async function sendDueReminders(env: Bindings, scheduledTime = Date.now()) {
  if (env.RER_DEMO === '1') return { sent: 0 }
  const db = env.DB, at = new Date(scheduledTime).toISOString(), settings = await one(db, 'SELECT reminder_leads,reminder_sms FROM bm_settings WHERE id=1')
  if (!settings) return { sent: 0 }
  // Records are derived from the live visit, including bookings made by waitlist and recurring visits.
  // One reminder per lead time, never two at once: a lead time is skipped when the next shorter one is
  // already due (a visit booked inside both windows gets the shorter one now, and nothing twice).
  const leads = (JSON.parse(settings.reminder_leads) as number[]).sort((a, b) => b - a)
  for (const [index, lead] of leads.entries()) {
    const shorter = leads[index + 1], unlessShorterDue = shorter === undefined ? '' : new Date(scheduledTime + shorter * 60_000).toISOString()
    for (const channel of settings.reminder_sms ? ['email','sms'] : ['email']) {
      await stmt(db, `INSERT INTO bm_visit_reminders(id,appointment_id,start_at,lead_minutes,channel,due_at)
        SELECT lower(hex(randomblob(16))),a.id,a.start_at,?,?,strftime('%Y-%m-%dT%H:%M:%fZ',a.start_at,?) FROM bm_appointments a
        JOIN bm_clients c ON c.id=a.client_id WHERE a.status='booked' AND a.start_at>? AND a.start_at>? AND c.erased_at IS NULL
        AND (?='email' OR c.sms_reminder_consent=1) ON CONFLICT(appointment_id,start_at,lead_minutes,channel) DO UPDATE SET state='pending',outcome=NULL WHERE bm_visit_reminders.state='cancelled'`, lead, channel, `-${lead} minutes`, at, unlessShorterDue, channel).run()
    }
  }
  // Reminders left pending past their time (the scheduler did not run) give way to a shorter one due now.
  await stmt(db, `UPDATE bm_visit_reminders SET state='cancelled',outcome='Not sent: a later reminder for this visit was due at the same time' WHERE state='pending' AND due_at<=?
    AND EXISTS(SELECT 1 FROM bm_visit_reminders o WHERE o.appointment_id=bm_visit_reminders.appointment_id AND o.start_at=bm_visit_reminders.start_at AND o.channel=bm_visit_reminders.channel
      AND o.lead_minutes<bm_visit_reminders.lead_minutes AND o.due_at<=? AND o.state IN ('pending','sending','sent','uncertain'))`, at, at).run()
  await stmt(db, "UPDATE bm_visit_reminders SET state='cancelled',outcome='Not sent: the visit has started' WHERE channel='sms' AND state='pending' AND start_at<=?", at).run()
  // A crash after a claim may have reached the provider. Keep this distinct from a definite failure.
  await stmt(db, "UPDATE bm_visit_reminders SET state='uncertain',outcome='Delivery outcome unknown; contact the patient before resending' WHERE state='sending' AND attempted_at<?", new Date(scheduledTime-15*60_000).toISOString()).run()
  let sent = 0, attempts = 0
  for await (const candidate of dueReminders(db, at)) {
    if (candidate.channel === 'sms') {
      const result = await sendScheduledSms(env, candidate.id, at)
      if (result !== null) { sent += result; if (++attempts === 50) break }
      continue
    }
    const token = intakeToken(), hash = await sha256(token)
    const claim = await stmt(db, "UPDATE bm_visit_reminders SET state='sending',attempted_at=? WHERE id=? AND state='pending' RETURNING *", at, candidate.id).first<any>()
    if (!claim) continue
    const visit = await one(db, `SELECT a.*,c.email,c.phone,c.sms_reminder_consent,s.clinic_name,s.time_zone FROM bm_appointments a JOIN bm_clients c ON c.id=a.client_id,bm_settings s
      WHERE a.id=? AND a.status='booked' AND a.start_at=? AND c.erased_at IS NULL`, claim.appointment_id, claim.start_at)
    if (!visit) { await stmt(db, "UPDATE bm_visit_reminders SET state='cancelled' WHERE id=?", claim.id).run(); continue }
    await commit(db, null, [guard(db, "EXISTS(SELECT 1 FROM bm_appointments WHERE id=? AND status='booked' AND start_at=?)", visit.id, visit.start_at), stmt(db, 'INSERT INTO bm_visit_reply_links(reminder_id,token_hash) VALUES(?,?) ON CONFLICT(reminder_id) DO UPDATE SET token_hash=excluded.token_hash,revoked_at=NULL', claim.id, hash)])
    let state = 'failed', outcome = 'No email address', receipt: string | null = null
    const link = new URL('/visit/' + token, env.AUTH_ORIGIN).href
    const text = `Your appointment at ${visit.clinic_name} is on ${localTime(visit.start_at, visit.time_zone)}.\n\nConfirm or ask for a new time in one reply here:\n${link}\n\nThis private link expires when the visit starts. Please do not forward it.`
    try {
      if (claim.channel === 'email') {
        const result = await dispatchPatientMail(env, visit.email, `Appointment reminder from ${visit.clinic_name}`, text,
          { deliveryId: claim.id, clientId: visit.client_id, appointmentIds: [visit.id], kind: 'reminder' })
        state = result.state === 'accepted' ? 'sent' : result.state === 'uncertain' || result.state === 'sending' ? 'uncertain' : 'failed'
        outcome = result.state === 'suppressed' ? (env.AUTH_LOCAL === 'true' ? 'Not sent: Balm on this computer sends no email' : 'Not sent: email is suppressed on this install')
          : result.state === 'no_email' ? 'No email address' : result.state === 'unavailable' ? 'Mail provider is not configured'
          : state === 'sent' ? 'Accepted by mail provider; delivery not yet reported' : state === 'uncertain' ? 'Provider response unknown; contact the patient before resending' : 'Mail provider did not accept delivery'
        receipt = result.providerMessageId

      }
    } catch (error) {
      // The mail module distinguishes rejected calls from loss of a provider response.
      state = (error as any)?.outcome === 'rejected' ? 'failed' : 'uncertain'
      outcome = state === 'failed' ? 'Provider rejected delivery' : 'Provider response unknown; contact the patient before resending'
    }
    await commit(db, null, [
      stmt(db, "UPDATE bm_visit_reminders SET state=?,sent_at=?,outcome=? WHERE id=? AND state='sending'", state, state === 'sent' ? now() : null, outcome + (receipt ? ` (${receipt})` : ''), claim.id),
      audit(db, system, 'reminder.' + state, visit.client_id, claim.id, claim.channel),
    ])
    if (state === 'sent') sent++
    if (++attempts === 50) break
  }
  await sendDueFollowups(env, scheduledTime)
  await runPaymentSchedules(env, db, at)
  return { sent }
}

/** Page past refusals without spending the provider-attempt budget or revisiting a row this tick. */
async function* dueReminders(db: D1Database, at: string) {
  let dueAt = '', reminderId = ''
  while (true) {
    const due = await rows(db, `SELECT r.id,r.channel,r.due_at FROM bm_visit_reminders r JOIN bm_appointments a ON a.id=r.appointment_id
      WHERE r.state='pending' AND r.due_at<=? AND a.start_at>? AND a.start_at=r.start_at AND a.status='booked'
      AND (r.due_at>? OR (r.due_at=? AND r.id>?)) ORDER BY r.due_at,r.id LIMIT 50`, at, at, dueAt, dueAt, reminderId)
    if (!due.length) return
    for (const candidate of due) {
      dueAt = candidate.due_at; reminderId = candidate.id
      yield candidate
    }
  }
}

/** Quiet hours precede a provider claim. Null means no attempt; a deferred row has no attempted_at. */
async function sendScheduledSms(env: Bindings, reminderId: string, at: string) {
  const db = env.DB
  const context = () => one(db, `SELECT r.*,a.client_id,a.status,a.start_at AS visit_start,c.erased_at,c.phone,c.sms_reminder_consent,c.sms_time_zone AS patient_zone,c.version AS client_version,
    s.clinic_name,s.time_zone,s.reminder_sms,s.reminder_leads,s.version AS settings_version,s.sms_quiet_policy_id AS current_policy,p.intervals,p.source
    FROM bm_visit_reminders r JOIN bm_appointments a ON a.id=r.appointment_id JOIN bm_clients c ON c.id=a.client_id
    JOIN bm_settings s ON s.id=1 LEFT JOIN bm_sms_quiet_policies p ON p.id=s.sms_quiet_policy_id WHERE r.id=?`, reminderId)
  const refusal = (row: any) => {
    if (!row || row.erased_at || row.status !== 'booked' || row.visit_start !== row.start_at || row.visit_start <= at) return 'Not sent: the visit is no longer upcoming.'
    if (!row.reminder_sms || !JSON.parse(row.reminder_leads).includes(row.lead_minutes)) return 'Not sent: scheduled texts are disabled.'
    if (!row.sms_reminder_consent) return 'Not sent: the patient has not consented to text reminders.'
    if (!usMobile(row.phone)) return 'Not sent: record a valid patient mobile number.'
    if (!row.current_policy || !row.source) return 'Not sent: the owner must record valid SMS quiet intervals in Settings.'
    return quietHoursBlock(row.intervals, row.patient_zone, at)
  }
  const pending = async (row: any, outcome: string, claimed = false) => {
    await stmt(db, `UPDATE bm_visit_reminders SET state='pending',attempted_at=NULL,outcome=?,sms_quiet_policy_id=?,sms_time_zone=? WHERE id=? AND state=?`,
      outcome, row?.current_policy ?? null, row?.patient_zone ?? null, reminderId, claimed ? 'sending' : 'pending').run()
    if (claimed) await stmt(db, 'UPDATE bm_visit_reply_links SET revoked_at=? WHERE reminder_id=?', at, reminderId).run()
    return null
  }
  const row = await context()
  if (!row || row.state !== 'pending') return null
  const block = refusal(row)
  if (block) return pending(row, block)
  const sender = await smsSender(env)
  if (!sender) return pending(row, 'Not sent: SMS provider or active recorded BAA is unavailable.')
  const token = intakeToken(), hash = await sha256(token)
  // Fence the versions read above and current consent, BAA and still-live visit in the claim itself.
  const claimed = await stmt(db, `UPDATE bm_visit_reminders SET state='sending',attempted_at=?,sms_quiet_policy_id=?,sms_time_zone=?,outcome=NULL WHERE id=? AND state='pending'
    AND EXISTS(SELECT 1 FROM bm_appointments a JOIN bm_clients c ON c.id=a.client_id JOIN bm_settings s ON s.id=1
      WHERE a.id=bm_visit_reminders.appointment_id AND a.status='booked' AND a.start_at=bm_visit_reminders.start_at AND a.start_at>?
      AND c.erased_at IS NULL AND c.sms_reminder_consent=1 AND c.version=? AND s.version=? AND s.reminder_sms=1 AND s.sms_quiet_policy_id=?)
    AND EXISTS(SELECT 1 FROM bm_baa_records WHERE processor='sms' AND revoked_at IS NULL) RETURNING id`, at, row.current_policy, row.patient_zone, reminderId, at, row.client_version, row.settings_version, row.current_policy).first()
  if (!claimed) return null
  await stmt(db, 'INSERT INTO bm_visit_reply_links(reminder_id,token_hash) VALUES(?,?) ON CONFLICT(reminder_id) DO UPDATE SET token_hash=excluded.token_hash,revoked_at=NULL', reminderId, hash).run()
  // Re-read after asynchronous preparation. Deferred attempts use today's authority and policy, never a frozen permission.
  const current = await context(), changed = refusal(current)
  if (changed) return pending(current, changed, true)
  if (current!.client_version !== row.client_version || current!.settings_version !== row.settings_version) return pending(current, 'Not sent: patient or reminder settings changed; rechecking next minute.', true)
  let state = 'uncertain', outcome = 'Provider response unknown; contact the patient before resending'
  try {
    // smsSender also checks the current BAA immediately before its HTTP request.
    const result = await sender.send({ to: usMobile(current!.phone)!, body: `Your appointment at ${current!.clinic_name} is on ${localTime(current!.start_at, current!.time_zone)}.\n\nConfirm or ask for a new time in one reply here:\n${new URL('/visit/' + token, env.AUTH_ORIGIN).href}\n\nThis private link expires when the visit starts. Please do not forward it.` })
    state = 'sent'; outcome = `Accepted by text provider: ${result.status}; delivery not yet reported (${result.id})`
  } catch (error) {
    if ((error as any)?.code === 'record_sms_baa_first') return pending(current, 'Not sent: the active recorded SMS BAA was removed.', true)
    // A lost HTTP response may have sent the text; never automatically try it again.
    if ((error as any)?.outcome === 'rejected') { state = 'failed'; outcome = 'Provider rejected delivery' }
  }
  await commit(db, null, [
    stmt(db, "UPDATE bm_visit_reminders SET state=?,sent_at=?,outcome=? WHERE id=? AND state='sending'", state, state === 'sent' ? at : null, outcome, reminderId),
    audit(db, system, 'reminder.' + state, current!.client_id, reminderId, 'sms'),
  ])
  return state === 'sent' ? 1 : 0
}
