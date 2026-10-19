import type { Bindings } from '../../auth.server'
import { audit, commit, guard, one, rows, stmt, type Data } from '../domain/model'
import { chargeCardOnFile, syncIntent } from './charges'
import { availableBalanceSql, availablePlanBalance } from './plan-balance'

const scheduler = { email: 'payment scheduler', role: 'payments' }

async function settle(db: D1Database, installment: Data, payment: Data | null) {
  const paid = payment?.status === 'succeeded'
  await stmt(db, 'UPDATE bm_plan_installments SET status=?,outcome=? WHERE id=?', paid ? 'paid' : 'review', paid ? 'Paid; receipt is on the patient ledger and portal' : payment?.failure ?? 'Charge outcome needs a person to check Stripe; Balm will not send it again', installment.id).run()
}

export async function chargeDueInstallments(env: Bindings, db: D1Database, today: string, at: string) {
  // Reconcile known intents with GET only. A missing response/intent remains a
  // human task indefinitely: Stripe may have received the original POST.
  const pending = await rows(db, `SELECT i.*,cp.payment_intent FROM bm_plan_installments i JOIN bm_card_payments cp ON cp.id=i.payment_id
    WHERE i.status IN ('reserved','review') ORDER BY i.due_on LIMIT 50`)
  for (const installment of pending) {
    let payment = await one(db, 'SELECT * FROM bm_card_payments WHERE id=?', installment.payment_id)
    if (installment.payment_intent && payment?.status !== 'succeeded' && payment?.status !== 'failed') {
      try { payment = await syncIntent(env, db, installment.payment_intent) } catch { /* No new charge: leave the reservation for a person. */ }
    }
    await settle(db, installment, payment)
  }
  const due = await rows(db, `SELECT i.*,p.client_id,p.amount_cents AS monthly_cents,p.card_id FROM bm_plan_installments i JOIN bm_payment_plans p ON p.id=i.plan_id JOIN bm_clients c ON c.id=p.client_id
    WHERE p.status='active' AND i.status='scheduled' AND i.due_on<=? AND c.erased_at IS NULL
    AND NOT EXISTS(SELECT 1 FROM bm_plan_installments earlier WHERE earlier.plan_id=i.plan_id AND earlier.sequence<i.sequence AND earlier.status NOT IN ('paid','skipped'))
    ORDER BY i.due_on LIMIT 50`, today)
  let charged = 0
  for (const installment of due) {
    const clientId = String(installment.client_id), amount = Math.min(Number(installment.monthly_cents), await availablePlanBalance(db, clientId))
    if (amount < 50) {
      // A balance under Stripe's minimum stays visible for human handling.
      const unpaid = await one(db, `SELECT ${availableBalanceSql} AS cents`, clientId, clientId, clientId)
      const hasPending = await one(db, "SELECT id FROM bm_card_payments WHERE client_id=? AND status IN ('open','processing','requires_action')", clientId)
      if (hasPending) continue
      await stmt(db, "UPDATE bm_plan_installments SET status=?,outcome=? WHERE id=? AND status='scheduled'", unpaid!.cents > 0 ? 'review' : 'skipped', unpaid!.cents > 0 ? 'Balance is below the card processor minimum; collect at the desk' : 'Patient balance is paid', installment.id).run()
      if (!unpaid!.cents) await stmt(db, "UPDATE bm_plan_installments SET status='skipped',outcome='Patient balance is paid' WHERE plan_id=? AND status='scheduled'", installment.plan_id).run()
      continue
    }
    const paymentId = `plan-${installment.id}`
    try {
      const payment = await chargeCardOnFile(env, db, null, {
        clientId, amountCents: amount, kind: 'charge', paymentId, description: 'Authorized monthly payment plan',
        reservation: [
          guard(db, "EXISTS(SELECT 1 FROM bm_payment_plans p JOIN bm_clients c ON c.id=p.client_id JOIN bm_cards card ON card.id=p.card_id WHERE p.id=? AND p.status='active' AND c.erased_at IS NULL AND card.removed_at IS NULL)", installment.plan_id),
          guard(db, `(${availableBalanceSql})>=?`, clientId, clientId, clientId, amount),
          stmt(db, "UPDATE bm_plan_installments SET status='reserved',payment_id=?,amount_cents=?,reserved_at=? WHERE id=? AND status='scheduled'", paymentId, amount, at, installment.id), guard(db, 'changes()=1'),
          audit(db, scheduler, 'payment_plan.installment_reserved', clientId, installment.id, `${amount} cents`),
        ],
      })
      await settle(db, installment, payment)
      if (payment?.status === 'succeeded') charged++
    } catch (error) {
      // A raced balance change remains scheduled; all other failures are visible
      // without creating a new payment ID or guessing whether money moved.
      const payment = await one(db, 'SELECT * FROM bm_card_payments WHERE id=?', paymentId)
      if (payment) await settle(db, installment, payment)
      else if ((error as Error).message !== 'changed_refresh_and_retry') await stmt(db, "UPDATE bm_plan_installments SET status='review',outcome=? WHERE id=? AND status='scheduled'", (error as Error).message.slice(0, 300), installment.id).run()
    }
  }
  await stmt(db, `UPDATE bm_payment_plans SET status='completed' WHERE status='active' AND NOT EXISTS(SELECT 1 FROM bm_plan_installments i WHERE i.plan_id=bm_payment_plans.id AND i.status NOT IN ('paid','skipped'))`).run()
  return { charged }
}
