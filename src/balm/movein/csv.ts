// The CSV reader is Strap's (src/strap/movein/csv.ts, just-every/run-strap @ 92c3892).
import { Buffer } from 'node:buffer'
import { canonicalJson, sha256 } from '../../modules/import-kit/src/d1/index.ts'
import type { Diagnostic, SourceBundle, SourceRecord } from '../../modules/import-kit/src/types.ts'
import { ImportError, requiredText } from './errors.ts'

export const namespace = 'balm.cliniko.patients.csv.v1'
export const formatName = 'Cliniko patient CSV v1'
/** What Balm reads from Cliniko's patient export (Settings → Data & docs → Data exports → Patients), by header; other columns are left out. */
export const fields = [
  { key: 'id', label: 'Patient ID', headers: ['id', 'patient id'], required: true },
  { key: 'firstName', label: 'First Name', headers: ['first name', 'first'], required: true },
  { key: 'lastName', label: 'Last Name', headers: ['last name', 'last', 'surname'], required: true },
  { key: 'dateOfBirth', label: 'Date of Birth', headers: ['date of birth', 'dob', 'birth date', 'birthday'], required: false },
  { key: 'email', label: 'Email', headers: ['email', 'email address'], required: false },
  { key: 'mobile', label: 'Mobile', headers: ['mobile', 'mobile phone', 'mobile number', 'phone', 'phone number'], required: false },
] as const
export type DateFormat = 'MDY' | 'DMY' | 'YMD'
export const dateFormats: [DateFormat, string][] = [['MDY', 'MM/DD/YYYY (US, for example 04/12/1988 is April 12)'], ['DMY', 'DD/MM/YYYY (for example 04/12/1988 is 4 December)'], ['YMD', 'YYYY-MM-DD']]
export const dateFormat = (value: unknown): DateFormat => value === 'DMY' || value === 'YMD' ? value : 'MDY'

/** RFC 4180 quoting; diagnostic rows name the physical starting line. */
function parse(text: string): { cells: string[]; line: number }[] {
  const rows: { cells: string[]; line: number }[] = []
  let cells: string[] = [], cell = '', state: 'plain' | 'quoted' | 'closed' = 'plain', line = 1, start = 1
  const push = () => { cells.push(cell); rows.push({ cells, line: start }); cells = []; cell = ''; state = 'plain' }
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]
    if (state === 'quoted') {
      if (ch === '"') { if (text[i + 1] === '"') { cell += '"'; i++ } else state = 'closed' }
      else { cell += ch; if (ch === '\n') line++ }
      continue
    }
    if (ch === '"') {
      if (state !== 'plain' || cell) throw new ImportError('invalid_csv', 422, `Unexpected quote at line ${line}`)
      state = 'quoted'; continue
    }
    if (ch === ',') { cells.push(cell); cell = ''; state = 'plain'; continue }
    if (ch === '\r' || ch === '\n') {
      if (ch === '\r' && text[i + 1] === '\n') i++
      push(); line++; start = line; continue
    }
    if (state === 'closed') throw new ImportError('invalid_csv', 422, `Unexpected text after a quote at line ${line}`)
    cell += ch
  }
  if (state === 'quoted') throw new ImportError('invalid_csv', 422, 'Unclosed CSV quote')
  if (cell || cells.length || state === 'closed') push()
  return rows
}

const monthDay = (iso: string) => new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', month: 'long', day: 'numeric', year: 'numeric' }).format(new Date(iso + 'T00:00:00Z'))
const realDate = (iso: string) => /^\d{4}-\d\d-\d\d$/.test(iso) && !Number.isNaN(Date.parse(iso + 'T00:00:00Z')) && new Date(iso + 'T00:00:00Z').toISOString().slice(0, 10) === iso

