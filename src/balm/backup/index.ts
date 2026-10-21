// HIPAA-004: the owner points Balm at an S3-compatible bucket they control and pastes the public half of a
// key pair they keep; on a schedule Balm writes the whole clinic there as one encrypted `.rer` archive
// (the same archive `rer export` makes, so `rer import` and its erasure fence restore it). The Clinic page
// and the schedule show the newest recovery point. Balm only adds objects: it never deletes a backup.
import { createPortability } from '@runeditrun/rer/modules/portability'
import type { Bindings } from '../../auth.server'
import archivePolicy from '../archive-policy.mjs'
import { audit, commit, human, id, insist, need, now, one, optional, rows, stmt, text, type Actor, type Data } from '../domain/model'
import { managed } from '../scribe'
import { seal, unseal } from '../scribe/seal'
import { encryptBackup, readPublicKey } from './envelope.mjs'
import { putObject, putStream, storage, StorageError } from './s3.mjs'

const PURPOSE = 'backup-storage-secret'
const RETRY_MINUTES = 15, STALE_MINUTES = 30
export const MANAGED_LINE = 'Automatic backups are not available yet on RER Managed hosting: it has no outbound connection to your storage. They work on a self-hosted install.'
const loopback = (env: Bindings) => env.AUTH_LOCAL === 'true'
const counted: Record<string, string> = { bm_clients: 'clients', bm_appointments: 'visits', bm_notes: 'notes', bm_invoices: 'invoices', bm_audit: 'audit' }

/** What the owner sees: the saved storage record without its secret, the last runs and the newest recovery point. Nobody else sees any of it. */
export async function backupState(env: Bindings, who: Actor) {
  if (who.role !== 'owner') return null
  if (managed(env)) return { managed: true, line: MANAGED_LINE, saved: null, runs: [], recovery: null }
  const saved = await one(env.DB, 'SELECT enabled,endpoint,region,bucket,prefix,access_key_id,secret_hint,key_fingerprint,interval_hours,consent_by,consent_at,updated_by,updated_at,checked_at,check_ok,check_message FROM bm_backup_settings WHERE id=1')
  const runs = (await rows(env.DB, 'SELECT id,trigger,started_at,finished_at,state,object_key,bytes,recovery_point,counts,error FROM bm_backup_runs ORDER BY started_at DESC LIMIT 10')).map(r => ({ ...r, counts: r.counts ? JSON.parse(String(r.counts)) : null }))
  // The newest success is read on its own: a run of failed retries can push it out of the last ten.
  const recovery = await one(env.DB, "SELECT id,trigger,started_at,finished_at,state,object_key,bytes,recovery_point,counts,error FROM bm_backup_runs WHERE state='ok' ORDER BY started_at DESC LIMIT 1")
  return { managed: false, line: null, saved, runs, recovery: recovery ? { ...recovery, counts: JSON.parse(String(recovery.counts)) } : null }
}

