import { base64Bytes, receiptBytes } from './account-documents'
// The patient's documents: a superbill per visit (to submit to their insurer),
// a statement across visits, and a receipt per card payment. Each is built from
// the approved invoice's frozen facts and the ledger, never from note text.
import { retailReceipt } from './retail'
import { unitMethodLabel } from '../insurance/unit-method'
import { externalReceipt } from './account-documents'
import { dollars, invoiceNumber } from '../domain/invoices'
import { insist, one, rows, type Data } from '../domain/model'
import { visitCodes } from './codes'
import { cardLabel, ledger, receiptNumber } from './ledger'
import { pdf, type Block } from './pdf'

const usDate = (iso: string, zone: string) => new Intl.DateTimeFormat('en-US', { timeZone: zone, month: 'short', day: 'numeric', year: 'numeric' }).format(new Date(iso))
const clinicFacts = (c: Data): [string, string][] => [['Clinic', c.clinic_name ?? c.name], ...(c.address ? [['Address', c.address] as [string, string]] : []), ...(c.abn ? [['Tax ID (' + (c.tax_id_type ?? c.taxIdType ?? 'EIN') + ')', c.abn] as [string, string]] : []), ...((c.practice_npi ?? c.practiceNpi) ? [['Practice NPI', c.practice_npi ?? c.practiceNpi] as [string, string]] : [])]

/** Everything a superbill shows for one approved invoice, and what is still missing. */
export async function superbillFacts(db: D1Database, invoiceId: string) {
  const invoice = await one(db, `SELECT i.*,a.practitioner_id,p.npi,(SELECT COALESCE(SUM(amount_cents),0) FROM bm_invoice_payments x WHERE x.invoice_id=i.id) AS paid_cents,(SELECT COALESCE(SUM(amount_cents),0) FROM bm_invoice_adjustments x WHERE x.invoice_id=i.id) AS adjusted_cents
    FROM bm_invoices i JOIN bm_appointments a ON a.id=i.appointment_id JOIN bm_staff p ON p.id=a.practitioner_id WHERE i.id=? AND i.status='approved'`, invoiceId)
  insist(invoice, 'invoice_not_found', 404)
  const v = JSON.parse(invoice.snapshot as string), codes = (await visitCodes(db, { appointmentId: invoice.appointment_id as string }))[invoice.appointment_id as string]
  // CPT units the visit's signed notes billed (frozen on the invoice) win over codes entered for the visit.
  const procedures: Data[] = v.procedures?.length ? v.procedures.filter((p: Data) => p.units > 0).map((p: Data) => ({ code: p.code, description: p.description ?? '', modifiers: p.modifiers ?? codes.cpt.find(c => c.code === p.code)?.modifiers ?? '', units: p.units, ...(p.diagnosisCodes?.length ? { diagnosisCodes: p.diagnosisCodes } : {}), from: 'notes' }))
    : codes.cpt.map(c => ({ ...c, description: '', from: 'visit' }))
  const diagnoses: string[] = v.diagnoses ?? codes.icd10
  const missing = [
    ...(procedures.some(p => p.diagnosisCodes?.length && p.diagnosisCodes.some((d: string) => !diagnoses.includes(d))) ? ['the signed procedure’s selected ICD-10 diagnoses'] : []),
    ...(invoice.npi ? [] : ['the practitioner’s NPI (Clinic → Billing identifiers)']),
    ...(v.clinic.practiceNpi ? [] : ['the practice’s NPI on the approved invoice']),
    ...(v.clinic.abn ? [] : ['the clinic’s tax ID (Clinic details, before the invoice is approved)']),
    ...(diagnoses.length ? [] : ['an ICD-10 diagnosis for the visit']),
    ...(procedures.length ? [] : ['a CPT code for the visit']),
  ]
  return { invoice, v, npi: invoice.npi as string, diagnoses, procedures, missing, paidCents: invoice.paid_cents as number }
}

