// Outpatient therapy CPT codes and billed units by the CMS 8-minute rule
// (Medicare Claims Processing Manual, ch. 5 §20.2). Timed codes bill by total
// timed minutes: 8-22 minutes is 1 unit, 23-37 is 2, 38-52 is 3, and so on.
// Each code first takes its whole 15-minute units; the remaining units go to the
// codes with the most minutes left over. A clinician selects the codes at a
// tied allocation boundary; unresolved previews keep stable provisional units.
// Untimed (service-based) codes bill one unit each.
export type Code = { code: string; description: string; timed: boolean }
export type Charge = { code: string; minutes: number; cmsTieChosen?: true; diagnosisCodes?: string[] }
export type BilledLine = Code & { minutes: number; units: number; cmsTieChosen?: true; diagnosisCodes?: string[] }
export type CmsTie = { codes: string[]; units: number; selected: string[]; resolved: boolean }
export type Billing = { lines: BilledLine[]; timedMinutes: number; timedUnits: number; units: number; cmsTie: CmsTie | null }

export const codes: Code[] = [
  ['97110', 'Therapeutic exercise', true], ['97112', 'Neuromuscular re-education', true], ['97116', 'Gait training', true],
  ['97140', 'Manual therapy', true], ['97530', 'Therapeutic activities', true], ['97535', 'Self-care and home management training', true],
  ['97542', 'Wheelchair management training', true], ['97750', 'Physical performance test', true], ['97760', 'Orthotic management and training', true],
  ['97763', 'Orthotic or prosthetic management, subsequent', true], ['97032', 'Electrical stimulation, attended', true], ['97033', 'Iontophoresis', true],
  ['97035', 'Ultrasound', true], ['97129', 'Cognitive function intervention, first 15 minutes', true],
  ['97161', 'PT evaluation, low complexity', false], ['97162', 'PT evaluation, moderate complexity', false], ['97163', 'PT evaluation, high complexity', false],
  ['97164', 'PT re-evaluation', false], ['97165', 'OT evaluation, low complexity', false], ['97166', 'OT evaluation, moderate complexity', false],
  ['97167', 'OT evaluation, high complexity', false], ['97168', 'OT re-evaluation', false], ['97010', 'Hot or cold packs', false],
  ['97014', 'Electrical stimulation, unattended', false], ['97150', 'Group therapeutic procedures', false],
  ['92507', 'Speech, language, voice or communication treatment', false], ['92521', 'Evaluation of speech fluency', false],
  ['92522', 'Evaluation of speech sound production', false], ['92523', 'Evaluation of speech sound production with language', false],
  ['92524', 'Behavioral and qualitative analysis of voice and resonance', false], ['92526', 'Treatment of swallowing dysfunction', false],
  ['92610', 'Evaluation of oral and pharyngeal swallowing function', false],
].map(([code, description, timed]) => ({ code, description, timed }) as Code)

export const cpt = (code: unknown) => codes.find(c => c.code === code)

/** Billed units for one note's charges. */
export function bill(charges: Charge[]): Billing {
  const lines = charges.map(c => ({ ...cpt(c.code)!, ...(c.diagnosisCodes?.length ? { diagnosisCodes: c.diagnosisCodes } : {}), minutes: c.minutes, units: 0, ...(c.cmsTieChosen ? { cmsTieChosen: true as const } : {}) }))
  const timed = lines.filter(l => l.timed)
  const timedMinutes = timed.reduce((sum, l) => sum + l.minutes, 0)
  const timedUnits = Math.floor((timedMinutes + 7) / 15)
  for (const l of timed) l.units = Math.floor(l.minutes / 15)
  let left = timedUnits - timed.reduce((sum, l) => sum + l.units, 0)
  let cmsTie: CmsTie | null = null
  const remainders = [...new Set(timed.map(l => l.minutes % 15))].filter(Boolean).sort((a, b) => b - a)
  for (const remainder of remainders) {
    if (left <= 0) break
    const group = timed.filter(l => l.minutes % 15 === remainder)
    const count = Math.min(left, group.length)
    if (count < group.length) {
      const selected = group.filter(l => l.cmsTieChosen).map(l => l.code)
      cmsTie = { codes: group.map(l => l.code), units: count, selected, resolved: selected.length === count }
    }
    // Selection only breaks an equal-remainder tie; it cannot outrank more minutes.
    for (const l of [...group].sort((a, b) => Number(!!b.cmsTieChosen) - Number(!!a.cmsTieChosen)).slice(0, count)) l.units++
    left -= count
  }
  for (const l of lines) if (!l.timed) l.units = 1
  return { lines, timedMinutes, timedUnits, cmsTie, units: lines.reduce((sum, l) => sum + l.units, 0) }
}
