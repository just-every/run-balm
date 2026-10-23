// The codes a superbill carries: each visit's CPT lines (units, modifiers) and
// ICD-10 diagnoses in order, and each practitioner's NPI. When the visit's signed
// notes billed CPT units, the invoice froze those, and the superbill uses them.
import { visibleAppointment } from '../domain/booking'
import { audit, commit, human, insist, need, now, one, rows, stmt, text, type Actor, type Data } from '../domain/model'

/** An NPI is ten digits whose last is the Luhn check over 80840 and the first nine. */
export function validNpi(npi: string) {
  if (!/^\d{10}$/.test(npi)) return false
  let sum = 24
  for (let i = 0; i < 9; i++) { const d = Number(npi[8 - i]) * (i % 2 === 0 ? 2 : 1); sum += d > 9 ? d - 9 : d }
  return (10 - sum % 10) % 10 === Number(npi[9])
}

const items = (value: unknown) => String(value ?? '').toUpperCase().split(/[,;\n]+/).map(s => s.trim()).filter(Boolean)

/** "97110 GP x2, 97140 x1" → CPT lines. Units default to 1; up to four two-character modifiers. */
export function parseCpt(value: unknown) {
  const lines = items(value).map(item => {
    const [code, ...rest] = item.split(/[\s-]+/).filter(Boolean)
    insist(/^(?:\d{4}[0-9A-Z]|[A-Z]\d{4})$/.test(code), `"${item}" is not a CPT or HCPCS code (five characters, like 97110 or G0001)`)
    let units = 1
    const modifiers: string[] = []
    for (const token of rest) {
      const count = token.match(/^[X×](\d{1,2})$|^(\d{1,2})U$|^(\d)$/)
      if (count) units = Number(count[1] ?? count[2] ?? count[3])
      else { insist(/^[A-Z0-9]{2}$/.test(token), `"${token}" in "${item}" is not a modifier or a unit count`); modifiers.push(token) }
    }
    insist(units >= 1 && units <= 99 && modifiers.length <= 4, `check the units and modifiers of "${item}"`)
    return { code, modifiers: modifiers.join(' '), units }
  })
  insist(lines.length <= 12, 'at_most_12_cpt_lines')
  return lines
}

/** "M25.561, m5450" → ICD-10-CM codes with the dot after the category. */
export function parseIcd10(value: unknown) {
  const codes = items(value).map(item => {
    const bare = item.replace('.', '')
    insist(/^[A-TV-Z]\d[0-9A-Z][0-9A-Z]{0,4}$/.test(bare), `"${item}" is not an ICD-10 code (like M25.561)`)
    return bare.length > 3 ? `${bare.slice(0, 3)}.${bare.slice(3)}` : bare
  })
  insist(codes.length <= 12, 'at_most_12_diagnoses')
  insist(new Set(codes).size === codes.length, 'a_diagnosis_is_listed_twice')
  return codes
}

/** The visit's practitioner or the front desk records its codes. */
export async function saveVisitCodes(db: D1Database, who: Actor, input: Data) {
  need(who, 'owner', 'reception', 'practitioner'); human(who)
  const visit = await visibleAppointment(db, who, input.appointmentId)
  insist(visit.status !== 'cancelled', 'canceled_visits_have_no_codes', 409)
  const cpt = parseCpt(input.cpt), icd = parseIcd10(input.icd10), at = now()
  await commit(db, who, [
    stmt(db, 'DELETE FROM bm_visit_codes WHERE appointment_id=?', visit.id),
    ...cpt.map((l, i) => stmt(db, "INSERT INTO bm_visit_codes(appointment_id,kind,position,code,modifiers,units,saved_by,saved_at) VALUES(?,'cpt',?,?,?,?,?,?)", visit.id, i + 1, l.code, l.modifiers, l.units, who.email, at)),
    ...icd.map((code, i) => stmt(db, "INSERT INTO bm_visit_codes(appointment_id,kind,position,code,saved_by,saved_at) VALUES(?,'icd10',?,?,?,?)", visit.id, i + 1, code, who.email, at)),
    audit(db, who, 'visit.codes_saved', visit.client_id as string, visit.id as string, `${cpt.length} CPT, ${icd.length} ICD-10`),
  ])
  return { appointmentId: visit.id, cpt, icd10: icd }
}

export async function savePractitionerNpi(db: D1Database, who: Actor, input: Data) {
  need(who, 'owner'); human(who)
  const staff = await one(db, "SELECT id FROM bm_staff WHERE id=? AND role='practitioner' AND erased_at IS NULL", text(input.staffId, 'staff', 100))
  insist(staff, 'practitioner_not_found', 404)
  const npi = String(input.npi ?? '').replace(/\s/g, '')
  insist(!npi || validNpi(npi), 'that_npi_is_not_valid_ten_digits_with_a_correct_check_digit')
  await commit(db, who, [stmt(db, 'UPDATE bm_staff SET npi=?,version=version+1 WHERE id=?', npi, staff.id), audit(db, who, 'staff.npi_saved', null, staff.id as string)])
  return { staffId: staff.id, npi }
}

/** Codes for one visit, or for every visit of a client, keyed by appointment. */
export async function visitCodes(db: D1Database, by: { appointmentId: string } | { clientId: string }) {
  const list = 'appointmentId' in by ? await rows(db, 'SELECT * FROM bm_visit_codes WHERE appointment_id=? ORDER BY kind,position', by.appointmentId)
    : await rows(db, 'SELECT v.* FROM bm_visit_codes v JOIN bm_appointments a ON a.id=v.appointment_id WHERE a.client_id=? ORDER BY v.kind,v.position', by.clientId)
  const out: Record<string, { cpt: Data[]; icd10: string[] }> = {}
  if ('appointmentId' in by) out[by.appointmentId] = { cpt: [], icd10: [] }
  for (const r of list) {
    const visit = out[r.appointment_id as string] ??= { cpt: [], icd10: [] }
    r.kind === 'cpt' ? visit.cpt.push({ code: r.code, modifiers: r.modifiers, units: r.units }) : visit.icd10.push(r.code as string)
  }
  return out
}

export const cptText = (lines: Data[]) => lines.map(l => [l.code, l.modifiers, l.units > 1 ? `x${l.units}` : ''].filter(Boolean).join(' ')).join(', ')