export async function superbillPdf(db: D1Database, invoiceId: string) {
  const f = await superbillFacts(db, invoiceId)
  insist(!f.missing.length, `the superbill needs ${f.missing.join(', ')}`, 409)
  const letters = 'ABCDEFGHIJKL', number = invoiceNumber(f.invoice.number as number)
  const blocks: Block[] = [
    { kind: 'facts', rows: [['Superbill for', number], ['Date of service', f.v.serviceDate]] },
    { kind: 'heading', text: 'Provider' },
    { kind: 'facts', rows: [...clinicFacts(f.v.clinic), ['Rendering provider', [f.v.practitioner.name, f.v.practitioner.profession].filter(Boolean).join(', ')], ['NPI', f.npi]] },
    { kind: 'heading', text: 'Patient' },
    { kind: 'facts', rows: [['Name', f.v.client.name], ...(f.v.client.dateOfBirth ? [['Date of birth', usDate(f.v.client.dateOfBirth, 'UTC')] as [string, string]] : [])] },
    { kind: 'heading', text: 'Diagnoses (ICD-10-CM)' },
    { kind: 'table', columns: [{ label: 'Pointer', width: 1 }, { label: 'Code', width: 2 }], rows: f.diagnoses.map((d, i) => [letters[i], d]) },
    { kind: 'heading', text: 'Procedures (CPT)' },
    { kind: 'table', columns: [{ label: 'CPT', width: 1.2 }, { label: 'Modifiers', width: 1.3 }, { label: 'Description', width: 4 }, { label: 'Diagnosis', width: 1.4 }, { label: 'Units', width: 0.9, right: true }],
      rows: f.procedures.map(p => [p.code, p.modifiers || '—', p.description || '—', (p.diagnosisCodes?.length ? p.diagnosisCodes.map((d: string) => letters[f.diagnoses.indexOf(d)]) : letters.slice(0, f.diagnoses.length).split('')).join(', '), String(p.units)]),
      totals: [['Total charges', dollars(f.invoice.amount_cents as number)], ['Paid', dollars(f.paidCents)], ['Adjustments', dollars(Number(f.invoice.adjusted_cents))], ['Balance', dollars((f.invoice.amount_cents as number) - f.paidCents - Number(f.invoice.adjusted_cents))]] },
    { kind: 'notes', lines: [`Charges are for ${f.v.service.name} (${f.v.service.durationMinutes} min).`, f.procedures[0].from === 'notes' ? `CPT units are those billed from the signed treatment note by ${unitMethodLabel(f.v.timedUnitBasis?.method, f.v.timedUnitBasis?.fixedUnitMinutes)}.` : 'CPT codes and units as recorded for the visit.',
      'Submit this superbill to your insurance company to request reimbursement for out-of-network care. It is not a bill.'] },
  ]
  return { name: `superbill-${number}.pdf`, bytes: pdf({ header: f.v.clinic.name, title: 'Superbill', blocks }) }
}

export async function statementPdf(db: D1Database, clientId: string, issued?: {at: string; dunning: string; address?: string}) {
  const client = await one(db, 'SELECT first_name,last_name FROM bm_clients WHERE id=?', clientId), clinic = await one(db, 'SELECT * FROM bm_settings WHERE id=1')
  insist(client && clinic, 'client_not_found', 404)
  const l = await ledger(db, clientId), zone = clinic.time_zone as string, today = usDate(issued?.at ?? new Date().toISOString(), zone)
  const blocks: Block[] = [
    { kind: 'facts', rows: [...clinicFacts(clinic), ['Patient', `${client.first_name} ${client.last_name}`], ['Statement date', today], ['Balance due', dollars(Math.max(l.patientBalanceCents, 0))]] },
    { kind: 'heading', text: 'Charges and payments' },
    { kind: 'table', columns: [{ label: 'Date', width: 1.3 }, { label: 'Description', width: 4.4 }, { label: 'Charges', width: 1.2, right: true }, { label: 'Paid / adjusted', width: 1.2, right: true }, { label: 'Balance', width: 1.2, right: true }],
      rows: l.lines.map(x => [usDate(x.at, zone), x.description, x.chargeCents ? dollars(x.chargeCents) : '', x.paymentCents ? dollars(x.paymentCents) : '', dollars(x.balanceCents)]),
      totals: [['Total charges', dollars(l.chargesCents)], ['Total payments', dollars(l.paymentsCents)], ['Adjustments', dollars(l.adjustmentsCents)], ['Pending insurance (not patient due)', dollars(l.insurancePendingCents)], [l.patientBalanceCents < 0 ? 'Credit' : 'Patient balance due', dollars(Math.abs(l.patientBalanceCents))]] },
    { kind: 'notes', lines: [...(issued ? [issued.dunning] : []), l.lines.length ? 'Pay online from the private link the clinic sent you, or at your next visit.' : 'No charges yet.'] },
  ]
  return { name: `statement-${today.replace(/[ ,]+/g, '-')}.pdf`, bytes: pdf({ header: clinic.clinic_name as string, title: 'Statement', blocks, ...(issued?.address ? {envelope: {sender: [String(clinic.clinic_name), String(clinic.address ?? '')], recipient: [`${client.first_name} ${client.last_name}`, ...issued.address.split('\n')]}} : {}) }), balanceCents: l.patientBalanceCents }
}

