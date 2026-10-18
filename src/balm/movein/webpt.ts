import { sha256 } from '../../modules/import-kit/src/provenance/identity.ts'
import { wallClockInstants } from '../availability/timezone.ts'
import type { Bundle, BundleFile, DateFormat } from './formats.ts'
import { headerKey } from './formats/columns.ts'
import type { CsvRow } from './formats/reader.ts'
import { calendarDate } from './formats/values.ts'

const nameKey = (name: string) => name.normalize('NFKC').trim().toLowerCase().replace(/\s+/g, ' ')
const reportName = (name: string) => {
  const comma = /^([^,]+),\s*(.+)$/.exec(name.trim())
  return nameKey(comma ? `${comma[2]} ${comma[1]}` : name)
}

function minuteOfDay(value: string): number {
  const clock = /^(\d{1,2}):(\d{2})\s*(AM|PM)?$/i.exec(value)
  if (!clock) throw new Error('The appointment time must include hours and minutes, for example 09:00 AM.')
  let hour = Number(clock[1])
  const minute = Number(clock[2]), period = clock[3]?.toUpperCase()
  if (minute > 59 || (period ? hour < 1 || hour > 12 : hour > 23)) throw new Error('The appointment time is invalid.')
  if (period) hour = hour % 12 + (period === 'PM' ? 12 : 0)
  return hour * 60 + minute
}

function localInstant(date: string, clock: string, timeZone: string): string {
  const candidates = wallClockInstants(date, minuteOfDay(clock), timeZone)
  if (!candidates.length) throw new Error(`This appointment time did not exist in ${timeZone} because the clocks changed. Check the original appointment before importing.`)
  if (candidates.length > 1) throw new Error(`This appointment time occurred twice in ${timeZone} because the clocks changed. The report does not say which occurrence was booked; check the original appointment before importing.`)
  return candidates[0].toISOString()
}

/** Native Analytics Scheduled Visits columns; patients must be normalized first.
 * https://discover.webpt.com/v1/docs/webpt-analytics-scheduled-visits
 * The Patient Lists report has no matching WebPT internal ID. Name matching is
 * permitted only when exactly one uploaded patient has that complete name.
 */
