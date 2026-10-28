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
  const carryAuthorizations = file.kind === 'authorizations' && keys.includes('allowance')
  const carryInvoices = file.kind === 'invoices' && keys.includes('billed')
  const carryClaims = file.kind === 'claims' && keys.includes('billed')
  const inventoryKind = !carryInvoices && !carryAuthorizations && !carryClaims && (file.kind === 'invoices' || file.kind === 'authorizations' || file.kind === 'claims') ? file.kind as 'invoices' | 'authorizations' | 'claims' : null
  const seen = new Set<string>(carryInvoices ? [...bundle.carriedInvoices.map(r => r.sourceId), ...bundle.inventory.filter(r => r.kind === 'invoices').map(r => r.sourceId)] : carryAuthorizations ? bundle.carriedAuthorizations.map(r => r.sourceId) : file.kind === 'claims' ? [...bundle.carriedClaims.map(r => r.sourceId), ...bundle.inventory.filter(r => r.kind === 'claims').map(r => r.sourceId)] : inventoryKind ? bundle.inventory.filter(r => r.kind === inventoryKind).map(r => r.sourceId) : file.kind === 'patients' ? bundle.patients.map(p => p.sourceId) : file.kind === 'balances' ? bundle.balances.map(p => p.patientId) : bundle[file.kind as 'appointments' | 'notes' | 'insurance'].map(p => p.sourceId))
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
        if (carryAuthorizations) {
          const whole = (key: string, min: number, max: number) => { const v = required(key); if (!/^\d+$/.test(v) || !Number.isSafeInteger(+v) || +v < min || +v > max) throw new Error(`${key} is outside the supported whole-number range.`); return +v }
          const allowanceKind = required('allowance kind'), bookingAction = required('booking action')
          if (!['visits', 'units'].includes(allowanceKind) || !['warn', 'block'].includes(bookingAction)) throw new Error('Choose visits or units and an explicit warn or block booking action.')
          const allowance = whole('allowance', 1, allowanceKind === 'visits' ? 10000 : 1000000), used = whole('used', 0, allowance)
          const startsOn = date('starts on'), endsOn = date('ends on'), cutoverOn = date('cutover on')
          if (endsOn < startsOn || cutoverOn < startsOn || cutoverOn > endsOn) throw new Error('Cutover must be within the original authorization dates.')
          const cptScope = get('cpt scope').split(/\s+/).filter(Boolean)
          if (cptScope.length > 200 || cptScope.some(code => !/^(?:\d{4}[\dA-Z]|[A-Z]\d{4})$/.test(code))) throw new Error('CPT scope must contain space-separated procedure codes.')
          bundle.carriedAuthorizations.push({ ...location, sourceId, patientId, policySourceId: required('policy id', 100), number: required('number', 50), startsOn, endsOn, cutoverOn, allowanceKind: allowanceKind as 'visits' | 'units', allowance, used, unitsPerVisit: allowanceKind === 'units' ? whole('units per visit', 1, 10000) : 1, cptScope, practitionerId: get('practitioner id'), bookingAction: bookingAction as 'warn' | 'block', policyInput: { payerId: required('payer id', 100), memberId: required('member id', 80), patientSex: required('patient sex'), address: required('address', 100), city: required('city', 30), state: required('state', 2), postalCode: required('postal code', 10), relationship: get('relationship') || '18', subscriberFirst: get('subscriber first'), subscriberLast: get('subscriber last'), subscriberDob: get('subscriber dob') ? date('subscriber dob') : '', subscriberSex: get('subscriber sex'), groupNumber: get('group number'), planName: get('plan name'), priority: get('priority') ? Number(get('priority')) : 1, startsOn: date('policy starts on'), endsOn: get('policy ends on') ? date('policy ends on') : '' } })
        } else if (carryInvoices) {
          const billedCents = usdCents(required('billed')), balanceCents = usdCents(required('balance'))
          if (billedCents < 0 || balanceCents < 0 || balanceCents > billedCents) throw new Error('An invoice balance must be between zero and its original billed amount. Carry account credits in the independent net aging, never as a negative invoice.')
          bundle.carriedInvoices.push({ ...location, sourceId, patientId, reference: required('reference', 240), issuedOn: date('issuedOn'), billedCents, balanceCents })
        } else if (inventoryKind) {
          bundle.inventory.push({ ...location, kind: inventoryKind, sourceId, patientId, reference: required('reference', 240) })
        } else if (carryClaims) {
          if (sourceId.length > 100) throw new Error('Source claim ID must have at most 100 characters.')
          const payerId = required('payerId', 100), patientControl = required('patientControl', 100), payerControl = get('payerControl')
          if (payerControl.length > 100 || /[\u0000-\u001f\u007f]/.test(payerControl)) throw new Error('Payer control is malformed.')
          column = 'Billed'; const billedCents = usdCents(required('billed'))
          column = 'Balance'; const balanceCents = usdCents(required('balance'))
          if (billedCents <= 0 || balanceCents <= 0 || balanceCents > billedCents) throw new Error('An open claim needs a positive balance no greater than its billed amount.')
          const status = required('status')
          if (!['open', 'denied', 'rejected'].includes(status)) throw new Error('Claim status must be open, denied or rejected.')
          bundle.carriedClaims.push({ ...location, sourceId, patientId, payerId, patientControl, payerControl, serviceDate: date('serviceDate'), billedCents, balanceCents, status: status as 'open' | 'denied' | 'rejected' })
        } else if (file.kind === 'appointments') {
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
