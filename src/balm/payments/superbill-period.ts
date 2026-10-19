import { endOfHostDate } from '../availability/date-bounds'
import { firstInstantOfHostDate, hostDateAt } from '../availability/timezone'
import { dollars, invoiceNumber } from '../domain/invoices'
import { day, insist, one, rows } from '../domain/model'
import { superbillFacts } from './documents'
import { pdf, type Block } from './pdf'

const civilDate = (date: string) => new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', month: 'short', day: 'numeric', year: 'numeric' }).format(new Date(date + 'T00:00:00Z'))

type Visit = Awaited<ReturnType<typeof superbillFacts>>

function periodDay(value: string, field: string) {
  // day() checks calendar normalization; reject unparseable dates before its ISO conversion.
  insist(typeof value === 'string' && Number.isFinite(Date.parse(value + 'T00:00:00Z')), `invalid_${field}`)
  return day(value, field)
}

function visitBlocks(f: Visit): Block[] {
  const c = f.v.clinic, patient = f.v.client, letters = 'ABCDEFGHIJKL'
  return [
    { kind: 'heading', text: `${f.v.serviceDate} · ${invoiceNumber(f.invoice.number as number)}` },
    // Repeat frozen identity on every visit: a practice or patient identity change
    // must never make an older invoice appear to belong to today's identity.
    { kind: 'facts', rows: [
      ['Patient', patient.name],
      ...(patient.dateOfBirth ? [['Date of birth', civilDate(patient.dateOfBirth)] as [string, string]] : []),
      ['Practice', c.name],
      ...(c.address ? [['Address', c.address] as [string, string]] : []),
      [c.taxIdType ? 'Tax ID (' + c.taxIdType + ')' : 'Tax ID', c.abn], ['Practice NPI', c.practiceNpi],
      ['Rendering provider', [f.v.practitioner.name, f.v.practitioner.profession].filter(Boolean).join(', ')],
      ['Rendering NPI', f.npi], ['Service', f.v.service.name],
    ] },
    { kind: 'table', columns: [{ label: 'Pointer', width: 1 }, { label: 'ICD-10-CM', width: 4 }],
      rows: f.diagnoses.map((code, i) => [letters[i], code]) },
    { kind: 'table', columns: [
      { label: 'CPT', width: 1.1 }, { label: 'Modifiers', width: 1.4 },
      { label: 'Description', width: 3.2 }, { label: 'Diagnosis', width: 1.6 }, { label: 'Units', width: 0.8, right: true },
    ], rows: f.procedures.map(p => [p.code, p.modifiers || '—', p.description || '—', letters.slice(0, f.diagnoses.length).split('').join(', '), String(p.units)]),
    totals: totals(Number(f.invoice.amount_cents), f.paidCents, Number(f.invoice.adjusted_cents)) },
  ]
}

function totals(charges: number, paid: number, adjusted: number): [string, string][] {
  return [['Total charges', dollars(charges)], ['Paid', dollars(paid)], ['Adjustments', dollars(adjusted)], ['Balance', dollars(charges - paid - adjusted)]]
}

/** Approved visits in an inclusive clinic-local period, using invoice identities and ledger payments. */
export async function periodSuperbillPdf(db: D1Database, clientId: string, from: string, to: string) {
  from = periodDay(from, 'from'); to = periodDay(to, 'to')
  insist(from <= to, 'superbill_date_range_reversed')
  const settings = await one(db, 'SELECT time_zone FROM bm_settings WHERE id=1')
  insist(settings?.time_zone, 'clinic_time_zone_not_set', 409)
  const zone = settings.time_zone as string
  const start = firstInstantOfHostDate(from, zone), end = endOfHostDate(to, zone)
  insist(start && end, 'invalid_superbill_date_range')
  const invoices = await rows<{ id: string; start_at: string }>(db, `SELECT i.id,a.start_at FROM bm_invoices i
    JOIN bm_appointments a ON a.id=i.appointment_id
    WHERE i.client_id=? AND a.client_id=? AND i.status='approved' AND a.start_at>=? AND a.start_at<?
    ORDER BY a.start_at,i.number,i.id`, clientId, clientId, start.toISOString(), end.toISOString())
  // Filter civil dates as well: the boundary helper covers repeated midnights.
  const selected = invoices.filter(i => { const date = hostDateAt(new Date(i.start_at), zone); return date >= from && date <= to })
  insist(selected.length, 'no_approved_visits_in_superbill_period', 409)
  const visits = await Promise.all(selected.map(i => superbillFacts(db, i.id)))
  for (const f of visits) {
    const missing = [...f.missing,
      ...(f.v.clinic.practiceNpi ? [] : ['the practice’s NPI on the approved invoice']),
      ...(f.v.clinic.name && f.v.client.name && f.v.practitioner.name && f.v.serviceDate ? [] : ['the invoice’s practice, patient, rendering provider and service date']),
      ...(f.procedures.every(p => p.code && Number.isInteger(p.units) && p.units > 0) ? [] : ['CPT codes with positive billed units']),
    ]
    insist(!missing.length, `${invoiceNumber(f.invoice.number as number)}: the superbill needs ${missing.join(', ')}`, 409)
  }
  const charges = visits.reduce((sum, f) => sum + Number(f.invoice.amount_cents), 0)
  const paid = visits.reduce((sum, f) => sum + f.paidCents, 0)
  const adjusted = visits.reduce((sum, f) => sum + Number(f.invoice.adjusted_cents), 0)
  const blocks: Block[] = [
    { kind: 'facts', rows: [['Period (inclusive)', `${civilDate(from)} through ${civilDate(to)}`], ['Clinic time zone', zone], ['Visits', String(visits.length)]] },
    ...visits.flatMap(visitBlocks),
    { kind: 'heading', text: 'Period totals' },
    { kind: 'facts', rows: totals(charges, paid, adjusted) },
    { kind: 'notes', lines: ['CPT units come from the approved invoice’s signed-note billing when present, otherwise from the visit’s recorded codes. Payments and adjustments are the amounts posted to these invoices.', 'Submit this superbill to your insurance company to request reimbursement for out-of-network care. It is not a bill.'] },
  ]
  return { name: `superbill-${from}-through-${to}.pdf`, bytes: pdf({ header: 'Patient superbill', title: 'Period superbill', blocks }) }
}
