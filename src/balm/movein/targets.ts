import type { Bindings } from '../../auth.server'
import { patientCreationSql } from '../domain/hosting'
// Client target adapter after Strap's member adapter (src/strap/movein/{snapshots,targets}.ts,
// just-every/run-strap @ 92c3892). A client with any clinic work, or edited after
// import, is retained by undo; the kit records why.
import { sha256 } from '../../modules/import-kit/src/d1/index.ts'
import type { D1Database, D1Sql, D1TargetAdapter, D1UndoDependency, TargetRow } from '../../modules/import-kit/src/d1/index.ts'
import { ImportError } from './errors.ts'

export const destination = 'balm:clients'
export const mappingVersion = 'cliniko-patients-v1'
export const clientFields = ['id', 'first_name', 'last_name', 'date_of_birth', 'email', 'phone', 'created_via', 'version', 'erased_at'] as const
const sql = (sql: string, ...params: unknown[]): D1Sql => ({ sql, params })
/** The same identity text clients.ts hashes for the erasure journal. */
export const identityText = (first: string, last: string, dob: string | null) => `client:${first.trim().toLowerCase()}|${last.trim().toLowerCase()}|${dob ?? ''}`

// D1 caps the terms of one compound SELECT, so the waitlist joins through a nested one.
const dependencies = `(SELECT json_group_array(json_object('table',d.t,'id',d.id)) FROM (SELECT t,id FROM (
  SELECT 'bm_appointments' AS t,id FROM bm_appointments WHERE client_id=s.id UNION ALL SELECT 'bm_notes',id FROM bm_notes WHERE client_id=s.id
  UNION ALL SELECT 'bm_intake_responses',id FROM bm_intake_responses WHERE client_id=s.id UNION ALL SELECT 'bm_invoices',id FROM bm_invoices WHERE client_id=s.id
  UNION ALL SELECT 'bm_drafts',id FROM bm_drafts WHERE client_id=s.id) UNION ALL SELECT 'bm_waitlist',id FROM bm_waitlist WHERE client_id=s.id ORDER BY 1,2) d)`
const select = `SELECT s.*,r.revision AS import_revision,${dependencies} AS dependency_snapshot FROM bm_clients s LEFT JOIN bm_import_client_revisions r ON r.client_id=s.id`

function scope(dest: string, kind: string) {
  if (dest !== destination || kind !== 'client') throw new ImportError('invalid_import_target', 409)
}
function target(row: Record<string, any>): TargetRow {
  return { destination, targetKind: 'client', targetId: row.id, revision: row.import_revision ?? `native:${row.version}`,
    value: { ...Object.fromEntries(clientFields.map(key => [key, row[key]])), dependencies: row.dependency_snapshot } }
}
function matches(row: TargetRow | null, dest: string, kind: string, id: string): D1Sql {
  scope(dest, kind)
  if (!row) return sql('NOT EXISTS(SELECT 1 FROM bm_clients WHERE id=?) AND NOT EXISTS(SELECT 1 FROM bm_import_client_revisions WHERE client_id=?)', id, id)
  const v = row.value as Record<string, any>
  return sql(`EXISTS(SELECT 1 FROM bm_clients s LEFT JOIN bm_import_client_revisions r ON r.client_id=s.id WHERE s.id=?
    AND ${clientFields.map(key => `s.${key} IS ?`).join(' AND ')} AND COALESCE(r.revision,'native:'||s.version)=? AND ${dependencies} IS ?)`,
  id, ...clientFields.map(key => v[key]), row.revision, v.dependencies)
}

