import { clientVisible } from '../domain/clients'
import { audit, commit, day, guard, human, id, insist, integer, need, now, one, rows, stmt, text, type Actor, type Data } from '../domain/model'
import { liveCard } from './cards'
import { availablePlanBalance, clinicDay, monthDue } from './plan-balance'
import { parseDollars } from './ledger'

const checked = (value: unknown) => value === true || value === 'on'
export const planAuthorization = (clinic: string, amount: number, months: number, first: string) =>
  `I authorize ${clinic} to charge my saved card up to $${(amount / 100).toFixed(2)} monthly for ${months} months, starting ${new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', year: 'numeric', month: 'short', day: 'numeric' }).format(new Date(first + 'T12:00:00Z'))}, for my current patient balance. Each charge is limited to the remaining balance. I can ask the clinic to stop future charges at any time.`

export async function planCommand(db: D1Database, who: Actor, name: string, input: Data) {
  human(who); need(who, 'owner', 'reception')
  if (name === 'pay.review.save') {
    need(who, 'owner')
    const afterDays = integer(input.afterDays, 'review_age_days', 1, 3650)
    await commit(db, who, [stmt(db, 'UPDATE bm_balance_review_settings SET after_days=? WHERE id=1', afterDays), audit(db, who, 'balance.review_age_saved', null, null, `${afterDays} days`)])
    return { afterDays }
  }
  const client = await clientVisible(db, who, input.clientId), clientId = String(client.id)
  if (name === 'pay.plan.stop' || name === 'pay.reminders.stop') {
    const reason = text(input.reason, 'stop_reason', 500), table = name === 'pay.plan.stop' ? 'bm_payment_plans' : 'bm_balance_reminders'
    const recordId = text(input.id, 'plan', 100)
    await commit(db, who, [stmt(db, `UPDATE ${table} SET status='stopped',stopped_by=?,stopped_at=?,stop_reason=? WHERE id=? AND client_id=? AND status='active'`, who.email, now(), reason, recordId, clientId), guard(db, 'changes()=1'), audit(db, who, name === 'pay.plan.stop' ? 'payment_plan.stopped' : 'balance_reminders.stopped', clientId, recordId)])
    return { stopped: true }
  }
  const authorizedBy = text(input.authorizedBy, 'patient_authorizing', 200), authorizedOn = day(input.authorizedOn, 'authorization_date')
  const zone = (await one(db, 'SELECT time_zone FROM bm_settings WHERE id=1'))!.time_zone
  insist(authorizedOn <= clinicDay(now(), zone), 'authorization_cannot_be_in_the_future')
  const evidence = text(input.evidence, 'authorization_evidence', 1000)
  insist(checked(input.authorized), 'record_the_patient_authorization_first')
  const recordId = id()
  if (name === 'pay.plan.create') {
    const amount = integer(input.amountCents ?? parseDollars(input.amount, 'monthly_charge'), 'monthly_amount_cents', 50, 10_000_000), months = integer(input.months, 'months', 1, 60), first = day(input.firstDue, 'first_charge_date')
    const card = await liveCard(db, clientId)
    insist(card, 'save_the_patient_card_first', 409)
    insist(await availablePlanBalance(db, clientId) > 0, 'there_is_no_patient_balance_to_plan', 409)
    const clinic = (await one(db, 'SELECT clinic_name FROM bm_settings WHERE id=1'))!.clinic_name
    await commit(db, who, [
      guard(db, 'EXISTS(SELECT 1 FROM bm_cards WHERE id=? AND client_id=? AND removed_at IS NULL)', card.id, clientId),
      stmt(db, `INSERT INTO bm_payment_plans(id,client_id,amount_cents,months,first_due,authorized_by,authorized_on,authorization_evidence,authorization_text,card_id,status,created_by,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,'active',?,?)`,
        recordId, clientId, amount, months, first, authorizedBy, authorizedOn, evidence, planAuthorization(clinic, amount, months, first), card.id, who.email, now()),
      ...Array.from({ length: months }, (_, offset) => stmt(db, "INSERT INTO bm_plan_installments(id,plan_id,sequence,due_on,status) VALUES(?,?,?,?,'scheduled')", id(), recordId, offset + 1, monthDue(first, offset))),
      audit(db, who, 'payment_plan.authorized', clientId, recordId, `${months} monthly installments of up to ${amount} cents`),
    ])
    return { id: recordId, clientId, amountCents: amount, months, firstDue: first }
  }
  insist(name === 'pay.reminders.save' || name === 'pay.statements.save', 'unknown_command', 404)
  const statementMode = name === 'pay.statements.save' ? 1 : 0
  insist(client.email, 'the_patient_has_no_email_address', 409)
  const everyDays = integer(input.everyDays, 'reminder_interval_days', 1, 365), first = day(input.firstDue, 'first_reminder_date')
  await commit(db, who, [
    guard(db, "NOT EXISTS(SELECT 1 FROM bm_balance_reminders WHERE client_id=? AND status='active')", clientId),
    stmt(db, `INSERT INTO bm_balance_reminders(id,client_id,every_days,next_on,consent_evidence,consented_by,consented_on,status,created_by,created_at,statement_mode) VALUES(?,?,?,?,?,?,?,'active',?,?,?)`, recordId, clientId, everyDays, first, evidence, authorizedBy, authorizedOn, who.email, now(), statementMode),
    audit(db, who, statementMode ? 'patient_statements.authorized' : 'balance_reminders.authorized', clientId, recordId, `email every ${everyDays} days`),
  ])
  return { id: recordId, clientId, everyDays, firstDue: first, statementMode }
}

