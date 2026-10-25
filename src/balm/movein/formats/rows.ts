import type { Bundle, BundleFile, DateFormat } from '../formats.ts'
import { columnsFor, headerKey } from './columns.ts'
import type { CsvRow } from './reader.ts'
import { calendarDate, timestamp, usdCents } from './values.ts'

export function normalizeRows(bundle: Bundle, file: BundleFile, rows: CsvRow[], format: DateFormat): void {
  const diagnostic = (severity: 'error' | 'warning', code: string, message: string, row?: number, column?: string) => bundle.diagnostics.push({ severity, code, message, file: file.name, ...(row === undefined ? {} : { row }), ...(column ? { column } : {}) })
  const headers = rows[0]?.cells.map(v => v.trim()) ?? [], keys = headers.map(headerKey), columns = columnsFor(bundle.provider, file.kind, headers)
  const at = new Map<string, number>()
  for (const column of columns) {
    const matches = keys.flatMap((key, index) => column.names.some(n => headerKey(n) === key) ? [index] : [])
    if (matches.length > 1) diagnostic('error', 'ambiguous_columns', `More than one column maps to ${column.names[0]}; supply only one.`, rows[0]?.row, column.names[0])
    at.set(column.key, matches[0] ?? -1)
  }
  for (const [i, key] of keys.entries()) {
    if (!key || keys.indexOf(key) !== i) diagnostic('error', 'duplicate_or_empty_header', 'Every CSV header must be nonempty and unique.', rows[0]?.row, headers[i])
    if (![...at.values()].includes(i)) bundle.unmappedColumns.push({ file: file.name, column: headers[i] })
  }
  const missing = columns.filter(c => c.required && (at.get(c.key) ?? -1) < 0)
  if (file.kind !== 'patients' && file.kind !== 'balances' && (at.get('sourceId') ?? -1) < 0) missing.push({ key: 'sourceId', names: ['Source ID'], required: true })
  if (missing.length || !headers.length) {
    diagnostic('error', 'conversion_required', `CSV needs ${missing.map(c => c.names[0]).join(', ') || 'a header row'}. This file does not contain the details needed for this kind of record. Check that you downloaded the export named on the Move in page.`, rows[0]?.row)
    for (const row of rows.slice(1).filter(r => r.cells.some(c => c.trim()))) bundle.unmappedRows.push({ file: file.name, row: row.row, reason: 'conversion_required' })
    return
  }
  if (bundle.diagnostics.some(d => d.file === file.name && d.severity === 'error')) {
    for (const row of rows.slice(1).filter(r => r.cells.some(c => c.trim()))) bundle.unmappedRows.push({ file: file.name, row: row.row, reason: 'invalid_headers' })
    return
  }
  const reportPatients = ['simplepractice', 'jane', 'webpt'].includes(bundle.provider) && file.kind === 'patients' && ((at.get('fullName') ?? -1) >= 0 || (bundle.provider === 'webpt' && keys.includes('name (first)')))
  if (reportPatients) diagnostic('warning', 'report_identity_review', 'Check the first and last names in the preview. If the report has no patient number, Balm uses the name and email or birth date to recognize an unchanged upload. Other report columns are listed below.')
  const seen = new Set<string>(file.kind === 'patients' ? bundle.patients.map(p => p.sourceId) : file.kind === 'balances' ? bundle.balances.map(p => p.patientId) : bundle[file.kind].map(p => p.sourceId))
  let nonempty = 0
  for (const { cells, row } of rows.slice(1)) {
    if (!cells.some(c => c.trim())) continue
    nonempty++
    const location = { file: file.name, row }, get = (key: string) => { const i = at.get(key) ?? -1; return i < 0 ? '' : cells[i].trim() }
    let column = ''
    const required = (key: string, max = 200) => { column = columns.find(c => c.key === key)?.names[0] ?? key; const value = get(key); if (!value || value.length > max || /[\u0000-\u001f\u007f]/.test(value)) throw new Error(`${column} is required, must have at most ${max} characters and cannot contain control characters.`); return value }
    const date = (key: string) => { column = columns.find(c => c.key === key)?.names[0] ?? key; const result = calendarDate(get(key), format); if (result.ambiguous) diagnostic('warning', 'ambiguous_date', `This date was interpreted using ${format}; review the day and month.`, row, column); return result.value }
    try {
      if (cells.length !== headers.length) { column = ''; throw new Error(`This row has ${cells.length} cells; the header has ${headers.length}.`) }
      if (file.kind === 'patients') {
        let firstName = get('firstName'), lastName = get('lastName')
        const fullName = get('fullName'), email = get('email').toLowerCase(), phone = get('phone'), dateOfBirth = get('dateOfBirth') ? date('dateOfBirth') : null
        if ((!firstName || !lastName) && fullName) {
          const comma = /^([^,]+),\s*(.+)$/.exec(fullName), words = fullName.split(/\s+/)
          ;[firstName, lastName] = comma ? [comma[2], comma[1]] : [words[0], words.slice(1).join(' ')]
        }
        column = 'First Name'; if (!firstName || firstName.length > 80 || /[\u0000-\u001f\u007f]/.test(firstName)) throw new Error('A first name of at most 80 characters is required.')
        column = 'Last Name'; if (!lastName || lastName.length > 80 || /[\u0000-\u001f\u007f]/.test(lastName)) throw new Error('A last name of at most 80 characters is required.')
        column = 'Email'; if (email && (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))) throw new Error('Email is malformed.')
        column = 'Phone'; if (phone.length > 40 || /[\u0000-\u001f\u007f]/.test(phone)) throw new Error('Phone must have at most 40 characters and no control characters.')
        let sourceId = get('sourceId')
        if (!sourceId) {
          column = 'Patient ID'
          if (!reportPatients || (!email && !dateOfBirth)) throw new Error('This patient needs an email address, date of birth or patient number so Balm can distinguish them from someone with the same name.')
          sourceId = `derived:${encodeURIComponent(`${firstName} ${lastName}`.normalize('NFKC').toLowerCase().replace(/\s+/g, ' ').trim())}:${encodeURIComponent(email || dateOfBirth!)}`
        }
        column = 'Patient ID'; if (sourceId.length > 600 || /[\u0000-\u001f\u007f]/.test(sourceId)) throw new Error('Patient ID is malformed or too long.')
        if (/^[=']|^\d+(?:\.\d+)?e[+-]?\d+$/i.test(sourceId)) throw new Error('This patient number appears to have been rounded or changed by a spreadsheet. Download the original file again and upload it without opening and saving it in Excel.')
        if (seen.has(sourceId)) throw new Error('Two rows identify the same patient. Check the duplicate rows in the original report.')
        seen.add(sourceId)
        const payer = get('payer'), memberId = get('memberId')
        if (payer && !memberId) diagnostic('warning', 'incomplete_insurance', 'Insurance has no member number. The patient can move in, but this policy is left out; check the original insurance record before billing.', row, 'Insurance ID')
        bundle.patients.push({ ...location, sourceId, firstName, lastName, dateOfBirth, email: email || null, phone: phone || null })
        if (payer && memberId) bundle.insurance.push({ ...location, sourceId: `primary:${sourceId}`, patientId: sourceId, payer, memberId, groupNumber: '' })
      } else if (file.kind === 'balances') {
        const patientId = required('patientId', 600); column = 'Balance'
        const cents = usdCents(get('amount'))
        if (seen.has(patientId)) throw new Error('More than one opening balance for this patient; reconcile to one net balance before import.')
        seen.add(patientId)
        bundle.balances.push({ ...location, patientId, cents })
      } else {
        const sourceId = required('sourceId', 600), patientId = required('patientId', 600)
        if (seen.has(sourceId)) throw new Error(`Duplicate ${file.kind} source ID.`)
        seen.add(sourceId)
        if (file.kind === 'appointments') {
          column = 'Start At'; const startAt = timestamp(required('startAt'))
          column = 'End At'; const endAt = timestamp(required('endAt'))
          if (endAt <= startAt) throw new Error('Appointment end must be after its start.')
          const raw = required('status').toLowerCase().replaceAll('_', ' ').replaceAll('-', ' ')
          const statuses: Record<string, Bundle['appointments'][number]['status']> = { booked: 'booked', scheduled: 'booked', attended: 'attended', arrived: 'attended', completed: 'attended', canceled: 'cancelled', cancelled: 'cancelled', 'no show': 'no_show', 'did not arrive': 'no_show' }
          if (!statuses[raw]) throw new Error('Unsupported appointment status; explicitly map to booked, attended, cancelled or no_show.')
          bundle.appointments.push({ ...location, sourceId, patientId, startAt, endAt, status: statuses[raw] })
        } else if (file.kind === 'notes') {
          const title = required('title', 240), body = get('body'); column = 'Body'
          if (!body || body.length > 100_000 || /\u0000/.test(body)) throw new Error('Read-only historical note text is required and must have at most 100,000 characters.')
          bundle.notes.push({ ...location, sourceId, patientId, title, body, date: date('date') })
        } else {
          const payer = required('payer'), memberId = required('memberId'), groupNumber = get('groupNumber')
          if (groupNumber.length > 200 || /[\u0000-\u001f\u007f]/.test(groupNumber)) throw new Error('Group number is malformed.')
          bundle.insurance.push({ ...location, sourceId, patientId, payer, memberId, groupNumber })
        }
      }
    } catch (error) {
      diagnostic('error', 'invalid_row', error instanceof Error ? error.message : 'The row cannot be normalized.', row, column)
      bundle.unmappedRows.push({ ...location, reason: 'invalid_row' })
    }
  }
  if (!nonempty) diagnostic('error', 'empty_file', 'The file contains no data rows.')
}
