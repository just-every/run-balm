import type { Bundle, BundleDiagnostic } from './formats'
import type { Totals } from './bundle-plan'
import { columnsFor, headerKey, layouts } from './formats/columns'
import { readCsv } from './formats/reader'

type Difference = { metric: string; source: number; planned: number }
const amount = (cents: number) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(cents / 100)

/** Local, source-grounded mapping assistant. Unknown meanings are never guessed. */
export function mappingReport(bundle: Bundle, diagnostics: BundleDiagnostic[], source: Totals, planned: Totals, mismatches: Difference[], mappedAppointments: boolean) {
  const fields: { file: string; kind: string; column: string; target: string | null; explanation: string; examples: { row: number; value: string }[] }[] = []
  const files: { file: string; kind: string; records: number | null; explanation?: string }[] = []
  for (const file of bundle.files) {
    let rows
    try { rows = readCsv(file.csv) }
    catch { files.push({ file: file.name, kind: file.kind, records: null, explanation: 'The file could not be parsed, so its record count is unknown. Resolve its file diagnostic before cutover.' }); continue }
    const headers = rows[0]?.cells.map(v => v.trim()) ?? []
    const body = rows.slice(1).filter(r => r.cells.some(v => v.trim()))
    files.push({ file: file.name, kind: file.kind, records: body.length })
    const nativeWebpt = bundle.provider === 'webpt' && file.kind === 'appointments' && headers.some(h => ['appointment date', 'visit status'].includes(headerKey(h)))
    const nativeTargets: Record<string, string> = { 'patient name': 'patientId (unique full-name match)', 'appointment date': 'startAt and endAt (clinic date)', 'start time': 'startAt (clinic time)', 'end time': 'endAt (clinic time)', 'visit status': 'status' }
    const columns = Object.hasOwn(layouts, file.kind) ? columnsFor(bundle.provider, file.kind, headers) : []
    headers.forEach((column, index) => {
      const candidates = columns.filter(c => c.names.some(n => headerKey(n) === headerKey(column)))
      const target = nativeWebpt ? nativeTargets[headerKey(column)] ?? null : candidates.length === 1 ? candidates[0].key : null
      const examples = target ? [] : body.filter(r => r.cells[index]?.trim()).slice(0, 3).map(r => ({ row: r.row, value: r.cells[index].trim().slice(0, 160) }))
      fields.push({ file: file.name, kind: file.kind, column, target, examples,
        explanation: (file.kind === 'invoices' && !headers.some(h => headerKey(h) === 'billed') || file.kind === 'authorizations' && !headers.some(h => headerKey(h) === 'allowance') || file.kind === 'claims' && !headers.some(h => headerKey(h) === 'billed')) ? 'Retained in the reconciliation inventory only; this field creates no native invoice, claim or usable authorization.' : target ? 'Recognized by the importer’s supported header rules; review the normalized records before approval.' : 'No supported destination field. This column is omitted; retain the original export. Its meaning is not inferred from example values.' })
    })
  }
  const rowKey = (file: string, row: number) => JSON.stringify([file, row])
  const rowDiagnostics = new Map<string, BundleDiagnostic[]>(), fileErrors = new Map<string, BundleDiagnostic[]>()
  for (const diagnostic of diagnostics) {
    if (diagnostic.row) { const key = rowKey(diagnostic.file, diagnostic.row); rowDiagnostics.set(key, [...(rowDiagnostics.get(key) ?? []), diagnostic]) }
    if (diagnostic.severity === 'error' && (!diagnostic.row || diagnostic.row === 1)) fileErrors.set(diagnostic.file, [...(fileErrors.get(diagnostic.file) ?? []), diagnostic])
  }
  const unmappedRecords = bundle.unmappedRows.map(record => {
    const found = [...(rowDiagnostics.get(rowKey(record.file, record.row)) ?? []), ...(fileErrors.get(record.file) ?? [])]
    return { ...record, explanations: found.length ? found.map(d => d.message) : ['The file’s headers are invalid. Resolve its named column diagnostics before cutover.'], blocking: true }
  })
  const reported = new Set(unmappedRecords.map(r => rowKey(r.file, r.row)))
  for (const diagnostic of diagnostics.filter(d => d.severity === 'error' && d.row && d.row > 1)) {
    const key = rowKey(diagnostic.file, diagnostic.row!)
    if (!reported.has(key)) { unmappedRecords.push({ file: diagnostic.file, row: diagnostic.row!, reason: diagnostic.code, explanations: [diagnostic.message], blocking: true }); reported.add(key) }
  }
  if (!mappedAppointments) for (const record of bundle.appointments) unmappedRecords.push({ file: record.file, row: record.row, reason: 'appointment_mapping_required', explanations: ['No active practitioner and service mapping was selected. This visit is omitted until both are mapped.'], blocking: false })
  for (const record of bundle.inventory) unmappedRecords.push({ file: record.file, row: record.row, reason: 'inventory_not_carried', explanations: [`${record.kind} record ${record.sourceId} (${record.reference}) is retained in the reviewed source only. No native invoice, claim or usable authorization is created.`], blocking: false })
  for (const d of diagnostics.filter(d => d.code === 'incomplete_insurance' && d.row)) unmappedRecords.push({ file: d.file, row: d.row!, reason: d.code, explanations: [d.message], blocking: false })
  const balances = new Map<string, Bundle['balances']>()
  for (const record of bundle.balances) { const list = balances.get(record.patientId) ?? []; list.push(record); balances.set(record.patientId, list) }
  const balanceDifferences = mismatches.filter(d => d.metric.startsWith('balancesByPatient:')).map(d => {
    const patientId = d.metric.slice('balancesByPatient:'.length)
    const records = balances.get(patientId) ?? []
    const uploadedCents = records.reduce((sum, b) => sum + b.cents, 0)
    return { patientId, sourceCents: d.source, uploadedCents, plannedCents: d.planned, differenceCents: d.source - d.planned,
      records: records.map(r => ({ file: r.file, row: r.row, cents: r.cents })),
      explanation: `The source control is ${amount(d.source)}; valid uploaded opening balances total ${amount(uploadedCents)} and Balm will carry ${amount(d.planned)}. The difference is ${amount(d.source - d.planned)}. ${uploadedCents === d.planned ? 'The uploaded records contain no additional balance explaining the source control. Check the original aging report and any omitted or invalid balance rows; no adjustment is invented.' : 'Review the listed balance records and mapping before cutover.'}` }
  })
  const countDifferences = mismatches.filter(d => !d.metric.startsWith('balancesByPatient:')).map(d => ({ ...d, uploadedInventory: ['invoices', 'authorizations', 'claims'].includes(d.metric) ? bundle.inventory.filter(r => r.kind === d.metric).length : undefined, explanation: `Source control ${d.source}; mapped records ${d.planned}; difference ${d.source - d.planned}. Check the original export against the file row counts and the unmapped record explanations. The source control alone does not establish why a record is absent.` }))
  return { method: 'supported-header-rules', fields, files, unmappedRecords, balanceDifferences, countDifferences, source, planned,
    limitations: ['Only the record types supported by Move in are proposed. Native complete exports and attachments remain outside this importer. Usable authorizations require the documented reviewed carry format. Open claims carry only through the documented reviewed format; inventories alone never carry them.', 'Unrecognized columns are omitted with source examples for the owner; the assistant never infers clinical meaning or invents balancing entries.'],
    approval: 'The owner must approve this exact mapping and reconciliation, then approve cutover. Preparation creates no clinic records.' }
}