export async function clientPlans(db: D1Database, clientId: string) {
  const plans = await rows(db, 'SELECT * FROM bm_payment_plans WHERE client_id=? ORDER BY created_at DESC', clientId)
  for (const plan of plans) plan.installments = await rows(db, `SELECT i.*,p.status AS payment_status,p.failure,p.receipt_number FROM bm_plan_installments i LEFT JOIN bm_card_payments p ON p.id=i.payment_id WHERE i.plan_id=? ORDER BY sequence`, plan.id)
  const reminders = await rows(db, 'SELECT * FROM bm_balance_reminders WHERE client_id=? ORDER BY created_at DESC', clientId)
  for (const reminder of reminders) reminder.notices = await rows(db, 'SELECT * FROM bm_balance_notices WHERE reminder_id=? ORDER BY due_on', reminder.id)
  return { plans, reminders }
}

/** Call only after the portal session has selected this patient. */
export async function patientPlans(db: D1Database, clientId: string) {
  const plans = await rows(db, `SELECT id,amount_cents,months,first_due,authorized_by,authorized_on,authorization_text,status,stop_reason FROM bm_payment_plans WHERE client_id=? ORDER BY created_at DESC`, clientId)
  for (const plan of plans) plan.installments = await rows(db, `SELECT i.due_on,i.amount_cents,i.status,i.payment_id,p.status AS payment_status,p.receipt_number
    FROM bm_plan_installments i LEFT JOIN bm_card_payments p ON p.id=i.payment_id WHERE i.plan_id=? ORDER BY i.sequence`, plan.id)
  const reminders = await rows(db, `SELECT every_days,next_on,status,consented_by,consented_on,statement_mode FROM bm_balance_reminders WHERE client_id=? ORDER BY created_at DESC`, clientId)
  return { plans, reminders }
}

