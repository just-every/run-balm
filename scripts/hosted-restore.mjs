// Restore a hosted Balm backup (the SQL file scripts/hosted-backup.mjs saves) into a fresh copy of Balm on
// this computer: after `rer install`, before `rer setup` and before any data.
//
//   node scripts/hosted-restore.mjs --input exports/balm-production-db-2026-10-17.sql
//
// Then run `rer setup --owner-email <the hosted clinic's owner>` and `rer dev`. A copy that already holds
// data is refused, so a restore never mixes two clinics.
import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { unstable_splitSqlQuery as statements } from 'wrangler'

const root = join(dirname(new URL(import.meta.url).pathname), '..')
const args = process.argv.slice(2), flag = name => { const i = args.indexOf(name); return i < 0 ? undefined : args[i + 1] }
const fail = message => { console.error(message); process.exit(2) }

const input = flag('--input') ?? fail('Name the backup: --input exports/balm-production-db-DATE.sql')
if (!existsSync(resolve(input))) fail(`${input} does not exist`)
if (!/^(PRAGMA|CREATE TABLE)/m.test(readFileSync(resolve(input), 'utf8').slice(0, 4096))) fail(`${input} is not a hosted Balm backup (an SQL file from scripts/hosted-backup.mjs). For a .rer archive, use rer import.`)
if (!existsSync(join(root, 'node_modules/wrangler/bin/wrangler.js'))) fail('Run rer install first.')

const database = /"database_name"\s*:\s*"([^"]+)"/.exec(readFileSync(join(root, 'wrangler.jsonc'), 'utf8'))?.[1] ?? fail('wrangler.jsonc names no D1 database')
// The same local database rer setup, rer dev and rer import use.
const wrangler = (...more) => spawnSync(process.execPath, [join(root, 'node_modules/wrangler/bin/wrangler.js'), 'd1', 'execute', database, '--local', '--persist-to', '.wrangler/state', '--config', 'wrangler.jsonc', ...more], {
  cwd: root, stdio: ['ignore', 'pipe', 'pipe'], encoding: 'utf8', env: { ...process.env, WRANGLER_SEND_METRICS: 'false' },
})
const query = sql => {
  const run = wrangler('--json', '--command', sql)
  if (run.status !== 0) fail(`Reading the local clinic failed:\n${`${run.stdout}\n${run.stderr}`.trim().split('\n').slice(-6).join('\n')}\nStop Balm first: rer dev --stop`)
  return JSON.parse(run.stdout)[0].results
}

const tables = query("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE '\\_cf\\_%' ESCAPE '\\' AND name NOT LIKE 'sqlite\\_%' ESCAPE '\\'")
if (tables.length) fail(`This copy of Balm already has a database (${tables.length} tables), so the restore was refused: it only goes into a fresh copy, before rer setup.\nRestore into a new folder (git clone https://github.com/just-every/run-balm.git, then rer install), or keep this clinic with rer export --output exports/before-restore.rer, then rer reset --yes and run this again.`)

// Cloudflare's export writes each table's rows right after the table, but D1 checks foreign keys as rows go
// in: create every table first, then the rows, then indexes and triggers (so no trigger fires on restored rows).
const all = statements(readFileSync(resolve(input), 'utf8'))
const phase = sql => /^\s*PRAGMA/i.test(sql) ? 0 : /^\s*CREATE\s+TABLE/i.test(sql) ? 1 : /^\s*(INSERT|DELETE)\s/i.test(sql) ? 2 : 3
const ordered = [0, 1, 2, 3].flatMap(n => all.filter(sql => phase(sql) === n)).map(sql => sql.trim().replace(/;?$/, ';')).join('\n')
const staged = join(root, '.wrangler', `restore-${process.pid}.sql`)
console.log(`Restoring ${input} into this copy of Balm…`)
writeFileSync(staged, ordered, { mode: 0o600 })
const run = wrangler('--file', staged, '--yes')
rmSync(staged, { force: true })
if (run.status !== 0) fail(`The restore failed:\n${`${run.stdout}\n${run.stderr}`.trim().split('\n').slice(-8).join('\n')}`)

const [counts] = query("SELECT (SELECT COUNT(*) FROM bm_clients) AS clients,(SELECT COUNT(*) FROM bm_appointments) AS visits,(SELECT COUNT(*) FROM bm_notes) AS notes,(SELECT COUNT(*) FROM bm_invoices) AS invoices,(SELECT COUNT(*) FROM bm_audit) AS audit,(SELECT email FROM oa_operators WHERE role='owner' AND status='active' ORDER BY created_at LIMIT 1) AS owner")
console.log(`Restored ${counts.clients} clients, ${counts.visits} visits, ${counts.notes} notes, ${counts.invoices} invoices and ${counts.audit} audit entries.`)
console.log(`Next: rer setup --owner-email ${counts.owner ?? 'the-hosted-owner@example.com'}, then rer dev.`)