async function save(env: Bindings, who: Actor, input: Data) {
  need(who, 'owner'); human(who)
  insist(!managed(env), 'backups_not_available_on_managed_hosting', 409)
  insist(env.RER_DEMO !== '1', 'backups_are_not_available_in_the_demo', 409)
  const current = await one(env.DB, 'SELECT secret_sealed,secret_hint,public_key,key_fingerprint,consent_by,consent_at FROM bm_backup_settings WHERE id=1')
  const consent = input.consent === true || input.consent === 'on'
  insist(consent || current, 'confirm_you_understand_how_backups_are_protected')
  const secret = optional(input.secretAccessKey, 'secret_access_key', 400)
  insist(secret || current, 'paste_the_secret_access_key')
  const endpoint = text(input.endpoint, 'endpoint', 300), region = text(input.region, 'region', 40), bucket = text(input.bucket, 'bucket', 63), prefix = optional(input.prefix, 'folder', 200) ?? ''
  const accessKeyId = text(input.accessKeyId, 'access_key_id', 200)
  const publicKey = optional(input.publicKey, 'public_key', 2000)
  insist(publicKey || current, 'paste_the_public_key_printed_by_backup_keygen')
  const interval = Number(input.intervalHours ?? 24)
  insist([1, 6, 12, 24].includes(interval), 'choose_how_often_to_back_up')
  let key
  try { key = publicKey ? await readPublicKey(publicKey) : { publicKey: String(current!.public_key), fingerprint: String(current!.key_fingerprint) } } catch (error) { insist(false, (error as Error).message) }
  const sealed = secret ? await seal(env.SESSION_SECRET, PURPOSE, secret) : String(current!.secret_sealed), hint = secret ? '…' + secret.slice(-4) : String(current!.secret_hint)
  const config = { endpoint, region, bucket, prefix, accessKeyId, secretAccessKey: secret ?? (await unseal(env.SESSION_SECRET, PURPOSE, String(current!.secret_sealed))) ?? '' }
  insist(config.secretAccessKey, 'paste_the_secret_access_key')
  let target
  try { target = storage(config, { loopback: loopback(env) }) } catch (error) { insist(false, (error as Error).message) }
  const at = now()
  // Saving proves the credentials the way every backup will use them: one small new object, never a patient record.
  let ok = true, message = 'Balm wrote a connection check to your storage.'
  try { await putObject(target, `balm-connection-check-${at.replace(/[-:]|\.\d{3}/g, '')}-${id()}.txt`, new TextEncoder().encode(`Balm connection check ${at}. Backups in this folder are encrypted; this file holds no clinic data.\n`)) }
  catch (error) { ok = false; message = error instanceof StorageError ? error.message : 'Balm could not reach your storage.' }
  await commit(env.DB, who, [
    stmt(env.DB, `INSERT INTO bm_backup_settings(id,enabled,endpoint,region,bucket,prefix,access_key_id,secret_sealed,secret_hint,public_key,key_fingerprint,interval_hours,consent_by,consent_at,updated_by,updated_at,checked_at,check_ok,check_message)
      VALUES(1,1,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
      ON CONFLICT(id) DO UPDATE SET enabled=1,endpoint=excluded.endpoint,region=excluded.region,bucket=excluded.bucket,prefix=excluded.prefix,access_key_id=excluded.access_key_id,secret_sealed=excluded.secret_sealed,secret_hint=excluded.secret_hint,
        public_key=excluded.public_key,key_fingerprint=excluded.key_fingerprint,interval_hours=excluded.interval_hours,consent_by=excluded.consent_by,consent_at=excluded.consent_at,updated_by=excluded.updated_by,updated_at=excluded.updated_at,checked_at=excluded.checked_at,check_ok=excluded.check_ok,check_message=excluded.check_message`,
    endpoint, region, bucket, target.prefix.replace(/\/$/, ''), accessKeyId, sealed, hint, key.publicKey, key.fingerprint, interval, consent ? who.email : current!.consent_by, consent ? at : current!.consent_at, who.email, at, at, ok ? 1 : 0, message),
    audit(env.DB, who, 'backup.saved', null, null, `encrypted to key ${key.fingerprint}, every ${interval} h, endpoint ${endpoint}, bucket ${bucket}${secret ? ', credentials changed' : ''}${consent ? ', consent recorded' : ''}`),
  ])
  return { saved: true, ok, message, fingerprint: key.fingerprint }
}

async function setEnabled(env: Bindings, who: Actor, enabled: boolean) {
  need(who, 'owner'); human(who)
  insist(await one(env.DB, 'SELECT 1 FROM bm_backup_settings WHERE id=1'), 'backups_are_not_set_up', 409)
  await commit(env.DB, who, [stmt(env.DB, 'UPDATE bm_backup_settings SET enabled=?,updated_by=?,updated_at=? WHERE id=1', enabled ? 1 : 0, who.email, now()), audit(env.DB, who, enabled ? 'backup.resumed' : 'backup.paused', null)])
  return { enabled }
}

async function remove(env: Bindings, who: Actor) {
  need(who, 'owner'); human(who)
  await commit(env.DB, who, [stmt(env.DB, 'DELETE FROM bm_backup_settings WHERE id=1'), audit(env.DB, who, 'backup.removed', null, null, 'storage record and credentials removed; backups already written stay in the owner’s storage')])
  return { removed: true }
}

export async function backupCommand(env: Bindings, who: Actor, name: string, input: Data) {
  if (name === 'backup.save') return save(env, who, input)
  if (name === 'backup.pause') return setEnabled(env, who, false)
  if (name === 'backup.resume') return setEnabled(env, who, true)
  if (name === 'backup.remove') return remove(env, who)
  if (name === 'backup.run') { need(who, 'owner'); human(who); return runBackup(env, 'manual', Date.now(), who) }
  throw new Error('unknown_backup_command')
}

async function* bytesOf(stream: ReadableStream<Uint8Array>, onManifest: (manifest: any) => void) {
  const decoder = new TextDecoder()
  let head = '', seen = false
  for await (const chunk of stream as unknown as AsyncIterable<Uint8Array>) {
    if (!seen) {
      head += decoder.decode(chunk, { stream: true })
      const end = head.indexOf('\n')
      if (end >= 0) { seen = true; onManifest(JSON.parse(head.slice(0, end))) }
    }
    yield chunk
  }
}

