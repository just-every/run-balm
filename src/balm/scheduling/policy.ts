import { parseDollars } from '../payments/ledger'
import { audit, commit, guard, human, id, insist, integer, need, now, one, stmt, text, type Actor, type Data } from '../domain/model'

export async function getVisitPolicy(db: D1Database) {
  const s = (await one(db, 'SELECT cancellation_notice_hours,late_cancel_fee_cents,no_show_fee_cents FROM bm_settings WHERE id=1'))!
  return { noticeHours: Number(s.cancellation_notice_hours), lateCancelFeeCents: Number(s.late_cancel_fee_cents), noShowFeeCents: Number(s.no_show_fee_cents) }
}
export async function saveVisitPolicy(db: D1Database, who: Actor, input: Data) {
  need(who, 'owner'); human(who)
  const notice = integer(input.noticeHours, 'notice_hours', 0, 8760)
  const late = integer(input.lateCancelFeeCents ?? parseDollars(input.lateCancelFee, 'late_cancellation_fee'), 'late_cancel_fee_cents', 0, 1_000_000)
  const absent = integer(input.noShowFeeCents ?? parseDollars(input.noShowFee, 'no_show_fee'), 'no_show_fee_cents', 0, 1_000_000)
  insist((late === 0 || late >= 50) && (absent === 0 || absent >= 50), 'fees_must_be_zero_or_at_least_50_cents')
  await commit(db, who, [stmt(db, 'UPDATE bm_settings SET cancellation_notice_hours=?,late_cancel_fee_cents=?,no_show_fee_cents=? WHERE id=1', notice, late, absent), audit(db, who, 'visit_policy.saved', null)])
  return getVisitPolicy(db)
}
export type VisitPolicy = Awaited<ReturnType<typeof getVisitPolicy>>
export function feeProposalStatements(db: D1Database, who: { email: string; role: string }, a: Data, status: 'cancelled' | 'no_show', policy: VisitPolicy) {
  const late = Date.parse(a.start_at) - Date.now() < policy.noticeHours * 3600_000
  const amount = status === 'no_show' ? policy.noShowFeeCents : late ? policy.lateCancelFeeCents : 0
  return [
    guard(db, 'EXISTS(SELECT 1 FROM bm_settings WHERE id=1 AND cancellation_notice_hours=? AND late_cancel_fee_cents=? AND no_show_fee_cents=?)', policy.noticeHours, policy.lateCancelFeeCents, policy.noShowFeeCents),
    ...(amount ? [stmt(db, 'INSERT INTO bm_visit_fees(id,appointment_id,client_id,kind,amount_cents,notice_hours,proposed_at) VALUES(?,?,?,?,?,?,?)', id(), a.id, a.client_id, status === 'no_show' ? 'no_show' : 'late_cancel', amount, policy.noticeHours, now()),
    audit(db, who, 'appointment.fee_proposed', a.client_id, a.id, `${amount} cents; ${status}`)] : []),
  ]
}
/** Cancellation reasons live in the visit record, never the general access audit. */
export function cancellationStatements(db: D1Database, who: { email: string; role: string }, a: Data, reason: unknown, policy: VisitPolicy) {
  return [stmt(db, 'INSERT INTO bm_visit_cancellations(appointment_id,reason,actor_email,actor_role,cancelled_at) VALUES(?,?,?,?,?)', a.id, text(reason, 'cancellation_reason', 500), who.email, who.role, now()), ...feeProposalStatements(db, who, a, 'cancelled', policy)]
}
