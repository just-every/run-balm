// Shared by the owner's backup scripts: the storage settings (from the environment or a private --env-file),
// the newest backup in the owner's bucket, and decrypting one into a `.rer` archive for `rer import`.
import { chmodSync, createReadStream, existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs'
import { open } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { decryptBackup } from '../../src/balm/backup/envelope.mjs'
import { getObject, listObjects, storage } from '../../src/balm/backup/s3.mjs'

export const args = process.argv.slice(2)
export const flag = name => { const i = args.indexOf(name); return i < 0 ? undefined : args[i + 1] }
export const fail = message => { console.error(message); process.exit(2) }

const SETTINGS = ['BALM_BACKUP_ENDPOINT', 'BALM_BACKUP_REGION', 'BALM_BACKUP_BUCKET', 'BALM_BACKUP_PREFIX', 'BALM_BACKUP_ACCESS_KEY_ID', 'BALM_BACKUP_SECRET_ACCESS_KEY']

/** The owner's storage from BALM_BACKUP_* in the environment or in the private settings file named by --env-file. */
export function storageFromEnvironment() {
  const values = {}
  for (const key of SETTINGS) if (process.env[key]) values[key] = process.env[key]
  const file = flag('--env-file')
  if (file) {
    let body
    try { body = readFileSync(resolve(file), 'utf8') } catch { fail(`The settings file ${file} could not be read`) }
    for (const line of body.split(/\r?\n/)) {
      const match = /^\s*(?:export\s+)?([A-Z][A-Z0-9_]*)\s*=\s*(.*?)\s*$/.exec(line)
      if (match && SETTINGS.includes(match[1])) values[match[1]] = match[2].replace(/^(["'])(.*)\1$/, '$2')
    }
  }
  for (const key of SETTINGS.filter(k => k !== 'BALM_BACKUP_PREFIX')) if (!values[key]) fail(`${key} is missing: set it in the environment, or name your private settings file with --env-file FILE`)
  try {
    return storage({ endpoint: values.BALM_BACKUP_ENDPOINT, region: values.BALM_BACKUP_REGION, bucket: values.BALM_BACKUP_BUCKET, prefix: values.BALM_BACKUP_PREFIX ?? '', accessKeyId: values.BALM_BACKUP_ACCESS_KEY_ID, secretAccessKey: values.BALM_BACKUP_SECRET_ACCESS_KEY }, { loopback: true })
  } catch (error) { fail(error.message) }
}

export const privateKey = () => {
  const path = flag('--key') ?? fail('Name your private key: --key exports/balm-backup-private-key.pem')
  try { return readFileSync(resolve(path), 'utf8') } catch { fail(`The key file ${path} could not be read`) }
}

/** Backup objects in the bucket, newest last: only files Balm wrote (balm-backup-*.balmbk). */
export async function backupsIn(target) {
  const keys = (await listObjects(target)).filter(key => /\/?balm-backup-[^/]+\.balmbk$/.test(key))
  if (!keys.length) fail('No backups were found in that bucket and folder.')
  return keys
}

async function* chunks(stream) { for await (const chunk of stream) yield new Uint8Array(chunk) }

/** Decrypts one backup (a downloaded file or an object) into a new private `.rer` file; returns its archive manifest. */
export async function decryptTo(source, key, output) {
  const out = resolve(output)
  if (existsSync(out)) fail(`${output} already exists; choose a new file name so a backup is never overwritten`)
  mkdirSync(dirname(out), { recursive: true, mode: 0o700 })
  const file = await open(out, 'wx', 0o600)
  let head = '', manifest
  try {
    for await (const plain of decryptBackup(source, key)) {
      if (!manifest) { head += Buffer.from(plain).toString('utf8'); const end = head.indexOf('\n'); if (end >= 0) manifest = JSON.parse(head.slice(0, end)) }
      await file.write(plain)
    }
  } catch (error) {
    await file.close(); rmSync(out, { force: true })
    fail({ wrong_backup_key: 'That private key does not open this backup.', backup_damaged: 'The backup is damaged or was changed after it was written.', backup_truncated: 'The backup is incomplete.', not_a_balm_backup: 'That file is not a Balm backup.' }[error.message] ?? `Decrypting failed: ${error.message}`)
  }
  await file.close(); chmodSync(out, 0o600)
  return manifest
}

export async function objectSource(target, objectKey) { return chunks(await getObject(target, objectKey)) }
export async function* fileSource(path) { for await (const chunk of createReadStream(resolve(path))) yield new Uint8Array(chunk) }

export const summary = manifest => {
  const rows = Object.fromEntries(manifest.tables.map(t => [t.name, t.count]))
  return `recovery point ${manifest.exportedAt}: ${rows.bm_clients ?? 0} clients, ${rows.bm_appointments ?? 0} visits, ${rows.bm_notes ?? 0} notes, ${rows.bm_invoices ?? 0} invoices, ${rows.bm_audit ?? 0} audit entries`
}