/** Re-derive what the invoices touched since the last look owe: one set-based pass over the changes, nothing when none. */
async function refreshOpenInvoices(db: D1Database) {
  if (!await one(db, 'SELECT 1 FROM bm_invoice_balance_stale LIMIT 1')) return
  await db.batch([
    stmt(db, 'DELETE FROM bm_invoice_open WHERE invoice_id IN (SELECT invoice_id FROM bm_invoice_balance_stale)'),
    stmt(db, `INSERT INTO bm_invoice_open(invoice_id,balance_cents,approved_at) SELECT id,balance,approved_at FROM (SELECT i.id AS id,i.approved_at AS approved_at,
      i.amount_cents-COALESCE((SELECT SUM(amount_cents) FROM bm_invoice_payments p WHERE p.invoice_id=i.id),0)-COALESCE((SELECT SUM(amount_cents) FROM bm_invoice_adjustments x WHERE x.invoice_id=i.id),0) AS balance
      FROM bm_invoices i WHERE i.status='approved' AND i.id IN (SELECT invoice_id FROM bm_invoice_balance_stale)) WHERE balance>0`),
    stmt(db, 'DELETE FROM bm_invoice_balance_stale'),
  ])
}

/** A live work list only: no export or collections side effect exists. It reads the patients with an old open invoice, never the paid history. */
export async function balanceReview(db: D1Database, at = now()) {
  const afterDays = Number((await one(db, 'SELECT after_days FROM bm_balance_review_settings WHERE id=1'))!.after_days)
  await refreshOpenInvoices(db)
  const aged = await rows(db, `SELECT g.*,
    (SELECT COALESCE(SUM(amount_cents-applied_cents),0) FROM bm_card_payments WHERE client_id=g.client_id AND status='succeeded')+(SELECT COALESCE(SUM(remaining_cents),0) FROM bm_credit_balances WHERE client_id=g.client_id) AS credit_cents,
    (SELECT age_days FROM bm_balance_review_queue q WHERE q.client_id=g.client_id AND q.after_days=? AND q.oldest_at=g.oldest_at) AS queued_age
    FROM (SELECT c.id AS client_id,c.first_name,c.last_name,MIN(i.approved_at) AS oldest_at,SUM(o.balance_cents) AS balance_cents
    FROM bm_clients c CROSS JOIN bm_invoices i ON i.client_id=c.id CROSS JOIN bm_invoice_open o ON o.invoice_id=i.id
    WHERE c.id IN (SELECT i2.client_id FROM bm_invoice_open o2 JOIN bm_invoices i2 ON i2.id=o2.invoice_id WHERE o2.approved_at<=? UNION SELECT client_id FROM bm_balance_review_queue WHERE after_days=?)
    AND c.erased_at IS NULL AND i.status='approved' AND NOT EXISTS(SELECT 1 FROM bm_invoice_insurance_hold h WHERE h.invoice_id=o.invoice_id)
    GROUP BY c.id HAVING julianday(?)-julianday(MIN(i.approved_at))>=?
      OR EXISTS(SELECT 1 FROM bm_balance_review_queue q WHERE q.client_id=c.id AND q.after_days=?)) g ORDER BY g.oldest_at`,
    afterDays, new Date(Date.parse(at) - afterDays * 86400_000 + 1000).toISOString(), afterDays, at, afterDays, afterDays)
  const accounts: Data[] = []
  for (const { credit_cents, queued_age, ...row } of aged) {
    const age = Math.max(Number(queued_age ?? 0), Math.floor((Date.parse(at) - Date.parse(row.oldest_at as string)) / 86400_000))
    const credit = Number(credit_cents)
    if (row.balance_cents as number > credit && age >= afterDays) accounts.push({ ...row, balance_cents: row.balance_cents as number - credit, age_days: age })
  }
  const attention = await rows(db, `SELECT i.*,p.client_id,c.first_name,c.last_name,cp.status AS payment_status,cp.failure FROM bm_plan_installments i JOIN bm_payment_plans p ON p.id=i.plan_id JOIN bm_clients c ON c.id=p.client_id LEFT JOIN bm_card_payments cp ON cp.id=i.payment_id WHERE i.status IN ('review','reserved') AND c.erased_at IS NULL ORDER BY i.due_on`)
  return { afterDays, accounts, attention }
}
