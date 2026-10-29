// Adapted from Nectar's prepare/approve fence (src/nectar/subscriptions.ts,
// just-every/run-nectar @ 7f38865): a person approves the exact prepared bytes,
// and the approval keeps their digest. subject_id is unique, so a second
// approval of the same preparation aborts its batch.
import { decisionLabel, guard, human, id, now, sha256, stmt, type Actor, type Data } from './model'

export async function approvalStatements(db: D1Database, who: Actor, type: 'intake' | 'reminder' | 'invoice', subject: Data, exact: string) {
  human(who)
  const record = stmt(db, 'INSERT INTO bm_approvals(id,subject_type,subject_id,prepared_by,prepared_role,approved_by,approved_at,sha256) VALUES(?,?,?,?,?,?,?,?)',
    id(), type, subject.id, subject.prepared_by, subject.prepared_role, decisionLabel(who), now(), await sha256(exact))
  if (type === 'invoice') return [record]
  return [
    stmt(db, "UPDATE bm_drafts SET status='approved' WHERE id=? AND status='draft'", subject.id),
    guard(db, "EXISTS(SELECT 1 FROM bm_drafts WHERE id=? AND status='approved')", subject.id),
    record,
  ]
}