export async function receiptPdf(db: D1Database, paymentId: string) {
  const p = await one(db, `SELECT cp.*,c.first_name,c.last_name FROM bm_card_payments cp JOIN bm_clients c ON c.id=cp.client_id WHERE cp.id=? AND cp.status='succeeded'`, paymentId), clinic = await one(db, 'SELECT * FROM bm_settings WHERE id=1')
  if (!p) return await one(db,'SELECT id FROM bm_retail_sales WHERE id=?',paymentId) ? retailReceipt(db,paymentId) : externalReceipt(db, paymentId)
  insist(clinic, 'receipt_not_found', 404)
  if (p.receipt_base64) return { name: `receipt-${receiptNumber(p.receipt_number as number)}.pdf`, bytes: receiptBytes(p.receipt_base64 as string) }
  const isBooking=await one(db,'SELECT 1 FROM bm_booking_payments WHERE payment_id=?',paymentId)
  const posted = isBooking?[]:await rows(db, 'SELECT p.amount_cents,i.number FROM bm_payments p JOIN bm_invoices i ON i.id=p.invoice_id WHERE p.card_payment_id=? ORDER BY i.number', paymentId)
  const unapplied = (p.amount_cents as number) - posted.reduce((sum, item) => sum + Number(item.amount_cents), 0), number = receiptNumber(p.receipt_number as number)
  const booking=await one(db,'SELECT mode,start_at,price_cents,receipt_facts FROM bm_booking_payments WHERE payment_id=?',paymentId)
  const fixed=booking?JSON.parse(booking.receipt_facts as string):null
  const receiptClinic=fixed?.clinic??clinic, receiptPatient=fixed?.patient??p
  const blocks: Block[] = [
    { kind: 'facts', rows: [...clinicFacts(receiptClinic), ['Receipt', number], ['Date', usDate(p.succeeded_at as string, receiptClinic.time_zone as string)], ['Patient', `${receiptPatient.first_name} ${receiptPatient.last_name}`],
      ...(booking ? [['Visit',String(booking.start_at)],['Service price',dollars(Number(booking.price_cents))]] as [string,string][] : []),
      ['For', p.collection_purpose === 'coinsurance' ? 'Adjudicated coinsurance at check-in' : p.collection_purpose === 'balance' ? 'Patient balance at check-in' : booking ? (booking.mode==='full'?'Online booking prepayment':'Online booking deposit') : p.kind === 'copay' ? 'Copay at check-in' : p.kind === 'link' ? 'Payment from your statement link' : 'Payment toward your balance'], ['Paid with', cardLabel(p.card_brand, p.card_last4)], ['Amount paid', dollars(p.amount_cents as number)]] },
    { kind: 'table', columns: [{ label: 'Applied to', width: 4 }, { label: 'Amount', width: 1, right: true }],
      rows: [...posted.map(x => [`Invoice ${invoiceNumber(x.number as number)}`, dollars(x.amount_cents as number)]), ...(unapplied ? [[booking ? 'Booking payment; contact the clinic about fulfillment' : p.kind === 'copay' ? 'This visit’s invoice, once it is issued' : 'Credit toward your next visit', dollars(unapplied)]] : [])] },
    { kind: 'notes', lines: [`Stripe payment ${p.payment_intent}. Keep this receipt for your records.`] },
  ]
  const original = base64Bytes(pdf({ header: receiptClinic.clinic_name as string, title: `Receipt ${number}`, blocks }))
  await db.prepare('UPDATE bm_card_payments SET receipt_base64=? WHERE id=? AND receipt_base64 IS NULL').bind(original, paymentId).run()
  const saved = (await one(db, 'SELECT receipt_base64 FROM bm_card_payments WHERE id=?', paymentId))!
  return { name: `receipt-${number}.pdf`, bytes: receiptBytes(saved.receipt_base64 as string) }
}
