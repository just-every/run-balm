import {chooseSchedule} from './schedules'
import { chargeCode, type Charge } from '../charting/cpt'
import { payerBilling } from './unit-method'
import { hostDateAt } from '../availability/timezone'
import { insist, rows, type Data } from '../domain/model'

export type AccountedAuthorization = Data & {
  allowance_kind: 'visits' | 'units'; allowance_total: number
  used_allowance: number; reserved_allowance: number; remaining_allowance: number
  used_visits: number; reserved_visits: number; remaining_visits: number
  used_units: number; reserved_units: number; remaining_units: number | null
}

/** Charge facts only: never note text. Callers may wrap this SELECT to filter
 * client_id. Unsigned charges and recorded visit CPTs expose known scope only. */
export const signedAuthorizationChargeSql = `SELECT n.appointment_id,n.client_id,n.id,n.signed_sha256,n.signed_revision,n.signed_at,
  n.signed_at IS NOT NULL AS signed,r.charges,r.written_at AS created_at
  FROM bm_notes n JOIN bm_note_revisions r ON r.note_id=n.id
    AND r.number=COALESCE(n.signed_revision,(SELECT MAX(x.number) FROM bm_note_revisions x WHERE x.note_id=n.id))
  WHERE n.appointment_id IS NOT NULL
  UNION ALL SELECT c.appointment_id,a.client_id,NULL,NULL,NULL,NULL,0,
    json_array(json_object('code',c.code,'minutes',0)),a.created_at
  FROM bm_visit_codes c JOIN bm_appointments a ON a.id=c.appointment_id WHERE c.kind='cpt'`

/** CMS allocation is computed over the whole visit before any scope check. */
export function billedLines(charges: Charge[], unitMethod: string | null, fixedUnitMinutes?: number | null) {
  return payerBilling(charges, unitMethod, fixedUnitMinutes).lines
}
export function aggregateCharges(chargeRows: Data[]): Charge[] {
  const metadata = new Map<string, ReturnType<typeof chargeCode>>()
  const minutes = new Map<string, number>(), chosen = new Set<string>(), diagnoses = new Map<string, Set<string>>()
  for (const row of [...chargeRows].sort((a, b) => String(a.id ?? '').localeCompare(String(b.id ?? '')))) for (const charge of (typeof row.charges === 'string' ? JSON.parse(row.charges) : row.charges) ?? []) {
    insist(Number.isInteger(charge.minutes) && charge.minutes >= 0, 'invalid_signed_charge')
    const code = chargeCode(charge), previous = metadata.get(charge.code)
    insist(!previous || previous.timed === code.timed, 'signed_charge_timing_conflicts')
    metadata.set(charge.code, code)
    minutes.set(charge.code, (minutes.get(charge.code) ?? 0) + charge.minutes)
    if (charge.cmsTieChosen === true) chosen.add(charge.code)
    if (charge.diagnosisCodes?.length) {
      const selected = diagnoses.get(charge.code) ?? new Set<string>()
      for (const code of charge.diagnosisCodes) selected.add(code)
      diagnoses.set(charge.code, selected)
    }
  }
  return [...minutes].map(([code, minutes]) => ({ ...metadata.get(code)!, code, minutes, ...(chosen.has(code) ? { cmsTieChosen: true as const } : {}), ...(diagnoses.has(code) ? { diagnosisCodes: [...diagnoses.get(code)!] } : {}) }))
}
export async function signedCharges(db: D1Database, appointmentId: string) {
  const signed = await rows(db, `SELECT n.id,n.signed_sha256,n.signed_revision,r.charges FROM bm_notes n JOIN bm_note_revisions r ON r.note_id=n.id AND r.number=n.signed_revision WHERE n.appointment_id=? AND n.signed_at IS NOT NULL ORDER BY n.id`, appointmentId)
  return { signed, charges: aggregateCharges(signed) }
}
export const allowanceTotal = (a: Data): number => Number(a.allowance_kind === 'units' ? a.units : a.visits)
export const reservationAllowance = (a: Data): number => a.allowance_kind === 'units' ? Number(a.units_per_visit) : 1
export const lowRemainder = (a: Data): number => Number(a.low_remainder ?? 2)
export const authorizationScope = (a: Data): string[] => typeof a.cpt_scope === 'string' ? JSON.parse(a.cpt_scope) : a.cpt_scope ?? []
export const authorizationCoversCodes = (a: Data, codes: string[]): boolean => {
  const scope = authorizationScope(a)
  return !scope.length || codes.every(code => scope.includes(code))
}
const episode = (row: Data) => row.episodeId ?? row.episode_id ?? ''
export const authorizationOrder = (a: Data, b: Data) => b.starts_on.localeCompare(a.starts_on) || b.id.localeCompare(a.id)
export function selectAuthorization(auths: Data[], policyId: string, date: string, practitionerId: string, episodeId = '', clientId?: string) {
  return auths.filter(a => a.policy_id === policyId && episode(a) === episodeId && (!clientId || a.client_id === clientId)
    && a.starts_on <= date && a.ends_on >= date && (!a.practitioner_id || a.practitioner_id === practitionerId)).sort(authorizationOrder)[0]
}
/** A day cutoff is inclusive; an instant cutoff is exclusive (daily close's
 * next local midnight). Future bookings always retain their reservations. */
