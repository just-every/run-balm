// Reviewed billing adapted from Satchel (src/satchel/billing.ts, just-every/run-satchel
// @ 2d460e4): a preparation freezes a snapshot, a person approves that exact
// snapshot, and approval fixes the number and the downloadable bytes forever.
import { creditStatements } from '../payments/ledger'
import { approvalStatements } from './approvals'
import { audit, commit, guard, human, id, insist, integer, need, now, one, rows, sha256, stmt, text, type Actor, type Data } from './model'

const escape = (value: unknown) => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!))
export const dollars = (cents: number) => `${cents < 0 ? '-' : ''}$${(Math.abs(cents) / 100).toFixed(2)}`
export const localTime = (iso: string, zone: string) => new Intl.DateTimeFormat('en-US', { timeZone: zone, weekday: 'short', day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit', timeZoneName: 'short' }).format(new Date(iso))
export const invoiceNumber = (n: number) => 'INV-' + String(n).padStart(6, '0')

/** The facts an invoice freezes; approval re-reads them and compares byte for byte. */
export async function snapshot(db: D1Database, appointmentId: string, amountCents?: number) {
  const row = await one(db, `SELECT a.id,a.start_at,a.status,a.client_id,c.first_name,c.last_name,c.date_of_birth,p.name AS practitioner,p.profession,p.provider_number,
    s.name AS service,s.duration_minutes,s.price_cents,st.clinic_name,st.abn,st.address,st.time_zone
    FROM bm_appointments a JOIN bm_clients c ON c.id=a.client_id JOIN bm_staff p ON p.id=a.practitioner_id JOIN bm_services s ON s.id=a.service_id, bm_settings st WHERE a.id=?`, appointmentId)
  insist(row, 'appointment_not_found', 404)
  return { row, value: {
    clinic: { name: row.clinic_name, abn: row.abn, address: row.address },
    client: { name: `${row.first_name} ${row.last_name}`, dateOfBirth: row.date_of_birth },
    practitioner: { name: row.practitioner, profession: row.profession, providerNumber: row.provider_number },
    service: { name: row.service, durationMinutes: row.duration_minutes }, serviceDate: localTime(row.start_at as string, row.time_zone as string),
    appointmentId: row.id, amountCents: amountCents ?? (row.price_cents as number), currency: 'USD',
  } }
}

export async function prepareInvoice(db: D1Database, who: Actor, input: Data) {
  need(who, 'owner', 'reception', 'agent')
  const appointmentId = text(input.appointmentId, 'appointment', 100)
  const amount = input.amountCents === undefined || input.amountCents === '' ? undefined : integer(input.amountCents, 'amount_cents', 0, 10_000_000)
  const { row, value } = await snapshot(db, appointmentId, amount)
  insist(row.status === 'attended', 'invoice_needs_an_attended_appointment', 409)
  const invoiceId = id()
  await commit(db, who, [
    stmt(db, `INSERT INTO bm_invoices(id,appointment_id,client_id,status,amount_cents,snapshot,prepared_by,prepared_role,prepared_at) VALUES(?,?,?,'draft',?,?,?,?,?)`,
      invoiceId, appointmentId, row.client_id, value.amountCents, JSON.stringify(value), who.email, who.role, now()),
    audit(db, who, 'invoice.prepared', row.client_id as string, invoiceId, `${value.amountCents} cents`),
  ])
  return { id: invoiceId, status: 'draft', snapshot: value }
}

/** The downloadable bytes an approval fixes. */
export function artifact(number: number, value: any, approvedAt: string) {
  const line = (label: string, v: unknown) => v ? `<p><strong>${escape(label)}:</strong> ${escape(v)}</p>` : ''
  return `<!doctype html><html lang="en-US"><head><meta charset="utf-8"><title>${invoiceNumber(number)}</title>`
    + '<style>body{font:15px/1.5 system-ui,sans-serif;max-width:720px;margin:40px auto;padding:0 20px;color:#1d2a26}table{width:100%;border-collapse:collapse;margin:24px 0}td,th{border-bottom:1px solid #ccd;padding:8px;text-align:left}td:last-child,th:last-child{text-align:right}</style></head><body>'
    + `<h1>Invoice ${invoiceNumber(number)}</h1><p>Issued ${escape(approvedAt.slice(0, 10))}</p>`
    + `<h2>${escape(value.clinic.name)}</h2>${line('Tax ID', value.clinic.abn)}${line('Address', value.clinic.address)}`
    + `<h2>Client</h2>${line('Name', value.client.name)}${line('Date of birth', value.client.dateOfBirth)}`
    + `<h2>Provider</h2>${line('Practitioner', value.practitioner.name)}${line('Profession', value.practitioner.profession)}${line('Provider number', value.practitioner.providerNumber)}`
    + `<table><thead><tr><th>Date of service</th><th>Service</th><th>Amount (${escape(value.currency)})</th></tr></thead><tbody>`
    + `<tr><td>${escape(value.serviceDate)}</td><td>${escape(value.service.name)} (${escape(value.service.durationMinutes)} min)</td><td>${dollars(value.amountCents)}</td></tr></tbody>`
    + `<tfoot><tr><th colspan="2">Total</th><th>${dollars(value.amountCents)}</th></tr></tfoot></table>`
    + '<p>Keep this invoice for your records. Insurance claims are made outside Balm.</p></body></html>\n'
}

export async function approveInvoice(db: D1Database, who: Actor, input: Data) {
  need(who, 'owner', 'reception'); human(who)
  const invoice = await one(db, 'SELECT * FROM bm_invoices WHERE id=?', text(input.id, 'id', 100))
  insist(invoice, 'invoice_not_found', 404)
  insist(invoice.status === 'draft', 'already_decided', 409)
  // The facts the snapshot froze must still hold (Nectar's basis check).
  const { row, value } = await snapshot(db, invoice.appointment_id as string, invoice.amount_cents as number)
  insist(row.status === 'attended' && JSON.stringify(value) === invoice.snapshot, 'invoice_facts_changed_prepare_again', 409)
  const number = ((await one<{ n: number }>(db, 'SELECT MAX(number) AS n FROM bm_invoices'))?.n ?? 0) + 1
  const approvedAt = now(), bytes = artifact(number, value, approvedAt)
  await commit(db, who, [
    stmt(db, "UPDATE bm_invoices SET status='approved',number=?,artifact=?,artifact_sha256=?,approved_by=?,approved_at=?,version=version+1 WHERE id=? AND status='draft' AND version=?",
      number, bytes, await sha256(bytes), who.email, approvedAt, invoice.id, invoice.version),
    guard(db, "EXISTS(SELECT 1 FROM bm_invoices WHERE id=? AND status='approved' AND number=?)", invoice.id, number),
    ...await approvalStatements(db, who, 'invoice', invoice, invoice.snapshot as string),
    // A copay taken at check-in, or credit paid ahead, is matched to the invoice now.
    ...await creditStatements(db, invoice),
    audit(db, who, 'invoice.approved', invoice.client_id as string, invoice.id as string, invoiceNumber(number)),
  ])
  return { id: invoice.id, number: invoiceNumber(number), status: 'approved' }
}

export async function voidInvoice(db: D1Database, who: Actor, input: Data) {
  need(who, 'owner'); human(who)
  const invoice = await one(db, 'SELECT * FROM bm_invoices WHERE id=?', text(input.id, 'id', 100))
  insist(invoice && invoice.status !== 'void', 'invoice_not_found', 404)
  await commit(db, who, [
    guard(db, 'NOT EXISTS(SELECT 1 FROM bm_payments WHERE invoice_id=?)', invoice.id),
    stmt(db, "UPDATE bm_invoices SET status='void',void_reason=?,version=version+1 WHERE id=? AND version=?", text(input.reason, 'reason', 300), invoice.id, invoice.version),
    guard(db, "EXISTS(SELECT 1 FROM bm_invoices WHERE id=? AND status='void')", invoice.id),
    audit(db, who, 'invoice.voided', invoice.client_id as string, invoice.id as string),
  ])
  return { id: invoice.id, status: 'void' }
}

export async function recordPayment(db: D1Database, who: Actor, input: Data) {
  need(who, 'owner', 'reception'); human(who)
  const invoice = await one(db, "SELECT * FROM bm_invoices WHERE id=? AND status='approved'", text(input.invoiceId, 'invoice', 100))
  insist(invoice, 'approved_invoice_not_found', 404)
  const amount = integer(input.amountCents, 'amount_cents', 1, 10_000_000), reference = text(input.reference, 'reference', 120), paymentId = id()
  insist(!await one(db, 'SELECT 1 FROM bm_payments WHERE reference=?', reference), 'payment_reference_used', 409)
  await commit(db, who, [
    stmt(db, 'INSERT INTO bm_payments(id,invoice_id,amount_cents,reference,recorded_by,recorded_at) VALUES(?,?,?,?,?,?)', paymentId, invoice.id, amount, reference, who.email, now()),
    guard(db, "(SELECT COALESCE(SUM(amount_cents),0) FROM bm_payments WHERE invoice_id=?)<=(SELECT amount_cents FROM bm_invoices WHERE id=? AND status='approved')", invoice.id, invoice.id),
    audit(db, who, 'payment.recorded', invoice.client_id as string, paymentId, `${amount} cents`),
  ])
  return { id: paymentId, invoiceId: invoice.id, amountCents: amount }
}

export async function invoicesFor(db: D1Database, clientId?: string) {
  const list = await rows(db, `SELECT i.id,i.number,i.appointment_id,i.client_id,i.status,i.amount_cents,i.snapshot,i.prepared_by,i.prepared_role,i.prepared_at,i.approved_by,i.approved_at,i.void_reason,
    (SELECT COALESCE(SUM(amount_cents),0) FROM bm_payments p WHERE p.invoice_id=i.id) AS paid_cents FROM bm_invoices i ${clientId ? 'WHERE i.client_id=?' : ''} ORDER BY i.prepared_at DESC`, ...(clientId ? [clientId] : []))
  const payments = await rows(db, `SELECT * FROM bm_payments ${clientId ? 'WHERE invoice_id IN (SELECT id FROM bm_invoices WHERE client_id=?)' : ''} ORDER BY recorded_at`, ...(clientId ? [clientId] : []))
  return list.map(i => ({ ...i, snapshot: JSON.parse(i.snapshot as string), payments: payments.filter(p => p.invoice_id === i.id) }) as Data)
}

/** The exact approved bytes, audited per download. */
export async function invoiceDownload(db: D1Database, who: Actor, invoiceId: string) {
  need(who, 'owner', 'reception'); human(who)
  const invoice = await one(db, "SELECT * FROM bm_invoices WHERE id=? AND status IN ('approved','void') AND artifact IS NOT NULL", invoiceId)
  insist(invoice, 'invoice_not_found', 404)
  await commit(db, who, [audit(db, who, 'invoice.downloaded', invoice.client_id as string, invoice.id as string, invoiceNumber(invoice.number as number))])
  return { name: `balm-${invoiceNumber(invoice.number as number)}.html`, bytes: invoice.artifact as string }
}