export function normalizeWebptAppointments(bundle: Bundle, file: BundleFile, rows: CsvRow[], format: DateFormat, timeZone: string): boolean {
  if (bundle.provider !== 'webpt' || file.kind !== 'appointments') return false
  const headers = rows[0]?.cells.map(value => value.trim()) ?? [], keys = headers.map(headerKey)
  if (!keys.includes('appointment date') && !keys.includes('visit status')) return false
  const diagnostic = (severity: 'error' | 'warning', code: string, message: string, row?: number, column?: string) => {
    bundle.diagnostics.push({ severity, code, message, file: file.name, ...(row === undefined ? {} : { row }), ...(column ? { column } : {}) })
  }
  const requiredHeaders = ['Patient Name', 'Appointment Date', 'Start Time', 'End Time', 'Visit Status', 'Treating Therapist', 'Appointment Type']
  const body = rows.slice(1).filter(row => row.cells.some(cell => cell.trim()))
  const missing = requiredHeaders.filter(header => !keys.includes(headerKey(header)))
  if (missing.length) diagnostic('error', 'webpt_missing_columns', `The WebPT Scheduled Visits report is missing ${missing.join(', ')}. Show those columns in WebPT and download the report again.`, rows[0]?.row)
  if (keys.some((key, index) => !key || keys.indexOf(key) !== index)) diagnostic('error', 'duplicate_or_empty_header', 'Every CSV header must be nonempty and unique.', rows[0]?.row)
  try { if (!timeZone) throw new Error(); new Intl.DateTimeFormat('en-US', { timeZone }).format(0) }
  catch { diagnostic('error', 'webpt_time_zone_required', 'Save the clinic time zone before importing WebPT appointment times.') }
  const retained = new Set(['patient name', 'appointment date', 'start time', 'end time', 'visit status'])
  for (const [index, column] of headers.entries()) if (!retained.has(keys[index])) bundle.unmappedColumns.push({ file: file.name, column })
  if (bundle.diagnostics.some(d => d.file === file.name && d.severity === 'error')) {
    for (const row of body) bundle.unmappedRows.push({ file: file.name, row: row.row, reason: 'invalid_headers' })
    return true
  }
  diagnostic('warning', 'webpt_name_matching', 'WebPT uses different patient identifiers in these reports. Each appointment is linked only when its full patient name matches exactly one patient in the uploaded patient list. Check those links in the preview.')
  diagnostic('warning', 'webpt_appointment_mapping', `Appointment times are read in ${timeZone}. All visits use the practitioner and service selected on this page; check the original treating therapists, appointment types and clinics before applying.`)
  diagnostic('warning', 'webpt_three_year_history', 'WebPT Scheduled Visits includes only the most recent three years of appointment history. This report cannot establish that older appointments were exported.')
  const patients = new Map<string, Set<string>>()
  for (const patient of bundle.patients) {
    const key = nameKey(`${patient.firstName} ${patient.lastName}`), ids = patients.get(key) ?? new Set<string>()
    ids.add(patient.sourceId); patients.set(key, ids)
  }
  const seen = new Set(bundle.appointments.map(appointment => appointment.sourceId))
  const statuses: Record<string, Bundle['appointments'][number]['status']> = {
    booked: 'booked', scheduled: 'booked', confirmed: 'booked', other: 'booked',
    'checked in': 'attended', 'checked out': 'attended', cancelled: 'cancelled', canceled: 'cancelled', 'no show': 'no_show',
  }
  for (const { cells, row } of body) {
    let column = ''
    const get = (header: string) => cells[keys.indexOf(headerKey(header))]?.trim() ?? ''
    try {
      if (cells.length !== headers.length) throw new Error(`This row has ${cells.length} cells but its header has ${headers.length}. Upload the report as downloaded.`)
      column = 'Patient Name'
      const matches = patients.get(reportName(get(column)))
      if (!matches?.size) throw new Error('No uploaded patient has this full name. Include that patient in the WebPT patient export and preview again.')
      if (matches.size !== 1) throw new Error('More than one uploaded patient has this full name. This report cannot identify which patient was booked; check the original appointment before importing.')
      const patientId = [...matches][0]
      column = 'Appointment Date'
      const date = calendarDate(get(column), format)
      if (date.ambiguous) diagnostic('warning', 'ambiguous_date', `This appointment date was read using ${format}; check its day and month.`, row, column)
      column = 'Start Time'; const startAt = localInstant(date.value, get(column), timeZone)
      column = 'End Time'; const endAt = localInstant(date.value, get(column), timeZone)
      if (endAt <= startAt) throw new Error('The appointment end must be after its start on the reported date. This report cannot establish an overnight end date.')
      column = 'Visit Status'
      const rawStatus = get(column).toLowerCase(), status = Object.hasOwn(statuses, rawStatus) ? statuses[rawStatus] : undefined
      if (!status) throw new Error('This WebPT appointment status is missing or not supported. Check the original appointment before importing.')
      if (rawStatus === 'other') diagnostic('warning', 'webpt_status_not_recorded', 'WebPT has no recorded status for this visit. It stays booked in Balm; attendance is not assumed. Check past visits before billing.', row, column)
      const sourceId = `webpt-visit:${sha256(JSON.stringify([patientId, startAt, endAt, nameKey(get('Treating Therapist')), nameKey(get('Appointment Type'))]))}`
      if (seen.has(sourceId)) throw new Error('Two WebPT rows identify the same appointment. Check the duplicate rows before importing; neither can be distinguished by this report.')
      seen.add(sourceId)
      bundle.appointments.push({ file: file.name, row, sourceId, patientId, startAt, endAt, status })
    } catch (error) {
      diagnostic('error', 'webpt_invalid_appointment', error instanceof Error ? error.message : 'The appointment could not be read.', row, column)
      bundle.unmappedRows.push({ file: file.name, row, reason: 'webpt_invalid_appointment' })
    }
  }
  if (!body.length) diagnostic('error', 'empty_file', 'The file contains no appointment rows.')
  return true
}
