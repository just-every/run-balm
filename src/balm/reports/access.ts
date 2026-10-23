import { codeSetStatus } from '../codesets'
import { audit, commit, type Actor } from '../domain/model'
import { dailyCloseFacts } from './daily-close'

/** Ct-approved owner aggregate; the existing scoped documentation views remain. */
export async function dailyClose(db: D1Database, who: Actor) {
  if (who.role !== 'owner') return null
  const close = await dailyCloseFacts(db)
  const clients = new Set(Object.values(close).flatMap(value => Array.isArray(value) ? value.map(item => item.clientId) : []))
  if (clients.size) await commit(db, who, [...clients].map(clientId => audit(db, who, 'report.daily_close_read', clientId)))
  return {...close, codeSets:(await codeSetStatus(db,close.date)).filter(s=>s.missing||s.stale)}
}
