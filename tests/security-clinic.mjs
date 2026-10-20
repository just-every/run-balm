import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { request as httpRequest } from 'node:http'
import { clinic, slots } from './clinic.mjs'

// These fixtures use the real commands, D1 and public HTTP handlers. Only the
// harness's mail provider (and the existing Stripe HTTP fixture) are external fakes.
export async function securityClinic(h) {
  const { service, practitioners: [practitioner] } = await clinic(h)
  const starts = [...new Set(await slots(h, service.id, practitioner.id))].filter((_, i) => i % 4 === 0)
  assert.ok(starts.length > 20)
  const booking = (start, extra = {}) => ({
    serviceId: service.id, practitionerId: practitioner.id, start,
    firstName: 'Maya', lastName: 'Lee', dateOfBirth: '1988-04-02',
    email: 'maya@patient.example', phone: '(312) 555-0100', privacy: 'on', ...extra,
  })
  return { service, practitioner, starts, booking }
}

export const edgeAddress = n => `198.51.${Math.floor(n / 250)}.${n % 250 + 1}`

export async function publicRequest(h, path, fields, options = {}) {
  if (options.cf === null) {
    // A real direct HTTP socket bypasses Miniflare's synthetic Cloudflare edge.
    const socket = await h.mf.unsafeGetDirectURL()
    return new Promise((resolve, reject) => {
      const request = httpRequest(socket, { method: fields === undefined ? 'GET' : 'POST', path: h.origin + path,
        headers: { host: new URL(h.origin).host, origin: h.origin, 'CF-Connecting-IP': options.address, ...options.headers } }, response => {
        let text = ''; response.setEncoding('utf8'); response.on('data', chunk => { text += chunk })
        response.on('end', () => resolve({ status: response.statusCode, text, location: response.headers.location, cookie: response.headers['set-cookie']?.[0] }))
      })
      request.on('error', reject); request.setTimeout(10_000, () => request.destroy(new Error('direct HTTP door timed out')))
      request.end(fields === undefined ? undefined : new URLSearchParams(fields).toString())
    })
  }
  const response = await h.mf.dispatchFetch(h.origin + path, {
    method: fields === undefined ? 'GET' : 'POST',
    cf: options.cf === undefined ? { country: 'US', colo: 'DFW' } : options.cf,
    headers: {
      origin: h.origin, 'content-type': 'application/x-www-form-urlencoded',
      'CF-Connecting-IP': options.address ?? edgeAddress(1),
      ...options.headers,
    },
    ...(fields === undefined ? {} : { body: new URLSearchParams(fields).toString() }),
    redirect: 'manual',
  })
  return {
    status: response.status, text: await response.text(),
    location: response.headers.get('location'), cookie: response.headers.get('set-cookie'),
  }
}

export async function untilLimited(attempt) {
  for (let n = 0; n < 200; n++) {
    const response = await attempt(n)
    if (response.status === 429) return response
    assert.ok(response.status < 500, 'public abuse attempts must not become server errors')
  }
  assert.fail('public door never refused sustained abuse')
}

export async function effects(h, stripe) {
  const tables = ['bm_clients', 'bm_appointments', 'bm_intake_responses', 'bm_audit',
    'bm_pay_links', 'bm_card_payments', 'bm_card_setups', 'bm_portal_links', 'bm_portal_sessions']
  const counts = {}
  for (const table of tables) counts[table] = (await h.db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).first()).n
  return { ...counts, mail: h.mail.length, provider: stripe?.calls.length ?? 0 }
}

export function portalToken(h, email) {
  const mail = h.mail.findLast(m => m.to.includes(email) && m.text.includes('/portal/confirm?token='))
  assert.ok(mail, 'the real mail adapter delivered a patient sign-in link')
  return new URL(mail.text.match(/https?:\/\/[^\s]+\/portal\/confirm\?token=[^\s]+/)[0]).searchParams.get('token')
}

export async function assertPrivateStorage(h, tokens = [], identifiers = []) {
  const data = {}
  for (const table of ['bm_appointments', 'bm_pay_links', 'bm_portal_links', 'bm_portal_sessions', 'bm_audit']) {
    data[table] = (await h.db.prepare(`SELECT * FROM ${table}`).all()).results
  }
  const stored = JSON.stringify(data)
  for (const token of tokens) {
    assert.ok(!stored.includes(token), 'private bearer values are absent from persisted domain rows')
    const hash = createHash('sha256').update(token).digest('hex')
    assert.ok(stored.includes(hash), 'the credential is represented by its hash')
  }
  for (const table of ['bm_pay_links', 'bm_portal_links', 'bm_portal_sessions']) {
    for (const row of data[table]) {
      assert.ok(Date.parse(row.expires_at) > Date.parse(row.created_at), 'private credentials have a finite expiry after creation')
      assert.match(row.token_hash, /^[a-f0-9]{64}$/)
    }
  }
  const rates = (await h.db.prepare('SELECT * FROM bm_portal_rates').all()).results
  assert.ok(rates.length, 'rate counters persist in D1')
  for (const row of rates) {
    assert.match(row.key_hash, /^[a-f0-9]{64}$/)
    assert.ok(Number.isInteger(row.window) && row.attempts > 0)
  }
  for (const value of [...tokens, ...identifiers]) {
    assert.ok(!JSON.stringify(rates).includes(value), 'rate storage contains no raw address, email, patient id or token')
  }
}
