import { clientVisible } from './clients'
import { audit, commit, guard, human, id, insist, integer, now, one, practitionerId, rows, stmt, text, type Actor, type Data } from './model'

/** Clinical text is available only through a native human's patient scope. */
function scopeGuard(db: D1Database, who: Actor, clientId: string) {
  return guard(db, `EXISTS(SELECT 1 FROM bm_clients c WHERE c.id=? AND c.erased_at IS NULL AND
    (? IN ('owner','reception') OR EXISTS(SELECT 1 FROM bm_appointments a WHERE a.client_id=c.id AND a.practitioner_id=?)))`,
  clientId, who.role === 'owner' ? 'owner' : who.staffRole ?? '', practitionerId(who) ?? '')
}

function activeValue(value: unknown, previous?: Data | null) {
  if (value === undefined) return previous ? Number(previous.active) : 1
  if ([true, 1, '1', 'true', 'on'].includes(value as any)) return 1
  if ([false, 0, '0', 'false', 'off'].includes(value as any)) return 0
  insist(false, 'invalid_alert_active')
}

/** Owners and treating clinicians maintain alerts; reception can read them at check-in. */
export async function saveClientAlert(db: D1Database, who: Actor, input: Data) {
  human(who)
  insist(who.role === 'owner' || !!practitionerId(who), 'only_owner_or_treating_practitioner_changes_alerts', 403)
  const client = await clientVisible(db, who, input.clientId)
  const previous = input.id ? await one(db, 'SELECT * FROM bm_client_alerts WHERE id=? AND client_id=?', text(input.id, 'alert', 100), client.id) : null
  insist(!input.id || previous, 'alert_not_found', 404)
  const kind = text(input.kind, 'alert_kind', 20)
  insist(['medical', 'precaution', 'important'].includes(kind), 'invalid_alert_kind')
  const content = text(input.text, 'alert_text', 1000), active = activeValue(input.active, previous)
  const alertId = previous?.id as string ?? id(), at = now()
  const version = previous ? (input.version === undefined ? previous.version : integer(input.version, 'alert_version', 1, Number.MAX_SAFE_INTEGER)) : 0
  await commit(db, who, [scopeGuard(db, who, client.id),
    ...(previous ? [
      stmt(db, 'UPDATE bm_client_alerts SET kind=?,text=?,active=?,version=version+1,updated_at=?,updated_by=? WHERE id=? AND client_id=? AND version=?', kind, content, active, at, who.email, alertId, client.id, version),
      guard(db, 'changes()=1'),
    ] : [stmt(db, 'INSERT INTO bm_client_alerts(id,client_id,kind,text,active,created_at,created_by,updated_at,updated_by) VALUES(?,?,?,?,?,?,?,?,?)', alertId, client.id, kind, content, active, at, who.email, at, who.email)]),
    audit(db, who, previous ? 'alert.updated' : 'alert.created', client.id, alertId),
  ])
  return { id: alertId, clientId: client.id, version: Number(version) + 1, active: !!active }
}

/** All records on the chart permit review and reactivation; agents receive no alert text. */
export async function alertsFor(db: D1Database, who: Actor, clientId: string) {
  if (who.role === 'agent') return []
  human(who); await clientVisible(db, who, clientId)
  const alerts = await rows(db, 'SELECT * FROM bm_client_alerts WHERE client_id=? ORDER BY active DESC,created_at,id', clientId)
  await commit(db, who, [scopeGuard(db, who, clientId), audit(db, who, 'alert.read', clientId)])
  return alerts
}

/** One bounded query for visible calendar patients; only active alerts leave this door. */
export async function alertsForClients(db: D1Database, who: Actor, clientIds: string[]) {
  const result: Record<string, Data[]> = {}
  if (who.role === 'agent' || !clientIds.length) return result
  human(who)
  const keys = [...new Set(clientIds)]
  const visible = await rows(db, `SELECT c.id FROM bm_clients c WHERE c.id IN (SELECT value FROM json_each(?)) AND c.erased_at IS NULL AND
    (? IN ('owner','reception') OR EXISTS(SELECT 1 FROM bm_appointments a WHERE a.client_id=c.id AND a.practitioner_id=?))`,
  JSON.stringify(keys), who.role === 'owner' ? 'owner' : who.staffRole ?? '', practitionerId(who) ?? '')
  const ids = visible.map(c => c.id as string)
  if (!ids.length) return result
  const alerts = await rows(db, 'SELECT * FROM bm_client_alerts WHERE client_id IN (SELECT value FROM json_each(?)) AND active=1 ORDER BY created_at,id', JSON.stringify(ids))
  for (const clientId of ids) result[clientId] = []
  for (const alert of alerts) result[alert.client_id].push(alert)
  const accessed = ids.filter(clientId => result[clientId].length)
  if (accessed.length) await commit(db, who, accessed.flatMap(clientId => [scopeGuard(db, who, clientId), audit(db, who, 'alert.read', clientId)]))
  return result
}
