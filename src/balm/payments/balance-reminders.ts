import type { Bindings } from '../../auth.server'
import { audit, commit, guard, id, one, rows, stmt } from '../domain/model'
import { dispatchPatientMail } from '../mail/dispatch'
import { ledger } from './ledger'

const scheduler = { email: 'payment scheduler', role: 'payments' }

/** One generic email per due date, reserved durably before contacting mail. */
export async function sendBalanceReminders(env: Bindings, db: D1Database, today: string, at: string) {
  const due = await rows(db, `SELECT r.*,c.email,s.clinic_name FROM bm_balance_reminders r JOIN bm_clients c ON c.id=r.client_id,bm_settings s
    WHERE r.status='active' AND c.erased_at IS NULL ORDER BY r.next_on`)
  let sent = 0
  for (const reminder of due) {
    const balance = (await ledger(db, reminder.client_id)).patientBalanceCents
    if (balance <= 0) {
      await stmt(db, "UPDATE bm_balance_reminders SET status='paid',stopped_at=?,stop_reason='Patient balance is paid' WHERE id=? AND status='active'", at, reminder.id).run()
      continue
    }
    if (reminder.next_on > today) continue
    const noticeId = id()
    // Skip missed slots; a delayed scheduler sends one notice, never a burst.
    const elapsed = Math.floor((Date.parse(today) - Date.parse(reminder.next_on)) / 86400_000)
    const next = new Date(Date.parse(reminder.next_on) + (Math.floor(elapsed / reminder.every_days) + 1) * reminder.every_days * 86400_000).toISOString().slice(0, 10)
    try {
      await commit(db, null, [
        stmt(db, "UPDATE bm_balance_reminders SET next_on=? WHERE id=? AND status='active' AND next_on=?", next, reminder.id, reminder.next_on), guard(db, 'changes()=1'),
        stmt(db, "INSERT INTO bm_balance_notices(id,reminder_id,due_on,balance_cents,status,reserved_at) VALUES(?,?,?,?,'sending',?)", noticeId, reminder.id, reminder.next_on, balance, at),
        audit(db, scheduler, 'balance_reminder.reserved', reminder.client_id, noticeId),
      ])
    } catch (error) { if ((error as Error).message === 'changed_refresh_and_retry') continue; throw error }
    // Recheck a person's stop or an intervening payment before dispatch.
    const current = await one(db, "SELECT id FROM bm_balance_reminders WHERE id=? AND status='active'", reminder.id)
    if (!current || (await ledger(db, reminder.client_id)).patientBalanceCents <= 0) {
      await stmt(db, "UPDATE bm_balance_notices SET status='cancelled',outcome='Stopped or paid before delivery' WHERE id=?", noticeId).run()
      continue
    }
    const portal = new URL('/portal', env.AUTH_ORIGIN).href
    const delivery = await dispatchPatientMail(env, reminder.email, `Balance reminder from ${reminder.clinic_name}`,
      `${reminder.clinic_name} has a balance reminder for you. Sign in to your patient portal to review your statement, receipts and payment options:\n${portal}\n\nTo stop these reminders, contact the clinic.`,
      { clientId: reminder.client_id, appointmentIds: [], kind: 'reminder', deliveryId: noticeId })
    const state = delivery.state === 'accepted' ? 'sent' : delivery.state === 'sending' ? 'uncertain' : delivery.state
    await commit(db, null, [stmt(db, 'UPDATE bm_balance_notices SET status=?,outcome=? WHERE id=?', state, delivery.state, noticeId), audit(db, scheduler, `balance_reminder.${state}`, reminder.client_id, noticeId)])
    if (state === 'sent') sent++
  }
  // A crashed dispatch is a human-visible uncertainty, never a resend.
  await stmt(db, "UPDATE bm_balance_notices SET status='uncertain',outcome='Delivery outcome unknown; check before resending' WHERE status='sending' AND reserved_at<?", new Date(Date.parse(at) - 15 * 60_000).toISOString()).run()
  return { sent }
}
