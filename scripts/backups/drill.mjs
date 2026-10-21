// The restore drill: prove your newest backup restores, in a separate place, without touching the clinic.
// It downloads the newest backup from your bucket, decrypts it with your private key, restores it with
// `rer import` into a scratch copy of Balm in a private temporary folder, reads the restored clinic back
// and deletes the scratch copy. Run it on your own computer, not on the hosted clinic.
//
//   node scripts/backups/drill.mjs --key exports/balm-backup-private-key.pem --env-file backup.env [--keep]
import { spawnSync } from 'node:child_process'
import { cpSync, existsSync, mkdirSync, mkdtempSync, rmSync, symlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { backupsIn, decryptTo, args, fail, objectSource, privateKey, storageFromEnvironment, summary } from './lib.mjs'

const root = join(dirname(new URL(import.meta.url).pathname), '..', '..')
const key = privateKey(), target = storageFromEnvironment(), keys = await backupsIn(target)
const scratch = mkdtempSync(join(tmpdir(), 'balm-drill-')), checkout = join(scratch, 'scratch-balm'), archive = join(scratch, 'backup.rer')
const done = code => { if (!args.includes('--keep')) rmSync(scratch, { recursive: true, force: true }); else console.log(`Scratch copy kept in ${scratch}`); process.exit(code) }
try {
  console.log(`Downloading and decrypting ${keys.at(-1)}…`)
  const manifest = await decryptTo(await objectSource(target, keys.at(-1)), key, archive)
  console.log(`Backup holds ${summary(manifest)}.`)
  mkdirSync(checkout)
  for (const name of ['package.json', 'pnpm-lock.yaml', 'OPERATIONS.json', 'RUN-LOCALLY.md', 'ACCEPTANCE.md', 'SEED-COMMAND-CONTRACT.md', 'OPERATIONS.md', '.node-version', 'wrangler.jsonc', 'deploy.json', 'rer-setup.json', 'scripts', 'src', 'migrations']) if (existsSync(join(root, name))) cpSync(join(root, name), join(checkout, name), { recursive: true })
  symlinkSync(resolve(root, 'node_modules'), join(checkout, 'node_modules'), 'dir')
  const env = { ...process.env, CI: 'true', WRANGLER_SEND_METRICS: 'false' }
  delete env.RER_LOCAL_OPERATION; delete env.RER_LOCAL_STATE_PATH
  const cli = join(root, 'node_modules/@runeditrun/rer/global/rer.mjs')
  if (!existsSync(cli)) fail('Run rer install first.')
  console.log('Restoring into a scratch copy of Balm…')
  const restore = spawnSync(process.execPath, [cli, 'import', '--input', archive, '--yes', '--no-queue'], { cwd: checkout, env, encoding: 'utf8' })
  if (restore.status !== 0) { console.error(`The restore failed:\n${`${restore.stdout}\n${restore.stderr}`.trim().split('\n').slice(-8).join('\n')}`); done(1) }
  const read = spawnSync(process.execPath, [join(root, 'node_modules/wrangler/bin/wrangler.js'), 'd1', 'execute', 'foundation', '--local', '--persist-to', '.wrangler/state', '--config', 'wrangler.jsonc', '--json', '--command',
    "SELECT (SELECT COUNT(*) FROM bm_clients) AS clients,(SELECT COUNT(*) FROM bm_appointments) AS visits,(SELECT COUNT(*) FROM bm_notes) AS notes,(SELECT COUNT(*) FROM bm_invoices) AS invoices,(SELECT COUNT(*) FROM bm_audit) AS audit,(SELECT email FROM oa_operators WHERE role='owner' AND status='active' ORDER BY created_at LIMIT 1) AS owner"], { cwd: checkout, env, encoding: 'utf8' })
  if (read.status !== 0) { console.error('The restored clinic could not be read back.'); done(1) }
  const found = JSON.parse(read.stdout)[0].results[0], expected = Object.fromEntries(manifest.tables.map(t => [t.name, t.count]))
  const same = found.clients === expected.bm_clients && found.visits === expected.bm_appointments && found.notes === expected.bm_notes && found.invoices === expected.bm_invoices && found.audit === expected.bm_audit
  console.log(`Restored clinic: ${found.clients} clients, ${found.visits} visits, ${found.notes} notes, ${found.invoices} invoices, ${found.audit} audit entries (owner ${found.owner ?? 'none'}).`)
  if (!same) { console.error('Drill FAILED: the restored clinic does not match the backup.'); done(1) }
  console.log(`Drill passed: the backup with ${summary(manifest)} restored in a separate place and matches. The scratch copy is deleted.`)
  done(0)
} catch (error) { console.error(`Drill failed: ${error.message}`); done(1) }
