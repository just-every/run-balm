import { accountingKeys } from '../payments/accounting'
import { check, field, form, h, hidden, money, panel, select, status } from './shared'

const labels: Record<string, string> = { receivable: 'Receivable control', income: 'Service income', card: 'Card clearing', era: 'ERA clearing', cash: 'Cash on hand', external: 'Other payment clearing', bank: 'Bank deposits', fees: 'Processor fees', adjustments: 'Adjustments', liability: 'Gift value liability', tax: 'Sales tax liability' }
const path = '/app/clinic'

export function accountingPanel(s: any) {
  if (s.actor.role !== 'owner') return ''
  const data = s.accounting, c = data?.connection
  const connect = form('accounting.connect', path,
    select('environment', 'QuickBooks environment', [['sandbox', 'Sandbox'], ['production', 'Production']], c?.sandbox === false ? 'production' : 'sandbox')
    + field('realmId', 'Company id', '', 'text', 'required inputmode="numeric" autocomplete="off"')
    + field('clientId', 'Intuit client id', '', 'password', 'required autocomplete="off"')
    + field('clientSecret', 'Intuit client secret', '', 'password', 'required autocomplete="off"')
    + field('refreshToken', 'Authorized company refresh token', '', 'password', 'required autocomplete="off"')
    + check('confirm', 'I authorize this company connection and will review each financial handoff.'), c ? 'Reconnect company' : 'Connect QuickBooks')
  const mappings = c ? `<p><strong>${h(c.companyName || 'QuickBooks company')}</strong> · ${c.sandbox ? 'Sandbox' : 'Production'} · ${h(c.realmId)}</p><details${c.mappings ? '' : ' open'}><summary>Review account mappings</summary><p>Use USD control accounts. Balm sends dates, amounts and payment methods; no patient or clinical details.</p>` + form('accounting.mapping', path, accountingKeys.map(key => select(key, labels[key]!, [['', 'Choose an account'], ...c.accounts.filter((a: any) => a.currency === 'USD' && !['Accounts Receivable', 'Accounts Payable'].includes(a.type)).map((a: any) => [a.id, a.name])], c.mappings?.[key])).join('') + check('confirm', 'I reviewed every account and approve these mappings.'), 'Approve mappings') + '</details>' : ''
  const run = c?.mappings ? form('accounting.prepare', path, field('day', 'Clinic date to hand off', '', 'date', 'required'), 'Review day') : ''
  const batches = (data?.batches ?? []).map((b: any) => `<article class="entry"><h3>${h(b.day)} · ${status(b.status)}</h3><p>${b.sandbox ? 'Sandbox' : 'Production'} · ${h(b.realm_id)}${b.provider_id ? ' · Journal ' + h(b.provider_id) : ''}</p>${b.error ? `<p role="alert">${h(b.error)}</p>` : ''}<details${b.status === 'prepared' || b.status === 'sending' ? ' open' : ''}><summary>Journal details</summary>${b.payload.Line.map((l: any) => `<p>${h(l.Description)} · ${h(l.JournalEntryLineDetail.PostingType)} ${money(Math.round(l.Amount * 100))} · ${h(c?.accounts.find((a: any) => a.id === l.JournalEntryLineDetail.AccountRef.value)?.name ?? l.JournalEntryLineDetail.AccountRef.value)}</p>`).join('')}</details>${c && c.realmId === b.realm_id && c.sandbox === !!b.sandbox ? form('accounting.sync', path, hidden('id', b.id) + hidden('sha256', b.sha256) + check('confirm', b.status === 'prepared' ? 'I reviewed this exact journal and approve sending it to QuickBooks.' : 'Read the saved journal back from QuickBooks; resume the same request if needed.'), b.status === 'prepared' ? 'Approve and sync' : b.status === 'sending' ? 'Resume saved batch' : 'Check books again', true) : ''}</article>`).join('')
  return panel('Accounting handoff', `<details${c ? '' : ' open'}><summary>${c ? 'Connection settings' : 'Connect your books'}</summary>${connect}${c ? form('accounting.disconnect', path, '', 'Disconnect locally', true) : ''}</details>${mappings}${run}${batches}`, 'full', 'accounting')
}
