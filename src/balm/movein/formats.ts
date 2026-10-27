import { normalizeWebptAppointments } from './webpt.ts'
import { readCsv } from './formats/reader.ts'
import { normalizeRows } from './formats/rows.ts'

export type Provider = 'cliniko' | 'webpt' | 'simplepractice' | 'jane'
export type FileKind = 'patients' | 'appointments' | 'notes' | 'balances' | 'insurance' | 'invoices' | 'authorizations' | 'claims'
export type DateFormat = 'MDY' | 'DMY' | 'YMD'
export type BundleFile = { kind: FileKind; name: string; csv: string }
export type BundleInput = { provider: Provider; files: BundleFile[]; dateFormat?: DateFormat; practitionerId?: string; serviceId?: string }
export type Location = { row: number; file: string }
export type BundleDiagnostic = { severity: 'error' | 'warning'; code: string; message: string; file: string; row?: number; column?: string }
export type Bundle = {
  provider: Provider
  files: BundleFile[]
  patients: (Location & { sourceId: string; firstName: string; lastName: string; dateOfBirth: string | null; email: string | null; phone: string | null })[]
  appointments: (Location & { sourceId: string; patientId: string; startAt: string; endAt: string; status: 'booked' | 'attended' | 'cancelled' | 'no_show' })[]
  notes: (Location & { sourceId: string; patientId: string; title: string; body: string; date: string })[]
  balances: (Location & { patientId: string; cents: number })[]
  insurance: (Location & { sourceId: string; patientId: string; payer: string; memberId: string; groupNumber: string })[]
  inventory: (Location & { kind: 'invoices' | 'authorizations' | 'claims'; sourceId: string; patientId: string; reference: string })[]
  diagnostics: BundleDiagnostic[]
  unmappedColumns: { file: string; column: string }[]
  unmappedRows: (Location & { reason: string })[]
}

/** Pure preview normalization. It neither writes records nor infers patient identity. */
export function normalizeBundle(value: unknown, timeZone = ''): Bundle {
  const input = (value && typeof value === 'object' && !Array.isArray(value) ? value : {}) as Record<string, unknown>
  const bundle: Bundle = { provider: String(input.provider ?? '') as Provider, files: [], patients: [], appointments: [], notes: [], balances: [], insurance: [], inventory: [], diagnostics: [], unmappedColumns: [], unmappedRows: [] }
  const issue = (code: string, message: string, file = '') => bundle.diagnostics.push({ severity: 'error', code, message, file })
  if (!['cliniko', 'webpt', 'simplepractice', 'jane'].includes(bundle.provider)) issue('unsupported_provider', 'Choose Cliniko, WebPT, SimplePractice or Jane.')
  if (input.dateFormat !== undefined && !['MDY', 'DMY', 'YMD'].includes(String(input.dateFormat))) issue('invalid_date_format', 'Date format must be MDY, DMY or YMD.')
  if (!Array.isArray(input.files) || !input.files.length) { issue('missing_files', 'Upload at least one CSV file.'); return bundle }
  if (input.files.length > 25) { issue('too_many_files', 'Upload at most 25 files per bundle.'); return bundle }
  const names = new Set<string>()
  for (const raw of [...input.files].sort((a, b) => Number(b?.kind === 'patients') - Number(a?.kind === 'patients'))) {
    if (!raw || typeof raw !== 'object' || typeof raw.name !== 'string' || typeof raw.kind !== 'string' || typeof raw.csv !== 'string') { issue('invalid_file', 'Every file must have string kind, name and csv fields.'); continue }
    const file = { kind: raw.kind, name: raw.name, csv: raw.csv } as BundleFile
    bundle.files.push(file)
    if (!file.name || names.has(file.name)) { issue('duplicate_file', 'Every file needs a unique nonempty name.', file.name); continue }
    names.add(file.name)
    if (!['patients', 'appointments', 'notes', 'balances', 'insurance', 'invoices', 'authorizations', 'claims'].includes(file.kind)) { issue('unsupported_kind', 'This CSV category is unsupported.', file.name); continue }
    try {
      const rows = readCsv(file.csv)
      const format = (input.dateFormat ?? 'MDY') as DateFormat
      if (!normalizeWebptAppointments(bundle, file, rows, format, timeZone)) normalizeRows(bundle, file, rows, format)
    }
    catch (error) { issue('invalid_csv', error instanceof Error ? error.message : 'The CSV could not be read.', file.name) }
  }
  const patients = new Set(bundle.patients.map(p => p.sourceId))
  for (const kind of ['appointments', 'notes', 'balances', 'insurance'] as const) {
    for (const record of bundle[kind]) if (!patients.has(record.patientId)) {
      bundle.diagnostics.push({ severity: 'error', code: 'missing_patient_reference', message: `The ${kind} row references a patient ID absent from this bundle.`, file: record.file, row: record.row, column: 'Patient ID' })
      bundle.unmappedRows.push({ file: record.file, row: record.row, reason: 'missing_patient_reference' })
    }
  }
  for (const record of bundle.inventory) {
    if (!patients.has(record.patientId)) {
      bundle.diagnostics.push({ severity: 'error', code: 'missing_patient_reference', message: 'This inventory row references a patient ID absent from this bundle.', file: record.file, row: record.row })
      bundle.unmappedRows.push({ file: record.file, row: record.row, reason: 'missing_patient_reference' })
    }
    bundle.diagnostics.push({ severity: 'warning', code: 'inventory_not_carried', message: `${record.kind} record ${record.sourceId} (${record.reference}) is retained for reconciliation only; it creates no Balm invoice, claim or usable authorization. Complete its carry before relying on cutover.`, file: record.file, row: record.row })
  }
  if (bundle.inventory.length + bundle.patients.length + bundle.appointments.length + bundle.notes.length + bundle.balances.length + bundle.insurance.length > 50_000) issue('too_many_records', 'Upload up to 50,000 records at a time, including insurance policies.')
  if (!bundle.files.some(f => f.kind === 'notes')) bundle.diagnostics.push({ severity: 'warning', code: 'notes_not_supplied', message: 'No historical notes were uploaded. Keep the original charts; this import does not move them.', file: '' })
  if (bundle.provider === 'simplepractice') bundle.diagnostics.push({ severity: 'warning', code: 'separated_data_unverified', message: 'This report does not include restricted clients’ clinical and billing records. Keep the full SimplePractice export, including separated data, before closing your account.', file: '' })
  bundle.diagnostics.push({ severity: 'warning', code: 'document_import_not_supported', message: 'PDF charts, intake forms, attachments, ZIP archives, authorizations and claims are not imported. Keep those original records separately.', file: '' })
  return bundle
}
