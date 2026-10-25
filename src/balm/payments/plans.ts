import { scheduledStatementCycle } from './statement-cycles'
import type { Bindings } from '../../auth.server'
import { now, one, stmt } from '../domain/model'
import { sendBalanceReminders } from './balance-reminders'
import { clinicDay } from './plan-balance'
import { chargeDueInstallments } from './plan-runner'
import { balanceReview } from './plan-settings'
export { balanceReview, clientPlans, patientPlans, planCommand } from './plan-settings'

export async function runPaymentSchedules(env: Bindings, db = env.DB, at = now()) {
  if (env.RER_DEMO === '1') return { charged: 0, sent: 0 }
  const settings = await one(db, 'SELECT time_zone FROM bm_settings WHERE id=1')
  if (!settings) return { charged: 0, sent: 0 }
  const today = clinicDay(at, settings.time_zone)
  const payments = await chargeDueInstallments(env, db, today, at)
  const reminders = await sendBalanceReminders(env, db, today, at)
  await scheduledStatementCycle(env, db, today, at)
  const review = await balanceReview(db, at)
  for (const account of review.accounts) await stmt(db, `INSERT INTO bm_balance_review_queue(client_id,after_days,age_days,oldest_at,listed_at) VALUES(?,?,?,?,?)
    ON CONFLICT(client_id) DO UPDATE SET after_days=excluded.after_days,age_days=excluded.age_days,oldest_at=excluded.oldest_at,listed_at=excluded.listed_at`, account.client_id, review.afterDays, account.age_days, account.oldest_at, at).run()
  return { ...payments, ...reminders }
}
