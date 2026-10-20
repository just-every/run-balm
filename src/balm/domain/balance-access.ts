import { audit, commit, guard, human, insist, need, one, stmt, text, type Actor, type Data } from './model'

/** Owner grants or revokes balance visibility for a named active practitioner. */
export async function saveBalanceAccess(db: D1Database, who: Actor, input: Data) {
  need(who, 'owner'); human(who)
  insist([true, false, 'true', 'false'].includes(input.enabled), 'invalid_balance_visibility')
  const enabled = input.enabled === true || input.enabled === 'true'
  const staff = await one(db, "SELECT id,version FROM bm_staff WHERE id=? AND role='practitioner' AND active=1 AND erased_at IS NULL", text(input.id, 'practitioner', 100))
  insist(staff, 'active_practitioner_not_found', 404)
  await commit(db, who, [
    guard(db, "EXISTS(SELECT 1 FROM bm_staff WHERE id=? AND version=? AND role='practitioner' AND active=1 AND erased_at IS NULL)", staff.id, staff.version),
    stmt(db, 'UPDATE bm_staff SET balance_visibility=?,version=version+1 WHERE id=?', enabled ? 1 : 0, staff.id),
    audit(db, who, enabled ? 'staff.balance_visibility_granted' : 'staff.balance_visibility_revoked', null, staff.id as string),
  ])
  return { id: staff.id, balanceVisibility: enabled }
}
