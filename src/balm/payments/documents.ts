// The patient's documents: a superbill per visit (to submit to their insurer),
// a statement across visits, and a receipt per card payment. Each is built from
// the approved invoice's frozen facts and the ledger, never from note text.
import { dollars, invoiceNumber } from '../domain/invoices'
import { insist, one, rows, type Data } from '../domain/model'
import { visitCodes } from './codes'
import { cardLabel, ledger, receiptNumber } from './ledger'
import { pdf, type Block } from './pdf'

const usDate = (iso: string, zone: string) => new Intl.DateTimeFormat('en-US', { timeZone: zone, month: 'short', day: 'numeric', year: 'numeric' }).format(new Date(iso))
const clinicFacts = (c: Data): [string, string][] => [['Clinic', c.clinic_name ?? c.name], ...(c.address ? [['Address', c.address] as [string, string]] : []), ...(c.abn ? [['Tax ID (EIN)', c.abn] as [string, string]] : [])]

/** Everything a superbill shows for one approved invoice, and what is still missing. */
export async function superbillFacts(db: D1Database, invoiceId: string) {
  const invoice = await one(db, `SELECT i.*,a.practitioner_id,p.npi,(SELECT COALESCE(SUM(amount_cents),0) FROM bm_payments x WHERE x.invoice_id=i.id) AS paid_cents
    FROM bm_invoices i JOIN bm_appointments a ON a.id=i.appointment_id JOIN bm_staff p ON p.id=a.practitioner_id WHERE i.id=? AND i.status='approved'`, invoiceId)
  insist(invoice, 'invoice_not_found', 404)
  const v = JSON.parse(invoice.snapshot as string), codes = (await visitCodes(db, { appointmentId: invoice.appointment_id as string }))[invoice.appointment_id as string]
  // CPT units the visit's signed notes billed (frozen on the invoice) win over codes entered for the visit.
  const procedures: Data[] = v.procedures?.length ? v.procedures.map((p: Data) => ({ code: p.code, description: p.description ?? '', modifiers: p.modifiers ?? '', units: p.units, from: 'notes' }))
    : codes.cpt.map(c => ({ ...c, description: '', from: 'visit' }))
  const missing = [
    ...(invoice.npi ? [] : ['the practitioner’s NPI (Clinic → Billing identifiers)']),
    ...(v.clinic.abn ? [] : ['the clinic’s tax ID (Clinic details, before the invoice is approved)']),
    ...(codes.icd10.length ? [] : ['an ICD-10 diagnosis for the visit']),
    ...(procedures.length ? [] : ['a CPT code for the visit']),
  ]
  return { invoice, v, npi: invoice.npi as string, diagnoses: codes.icd10, procedures, missing, paidCents: invoice.paid_cents as number }
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
    { kind: 'facts', rows: [['Name', f.v.client.name], ...(f.v.client.dateOfBirth ? [['Date of birth', f.v.client.dateOfBirth] as [string, string]] : [])] },
    { kind: 'heading', text: 'Diagnoses (ICD-10-CM)' },
    { kind: 'table', columns: [{ label: 'Pointer', width: 1 }, { label: 'Code', width: 2 }], rows: f.diagnoses.map((d, i) => [letters[i], d]) },
    { kind: 'heading', text: 'Procedures (CPT)' },
    { kind: 'table', columns: [{ label: 'CPT', width: 1.2 }, { label: 'Modifiers', width: 1.3 }, { label: 'Description', width: 4 }, { label: 'Diagnosis', width: 1.4 }, { label: 'Units', width: 0.9, right: true }],
      rows: f.procedures.map(p => [p.code, p.modifiers || '—', p.description || '—', letters.slice(0, f.diagnoses.length).split('').join(', '), String(p.units)]),
      totals: [['Total charges', dollars(f.invoice.amount_cents as number)], ['Paid', dollars(f.paidCents)], ['Balance', dollars((f.invoice.amount_cents as number) - f.paidCents)]] },
    { kind: 'notes', lines: [`Charges are for ${f.v.service.name} (${f.v.service.durationMinutes} min).`, f.procedures[0].from === 'notes' ? 'CPT units are those billed from the signed treatment note by the CMS 8-minute rule.' : 'CPT codes and units as recorded for the visit.',
      'Submit this superbill to your insurance company to request reimbursement for out-of-network care. It is not a bill.'] },
  ]
  return { name: `superbill-${number}.pdf`, bytes: pdf({ header: f.v.clinic.name, title: 'Superbill', blocks }) }
}