/** One backup: snapshot, archive, encrypt and write it as a new object. Returns the recorded run; a failure is recorded, never thrown. */
export async function runBackup(env: Bindings, trigger: 'schedule' | 'manual', at = Date.now(), who?: Actor) {
  const row = await one(env.DB, 'SELECT * FROM bm_backup_settings WHERE id=1')
  insist(row && env.RER_DEMO !== '1', 'backups_are_not_set_up', 409)
  const runId = id(), started = new Date(at).toISOString()
  await stmt(env.DB, "UPDATE bm_backup_runs SET state='failed',finished_at=?,error='Interrupted before it finished' WHERE state='running' AND started_at<?", started, new Date(at - STALE_MINUTES * 60_000).toISOString()).run()
  await stmt(env.DB, "DELETE FROM bm_backup_runs WHERE state='failed' AND started_at<?", new Date(at - 30 * 86_400_000).toISOString()).run()
  const claim = await stmt(env.DB, "INSERT INTO bm_backup_runs(id,trigger,started_at,state) SELECT ?,?,?,'running' WHERE NOT EXISTS(SELECT 1 FROM bm_backup_runs WHERE state='running')", runId, trigger, started).run()
  insist(claim.meta.changes === 1, 'a_backup_is_already_running', 409)
  const portability = await createPortability({ db: env.DB, policy: archivePolicy })
  let exportId: string | undefined
  try {
    const secret = await unseal(env.SESSION_SECRET, PURPOSE, String(row.secret_sealed))
    if (!secret) throw new StorageError('The saved storage secret cannot be opened on this install. Enter it again.')
    const target = storage({ endpoint: String(row.endpoint), region: String(row.region), bucket: String(row.bucket), prefix: String(row.prefix), accessKeyId: String(row.access_key_id), secretAccessKey: secret }, { loopback: loopback(env) })
    exportId = await portability.exports.create('backup')
    let status = await portability.exports.advance(exportId, { maxParts: 25 })
    while (status.phase !== 'complete') status = await portability.exports.advance(exportId, { maxParts: 25 })
    let manifest: any
    const key = `balm-backup-${started.replace(/[-:]|\.\d{3}/g, '')}-${runId}.balmbk`
    const archive = bytesOf(await portability.exports.download(exportId), m => { manifest = m })
    const written = await putStream(target, key, encryptBackup(archive, String(row.public_key), started))
    const counts: Record<string, number> = {}
    for (const table of manifest.tables as { name: string; count: number }[]) if (counted[table.name]) counts[counted[table.name]] = table.count
    const finished = now()
    await commit(env.DB, null, [
      stmt(env.DB, "UPDATE bm_backup_runs SET state='ok',finished_at=?,object_key=?,bytes=?,content_hash=?,key_fingerprint=?,recovery_point=?,counts=? WHERE id=?", finished, target.prefix + key, written.bytes, status.contentHash, row.key_fingerprint, manifest.exportedAt, JSON.stringify(counts), runId),
      audit(env.DB, who ?? { email: 'Balm scheduler', role: 'system' }, 'backup.completed', null, runId, `recovery point ${manifest.exportedAt}, encrypted to key ${row.key_fingerprint}`),
    ])
  } catch (error) {
    const reason = error instanceof StorageError ? error.message : /erased|invalidat|abort/i.test(String(error)) ? 'A change that removes records was made while the backup was running; Balm will try again.' : 'The backup could not be completed; Balm will try again.'
    if (!(error instanceof StorageError)) console.error('backup failed', error)
    await stmt(env.DB, "UPDATE bm_backup_runs SET state='failed',finished_at=?,error=? WHERE id=?", now(), reason, runId).run()
  } finally {
    if (exportId) await portability.exports.abort(exportId).catch(() => {})
  }
  return await one(env.DB, 'SELECT id,trigger,started_at,finished_at,state,object_key,bytes,recovery_point,counts,error FROM bm_backup_runs WHERE id=?', runId)
}

/** Called each minute by the scheduler: backs up when the owner's interval has passed, and tries a failure again after a pause. */
export async function runDueBackup(env: Bindings, scheduledTime = Date.now()) {
  if (env.RER_DEMO === '1') return null
  const settings = await one<{ enabled: number; interval_hours: number }>(env.DB, 'SELECT enabled,interval_hours FROM bm_backup_settings WHERE id=1')
  if (!settings?.enabled) return null
  const lastOk = await one<{ started_at: string }>(env.DB, "SELECT started_at FROM bm_backup_runs WHERE state='ok' ORDER BY started_at DESC LIMIT 1")
  const last = await one<{ started_at: string; state: string }>(env.DB, 'SELECT started_at,state FROM bm_backup_runs ORDER BY started_at DESC LIMIT 1')
  const since = (iso?: string) => iso ? scheduledTime - Date.parse(iso) : Infinity
  if (last?.state === 'running' && since(last.started_at) < STALE_MINUTES * 60_000) return null
  if (last?.state === 'failed' && since(last.started_at) < RETRY_MINUTES * 60_000) return null
  if (lastOk && since(lastOk.started_at) < settings.interval_hours * 3_600_000 - 60_000) return null
  return runBackup(env, 'schedule', scheduledTime)
}