function beforeCutoff(value: string | null | undefined, cutoff?: string, zone = 'UTC') {
  return !cutoff || !value || (cutoff.length === 10 ? hostDateAt(new Date(value), zone) <= cutoff : Date.parse(value) < Date.parse(cutoff))
}
function visitCharges(visit: Data, chargeRows: Data[], cutoff?: string, zone = 'UTC') {
  const own = chargeRows.filter(r => r.appointment_id === visit.id && beforeCutoff(r.created_at, cutoff, zone))
  const signed = own.filter(r => r.signed !== 0 && r.signed !== false && (r.signed_at || r.signed === 1 || r.signed === true || r.signed === undefined && !('signed_at' in r)) && beforeCutoff(r.signed_at, cutoff, zone))
  const charges = aggregateCharges(signed)
  return { signed: signed.length > 0, charges, known: signed.length ? [] : own }
}
/** Any billed CPT outside scope makes the entire visit uncovered; it consumes
 * neither a partial unit debit nor a reservation. Empty scope covers all CPTs. */
export function authorizationCoversVisit(a: Data, visit: Data, chargeRows: Data[], cutoff?: string, zone = 'UTC') {
  if(a.billingPolicy&&visit.start_at){const s=chooseSchedule(a.billingSchedules??[],a.billingPolicy.payer_id,a.billingPolicy.plan_name,hostDateAt(new Date(visit.start_at),zone));if(s)a={...a,unit_method:s.unit_method,fixed_unit_minutes:s.fixed_unit_minutes}}
  const facts = visitCharges(visit, chargeRows, cutoff, zone)
  const codes = facts.signed ? billedLines(facts.charges, a.unit_method ?? null, a.fixed_unit_minutes).filter(l => l.units > 0).map(l => l.code) : facts.known.flatMap(row => {
    const charges = typeof row.charges === 'string' ? JSON.parse(row.charges) : row.charges
    return (charges ?? []).map((c: Charge) => c.code)
  })
  return authorizationCoversCodes(a, codes)
}
export function visitAllowance(a: Data, visit: Data, chargeRows: Data[], cutoff?: string, zone = 'UTC') {
  const empty = { used: 0, reserved: 0, usedVisits: 0, reservedVisits: 0 }
  if (!['booked', 'attended'].includes(visit.status) || !beforeCutoff(visit.created_at, cutoff, zone)
    || visit.status === 'attended' && !beforeCutoff(visit.start_at, cutoff, zone)
    || !authorizationCoversVisit(a, visit, chargeRows, cutoff, zone)) return empty
  if(a.billingPolicy&&visit.start_at){const s=chooseSchedule(a.billingSchedules??[],a.billingPolicy.payer_id,a.billingPolicy.plan_name,hostDateAt(new Date(visit.start_at),zone));if(s)a={...a,unit_method:s.unit_method,fixed_unit_minutes:s.fixed_unit_minutes}}
  const facts = visitCharges(visit, chargeRows, cutoff, zone)
  if (visit.status === 'booked' || a.allowance_kind === 'units' && !facts.signed) return { ...empty, reserved: reservationAllowance(a), reservedVisits: 1 }
  const used = a.allowance_kind === 'units' ? billedLines(facts.charges, a.unit_method ?? null, a.fixed_unit_minutes).reduce((sum, l) => sum + l.units, 0) : 1
  return { ...empty, used, usedVisits: 1 }
}
/** Shared bulk accounting for visits, claims, calendar and audited daily close.
 * Selection is by latest start per policy/episode/provider, inclusive bounds;
 * exhaustion never suppresses actual signed usage. Inputs remain unchanged. */
export function accountAuthorizations(auths: Data[], visits: Data[], zone: string, chargeRows: Data[], cutoff?: string): AccountedAuthorization[] {
  const out: AccountedAuthorization[] = [...auths].sort(authorizationOrder).map(a => ({ ...a, allowance_kind: a.allowance_kind ?? 'visits', allowance_total: allowanceTotal(a), used_allowance: 0, reserved_allowance: 0, remaining_allowance: 0, used_visits: 0, reserved_visits: 0, remaining_visits: 0, used_units: 0, reserved_units: 0, remaining_units: null }))
  const charges = new Map<string, Data[]>()
  for (const row of chargeRows) charges.set(row.appointment_id, [...(charges.get(row.appointment_id) ?? []), row])
  for (const visit of visits) {
    const date = hostDateAt(new Date(visit.start_at), zone)
    const policies = new Set(out.filter(a => !visit.client_id || a.client_id === visit.client_id).map(a => a.policy_id as string))
    for (const policyId of policies) {
      const a = selectAuthorization(out, policyId, date, visit.practitioner_id, episode(visit), visit.client_id)
      if (!a) continue
      const usage = visitAllowance(a, visit, charges.get(visit.id) ?? [], cutoff, zone)
      a.used_allowance += usage.used; a.reserved_allowance += usage.reserved
      a.used_visits += usage.usedVisits; a.reserved_visits += usage.reservedVisits
    }
  }
  for (const a of out) {
    a.remaining_allowance = Math.max(0, a.allowance_total - a.used_allowance - a.reserved_allowance)
    a.remaining_visits = a.allowance_kind === 'visits' ? a.remaining_allowance : Math.floor(a.remaining_allowance / reservationAllowance(a))
    if (a.allowance_kind === 'units') { a.used_units = a.used_allowance; a.reserved_units = a.reserved_allowance; a.remaining_units = a.remaining_allowance }
  }
  return out
}
