import type { Bindings } from '../../auth.server'
import { commit, DomainError, guard, id, insist, one, stmt, type Actor, type Data } from '../domain/model'
import { seal, unseal } from './stripe-api'

export const accountingConnection = (db: D1Database) => one(db, 'SELECT * FROM bm_accounting_connection WHERE id=1')
export const accountingOrigin = (sandbox: unknown) => sandbox ? 'https://sandbox-quickbooks.api.intuit.com' : 'https://quickbooks.api.intuit.com'

export async function refreshAccounting(credentials: Data) {
  let response: Response
  try {
    response = await fetch('https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer', {
      method: 'POST', headers: { authorization: 'Basic ' + btoa(credentials.clientId + ':' + credentials.clientSecret), 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' },
      body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: credentials.refreshToken }),
    })
  } catch { throw new DomainError('QuickBooks could not be reached. The connection needs another attempt.', 409) }
  const token = await response.json().catch(() => ({})) as Data
  insist(response.ok && token.access_token && token.refresh_token, 'QuickBooks authorization expired or was refused. Reconnect the company.', 409)
  return { ...credentials, refreshToken: token.refresh_token, accessToken: token.access_token, expiresAt: Date.now() + Number(token.expires_in) * 1000 }
}

export async function accountingToken(env: Bindings, who: Actor, connection: Data) {
  let credentials: Data
  try { credentials = JSON.parse(await unseal(env, connection.credentials)) }
  catch { throw new DomainError('The installation key changed. Reconnect QuickBooks before resuming accounting.', 409) }
  if (credentials.expiresAt > Date.now() + 60_000) return credentials.accessToken as string
  const lease = id()
  await commit(env.DB, who, [stmt(env.DB, 'UPDATE bm_accounting_connection SET refresh_lease=?,refresh_until=? WHERE id=1 AND version=? AND (refresh_until IS NULL OR refresh_until<?)', lease, Date.now() + 60_000, connection.version, Date.now()), guard(env.DB, 'changes()=1')])
  try {
    const next = await refreshAccounting(credentials)
    await commit(env.DB, null, [stmt(env.DB, 'UPDATE bm_accounting_connection SET credentials=?,refresh_lease=NULL,refresh_until=NULL WHERE id=1 AND version=? AND refresh_lease=?', await seal(env, JSON.stringify(next)), connection.version, lease), guard(env.DB, 'changes()=1')])
    return next.accessToken as string
  } catch (error) {
    await stmt(env.DB, 'UPDATE bm_accounting_connection SET refresh_lease=NULL,refresh_until=NULL WHERE id=1 AND refresh_lease=?', lease).run()
    throw error
  }
}

export async function accountingCall(connection: Data, token: string, path: string, body?: Data, requestId?: string) {
  const url = new URL(`${accountingOrigin(connection.sandbox)}/v3/company/${encodeURIComponent(connection.realm_id)}/${path}`)
  url.searchParams.set('minorversion', '75')
  if (requestId) url.searchParams.set('requestid', requestId)
  let response: Response
  try { response = await fetch(url, { method: body ? 'POST' : 'GET', headers: { authorization: 'Bearer ' + token, accept: 'application/json', ...(body ? { 'content-type': 'application/json' } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) }) }
  catch { throw new DomainError('QuickBooks outcome is uncertain. Resume this exact batch to read back its result.', 409) }
  const value = await response.json().catch(() => ({})) as Data
  insist(response.ok, 'QuickBooks refused the accounting request. Review the company and mappings, then resume the saved batch.', 409)
  return value
}

export async function accountingAccounts(connection: Data, token: string) {
  const accounts: Data[] = []
  for (let start = 1; ; start += 1000) {
    const result = await accountingCall(connection, token, 'query?query=' + encodeURIComponent(`select * from Account where Active = true startposition ${start} maxresults 1000`))
    const page = result.QueryResponse?.Account ?? []
    accounts.push(...page.map((a: Data) => ({ id: String(a.Id), name: String(a.FullyQualifiedName ?? a.Name), type: String(a.AccountType), currency: a.CurrencyRef?.value ?? 'USD' })))
    if (page.length < 1000) return accounts
  }
}
