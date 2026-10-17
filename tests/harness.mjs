import assert from 'node:assert/strict'
import { createServer } from 'node:net'
import { randomBytes } from 'node:crypto'
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { build } from 'esbuild'
import { Miniflare, convertV4MiniflareOptions } from 'miniflare'
import { unstable_splitSqlQuery } from 'wrangler'

const bundles = new Map()
export async function harness(options = {}) {
  const entry = options.entry ?? 'tests/worker.ts'
  if (!bundles.has(entry)) bundles.set(entry, await build({ entryPoints: [entry], bundle: true, write: false, format: 'esm', platform: 'neutral', conditions: ['workerd', 'worker', 'browser'], external: ['node:*', 'cloudflare:*'], target: 'es2023' }))
  const bundle = bundles.get(entry)
  const socket = createServer(); await new Promise(r => socket.listen(0, '127.0.0.1', r)); const port = socket.address().port; await new Promise(r => socket.close(r))
  const dir = options.root ? join(options.root, '.wrangler/state/v3') : await mkdtemp(join(tmpdir(), 'balm-test-')), origin = `${options.https ? 'https' : 'http'}://127.0.0.1:${port}`, setup = randomBytes(32).toString('hex')
  const auth = { AUTH_LOCAL: 'true', OWNER_EMAIL: 'owner@clinic.example', SESSION_SECRET: randomBytes(32).toString('hex'), SETUP_TOKEN: setup, MAIL_PROVIDER: 'development', MAIL_FROM: 'auth@clinic.example', ...options.auth, AUTH_ORIGIN: origin }
  const mf = new Miniflare({ ...convertV4MiniflareOptions({ host: '127.0.0.1', port, modules: true, script: bundle.outputFiles[0].text, compatibilityDate: '2026-09-08', compatibilityFlags: ['nodejs_compat'], d1Databases: { DB: 'local-foundation-only' }, bindings: auth, ...(options.outbound ? { outboundService: options.outbound } : {}) }), resourcePersistencePath: dir })
  try {
    const db = await mf.getD1Database('DB')
    if (!options.root) for (const file of (await readdir('migrations/core')).filter(f => f.endsWith('.sql')).sort()) await db.batch(unstable_splitSqlQuery(await readFile('migrations/core/' + file, 'utf8')).map(sql => db.prepare(sql)))
    const send = async (path, body, cookie = '', headers = {}) => {
      const response = await mf.dispatchFetch(origin + path, { method: body === undefined ? 'GET' : 'POST', headers: { host: new URL(origin).host, origin, 'content-type': 'application/json', cookie, ...headers }, ...(body === undefined ? {} : { body: JSON.stringify(body) }), redirect: 'manual' })
      const text = await response.text(); let value
      try { value = JSON.parse(text) } catch { value = text }
      return { status: response.status, value, text, headers: response.headers, cookie: response.headers.get('set-cookie')?.split(';')[0] }
    }
    const bootstrap = options.owner || options.unclaimed ? null : await send('/auth/bootstrap', { token: auth.SETUP_TOKEN, displayName: 'Jordan Clinic' })
    if (bootstrap) assert.equal(bootstrap.status, 303, bootstrap.text)
    const owner = options.owner ?? bootstrap?.cookie
    const cmd = async (name, input, cookie = owner, status = 200, headers = {}) => {
      const r = await send('/api/balm/command', { name, input }, cookie, headers)
      assert.equal(r.status, status, `${name}: ${JSON.stringify(r.value)}`)
      return r.value.result ?? r.value
    }
    const state = async (cookie = owner, status = 200) => { const r = await send('/api/balm/state', undefined, cookie); assert.equal(r.status, status, JSON.stringify(r.value)); return r.value }
    const confirmMail = async email => {
      const rows = (await db.prepare('SELECT message FROM rer_mail_development_outbox ORDER BY sequence DESC').all()).results
      const message = rows.map(r => JSON.parse(r.message)).find(m => m.to.includes(email))
      assert.ok(message, 'invitation delivered to the local outbox')
      const token = new URL(message.text.match(/https?:\/\/[^\s]+\/auth\/confirm\?token=[^\s]+/)[0]).searchParams.get('token')
      const r = await send('/auth/confirm', { token })
      assert.equal(r.status, 303, JSON.stringify(r.value)); return r.cookie
    }
    // Staff sign in through real native invitations.
    const staff = async (name, role = 'practitioner', extra = {}) => {
      const email = `${name.toLowerCase()}@clinic.example`, saved = await cmd('staff.save', { name, email, role, active: true, ...extra })
      await cmd('staff.invite', { id: saved.id })
      return { ...saved, cookie: await confirmMail(email) }
    }
    // First-run setup, so the owner's /app pages open.
    const finishSetup = async () => {
      const r = await mf.dispatchFetch(origin + '/setup', { method: 'POST', headers: { origin, cookie: owner, 'content-type': 'application/x-www-form-urlencoded' }, body: 'confirm=yes', redirect: 'manual' })
      assert.equal(r.status, 303)
    }
    const form = async (path, fields, cookie = '') => {
      const response = await mf.dispatchFetch(origin + path, { method: 'POST', headers: { host: new URL(origin).host, origin, cookie, 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(fields).toString(), redirect: 'manual' })
      return { status: response.status, text: await response.text(), location: response.headers.get('location') }
    }
    const signIn = async email => { const response = await send('/auth/magic-link', {email}); assert.equal(response.status,202,response.text); return confirmMail(email) }
    return { db, mf, origin, owner, auth, send, cmd, state, staff, finishSetup, form, confirmMail, signIn, close: async () => { await mf.dispose(); if (!options.root) await rm(dir, { recursive: true, force: true }) } }
  } catch (error) { await mf.dispose(); if (!options.root) await rm(dir, { recursive: true, force: true }); throw error }
}

export async function run(fn, options) { const h = await harness(options); try { await fn(h) } finally { await h.close() } }