export const clientTargets: D1TargetAdapter = {
  async read(db, dest, kind, id) {
    scope(dest, kind)
    const row = await db.prepare(`${select} WHERE s.id=?`).bind(id).first()
    return row ? target(row) : undefined
  },
  matches,
  write(row) {
    scope(row.destination, row.targetKind)
    const v = row.value as Record<string, any>
    if (v.id !== row.targetId || v.created_via !== 'import' || v.erased_at !== null || v.dependencies !== '[]') throw new ImportError('invalid_import_effect', 409)
    return [
      sql('INSERT INTO ik_d1_assertions(ok) SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM bm_erasure_journal WHERE identity_hash=?) THEN 1 ELSE 0 END', sha256(identityText(v.first_name, v.last_name, v.date_of_birth))),
      sql(`INSERT INTO bm_clients (${clientFields.join(',')},created_at) VALUES (${clientFields.map(() => '?').join(',')},strftime('%Y-%m-%dT%H:%M:%fZ','now'))`, ...clientFields.map(key => v[key])),
      sql('INSERT INTO bm_import_client_revisions(client_id,revision) VALUES(?,?)', row.targetId, row.revision),
      sql("INSERT INTO bm_audit(at,actor_email,actor_role,action,client_id,subject_id,detail) VALUES(strftime('%Y-%m-%dT%H:%M:%fZ','now'),'move-in kit','owner','client.imported',?,?,'Cliniko patient CSV v1')", row.targetId, row.targetId),
    ]
  },
  remove(dest, kind, id) {
    scope(dest, kind)
    return [
      sql(`INSERT INTO ik_d1_assertions(ok) SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM bm_clients s WHERE s.id=? AND ${dependencies}<>'[]') THEN 1 ELSE 0 END`, id),
      sql('DELETE FROM bm_import_client_revisions WHERE client_id=?', id),
      sql('DELETE FROM bm_clients WHERE id=?', id),
      sql("INSERT INTO bm_audit(at,actor_email,actor_role,action,client_id,subject_id,detail) VALUES(strftime('%Y-%m-%dT%H:%M:%fZ','now'),'move-in kit','owner','client.import_undone',?,?,'')", id, id),
    ]
  },
  async list(db, dest) {
    if (dest !== destination) throw new ImportError('invalid_import_target', 409)
    return (await db.prepare(select).all()).results.map(target)
  },
  matchesCount(count, dest) {
    if (dest !== destination) throw new ImportError('invalid_import_target', 409)
    return sql('(SELECT COUNT(*) FROM bm_clients)=?', count)
  },
  async preparePreservedUndo(db, dest, effects) {
    // One read admits large jobs without one D1 statement per client.
    const rows = await this.list!(db, dest), byId = new Map(rows.map(row => [row.targetId, row]))
    const retained: D1UndoDependency[] = []
    for (const effect of effects) {
      const row = byId.get(effect.expected.targetId), v = row?.value as Record<string, any> | undefined
      if (v && v.dependencies !== '[]') retained.push({ requiredEffectId: effect.provenance.id, cause: { table: 'bm_clients', recordId: row!.targetId }, evidence: { field: 'dependencies', snapshot: v.dependencies } })
    }
    return {
      observations: effects.map(effect => ({ effectId: effect.provenance.id, current: byId.get(effect.expected.targetId) ?? null, entity: { table: 'bm_clients', recordId: effect.expected.targetId } })),
      dependencies: retained,
      guards: [this.matchesCount!(rows.length, dest), ...rows.map(row => matches(row, dest, 'client', row.targetId))],
    }
  },
}

export async function nativeConflicts(db: Pick<D1Database, 'prepare'>, values: Record<string, any>[]) {
  const [clients, erased] = await Promise.all([
    db.prepare('SELECT id,first_name,last_name,date_of_birth FROM bm_clients WHERE erased_at IS NULL').all(),
    db.prepare('SELECT identity_hash FROM bm_erasure_journal').all(),
  ])
  const ids = new Set(clients.results.map(c => c.id)), people = new Set(clients.results.map(c => identityText(c.first_name, c.last_name, c.date_of_birth)))
  const erasedHashes = new Set(erased.results.map(e => e.identity_hash))
  return values.flatMap(value => {
    const identity = identityText(value.first_name, value.last_name, value.date_of_birth)
    const reason = erasedHashes.has(sha256(identity)) ? 'erased_identity' : ids.has(value.id) || people.has(identity) ? 'existing_client_requires_review' : null
    return reason ? [{ clientId: value.id as string, reason }] : []
  })
}

/** Resumed kit batches recheck hosting in the same transaction as their patient writes. */
export function hostingClientTargets(env?: Bindings): D1TargetAdapter {
  return { ...clientTargets, write(row) {
    const p = patientCreationSql(env)
    return [sql('INSERT INTO ik_d1_assertions(ok) SELECT CASE WHEN ('+p.sql+') THEN 1 ELSE 0 END',...p.params),...clientTargets.write(row)]
  } }
}
