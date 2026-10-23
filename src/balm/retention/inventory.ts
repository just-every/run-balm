import { custody } from './custody'
import { rows, stmt, type Data } from '../domain/model'

export type Inventory = Record<string, number[]>
/** Read row identities only; clinical bytes never travel in a destruction preview. */
export async function inventory(db: D1Database, clientId: string): Promise<Inventory> {
  const found: Inventory = {}
  for (const item of custody) {
    const table = item.table, terms: string[] = [], args: unknown[] = []
    if (item.client) { terms.push(table === 'bm_clients' ? 'id=?' : 'client_id=?'); args.push(clientId) }
    else for (const [column, parent, parentColumn] of item.links) {
      if (!found[parent]?.length) continue
      terms.push(`${column} IN (SELECT ${parentColumn} FROM ${parent} WHERE rowid IN (SELECT value FROM json_each(?)))`)
      args.push(JSON.stringify(found[parent]))
    }
    found[table] = terms.length ? (await rows(db, `SELECT rowid AS rid FROM ${table} WHERE ${terms.join(' OR ')} ORDER BY rowid`, ...args)).map(r => Number(r.rid)) : []
  }
  const resolvedPaper=await rows(db,`SELECT l.rowid AS rid FROM bm_runout_paper_lines l JOIN bm_remittance_suspense q ON q.paper_batch_id=l.batch_id AND q.patient_control=json_extract(l.detail,'$.id') JOIN bm_migrated_claims m ON m.id=q.resolved_claim WHERE m.client_id=?`,clientId)
  found.bm_runout_paper_lines=[...new Set([...found.bm_runout_paper_lines,...resolvedPaper.map(r=>Number(r.rid))])]
  found.bm_intake_photos = (await rows(db, `SELECT rowid AS rid FROM bm_intake_photos WHERE id IN (
    SELECT front FROM bm_intake_insurance WHERE client_id=? UNION SELECT back FROM bm_intake_insurance WHERE client_id=?
    UNION SELECT photo_id FROM bm_intake_identity WHERE client_id=?) ORDER BY rowid`, clientId, clientId, clientId)).map(r => Number(r.rid))
  return found
}
export const counts = (found: Inventory) => Object.fromEntries(Object.entries(found).filter(([,ids]) => ids.length).map(([table,ids]) => [table,ids.length]))
export function captureScope(db: D1Database, previewId: string, found: Inventory) {
  return Object.entries(found).filter(([,ids]) => ids.length).map(([table, ids]) => stmt(db,
    'INSERT INTO bm_retention_scope(preview_id,table_name,record_rowid) SELECT ?,?,value FROM json_each(?)', previewId, table, JSON.stringify(ids)))
}
export function purgeScope(db: D1Database, found: Inventory) {
  return [...custody].reverse().filter(t => found[t.table]?.length).map(t => stmt(db,
    `DELETE FROM ${t.table} WHERE rowid IN (SELECT value FROM json_each(?))`, JSON.stringify(found[t.table])))
}
