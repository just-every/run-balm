import { one, rows, type Data } from '../domain/model'
import { stateRules } from './states'

export function anniversary(date: string, years: number): string {
  // Leap-day anniversaries use March 1, conservatively retaining through February.
  const d = new Date(date.slice(0,10) + 'T00:00:00Z'); d.setUTCFullYear(d.getUTCFullYear() + years)
  return d.toISOString().slice(0,10)
}
export function appliedPolicy(policy: Data | null) {
  if (!policy) return null
  const rule = stateRules.find(r => r.state === policy.state)
  if (!rule) return null
  const reviewed = policy.reviewed_rule.trim().length > 0
  return { ...policy, rule, resolved: rule.status === 'verified' || (rule.status === 'ambiguous' && reviewed),
    adult: Math.max(rule.adultYears ?? 0, policy.adult_years, policy.payer_years),
    minor: Math.max(rule.minorYears ?? 0, rule.adultYears ?? 0, policy.minor_years, policy.adult_years, policy.payer_years),
    majority: Math.max(rule.majorityAge ?? 21, policy.majority_age) }
}
export async function eligibility(db: D1Database, client: Data, policy: Data | null) {
  const applied = appliedPolicy(policy), holds = await rows(db,'SELECT reason,set_at,set_by FROM bm_retention_holds WHERE client_id=?', client.id)
  const dates = await one(db, `SELECT MIN(at) AS first_at,MAX(at) AS last_at FROM (
    SELECT end_at AS at FROM bm_appointments WHERE client_id=? AND status<>'cancelled'
    UNION ALL SELECT created_at FROM bm_notes WHERE client_id=?
    UNION ALL SELECT submitted_at FROM bm_intake_responses WHERE client_id=?
    UNION ALL SELECT source_date FROM bm_movein_notes WHERE client_id=? AND source_date IS NOT NULL
  )`,client.id,client.id,client.id,client.id)
  const later = await one(db, `SELECT MAX(
    COALESCE((SELECT MAX(r.written_at) FROM bm_note_revisions r JOIN bm_notes n ON n.id=r.note_id WHERE n.client_id=?),''),
    COALESCE((SELECT MAX(a.written_at) FROM bm_note_addenda a JOIN bm_notes n ON n.id=a.note_id WHERE n.client_id=?),''),
    COALESCE((SELECT MAX(sent_at) FROM bm_messages WHERE client_id=?),''),
    COALESCE((SELECT MAX(created_at) FROM bm_chart_documents WHERE client_id=?),''),
    COALESCE((SELECT MAX(recorded_at) FROM bm_disclosures WHERE client_id=?),''),
    COALESCE((SELECT MAX(assigned_at) FROM bm_home_exercises WHERE client_id=?),''),
    COALESCE((SELECT MAX(created_at) FROM bm_plans_of_care WHERE client_id=?),''),
    COALESCE((SELECT MAX(recorded_at) FROM bm_measures WHERE client_id=?),'')
  ) AS at`,...Array(8).fill(client.id))
  const lastTreatment = dates?.last_at?.slice(0,10) ?? null
  const firstTreatment = dates?.first_at?.slice(0,10) ?? null
  const reasons: string[] = []
  if(await one(db,'SELECT id FROM bm_finance_observations WHERE client_id=?',client.id))reasons.push('finance_reconciliation_review_pending')
  if(await one(db,'SELECT id FROM bm_retail_sales WHERE client_id=?',client.id))reasons.push('retail_custody_review_pending')
  if(await one(db,'SELECT 1 FROM bm_remittance_suspense WHERE resolved_claim IS NULL LIMIT 1'))reasons.push('unmatched_remittance_identity_review_required')
  if (!applied?.resolved) reasons.push('state_rule_requires_review')
  if (!client.date_of_birth) reasons.push('date_of_birth_required')
  if (!lastTreatment) reasons.push('last_treatment_unknown')
  if (holds.length) reasons.push('legal_hold')
  // Current releases are explicitly partial, so they cannot clear preservation.
  // A later complete-fulfillment workflow must establish when this hold ends.
  if (await one(db,'SELECT id FROM bm_record_requests WHERE client_id=?',client.id)) reasons.push('patient_record_request_pending')
  let eligibleAfter: string | null = null, minor = false
  if (applied && client.date_of_birth && lastTreatment && firstTreatment) {
    const majority = anniversary(client.date_of_birth,applied.majority)
    minor = firstTreatment < majority
    const base = [lastTreatment,later?.at?.slice(0,10) ?? lastTreatment].sort().at(-1)!
    eligibleAfter = [anniversary(base,applied.adult), anniversary(client.date_of_birth,applied.rule.minimumAge ?? 0), ...(minor ? [anniversary(majority,applied.minor)] : [])].sort().at(-1)!
    const clock = (await one(db,"SELECT date('now') AS today"))!.today
    if (eligibleAfter >= clock) reasons.push('retention_period_not_complete')
  }
  const estimate = await one(db,"SELECT MAX(until) AS until FROM (SELECT date(issued_at,'+6 years') AS until FROM bm_estimates WHERE client_id=? UNION ALL SELECT date(prepared_at,'+6 years') FROM bm_aeob_sources WHERE client_id=?)",client.id,client.id)
  if(estimate?.until){
    eligibleAfter=[eligibleAfter??'',estimate.until].sort().at(-1)!
    if(estimate.until >= new Date().toISOString().slice(0,10))reasons.push('good_faith_estimate_six_year_retention')
  }
  return { eligible: !reasons.length, reasons, lastTreatment, minor, eligibleAfter, holds, policy: applied }
}
