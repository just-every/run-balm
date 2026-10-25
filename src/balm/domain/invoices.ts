import {copayRoomSql} from '../payments/cob-collection'
import {stageSetup} from '../insurance/cob-stages'
import {hostDateAt} from '../availability/timezone'
// Reviewed billing adapted from Satchel (src/satchel/billing.ts, just-every/run-satchel
// @ 2d460e4): a preparation freezes a snapshot, a person approves that exact
// snapshot, and approval fixes the number and the downloadable bytes forever.
import { unitMethodLabel } from '../insurance/unit-method'
import { creditStatements } from '../payments/ledger'
import { approvalStatements } from './approvals'
import { insuredCharge, visitBilling } from '../insurance/invoice-price'
import { audit, commit, guard, human, id, insist, integer, need, now, one, rows, sha256, stmt, text, type Actor, type Data } from './model'

const escape = (value: unknown) => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!))
const usd = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' })
/** An amount for people, in US dollars grouped the US way: "$2,480.00", "-$12.50". Every screen, document and email uses it. */
export const dollars = (cents: number) => usd.format(cents / 100)
export const localTime = (iso: string, zone: string) => new Intl.DateTimeFormat('en-US', { timeZone: zone, weekday: 'short', day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit', timeZoneName: 'short' }).format(new Date(iso))
/** A YYYY-MM-DD date of birth as Apr 12, 1988. */
const usBirthDate = (date: unknown) => /^\d{4}-\d\d-\d\d$/.test(String(date ?? '')) ? new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', month: 'short', day: 'numeric', year: 'numeric' }).format(new Date(date + 'T00:00:00Z')) : date
export const invoiceNumber = (n: number) => 'INV-' + String(n).padStart(6, '0')

/** The facts an invoice freezes; approval re-reads them and compares byte for byte. */
export async function snapshot(db: D1Database, appointmentId: string, amountCents?: number) {
  const row = await one(db, `SELECT a.id,a.start_at,a.status,a.coverage_choice,a.client_id,c.first_name,c.last_name,c.date_of_birth,p.name AS practitioner,p.profession,p.provider_number,
    s.name AS service,s.duration_minutes,s.price_cents,st.clinic_name,st.abn,st.practice_npi,st.tax_id_type,st.address,st.time_zone
    FROM bm_appointments a JOIN bm_clients c ON c.id=a.client_id JOIN bm_staff p ON p.id=a.practitioner_id JOIN bm_services s ON s.id=a.service_id, bm_settings st WHERE a.id=?`, appointmentId)
  insist(row, 'appointment_not_found', 404)
  // Freeze the same payer method and signed units used by pricing and claims.
  const packaged=await one(db,'SELECT 1 FROM bm_package_uses WHERE appointment_id=?',appointmentId)
  insist(!packaged || amountCents===undefined || amountCents===0,'package_visit_has_no_additional_charge',409)
  if(packaged)amountCents=0
  const billing = await visitBilling(db, appointmentId)
  const procedures = (billing?.lines ?? []).map(l => ({ code: l.code, description: l.description, minutes: l.timed ? l.minutes : null, units: l.units, ...(l.cmsTieChosen ? { cmsTieChosen: true } : {}), ...(l.diagnosisCodes?.length ? { diagnosisCodes: l.diagnosisCodes } : {}) }))
  const diagnoses = (await rows(db, "SELECT code FROM bm_visit_codes WHERE appointment_id=? AND kind='icd10' ORDER BY position", appointmentId)).map(d => d.code as string)
  return { row, value: {
    clinic: { name: row.clinic_name, abn: row.abn, taxIdType: row.tax_id_type, practiceNpi: row.practice_npi, address: row.address },
    client: { name: `${row.first_name} ${row.last_name}`, dateOfBirth: row.date_of_birth },
    practitioner: { name: row.practitioner, profession: row.profession, providerNumber: row.provider_number },
    service: { name: row.service, durationMinutes: row.duration_minutes }, serviceDate: localTime(row.start_at as string, row.time_zone as string),
    appointmentId: row.id, amountCents: amountCents ?? (row.price_cents as number), currency: 'USD',
    ...(procedures.length ? { procedures, ...(procedures.some(p => p.diagnosisCodes?.length) ? { diagnoses } : {}), timedUnitBasis: { schedule: billing!.schedule, method: billing!.method, payerId: billing!.payerId, payer: billing!.payer, payerVersion: billing!.payerVersion, ...(billing!.method === 'fixed' ? { fixedUnitMinutes: billing!.fixedUnitMinutes } : {}) } } : {}),
  } }
}

export async function prepareInvoice(db: D1Database, who: Actor, input: Data) {
  need(who, 'owner', 'reception', 'agent')
  const appointmentId = text(input.appointmentId, 'appointment', 100)
  // Left blank, an insured visit is charged at its payer's fee schedule (so its claim matches), any other at the service price.
  const amount = input.amountCents === undefined || input.amountCents === '' ? (await insuredCharge(db, appointmentId))?.cents : integer(input.amountCents, 'amount_cents', 0, 10_000_000)
  const { row, value } = await snapshot(db, appointmentId, amount)
  insist(row.status === 'attended', 'invoice_needs_an_attended_appointment', 409)
  const automatic = !input.replacesId ? await one(db, "SELECT id FROM bm_invoices WHERE appointment_id=? AND status='draft' AND attendance_started=1", appointmentId) : null
  const replacesId = input.replacesId || automatic?.id
  const replacing = replacesId ? await one(db, "SELECT * FROM bm_invoices WHERE id=? AND appointment_id=? AND status='draft'", text(replacesId, 'invoice', 100), appointmentId) : null
  insist(!replacesId || replacing, 'draft_invoice_not_found', 404)
  const invoiceId = id()
  await commit(db, who, [
    // Retain the earlier preparation; a concurrently approved draft cannot be replaced.
    ...(replacing ? [
      stmt(db, "UPDATE bm_invoices SET status='void',void_reason=?,version=version+1 WHERE id=? AND status='draft' AND version=?", 'Re-prepared from the current visit', replacing.id, replacing.version),
      guard(db, 'changes()=1'),
      audit(db, who, 'invoice.reprepared', row.client_id as string, invoiceId, replacing.id as string),
    ] : []),
    stmt(db, `INSERT INTO bm_invoices(id,appointment_id,client_id,status,amount_cents,snapshot,prepared_by,prepared_role,prepared_at) VALUES(?,?,?,'draft',?,?,?,?,?)`,
      invoiceId, appointmentId, row.client_id, value.amountCents, JSON.stringify(value), who.email, who.role, now()),
    audit(db, who, 'invoice.prepared', row.client_id as string, invoiceId, `${value.amountCents} cents`),
  ])
  return { id: invoiceId, status: 'draft', snapshot: value }
}

/** The downloadable bytes an approval fixes; the issue date is the clinic-local date of approval (the demo's sample invoices pass no zone and date in UTC). */
export function artifact(number: number, value: any, approvedAt: string, zone = 'UTC') {
  const line = (label: string, v: unknown) => v ? `<p><strong>${escape(label)}:</strong> ${escape(v)}</p>` : ''
  return `<!doctype html><html lang="en-US"><head><meta charset="utf-8"><title>${invoiceNumber(number)}</title>`
    + '<style>body{font:15px/1.5 system-ui,sans-serif;max-width:720px;margin:40px auto;padding:0 20px;color:#1d2a26}table{width:100%;border-collapse:collapse;margin:24px 0}td,th{border-bottom:1px solid #ccd;padding:8px;text-align:left}td:last-child,th:last-child{text-align:right}</style></head><body>'
    + `<h1>Invoice ${invoiceNumber(number)}</h1><p>Issued ${escape(new Intl.DateTimeFormat('en-US', { timeZone: zone, month: 'short', day: 'numeric', year: 'numeric' }).format(new Date(approvedAt)))}</p>`
    + `<h2>${escape(value.clinic.name)}</h2>${line('Tax ID (' + (value.clinic.taxIdType ?? 'EIN') + ')', value.clinic.abn)}${line('Practice NPI', value.clinic.practiceNpi)}${line('Address', value.clinic.address)}`
    + `<h2>Client</h2>${line('Name', value.client.name)}${line('Date of birth', usBirthDate(value.client.dateOfBirth))}`
    + `<h2>Provider</h2>${line('Practitioner', value.practitioner.name)}${line('Profession', value.practitioner.profession)}${line('Provider number', value.practitioner.providerNumber)}`
    + `<table><thead><tr><th>Date of service</th><th>Service</th><th>Amount (${escape(value.currency)})</th></tr></thead><tbody>`
    + `<tr><td>${escape(value.serviceDate)}</td><td>${escape(value.service.name)} (${escape(value.service.durationMinutes)} min)</td><td>${dollars(value.amountCents)}</td></tr></tbody>`
    + `<tfoot><tr><th colspan="2">Total</th><th>${dollars(value.amountCents)}</th></tr></tfoot></table>`
    + (value.procedures ? `<h2>Procedures billed (CPT)</h2><table><thead><tr><th>Code</th><th>Procedure</th><th>Minutes</th><th>Units</th></tr></thead><tbody>${value.procedures.map((p: any) => `<tr><td>${escape(p.code)}</td><td>${escape(p.description)}</td><td>${p.minutes ?? 'untimed'}</td><td>${p.units}</td></tr>`).join('')}</tbody></table><p>Timed units by ${escape(unitMethodLabel(value.timedUnitBasis?.method, value.timedUnitBasis?.fixedUnitMinutes))}${value.timedUnitBasis?.payer ? ' for ' + escape(value.timedUnitBasis.payer) : ''}, from the signed treatment note.</p>` : '')
    + '<p>Keep this invoice for your records. Insurance claims and remittances are tracked separately from this invoice.</p></body></html>\n'
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
  const cobSetup = ['uninsured','self_pay'].includes(String(row.coverage_choice))
    ? Object.assign([guard(db,'EXISTS(SELECT 1 FROM bm_appointments WHERE id=? AND coverage_choice=?)',invoice.appointment_id,row.coverage_choice)],{insuranceHeld:false})
    : await stageSetup(db,{client_id:invoice.client_id},{invoiceId:invoice.id as string,serviceDate:hostDateAt(new Date(row.start_at as string),row.time_zone as string)})
  const approvedAt = now(), bytes = artifact(number, value, approvedAt, row.time_zone as string)
  await commit(db, who, [
    stmt(db, "UPDATE bm_invoices SET status='approved',number=?,artifact=?,artifact_sha256=?,approved_by=?,approved_at=?,version=version+1 WHERE id=? AND status='draft' AND version=?",
      number, bytes, await sha256(bytes), who.email, approvedAt, invoice.id, invoice.version),
    guard(db, "EXISTS(SELECT 1 FROM bm_invoices WHERE id=? AND status='approved' AND number=?)", invoice.id, number),
    ...await approvalStatements(db, who, 'invoice', invoice, invoice.snapshot as string),
    ...(value.timedUnitBasis?.payerId ? [guard(db, 'EXISTS(SELECT 1 FROM bm_payers WHERE id=? AND version=?)', value.timedUnitBasis.payerId, value.timedUnitBasis.payerVersion)] : []),
    // A copay taken at check-in, or credit paid ahead, is matched to the invoice now.
    ...cobSetup,
    ...await creditStatements(db, invoice, cobSetup.insuranceHeld),
    audit(db, who, 'invoice.approved', invoice.client_id as string, invoice.id as string, invoiceNumber(number)),
  ])
  return { id: invoice.id, number: invoiceNumber(number), status: 'approved' }
}

export async function voidInvoice(db: D1Database, who: Actor, input: Data) {
  need(who, 'owner'); human(who)
  const invoice = await one(db, 'SELECT * FROM bm_invoices WHERE id=?', text(input.id, 'id', 100))
  insist(invoice && invoice.status !== 'void', 'invoice_not_found', 404)
  // Each reason an invoice cannot be voided is named; only a lost race is a conflict.
  const held = await one(db, 'SELECT EXISTS(SELECT 1 FROM bm_invoice_payments WHERE invoice_id=?) AS paid,EXISTS(SELECT 1 FROM bm_invoice_adjustments WHERE invoice_id=?) AS adjusted', invoice.id, invoice.id)
  insist(!held?.paid, 'invoice_has_payments', 409)
  insist(!held?.adjusted, 'invoice_has_insurance_payments', 409)
  const claims = await rows(db, "SELECT id,status,version FROM bm_claims WHERE invoice_id=? AND status<>'corrected'", invoice.id)
  insist(claims.every(c => c.status === 'draft' || c.status === 'ready'), 'invoice_has_a_sent_claim', 409)
  // A claim that was never batched is withdrawn with its invoice, so the visit can be invoiced and claimed again.
  const at = now(), reason = text(input.reason, 'reason', 300)
  await commit(db, who, [
    guard(db, "NOT EXISTS(SELECT 1 FROM bm_invoice_payments WHERE invoice_id=?) AND NOT EXISTS(SELECT 1 FROM bm_invoice_adjustments WHERE invoice_id=?) AND NOT EXISTS(SELECT 1 FROM bm_claims WHERE invoice_id=? AND status NOT IN ('draft','ready','corrected'))", invoice.id, invoice.id, invoice.id),
    ...claims.flatMap(c => [
      stmt(db, "UPDATE bm_claims SET status='corrected',updated_at=?,version=version+1 WHERE id=? AND version=?", at, c.id, c.version), guard(db, 'changes()=1'),
      stmt(db, 'INSERT INTO bm_claim_events(id,claim_id,kind,detail,created_at) VALUES(?,?,?,?,?)', id(), c.id, 'withdrawn', JSON.stringify({ invoiceId: invoice.id, reason }), at),
    ]),
    stmt(db, "UPDATE bm_invoices SET status='void',void_reason=?,version=version+1 WHERE id=? AND version=?", reason, invoice.id, invoice.version),
    guard(db, "EXISTS(SELECT 1 FROM bm_invoices WHERE id=? AND status='void')", invoice.id),
    audit(db, who, 'invoice.voided', invoice.client_id as string, invoice.id as string, claims.length ? `withdrew ${claims.length} unsent claim${claims.length === 1 ? '' : 's'}` : ''),
  ])
  return { id: invoice.id, status: 'void', withdrawnClaims: claims.map(c => c.id) }
}

export async function recordPayment(db: D1Database, who: Actor, input: Data) {
  need(who, 'owner', 'reception'); human(who)
  const invoice = await one(db, "SELECT * FROM bm_invoices WHERE id=? AND status='approved'", text(input.invoiceId, 'invoice', 100))
  insist(invoice, 'approved_invoice_not_found', 404)
  const amount = integer(input.amountCents, 'amount_cents', 1, 10_000_000), reference = text(input.reference, 'reference', 120), paymentId = id()
  const collectionAllowed = `NOT EXISTS(SELECT 1 FROM bm_invoice_insurance_hold WHERE invoice_id=?) OR ${copayRoomSql()}>=?`
  insist(await one(db,'SELECT 1 WHERE '+collectionAllowed,invoice.id,invoice.id,amount),'patient_balance_waits_for_all_payers',409)
  insist(!await one(db, 'SELECT 1 FROM bm_invoice_payments WHERE reference=? UNION ALL SELECT 1 FROM bm_account_entries WHERE reference=?', reference, reference), 'payment_reference_used', 409)
  await commit(db, who, [
    guard(db,collectionAllowed,invoice.id,invoice.id,amount),
    guard(db, 'NOT EXISTS(SELECT 1 FROM bm_account_entries WHERE reference=?)', reference),
    stmt(db, 'INSERT INTO bm_payments(id,invoice_id,amount_cents,reference,recorded_by,recorded_at) VALUES(?,?,?,?,?,?)', paymentId, invoice.id, amount, reference, who.email, now()),
    guard(db, "(SELECT COALESCE(SUM(amount_cents),0) FROM bm_invoice_payments WHERE invoice_id=?)<=(SELECT amount_cents-COALESCE((SELECT SUM(x.amount_cents) FROM bm_invoice_adjustments x WHERE x.invoice_id=bm_invoices.id),0) FROM bm_invoices WHERE id=? AND status='approved')", invoice.id, invoice.id),
    audit(db, who, 'payment.recorded', invoice.client_id as string, paymentId, `${amount} cents`),
  ])
  return { id: paymentId, invoiceId: invoice.id, amountCents: amount }
}

export async function invoicesFor(db: D1Database, clientId?: string) {
  const list = await rows(db, `SELECT i.id,i.number,i.appointment_id,i.client_id,i.status,i.amount_cents,i.snapshot,i.attendance_started,i.prepared_by,i.prepared_role,i.prepared_at,i.approved_by,i.approved_at,i.void_reason,${copayRoomSql('i.id')} AS collectible_copay_cents,EXISTS(SELECT 1 FROM bm_invoice_insurance_hold h WHERE h.invoice_id=i.id) AS insurance_pending,
    (SELECT COALESCE(SUM(amount_cents),0) FROM bm_invoice_payments p WHERE p.invoice_id=i.id) AS paid_cents,(SELECT COALESCE(SUM(amount_cents),0) FROM bm_invoice_adjustments x WHERE x.invoice_id=i.id) AS adjusted_cents FROM bm_invoices i ${clientId ? 'WHERE i.client_id=?' : ''} ORDER BY i.prepared_at DESC`, ...(clientId ? [clientId] : []))
  const payments = await rows(db, `SELECT * FROM bm_invoice_payments ${clientId ? 'WHERE invoice_id IN (SELECT id FROM bm_invoices WHERE client_id=?)' : ''} ORDER BY recorded_at`, ...(clientId ? [clientId] : []))
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