/** Agent context contains no source values, chart text, personal identifiers or row messages. */
export function agentMappingReport(report: ReturnType<typeof mappingReport>) {
  const fileNumber = (file: string) => report.files.findIndex(f => f.file === file) + 1
  return { method: report.method, fields: report.fields.map(({ file, kind, column, target, explanation }) => ({ sourceFile: fileNumber(file), kind, column, target, omitted: target === null, explanation })),
    files: report.files.map(({ kind, records }) => ({ kind, records })),
    unmappedRecords: report.unmappedRecords.map(({ file, row, reason, blocking }) => ({ sourceFile: fileNumber(file), row, reason, blocking,
      explanation: ({ missing_patient_reference: 'This record references a patient absent from the uploaded patient list.', appointment_mapping_required: 'This appointment has no active practitioner and service mapping.', incomplete_insurance: 'This policy has no member identifier and is omitted.', invalid_row: 'This record contains an invalid or missing required value. The owner must review its exact diagnostic.', conversion_required: 'This file lacks the required supported headers.', invalid_headers: 'This file has invalid or ambiguous headers.', existing_patient: 'This patient already exists in Balm; identity review is required.', erased_patient: 'An erasure fence prevents reimporting this identity.', duplicate_patient_identity: 'More than one record has this patient identity.' } as Record<string, string>)[reason] ?? 'The owner must resolve the named record diagnostic before cutover.' })),
    balanceDifferences: report.balanceDifferences.map(({ sourceCents, uploadedCents, plannedCents, differenceCents, explanation }) => ({ sourceCents, uploadedCents, plannedCents, differenceCents, explanation })),
    countDifferences: report.countDifferences.map(({ source, planned, explanation }) => ({ source, planned, explanation })), limitations: report.limitations, approval: report.approval }
}
