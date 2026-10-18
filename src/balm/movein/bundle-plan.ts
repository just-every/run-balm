import { normalizeBundle } from './formats.ts'
import { ImportError } from './errors.ts'
import { sha256, rows, one } from '../domain/model.ts'
import { identityText } from './targets.ts'

export type Totals = { patients: number; appointmentsByMonth: Record<string, number>; balancesByPatient: Record<string, number>; documents: number; insurance: number }
export type BundlePlan = Awaited<ReturnType<typeof planBundle>>
export const targetId = async (provider: string, kind: string, source: string) => 'movein-' + await sha256(JSON.stringify([provider, kind, source]))
export const isError = (d: { severity: string }) => d.severity.toLowerCase() === 'error'

function totals(bundle: ReturnType<typeof normalizeBundle>, appointments = bundle.appointments, timeZone = 'UTC'): Totals {
  const appointmentsByMonth: Record<string, number> = {}, balancesByPatient: Record<string, number> = {}
  for (const a of appointments) { const parts = new Intl.DateTimeFormat('en-US', { timeZone, year: 'numeric', month: '2-digit' }).formatToParts(new Date(a.startAt)); const month = parts.find(p => p.type === 'year')!.value + '-' + parts.find(p => p.type === 'month')!.value; appointmentsByMonth[month] = (appointmentsByMonth[month] ?? 0) + 1 }
  for (const b of bundle.balances) balancesByPatient[b.patientId] = (balancesByPatient[b.patientId] ?? 0) + b.cents
  return { patients: bundle.patients.length, appointmentsByMonth, balancesByPatient, documents: bundle.notes.length, insurance: bundle.insurance.length }
}

function compare(source: Totals, planned: Totals) {
  const mismatches: { metric: string; source: number; planned: number }[] = []
  for (const metric of ['patients', 'documents', 'insurance'] as const) if (source[metric] !== planned[metric]) mismatches.push({ metric, source: source[metric], planned: planned[metric] })
  for (const metric of ['appointmentsByMonth', 'balancesByPatient'] as const) {
    for (const key of new Set([...Object.keys(source[metric]), ...Object.keys(planned[metric])])) {
      const a = source[metric][key] ?? 0, b = planned[metric][key] ?? 0
      if (a !== b) mismatches.push({ metric: metric + ':' + key, source: a, planned: b })
    }
  }
  return mismatches
}

function expectedTotals(input: unknown, actual: Totals): Totals {
  if (input === undefined) return actual
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new ImportError('invalid_expected_totals', 400)
  const values = input as Record<string, unknown>
  if (values.patients !== undefined && (!Number.isSafeInteger(values.patients) || Number(values.patients) < 0)) throw new ImportError('invalid_expected_totals', 400)
  for (const field of ['appointmentsByMonth', 'balancesByPatient']) {
    const record = values[field]
    if (record === undefined) continue
    if (!record || typeof record !== 'object' || Array.isArray(record) || Object.entries(record).some(([key, value]) => !key || !Number.isSafeInteger(value) || (field === 'appointmentsByMonth' && Number(value) < 0))) throw new ImportError('invalid_expected_totals', 400)
  }
  return { ...actual, patients: values.patients === undefined ? actual.patients : Number(values.patients), appointmentsByMonth: values.appointmentsByMonth === undefined ? actual.appointmentsByMonth : { ...actual.appointmentsByMonth, ...values.appointmentsByMonth as Record<string, number> }, balancesByPatient: values.balancesByPatient === undefined ? actual.balancesByPatient : { ...actual.balancesByPatient, ...values.balancesByPatient as Record<string, number> } }
}