/** Reads a birth date in the chosen format (ISO YYYY-MM-DD is always accepted); a date that also reads the other way round is flagged, never swapped. */
function birthDate(value: string, line: number, format: DateFormat, warnings: Diagnostic[], sourceId: string): string | null {
  if (!value) return null
  const slash = value.match(/^(\d{1,2})[\/.-](\d{1,2})[\/.-](\d{4})$/)
  let iso = value
  if (slash) {
    if (format === 'YMD') throw new ImportError('invalid_patient_row', 422, `Line ${line}: the date of birth ${value} is not written YYYY-MM-DD. Choose the date format your file uses.`)
    const [month, day] = format === 'MDY' ? [slash[1], slash[2]] : [slash[2], slash[1]]
    iso = `${slash[3]}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`
    // The same digits read the other way round (day and month swapped).
    const other = `${slash[3]}-${day.padStart(2, '0')}-${month.padStart(2, '0')}`, otherName = format === 'MDY' ? 'DD/MM/YYYY' : 'MM/DD/YYYY'
    if (!realDate(iso)) throw new ImportError('invalid_patient_row', 422, `Line ${line}: the date of birth ${value} is not a real ${format === 'MDY' ? 'MM/DD/YYYY' : 'DD/MM/YYYY'} date.${realDate(other) ? ` If your file writes dates as ${otherName}, choose that format and preview again.` : ''}`)
    if (other !== iso && realDate(other)) {
      warnings.push({ severity: 'warning', code: 'ambiguous_date', kind: 'patient', sourceId, field: 'dateOfBirth', location: { artifact: 'patients.csv', row: line },
        message: `Line ${line}: ${value} is read as ${monthDay(iso)}. Written the other way round it would be ${monthDay(other)}; check it before importing.` })
    }
  }
  if (!realDate(iso)) throw new ImportError('invalid_patient_row', 422, `Line ${line}: the date of birth ${value} is not a date Balm can read. Use the format chosen above.`)
  return iso
}

export function patientSource(value: unknown, format: DateFormat = 'MDY'): SourceBundle {
  const csv = requiredText(value, 'csv'), bytes = Buffer.from(csv, 'utf8')
  if (bytes.length > 1_000_000) throw new ImportError('csv_too_large', 413, 'The file is larger than 1,000,000 bytes. Export a smaller date range from Cliniko and import each file in turn.')
  if (csv.includes('\0')) throw new ImportError('invalid_csv', 422, 'This file is not a CSV text file. Upload the CSV file Cliniko gave you.')
  const rows = parse(csv.replace(/^\uFEFF/, ''))
  const header = (rows[0]?.cells ?? []).map(v => v.trim().toLowerCase())
  const at = Object.fromEntries(fields.map(f => [f.key, header.findIndex(v => (f.headers as readonly string[]).includes(v))])) as Record<typeof fields[number]['key'], number>
  const missing = fields.filter(f => f.required && at[f.key] < 0)
  if (!rows.length || missing.length) throw new ImportError('invalid_csv_headers', 422, `The file's first row needs the column${missing.length === 1 ? '' : 's'} ${missing.map(f => f.label).join(', ')}. Upload Cliniko's patient export as it was downloaded.`)
  const body = rows.slice(1).filter(r => r.cells.some(c => c.trim()))
  if (!body.length || body.length > 1000) throw new ImportError('invalid_patient_count', 422, body.length ? 'Import up to 1000 patients at a time: export a smaller date range from Cliniko.' : 'The file has no patient rows.')
  const ids = new Set<string>(), artifactHash = sha256(bytes), warnings: Diagnostic[] = []
  const records: SourceRecord[] = body.map(({ cells, line }) => {
    if (cells.length !== header.length) throw new ImportError('invalid_csv_row', 422, `Line ${line} has ${cells.length} cells but the header has ${header.length}. Upload the file as Cliniko exported it.`)
    const cell = (key: keyof typeof at) => at[key] < 0 ? '' : cells[at[key]].trim()
    const id = cell('id'), firstName = cell('firstName'), lastName = cell('lastName'), mobile = cell('mobile'), email = cell('email').toLowerCase()
    const bad = (v: string, max: number) => v.length > max || /[\u0000-\u001f\u007f]/.test(v)
    if (!/^[A-Za-z0-9_-]{1,40}$/.test(id)) throw new ImportError('invalid_patient_row', 422, `Line ${line}: the patient ID is missing or not a Cliniko ID.`)
    if (!firstName || !lastName || bad(firstName, 80) || bad(lastName, 80)) throw new ImportError('invalid_patient_row', 422, `Line ${line}: a first and last name (up to 80 characters each) are needed.`)
    if (bad(mobile, 40)) throw new ImportError('invalid_patient_row', 422, `Line ${line}: the mobile number is longer than 40 characters.`)
    if (email && (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))) throw new ImportError('invalid_patient_row', 422, `Line ${line}: ${email} is not an email address.`)
    if (ids.has(id)) throw new ImportError('duplicate_patient', 422, `Line ${line}: patient ID ${id} appears twice in the file.`)
    ids.add(id)
    const payload = { id, firstName, lastName, dateOfBirth: birthDate(cell('dateOfBirth'), line, format, warnings, id), email: email || null, mobile: mobile || null }
    return { namespace, kind: 'patient', sourceId: id, payload, payloadHash: sha256(canonicalJson(payload)), artifactHash,
      location: { artifact: 'patients.csv', row: line } }
  })
  return { records, diagnostics: warnings, artifacts: [{ name: 'patients.csv', sha256: artifactHash, size: bytes.length,
    original: { status: 'available', base64: bytes.toString('base64') } }] }
}