export async function statementPdf(db: D1Database, clientId: string) {
  const client = await one(db, 'SELECT first_name,last_name FROM bm_clients WHERE id=?', clientId), clinic = await one(db, 'SELECT * FROM bm_settings WHERE id=1')
  insist(client && clinic, 'client_not_found', 404)
  const l = await ledger(db, clientId), zone = clinic.time_zone as string, today = usDate(new Date().toISOString(), zone)
  const blocks: Block[] = [
    { kind: 'facts', rows: [...clinicFacts(clinic), ['Patient', `${client.first_name} ${client.last_name}`], ['Statement date', today], ['Balance due', dollars(Math.max(l.balanceCents, 0))]] },
    { kind: 'heading', text: 'Charges and payments' },
    { kind: 'table', columns: [{ label: 'Date', width: 1.3 }, { label: 'Description', width: 4.4 }, { label: 'Charges', width: 1.2, right: true }, { label: 'Payments', width: 1.2, right: true }, { label: 'Balance', width: 1.2, right: true }],
      rows: l.lines.map(x => [usDate(x.at, zone), x.description, x.chargeCents ? dollars(x.chargeCents) : '', x.paymentCents ? dollars(x.paymentCents) : '', dollars(x.balanceCents)]),
      totals: [['Total charges', dollars(l.chargesCents)], ['Total payments', dollars(l.paymentsCents)], [l.balanceCents < 0 ? 'Credit' : 'Balance due', dollars(Math.abs(l.balanceCents))]] },
    { kind: 'notes', lines: [l.lines.length ? 'Pay online from the private link the clinic sent you, or at your next visit.' : 'No charges yet.'] },
  ]
  return { name: `statement-${today.replace(/[ ,]+/g, '-')}.pdf`, bytes: pdf({ header: clinic.clinic_name as string, title: 'Statement', blocks }), balanceCents: l.balanceCents }
}

export async function receiptPdf(db: D1Database, paymentId: string) {
  const p = await one(db, `SELECT cp.*,c.first_name,c.last_name FROM bm_card_payments cp JOIN bm_clients c ON c.id=cp.client_id WHERE cp.id=? AND cp.status='succeeded'`, paymentId), clinic = await one(db, 'SELECT * FROM bm_settings WHERE id=1')
  insist(p && clinic, 'receipt_not_found', 404)
  const posted = await rows(db, 'SELECT p.amount_cents,i.number FROM bm_payments p JOIN bm_invoices i ON i.id=p.invoice_id WHERE p.card_payment_id=? ORDER BY i.number', paymentId)
  const unapplied = (p.amount_cents as number) - (p.applied_cents as number), number = receiptNumber(p.receipt_number as number)
  const blocks: Block[] = [
    { kind: 'facts', rows: [...clinicFacts(clinic), ['Receipt', number], ['Date', usDate(p.succeeded_at as string, clinic.time_zone as string)], ['Patient', `${p.first_name} ${p.last_name}`],
      ['For', p.kind === 'copay' ? 'Copay at check-in' : p.kind === 'link' ? 'Payment from your statement link' : 'Payment toward your balance'], ['Paid with', cardLabel(p.card_brand, p.card_last4)], ['Amount paid', dollars(p.amount_cents as number)]] },
    { kind: 'table', columns: [{ label: 'Applied to', width: 4 }, { label: 'Amount', width: 1, right: true }],
      rows: [...posted.map(x => [`Invoice ${invoiceNumber(x.number as number)}`, dollars(x.amount_cents as number)]), ...(unapplied ? [[p.kind === 'copay' ? 'This visit’s invoice, once it is issued' : 'Credit toward your next visit', dollars(unapplied)]] : [])] },
    { kind: 'notes', lines: [`Stripe payment ${p.payment_intent}. Keep this receipt for your records.`] },
  ]
  return { name: `receipt-${number}.pdf`, bytes: pdf({ header: clinic.clinic_name as string, title: `Receipt ${number}`, blocks }) }
}
