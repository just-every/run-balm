import { insist } from '../domain/model'
// Outpatient therapy CPT codes and billed units by the CMS 8-minute rule
// (Medicare Claims Processing Manual, ch. 5 §20.2). Timed codes bill by total
// timed minutes: 8-22 minutes is 1 unit, 23-37 is 2, 38-52 is 3, and so on.
// Each code first takes its whole 15-minute units; the remaining units go to the
// codes with the most minutes left over. A clinician selects the codes at a
// tied allocation boundary; unresolved previews keep stable provisional units.
// Untimed (service-based) codes bill one unit each.
export type Code = { code: string; description: string; timed: boolean; release?: { id: string; version: string; effectiveOn: string }; timingRelease?: { id: string; version: string; effectiveOn: string } }
export type Charge = { code: string; minutes: number; description?: string; timed?: boolean; release?: Code['release']; timingRelease?: Code['timingRelease']; parameters?: string; cmsTieChosen?: true; diagnosisCodes?: string[] }
export type BilledLine = Code & { minutes: number; units: number; cmsTieChosen?: true; diagnosisCodes?: string[] }
export type CmsTie = { codes: string[]; units: number; selected: string[]; resolved: boolean }
export type Billing = { lines: BilledLine[]; timedMinutes: number; timedUnits: number; units: number; cmsTie: CmsTie | null }

// Numeric timing facts preserve math for revisions written before catalogs.
// They supply no descriptors and are never consulted to accept a new charge.
const legacyTimed = new Set(['97110','97112','97116','97140','97530','97535','97542','97750','97760','97763','97032','97033','97035','97129'])
const legacyUntimed = new Set(['97161','97162','97163','97164','97165','97166','97167','97168','97010','97014','97150','92507','92521','92522','92523','92524','92526','92610'])
export function chargeCode(charge: Charge): Code {
  const frozen = typeof charge.timed === 'boolean' && !!charge.release
  insist(frozen || legacyTimed.has(charge.code) || legacyUntimed.has(charge.code), 'charge_has_no_recorded_catalog_timing')
  return { code: charge.code, description: frozen ? charge.description ?? '' : '',
    timed: frozen ? charge.timed! : legacyTimed.has(charge.code), ...(frozen ? { release: charge.release, ...(charge.timingRelease?{timingRelease:charge.timingRelease}:{}) } : {}) }
}

/** Billed units for one note's charges. */
export function bill(charges: Charge[]): Billing {
  const lines = charges.map(c => ({ ...chargeCode(c), ...(c.diagnosisCodes?.length ? { diagnosisCodes: c.diagnosisCodes } : {}), minutes: c.minutes, units: 0, ...(c.cmsTieChosen ? { cmsTieChosen: true as const } : {}) }))
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
