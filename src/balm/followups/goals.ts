import { one, type Data } from '../domain/model'

/** Current chart facts, evaluated again before each claimed email. No clinical content leaves this module. */
export async function sequenceGoal(db: D1Database, f: Data, at: string) {
  const client = f.client_id
  const next = await one(db, "SELECT id FROM bm_appointments WHERE client_id=? AND status='booked' AND start_at>? LIMIT 1", client, at)
  const signed = async (kind: string) => one(db, `SELECT n.id,n.signed_at AS at FROM bm_notes n WHERE n.client_id=? AND n.signed_at IS NOT NULL AND n.template LIKE ? ORDER BY n.signed_at DESC LIMIT 1`, client, '%.' + kind)
  const discharge = await signed('discharge')
  if (f.kind === 'welcome') { const note = await signed('evaluation'); return { trigger: note?.at, met: !!discharge } }
  if (f.kind === 'discharge') return { trigger: discharge?.at, met: false }
  if (f.kind === 'missed') {
    const missed = await one(db, "SELECT id,start_at AS at FROM bm_appointments WHERE client_id=? AND status='no_show' AND start_at<=? ORDER BY start_at DESC LIMIT 1", client, at)
    return { trigger: missed?.at, met: !!next }
  }
  if (f.kind === 'no_next') {
    const plan = await one(db, `SELECT id,created_at AS at FROM bm_plans_of_care WHERE client_id=? AND json_extract(content,'$.certifiedThrough')>=? ORDER BY created_at DESC LIMIT 1`, client, at.slice(0, 10))
    return { trigger: plan?.at, met: !!next || !!discharge || (!plan && !!f.sent_count) }
  }
  const last = await one(db, "SELECT start_at AS at FROM bm_appointments WHERE client_id=? AND status='attended' AND start_at<=? ORDER BY start_at DESC LIMIT 1", client, at)
  return { trigger: last?.at, met: !!next }
}
