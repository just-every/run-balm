import type { Bindings } from '../../auth.server'
import { audit, commit, guard, human, insist, need, now, rows, stmt, text, type Actor, type Data } from '../domain/model'
import { accountingAccounts, accountingCall, accountingConnection, accountingToken, refreshAccounting } from './accounting-api'
import { prepareAccounting, syncAccounting } from './accounting-journal'
import { seal } from './stripe-api'

export const accountingKeys = ['receivable', 'income', 'card', 'era', 'cash', 'external', 'bank', 'fees', 'adjustments', 'liability', 'tax'] as const

export async function accountingView(env: Bindings, who: Actor) {
  if (who.role !== 'owner') return null
  const c = await accountingConnection(env.DB)
  return { connection: c ? { realmId: c.realm_id, companyName: c.company_name, sandbox: !!c.sandbox, accounts: JSON.parse(c.accounts), mappings: c.mappings ? JSON.parse(c.mappings) : null, connectedAt: c.connected_at } : null,
    batches: (await rows(env.DB, 'SELECT id,realm_id,sandbox,day,payload,sha256,status,prepared_at,provider_id,confirmed_at,error FROM bm_accounting_batches ORDER BY prepared_at DESC LIMIT 30')).map(b => ({ ...b, payload: JSON.parse(b.payload) })) }
}

export async function accountingCommand(env: Bindings, who: Actor, name: string, input: Data) {
  human(who); need(who, 'owner')
  const db = env.DB
  if (name === 'accounting.connect') {
    insist(input.confirm === true || input.confirm === 'on', 'Explicitly approve the accounting connection and financial handoff.')
    const realm = text(input.realmId, 'company_id', 100)
    insist(/^\d+$/.test(realm), 'Use the numeric QuickBooks company id.')
    const sandbox = input.environment !== 'production'
    insist(['sandbox', 'production'].includes(input.environment), 'Choose sandbox or production.')
    const credentials = await refreshAccounting({ clientId: text(input.clientId, 'client_id', 300), clientSecret: text(input.clientSecret, 'client_secret', 500), refreshToken: text(input.refreshToken, 'refresh_token', 2000) })
    // Persist a rotated grant before making any further provider request.
    const old = await accountingConnection(db), same = old?.realm_id === realm && !!old?.sandbox === sandbox
    await commit(db, who, [stmt(db, `INSERT INTO bm_accounting_connection(id,realm_id,sandbox,credentials,accounts,connected_at,connected_by) VALUES(1,?,?,?,'[]',?,?)
      ON CONFLICT(id) DO UPDATE SET realm_id=excluded.realm_id,sandbox=excluded.sandbox,credentials=excluded.credentials,accounts='[]',mappings=NULL,version=bm_accounting_connection.version+1,connected_at=excluded.connected_at,connected_by=excluded.connected_by,refresh_lease=NULL,refresh_until=NULL`, realm, sandbox ? 1 : 0, await seal(env, JSON.stringify(credentials)), now(), who.email), audit(db, who, 'accounting.connected', null, null, sandbox ? 'sandbox' : 'production')])
    const c = (await accountingConnection(db))!
    const company = await accountingCall(c, credentials.accessToken, 'companyinfo/' + encodeURIComponent(realm))
    insist(typeof company.CompanyInfo?.CompanyName === 'string', 'QuickBooks company identity could not be verified.', 409)
    const accounts = await accountingAccounts(c, credentials.accessToken)
    await commit(db, who, [stmt(db, 'UPDATE bm_accounting_connection SET accounts=?,mappings=?,company_name=? WHERE id=1 AND version=?', JSON.stringify(accounts), same ? old.mappings : null, company.CompanyInfo.CompanyName, c.version), guard(db, 'changes()=1')])
    return accountingView(env, who)
  }
  if (name === 'accounting.disconnect') {
    await commit(db, who, [stmt(db, 'DELETE FROM bm_accounting_connection WHERE id=1'), audit(db, who, 'accounting.disconnected', null)])
    return { disconnected: true }
  }
  if (name === 'accounting.mapping') {
    insist(input.confirm === true || input.confirm === 'on', 'Review and approve every account mapping.')
    const c = await accountingConnection(db)
    insist(c, 'Connect QuickBooks first.', 409)
    const accounts = await accountingAccounts(c, await accountingToken(env, who, c)), mappings: Data = {}
    for (const key of accountingKeys) {
      const value = String(input.mappings?.[key] ?? input[key] ?? ''), account = accounts.find(a => a.id === value)
      insist(account && account.currency === 'USD' && !['Accounts Receivable', 'Accounts Payable'].includes(account.type), 'Choose active USD control accounts. Customer-specific receivable and payable accounts require their own subledger.')
      mappings[key] = value
    }
    insist(mappings.receivable !== mappings.income, 'Receivables and income need different control accounts.')
    await commit(db, who, [stmt(db, 'UPDATE bm_accounting_connection SET accounts=?,mappings=?,version=version+1 WHERE id=1 AND version=?', JSON.stringify(accounts), JSON.stringify(mappings), c.version), guard(db, 'changes()=1'), audit(db, who, 'accounting.mapping_reviewed', null)])
    return accountingView(env, who)
  }
  if (name === 'accounting.prepare') return prepareAccounting(env, who, input)
  insist(name === 'accounting.sync', 'unknown_command', 404)
  return syncAccounting(env, who, input)
}
