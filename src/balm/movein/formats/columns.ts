import type { FileKind } from '../formats.ts'

type Column = { key: string; names: string[]; required?: boolean }
const field = (key: string, names: string[], required = false): Column => ({ key, names, required })
const source = field('sourceId', ['Source ID', 'ID'])
const patient = field('patientId', ['Patient ID', 'Client ID'], true)
export const layouts: Record<FileKind, Column[]> = {
  patients: [
    field('sourceId', ['Source ID', 'Patient ID', 'Client ID', 'ID']),
    field('firstName', ['First Name', 'First']), field('lastName', ['Last Name', 'Last', 'Surname']),
    field('fullName', ['Client', 'Patient', 'Patient Name', 'Client Name', 'Name']),
    field('dateOfBirth', ['Date of Birth', 'DOB', 'Birth Date', 'Birthday']),
    field('email', ['Email', 'Email Address']), field('phone', ['Phone', 'Phone Number', 'Mobile', 'Mobile Phone', 'Mobile Number']),
    field('payer', ['Primary Insurance']), field('memberId', ['Insurance ID']),
  ],
  appointments: [source, patient, field('startAt', ['Start At', 'Start Time', 'Starts At'], true), field('endAt', ['End At', 'End Time', 'Ends At'], true), field('status', ['Status'], true)],
  notes: [source, patient, field('title', ['Title'], true), field('body', ['Body', 'Note Text'], true), field('date', ['Date', 'Note Date'], true)],
  balances: [patient, field('amount', ['Balance', 'Amount'], true)],
  insurance: [source, patient, field('payer', ['Payer', 'Insurer', 'Primary Insurance'], true), field('memberId', ['Member ID', 'Insurance ID'], true), field('groupNumber', ['Group Number', 'Group ID'])],
}
export const headerKey = (text: string) => text.trim().toLowerCase().replace(/[_\s]+/g, ' ')
