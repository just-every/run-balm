import type { Bindings } from '../../auth.server'
import { operatorMail } from '../../mail.server.mjs'
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
  // A crash after a claim may have reached the provider. Keep this distinct from a definite failure.
  await stmt(db, "UPDATE bm_visit_reminders SET state='uncertain',outcome='Delivery outcome unknown; contact the patient before resending' WHERE state='sending' AND attempted_at<?", new Date(scheduledTime-15*60_000).toISOString()).run()
  const due = await rows(db, `SELECT r.id FROM bm_visit_reminders r JOIN bm_appointments a ON a.id=r.appointment_id
    WHERE r.state='pending' AND r.due_at<=? AND a.start_at>? AND a.start_at=r.start_at AND a.status='booked' ORDER BY r.due_at LIMIT 50`, at, at)
  let sent = 0
  for (const candidate of due) {
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
        const sender = operatorMail(env)
        if (env.AUTH_LOCAL === 'true') outcome = 'Not sent: Balm on this computer sends no email'
        else if (!sender || !env.MAIL_FROM) outcome = 'Mail provider is not configured'
        else if (visit.email) {
          const result: any = await sender.send({ deliveryId: claim.id, from: env.MAIL_FROM, to: [visit.email], subject: `Appointment reminder from ${visit.clinic_name}`, text, html: `<p>${text.replace(/[&<>]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;'}[c]!)).replace(/\n/g, '<br>')}</p>`, headers: { 'Auto-Submitted': 'auto-generated' } })
          state = result?.status === 'accepted' ? 'sent' : result?.status === 'uncertain' ? 'uncertain' : 'failed'
          outcome = result?.status === 'development' ? 'Not sent: email is suppressed on this install' : state === 'sent' ? 'Accepted by mail provider' : state === 'uncertain' ? 'Provider response unknown; contact the patient before resending' : 'Mail provider did not accept delivery'
          receipt = result?.providerMessageId ?? null
        }
      } else {
        const sender = smsSender(env), to = usMobile(visit.phone)
        outcome = 'Text provider unavailable or patient has no consent or mobile number'
        if (sender && to && visit.sms_reminder_consent) { const result = await sender.send({ to, body: text }); state = 'sent'; outcome = `Text provider ${result.status}`; receipt = result.id }
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
  }
  return { sent }
}
