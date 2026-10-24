import { codeSetEdge, installCodeSetFixtures } from './code-sets-journey.mjs'
import {authorizeTestSession} from './staff-second-step.mjs'
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
  const dir = options.root ? join(options.root, '.wrangler/state/v3') : await mkdtemp(join(tmpdir(), 'balm-test-')), origin = `${options.https === false ? 'http' : 'https'}://127.0.0.1:${port}`, setup = randomBytes(32).toString('hex')
  const auth = { AUTH_LOCAL: 'false', OWNER_EMAIL: 'owner@clinic.example', SESSION_SECRET: randomBytes(32).toString('hex'), INSTALLATION_KEY: randomBytes(32).toString('hex'), SETUP_TOKEN: setup, MAIL_PROVIDER: 'resend', MAIL_API_KEY: 'synthetic-balm-1', MAIL_FROM: 'auth@clinic.example', ...options.auth, AUTH_ORIGIN: origin }
  // Exercise the production mail adapter; only the provider's HTTP edge is fake.
  // h.mail contains Resend request bodies in send order, in this test's memory only.
  const mail = [], outboundRequests = [], codeSets = options.codeSetEdge ?? codeSetEdge()
  const outbound = async request => {
    // Record before dispatch: a provider error caught by product code must not hide egress.
    const url = new URL(request.url)
    outboundRequests.push({ method: request.method, origin: url.origin, pathname: url.pathname })
    if (request.url === 'https://api.resend.com/emails' && request.method === 'POST') {
      assert.equal(request.headers.get('authorization'), `Bearer ${auth.MAIL_API_KEY}`)
      mail.push(await request.json())
      return Response.json({ id: `mail_test_${mail.length}` })
    }
    if (codeSets.handles(request.url)) return codeSets.outbound(request)
    if (options.outbound) return options.outbound(request)
    throw new Error(`Unexpected outbound request: ${request.method} ${request.url}`)
  }
  const mf = new Miniflare({ ...convertV4MiniflareOptions({ host: '127.0.0.1', port, https: !!options.browserHttps, modules: true, script: bundle.outputFiles[0].text, compatibilityDate: '2026-09-08', compatibilityFlags: ['nodejs_compat'], d1Databases: { DB: 'local-foundation-only' }, bindings: auth, outboundService: outbound, ...(options.direct ? { unsafeDirectSockets: [{ entrypoint: 'default', proxy: true, host: '127.0.0.1' }] } : {}) }), resourcePersistencePath: dir })
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
    if(bootstrap&&options.autoMfa!==false)await authorizeTestSession(send,owner,auth.OWNER_EMAIL,auth.SESSION_SECRET+':'+(options.root??'memory'))
    const cmd = async (name, input, cookie = owner, status = 200, headers = {}) => {
      const r = await send('/api/balm/command', { name, input }, cookie, headers)
      assert.equal(r.status, status, `${name}: ${JSON.stringify(r.value)}`)
      return r.value.result ?? r.value
    }
    const state = async (cookie = owner, status = 200) => { const r = await send('/api/balm/state', undefined, cookie); assert.equal(r.status, status, JSON.stringify(r.value)); return r.value }
    const confirmMail = async email => {
      const message = mail.findLast(m => m.to.includes(email) && /\/auth\/confirm\?token=/.test(m.text))
      assert.ok(message, 'sign-in or invitation submitted to the mail provider')
      const token = new URL(message.text.match(/https?:\/\/[^\s]+\/auth\/confirm\?token=[^\s]+/)[0]).searchParams.get('token')
      const r = await send('/auth/confirm', { token })
      assert.equal(r.status, 303, JSON.stringify(r.value)); if(options.autoMfa!==false)await authorizeTestSession(send,r.cookie,email,auth.SESSION_SECRET+':'+(options.root??'memory')); return r.cookie
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
    const h = { db, mf, origin, owner, auth, mail, outboundRequests, send, cmd, state, staff, finishSetup, form, confirmMail, signIn, codeSets, codeSetsInstalled: false, provisioningRequests: [], close: async () => { await mf.dispose(); if (!options.root) await rm(dir, { recursive: true, force: true }) } }
    if (bootstrap && options.autoMfa !== false && options.codeSets !== false) {
      await installCodeSetFixtures(h, codeSets)
      h.codeSetsInstalled = true
      // Provisioning is explicit test setup. Subsequent egress assertions start
      // here; every setup request remains available for inspection separately.
      h.provisioningRequests.push(...outboundRequests.splice(0))
    }
    return h
  } catch (error) { await mf.dispose(); if (!options.root) await rm(dir, { recursive: true, force: true }); throw error }
}

export async function run(fn, options) { const h = await harness(options); try { await fn(h) } finally { await h.close() } }
