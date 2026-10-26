import assert from 'node:assert/strict'
import { mock } from 'node:test'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { execFileSync } from 'node:child_process'
import { harness } from './harness.mjs'
import { fakeProviders } from './fakes/stripe.mjs'
import { accountingDayFixture, accountingDay, accountingNow } from './accounting-day.mjs'

assert.equal(process.env.BALM_QBO_SANDBOX, '1', 'This manual journey requires explicit sandbox opt-in and held credentials.')
for (const key of ['QBO_CLIENT_ID', 'QBO_CLIENT_SECRET', 'QBO_REFRESH_TOKEN', 'QBO_REALM_ID']) assert.ok(process.env[key], key + ' is required through the named-key injector')
const ingestTool = process.env.BALM_QBO_INGEST
assert.ok(ingestTool, 'Set BALM_QBO_INGEST to the approved rotated-grant persistence helper.')
mock.timers.enable({ apis: ['Date'], now: accountingNow })
const stripe = fakeProviders(), origin = 'https://sandbox-quickbooks.api.intuit.com'
let access, h
const network = async request => {
  const url = new URL(request.url)
  if (url.hostname === 'api.stripe.com') return stripe.handler(request)
  assert.ok(url.origin === origin || url.origin === 'https://oauth.platform.intuit.com')
  const body = request.method === 'POST' ? await request.arrayBuffer() : undefined
  if (url.hostname === 'oauth.platform.intuit.com') {
    assert.ok(request.headers.get('authorization') === 'Basic ' + Buffer.from(process.env.QBO_CLIENT_ID + ':' + process.env.QBO_CLIENT_SECRET).toString('base64'), 'native OAuth authorization matches the injected client pair')
    assert.ok(new URLSearchParams(new TextDecoder().decode(body)).get('refresh_token') === process.env.QBO_REFRESH_TOKEN, 'native OAuth uses the injected company grant')
  }
  const response = await fetch(request.url, { method: request.method, headers: Object.fromEntries([...request.headers].filter(([key]) => ['authorization','accept','content-type'].includes(key))), ...(body ? { body } : {}) })
  const bytes = await response.arrayBuffer()
  if (url.hostname === 'oauth.platform.intuit.com' && !response.ok) {
    const fault = JSON.parse(new TextDecoder().decode(bytes))
    const allowed = ['invalid_grant','invalid_client','invalid_request','unsupported_grant_type','unauthorized_client']
    console.log(JSON.stringify({edge:'intuit_oauth',http:response.status,error:allowed.includes(fault.error) ? fault.error : 'other_provider_refusal'}))
  }
  if (url.hostname === 'oauth.platform.intuit.com' && response.ok) {
    const token = JSON.parse(new TextDecoder().decode(bytes))
    access = token.access_token
    if (token.refresh_token !== process.env.QBO_REFRESH_TOKEN) {
      const dir = await mkdtemp(join(tmpdir(), 'balm-qbo-grant-'))
      try {
        const file = join(dir, 'rotated.env')
        await writeFile(file, 'QBO_REFRESH_TOKEN=' + token.refresh_token + '\n', { mode: 0o600 })
        execFileSync('python3', ['-I', ingestTool, file], { stdio: ['ignore', 'pipe', 'pipe'] })
        process.env.QBO_REFRESH_TOKEN = token.refresh_token
      } finally { await rm(dir, { recursive: true, force: true }) }
    }
  }
  return new Response(bytes, { status: response.status, headers: { 'content-type': 'application/json' } })
}
try {
  h = await harness({ entry: 'tests/accounting-worker.ts', outbound: network })
  await accountingDayFixture(h, stripe)
  await h.cmd('accounting.connect', { realmId: process.env.QBO_REALM_ID, clientId: process.env.QBO_CLIENT_ID, clientSecret: process.env.QBO_CLIENT_SECRET, refreshToken: process.env.QBO_REFRESH_TOKEN, environment: 'sandbox', confirm: true })
  const connection = (await h.state()).accounting.connection, accounts = connection.accounts
  const choose = types => { const a = accounts.find(a => types.includes(a.type) && a.currency === 'USD'); assert.ok(a, 'Sandbox needs an existing USD ' + types.join(' or ') + ' account'); return a.id }
  const asset = choose(['Other Current Asset', 'Bank']), income = choose(['Income']), expense = choose(['Expense']), liability = choose(['Other Current Liability'])
  const mappings = { receivable: asset, income, card: asset, era: asset, cash: asset, external: asset, bank: choose(['Bank']), fees: expense, adjustments: expense, liability, tax: liability }
  await h.cmd('accounting.mapping', { mappings, confirm: true })
  const prepared = await h.cmd('accounting.prepare', { day: accountingDay }), input = { id: prepared.id, sha256: prepared.sha256, confirm: true }
  const first = await h.cmd('accounting.sync', input)
  assert.equal(first.status, 'confirmed')
  const second = await h.cmd('accounting.sync', input)
  assert.equal(second.providerId, first.providerId)
  assert.equal((await h.cmd('accounting.prepare', { day: accountingDay })).status, 'up_to_date')
  const batch = (await h.state()).accounting.batches.find(b => b.id === prepared.id)
  const query = new URL(`${origin}/v3/company/${encodeURIComponent(process.env.QBO_REALM_ID)}/query`)
  query.searchParams.set('query', `select * from JournalEntry where DocNumber = '${batch.payload.DocNumber}'`)
  query.searchParams.set('minorversion', '75')
  const response = await fetch(query, { headers: { authorization: 'Bearer ' + access, accept: 'application/json' } })
  assert.equal(response.status, 200, 'independent sandbox readback')
  const journals = (await response.json()).QueryResponse?.JournalEntry ?? []
  assert.equal(journals.length, 1, 'only one provider journal exists after repeat sync')
  assert.equal(String(journals[0].Id), first.providerId)
  const totals = lines => lines.reduce((out, l) => { const d = l.JournalEntryLineDetail, key = d.AccountRef.value; out[key] = (out[key] ?? 0) + Math.round(l.Amount * 100) * (d.PostingType === 'Debit' ? 1 : -1); return out }, {})
  assert.deepEqual(totals(journals[0].Line), totals(batch.payload.Line), 'actual books match the frozen native journal in cents')
  const output = { journey: 'tests/accounting-sandbox.mjs', result: 'PASS', candidate: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(), day: accountingDay, providerJournalId: first.providerId, docNumber: batch.payload.DocNumber, providerJournalCountAfterReplay: journals.length, expectedAccountCents: totals(batch.payload.Line), observedAccountCents: totals(journals[0].Line), postedLines: journals[0].Line.map(l => ({ description: l.Description, amount: l.Amount, postingType: l.JournalEntryLineDetail.PostingType, accountId: l.JournalEntryLineDetail.AccountRef.value })) }
  console.log(JSON.stringify(output, null, 2))
  if (process.env.BALM_SANDBOX_OUTPUT) await writeFile(process.env.BALM_SANDBOX_OUTPUT, JSON.stringify(output, null, 2) + '\n')
} finally { if (h) await h.close(); mock.timers.reset() }
