import { fileFromField } from '../forms'
import { ImportError } from './errors'

const kinds = ['patients', 'appointments', 'notes', 'balances', 'insurance', 'invoices', 'authorizations', 'claims'] as const

/** Reconstitute the reviewed bytes; submitted reconciliation fields remain editable. */
export function bundleFormInput(input: Record<string, unknown>) {
  let original: Record<string, unknown> = {}
  if (typeof input.bundleBase64 === 'string') {
    try { original = JSON.parse(fileFromField(input.bundleBase64)) }
    catch { throw new ImportError('invalid_review', 400, 'Upload the files again; this review could not be read.') }
  }
  const next: Record<string, any> = { ...original, ...input }
  delete next.bundleBase64
  // Approval checkboxes must be present in this submission, never inherited.
  for (const approval of ['mappingApproval', 'cutoverApproval']) if (input[approval] === undefined) delete next[approval]
  if (!Array.isArray(next.files)) next.files = kinds.filter(kind => typeof input[kind] === 'string' && input[kind]).map(kind => ({ kind, name: input[kind + 'Name'] ?? kind + '.csv', csv: input[kind] }))
  const expected: Record<string, any> = {}
  for (const field of ['patients', 'documents', 'insurance', 'invoices', 'authorizations', 'claims']) {
    const value = input['expected' + field[0].toUpperCase() + field.slice(1)]
    if (value !== undefined && value !== '') expected[field] = Number(value)
  }
  for (const [key, value] of Object.entries(input)) {
    if (key.startsWith('month_')) (expected.appointmentsByMonth ??= {})[key.slice(6)] = Number(value)
    if (key.startsWith('balance_')) {
      const dollars = String(value).trim()
      if (!/^-?\d+(\.\d{1,2})?$/.test(dollars)) throw new ImportError('invalid_balance', 400, 'Enter source balances in dollars and cents.')
      const negative = dollars.startsWith('-'), [whole, fraction = ''] = dollars.replace(/^-/, '').split('.')
      ;(expected.balancesByPatient ??= {})[key.slice(8)] = (Number(whole) * 100 + Number(fraction.padEnd(2, '0'))) * (negative ? -1 : 1)
    }
  }
  if (Object.keys(expected).length) next.expectedTotals = expected
  return next
}
