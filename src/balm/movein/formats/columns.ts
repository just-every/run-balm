import type { FileKind, Provider } from '../formats.ts'

type Column = { key: string; names: string[]; required?: boolean }
const field = (key: string, names: string[], required = false): Column => ({ key, names, required })
const source = field('sourceId', ['Source ID', 'ID'])
const patient = field('patientId', ['Patient ID', 'Client ID'], true)
export const layouts: Record<FileKind, Column[]> = {
  patients: [
    field('sourceId', ['Source ID', 'Patient ID', 'Client ID', 'ID']),
    field('firstName', ['First Name', 'First', 'Name (First)']), field('lastName', ['Last Name', 'Last', 'Surname', 'Name (Last)']),
    field('fullName', ['Client', 'Patient', 'Patient Name', 'Client Name', 'Name']),
    field('dateOfBirth', ['Date of Birth', 'DOB', 'Birth Date', 'Birthday']),
    field('email', ['Email', 'Email Address']), field('phone', ['Phone', 'Phone Number', 'Mobile', 'Mobile Phone', 'Mobile Number']),
    field('payer', ['Primary Insurance']), field('memberId', ['Insurance ID', 'Primary Subscriber ID']),
  ],
  invoices: [source, patient, field('reference', ['Reference'], true)],
  authorizations: [source, patient, field('reference', ['Reference'], true)],
  claims: [source, patient, field('reference', ['Reference'], true)],
  appointments: [source, patient, field('startAt', ['Start At', 'Start Time', 'Starts At'], true), field('endAt', ['End At', 'End Time', 'Ends At'], true), field('status', ['Status'], true)],
  notes: [source, patient, field('title', ['Title'], true), field('body', ['Body', 'Note Text'], true), field('date', ['Date', 'Note Date'], true)],
  balances: [patient, field('amount', ['Balance', 'Amount'], true)],
  insurance: [source, patient, field('payer', ['Payer', 'Insurer', 'Primary Insurance'], true), field('memberId', ['Member ID', 'Insurance ID'], true), field('groupNumber', ['Group Number', 'Group ID'])],
}
export const headerKey = (text: string) => text.trim().toLowerCase().replace(/[_\s]+/g, ' ')

export const claimColumns: Column[] = [source, patient, field('payerId', ['Payer ID'], true), field('patientControl', ['Patient control'], true), field('payerControl', ['Payer control']), field('serviceDate', ['Service date'], true), field('billed', ['Billed'], true), field('balance', ['Balance'], true), field('status', ['Status'], true)]

const authorizationFields = [
  'Policy ID', 'Payer ID', 'Member ID', 'Policy Starts On', 'Policy Ends On', 'Starts On', 'Ends On', 'Number', 'Cutover On',
  'Allowance Kind', 'Allowance', 'Used', 'Units Per Visit', 'CPT Scope', 'Practitioner ID', 'Booking Action',
  'Patient Sex', 'Address', 'City', 'State', 'Postal Code', 'Relationship', 'Subscriber First', 'Subscriber Last',
  'Subscriber DOB', 'Subscriber Sex', 'Group Number', 'Plan Name', 'Priority',
]
const requiredAuthorizationFields = new Set([
  'Policy ID', 'Payer ID', 'Member ID', 'Policy Starts On', 'Starts On', 'Ends On', 'Number', 'Cutover On',
  'Allowance Kind', 'Allowance', 'Used', 'Booking Action', 'Patient Sex', 'Address', 'City', 'State', 'Postal Code',
])
export const authorizationColumns: Column[] = [source, patient, ...authorizationFields.map(name => field(headerKey(name), [name], requiredAuthorizationFields.has(name)))]


/** The proposal and the importer share the same header decisions. */
export function columnsFor(provider: Provider, kind: FileKind, headers: string[]) {
  if (kind === 'authorizations' && headers.some(h => headerKey(h) === 'allowance')) return authorizationColumns
  if (kind === 'claims' && headers.some(h => headerKey(h) === 'billed')) return claimColumns
  return layouts[kind].map(c => provider === 'webpt' && kind === 'patients' && c.key === 'phone' && headers.some(h => ['Cell Phone', 'Home Phone', 'Phone'].includes(h))
    ? { ...c, names: [headers.includes('Cell Phone') ? 'Cell Phone' : headers.includes('Home Phone') ? 'Home Phone' : 'Phone'] } : c)
}
