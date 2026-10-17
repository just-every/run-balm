// Back up a hosted Balm: its whole D1 database (every table: clinic settings, staff, clients, visits, intake
// answers, notes with every revision, invoices, payments, the access audit) as one SQL file in exports/,
// readable only by you. `rer export` saves the clinic on this computer, never the hosted one.
//
//   node scripts/hosted-backup.mjs [--environment NAME] [--env-file FILE] [--output FILE]
//
// It uses CLOUDFLARE_ACCOUNT_ID and CLOUDFLARE_API_TOKEN from the environment, or from --env-file (the
// private file you deploy with). Balm keeps no files outside D1, so this one file is the whole clinic.
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { chmodSync, mkdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'

const root = join(dirname(new URL(import.meta.url).pathname), '..')
const args = process.argv.slice(2), flag = name => { const i = args.indexOf(name); return i < 0 ? undefined : args[i + 1] }
const fail = message => { console.error(message); process.exit(2) }

const environment = flag('--environment') ?? 'production'
if (!/^[a-z0-9][a-z0-9-]{0,31}$/.test(environment)) fail(`--environment ${environment} is not an environment name`)

const credentials = {}
for (const key of ['CLOUDFLARE_ACCOUNT_ID', 'CLOUDFLARE_API_TOKEN']) if (process.env[key]) credentials[key] = process.env[key]
const envFile = flag('--env-file')
if (envFile) {
  let text
  try { text = readFileSync(resolve(envFile), 'utf8') } catch { fail(`The settings file ${envFile} could not be read`) }
  for (const [, key, value] of text.split(/\r?\n/).map(line => /^\s*(?:export\s+)?([A-Z][A-Z0-9_]*)\s*=\s*(.*?)\s*$/.exec(line)).filter(Boolean))
    if (key in { CLOUDFLARE_ACCOUNT_ID: 1, CLOUDFLARE_API_TOKEN: 1 }) credentials[key] = value.replace(/^(["'])(.*)\1$/, '$2')
}
for (const key of ['CLOUDFLARE_ACCOUNT_ID', 'CLOUDFLARE_API_TOKEN']) if (!credentials[key]) fail(`${key} is missing: set it as for rer deploy, or name your private settings file with --env-file FILE`)

// rer deploy records the database it created for each environment in .rer/deploy; without that record
// (a backup from another folder) the name follows rer's rule: <project>-<environment>-db, e.g. balm-production-db.
const recorded = () => {
  try { const names = Object.keys(JSON.parse(readFileSync(join(root, '.rer/deploy', `${environment}.json`), 'utf8')).owned?.d1 ?? {}); return names.length === 1 ? names[0] : undefined }
  catch { return undefined }
}
const declaration = JSON.parse(readFileSync(join(root, 'deploy.json'), 'utf8'))
const database = recorded() ?? `${declaration.project.split('/').at(-1)}-${environment}-${declaration.d1[0].binding.toLowerCase()}`
const output = flag('--output') ?? join('exports', `${database}-${new Date().toISOString().slice(0, 10)}.sql`)
mkdirSync(dirname(resolve(output)), { recursive: true })

// The file holds health records: it is created readable only by you, like a local .rer export.
process.umask(0o077)
console.log(`Exporting ${database} from your Cloudflare account; the hosted Balm pauses for the few seconds this takes.`)
const run = spawnSync(process.execPath, [join(root, 'node_modules/wrangler/bin/wrangler.js'), 'd1', 'export', database, '--remote', '--output', output], {
  cwd: process.cwd(), stdio: ['ignore', 'pipe', 'pipe'], encoding: 'utf8',
  env: { ...process.env, ...credentials, WRANGLER_SEND_METRICS: 'false' },
})
if (run.status !== 0) {
  const said = `${run.stdout}\n${run.stderr}`.split('\n').filter(line => /error|not found|authentication|permission|\[ERROR\]/i.test(line)).slice(0, 6).join('\n')
  fail(`The export failed${said ? `:\n${said}` : ''}\nCheck the environment name (--environment) and that the API token has Account → D1 → Edit.`)
}

chmodSync(resolve(output), 0o600)
const sql = readFileSync(resolve(output))
const rows = {}
for (const [, table] of sql.toString('utf8').matchAll(/^INSERT INTO "?([A-Za-z0-9_]+)"?/gm)) rows[table] = (rows[table] ?? 0) + 1
const count = name => rows[name] ?? 0
console.log(`Backed up ${database} to ${output} (${Math.round(statSync(resolve(output)).size / 1024)} KB, sha256 ${createHash('sha256').update(sql).digest('hex')}), readable only by you.`)
console.log(`It holds ${Object.values(rows).reduce((s, n) => s + n, 0)} rows in ${Object.keys(rows).length} tables: ${count('bm_clients')} clients, ${count('bm_appointments')} visits, ${count('bm_notes')} notes, ${count('bm_invoices')} invoices, ${count('bm_audit')} audit entries.`)
console.log(`Restore it into a fresh copy of Balm with: rer run restore:hosted -- --input ${output}`)
