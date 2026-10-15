// The CSV reader is Strap's (src/strap/movein/csv.ts, just-every/run-strap @ 92c3892).
import { Buffer } from 'node:buffer'
import { canonicalJson, sha256 } from '../../modules/import-kit/src/d1/index.ts'
import type { SourceBundle, SourceRecord } from '../../modules/import-kit/src/types.ts'
import { ImportError, requiredText } from './errors.ts'

export const namespace = 'balm.cliniko.patients.csv.v1'
export const formatName = 'Cliniko patient CSV v1'
/** Cliniko's documented patient field names, with the export's patient ID. */
export const columns = ['ID', 'First Name', 'Last Name', 'Date of Birth', 'Email', 'Mobile']

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

/** Accepts YYYY-MM-DD or Australian DD/MM/YYYY; returns YYYY-MM-DD. */
function birthDate(value: string, line: number): string | null {
  if (!value) return null
  const au = value.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/)
  const iso = au ? `${au[3]}-${au[2].padStart(2, '0')}-${au[1].padStart(2, '0')}` : value
  if (!/^\d{4}-\d\d-\d\d$/.test(iso) || new Date(iso + 'T00:00:00Z').toISOString().slice(0, 10) !== iso) throw new ImportError('invalid_patient_row', 422, `Invalid date of birth at line ${line}`)
  return iso
}

export function patientSource(value: unknown): SourceBundle {
  const csv = requiredText(value, 'csv'), bytes = Buffer.from(csv, 'utf8')
  if (bytes.length > 1_000_000) throw new ImportError('csv_too_large', 413, 'Patient CSV is limited to 1,000,000 UTF-8 bytes')
  if (csv.includes('\0')) throw new ImportError('invalid_csv', 422)
  const rows = parse(csv.replace(/^﻿/, ''))
  if (!rows.length || rows[0].cells.length !== columns.length || rows[0].cells.some((v, i) => v.trim() !== columns[i])) {
    throw new ImportError('invalid_csv_headers', 422, `Use these exact headers: ${columns.join(',')}`)
  }
  const body = rows.slice(1).filter(r => r.cells.some(c => c.trim()))
  if (!body.length || body.length > 1000) throw new ImportError('invalid_patient_count', 422, 'Import between 1 and 1000 patient rows')
  const ids = new Set<string>(), artifactHash = sha256(bytes)
  const records: SourceRecord[] = body.map(({ cells, line }) => {
    if (cells.length !== columns.length) throw new ImportError('invalid_csv_row', 422, `Line ${line} must have ${columns.length} cells`)
    const [id, firstName, lastName, dob, rawEmail, mobile] = cells.map(v => v.trim())
    const email = rawEmail.toLowerCase()
    const bad = (v: string, max: number) => v.length > max || /[\u0000-\u001f\u007f]/.test(v)
    if (!/^[A-Za-z0-9_-]{1,40}$/.test(id) || !firstName || !lastName || bad(firstName, 80) || bad(lastName, 80) || bad(mobile, 40)
      || (email && (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)))) {
      throw new ImportError('invalid_patient_row', 422, `Invalid patient fields at line ${line}`)
    }
    if (ids.has(id)) throw new ImportError('duplicate_patient', 422, `Duplicate patient ID at line ${line}`)
    ids.add(id)
    const payload = { id, firstName, lastName, dateOfBirth: birthDate(dob, line), email: email || null, mobile: mobile || null }
    return { namespace, kind: 'patient', sourceId: id, payload, payloadHash: sha256(canonicalJson(payload)), artifactHash,
      location: { artifact: 'patients.csv', row: line } }
  })
  return { records, diagnostics: [], artifacts: [{ name: 'patients.csv', sha256: artifactHash, size: bytes.length,
    original: { status: 'available', base64: bytes.toString('base64') } }] }
}