/** Fingerprint binds exact source records, mapping and the owner's control totals. */
export async function planBundle(db: D1Database, input: Record<string, unknown>) {
  if (typeof input.provider !== 'string' || !Array.isArray(input.files) || input.files.some(f => !f || typeof f !== 'object' || typeof f.name !== 'string' || typeof f.kind !== 'string' || typeof f.csv !== 'string')) throw new ImportError('invalid_bundle', 400)
  const settings = await one(db, 'SELECT time_zone,version FROM bm_settings WHERE id=1')
  const bundle = normalizeBundle(input, settings!.time_zone as string), diagnostics = [...bundle.diagnostics]
  const diagnostic = (code: string, message: string, error = false) => diagnostics.push({ severity: error ? 'error' : 'warning', code, message, file: '' })
  const practitionerId = typeof input.practitionerId === 'string' ? input.practitionerId : ''
  const serviceId = typeof input.serviceId === 'string' ? input.serviceId : ''
  const timeZone = settings!.time_zone as string
  const source = expectedTotals(input.expectedTotals, totals(bundle, bundle.appointments, timeZone))
  const fingerprint = await sha256(JSON.stringify({ version: 1, bundle, practitionerId, serviceId, expectedTotals: source, timeZone }))
  const sourcePayload = JSON.stringify({ bundle, practitionerId, serviceId })
  const sourceJson = sourcePayload.length > 200_000 ? JSON.stringify({ version: 2, sha256: await sha256(sourcePayload) }) : sourcePayload
  const previous = await rows(db, 'SELECT id,state FROM bm_movein_jobs WHERE source_json=?', sourceJson)
  const [clients, erased, staff, services] = await Promise.all([
    rows(db, 'SELECT id,first_name,last_name,date_of_birth FROM bm_clients'), rows(db, 'SELECT identity_hash FROM bm_erasure_journal'),
    rows(db, "SELECT id,version FROM bm_staff WHERE active=1 AND role='practitioner' AND erased_at IS NULL AND id=?", practitionerId),
    rows(db, 'SELECT id,version FROM bm_services WHERE active=1 AND id=?', serviceId),
  ])
  const ownIds = new Set(await Promise.all(bundle.patients.map(p => targetId(bundle.provider, 'patient', p.sourceId))))
  const identities = new Set(clients.filter(c => !previous.length || !ownIds.has(c.id)).map(c => identityText(c.first_name, c.last_name, c.date_of_birth)))
  const erasedIdentities = new Set(erased.map(e => e.identity_hash))
  const patients = await Promise.all(bundle.patients.map(async p => ({ ...p, id: await targetId(bundle.provider, 'patient', p.sourceId), identityHash: await sha256(identityText(p.firstName, p.lastName, p.dateOfBirth)) })))
  const bundleIdentities = new Set<string>()
  for (const p of patients) {
    if (bundleIdentities.has(p.identityHash)) diagnostic('duplicate_patient_identity', `${p.firstName} ${p.lastName} (${p.file}, row ${p.row}) has the same name and birth date as another row. Resolve the identity before importing.`, true)
    bundleIdentities.add(p.identityHash)
    if (identities.has(identityText(p.firstName, p.lastName, p.dateOfBirth))) diagnostic('existing_patient', `${p.firstName} ${p.lastName} (${p.file}, row ${p.row}) already exists in Balm.`, true)
    if (erasedIdentities.has(p.identityHash)) diagnostic('erased_patient', `${p.firstName} ${p.lastName} (${p.file}, row ${p.row}) was previously erased.`, true)
  }
  if (bundle.appointments.length && (!staff.length || !services.length)) diagnostic('appointment_mapping_required', 'Map an active practitioner and service to import appointments. Unmapped appointments will be omitted.')
  const mapped = !!staff.length && !!services.length
  const appointments = mapped ? await Promise.all(bundle.appointments.map(async a => ({ ...a, id: await targetId(bundle.provider, 'appointment', a.sourceId) }))) : []
  const planned = totals(bundle, appointments, timeZone)
  const ordered = appointments.filter(a => a.status === 'booked').sort((a, b) => a.startAt.localeCompare(b.startAt))
  let previousEnd = '', previousVisit: typeof ordered[number] | null = null
  for (const a of ordered) {
    if (previousVisit && a.startAt < previousEnd) diagnostic('imported_overlap', `Visits in ${previousVisit.file}, row ${previousVisit.row}, and ${a.file}, row ${a.row} overlap. Both are kept; check the assigned practitioner.`)
    if (a.endAt > previousEnd) { previousEnd = a.endAt; previousVisit = a }
  }
  const mismatches = compare(source, planned)
  const requiresAcceptance = mismatches.length > 0 || diagnostics.some(d => !isError(d)) || bundle.unmappedColumns.length > 0 || bundle.unmappedRows.length > 0
  return { bundle, sourceJson, sourcePayload, timeZone, settingsVersion: settings!.version, provider: bundle.provider, fingerprint, patients, appointments, notes: bundle.notes, balances: bundle.balances, insurance: bundle.insurance,
    practitionerId, serviceId, practitionerVersion: staff[0]?.version, serviceVersion: services[0]?.version,
    counts: { patients: patients.length, appointments: appointments.length, notes: bundle.notes.length, balances: bundle.balances.length, insurance: bundle.insurance.length },
    diagnostics, unmappedColumns: bundle.unmappedColumns, unmappedRows: bundle.unmappedRows,
    reconciliation: { source, planned, mismatches }, requiresAcceptance, canApply: !diagnostics.some(isError), existingJob: previous[0] ?? null }
}
