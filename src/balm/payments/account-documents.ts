import { dollars } from '../domain/invoices'
import { insist, one, rows, type Data } from '../domain/model'
import { pdf } from './pdf'

export function base64Bytes(bytes: Uint8Array) {
  let raw = ''
  for (let offset = 0; offset < bytes.length; offset += 8192) raw += String.fromCharCode(...bytes.subarray(offset, offset + 8192))
  return btoa(raw)
}
export const receiptBytes = (encoded: string) => Uint8Array.from(atob(encoded), ch => ch.charCodeAt(0))
export const externalReceiptNumber = (entryId: string) => 'EXT-' + entryId

export async function prepareExternalReceipt(db: D1Database, entry: Data, approver: string, at: string) {
  const clinic = (await one(db, 'SELECT clinic_name,address,time_zone FROM bm_settings WHERE id=1'))!
  const client = (await one(db, 'SELECT first_name,last_name FROM bm_clients WHERE id=?', entry.client_id))!
  const refund = entry.kind === 'refund'
  return base64Bytes(pdf({ header: clinic.clinic_name, title: refund ? 'Recorded external refund' : 'External payment receipt', blocks: [
    { kind: 'facts', rows: [['Receipt', externalReceiptNumber(entry.id)], ['Patient', `${client.first_name} ${client.last_name}`],
      ['Amount', dollars(entry.amount_cents)], ['Actual transaction date', new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', dateStyle: 'medium' }).format(new Date(entry.occurred_on + 'T12:00:00Z'))], ['External reference', entry.reference],
      ['Reason', entry.reason], ['Approved by', approver], ['Recorded at', new Intl.DateTimeFormat('en-US', { timeZone: clinic.time_zone, dateStyle: 'medium', timeStyle: 'short' }).format(new Date(at))]] },
    { kind: 'notes', lines: [refund ? 'The clinic recorded a completed refund outside Balm. Balm did not send money or issue a Stripe refund.' : 'The clinic recorded money received outside Balm. Credit is applied to patient-responsibility invoices, oldest first; unused credit carries to later visits. This is not a Stripe payment.'] },
  ] }))
}

export async function externalReceipt(db: D1Database, key: string) {
  const entry = await one(db, "SELECT id,receipt_base64 FROM bm_posted_account_entries WHERE id=? AND kind IN ('credit','refund')", key)
  insist(entry?.receipt_base64, 'receipt_not_found', 404)
  return { name: `receipt-${externalReceiptNumber(key)}.pdf`, bytes: receiptBytes(entry.receipt_base64) }
}
export async function externalReceipts(db: D1Database, clientId: string) {
  return (await rows(db, "SELECT id,kind,amount_cents,posted_at FROM bm_posted_account_entries WHERE client_id=? AND kind IN ('credit','refund') UNION ALL SELECT id,kind,amount_cents+tax_cents AS amount_cents,recorded_at AS posted_at FROM bm_retail_sales WHERE client_id=? ORDER BY posted_at DESC,id", clientId,clientId))
    .map(e => ({ id: e.id, kind: e.kind, receipt_number: externalReceiptNumber(e.id), amount_cents: e.amount_cents, succeeded_at: e.posted_at }))
}
