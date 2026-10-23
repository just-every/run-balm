import { actor, audit, commit, day, guard, human, id, insist, integer, now, one, rows, stmt, text, type Actor, type Data } from '../domain/model'
import { biller } from '../domain/role-access'
import { datePlus, hostDateAt } from '../availability/timezone'
import { payerReason } from './codes'

async function billingActor(db: D1Database, initial: Actor) {
  human(initial)
  const who = await actor(db, initial.id)
  insist(who.role === 'owner' || biller(who), 'claim_work_requires_biller_or_owner', 403)
  return { ...who, sessionId: initial.sessionId }
}
function billingGuard(db: D1Database, who: Actor) {
  return guard(db, "?='owner' OR EXISTS(SELECT 1 FROM bm_staff_access WHERE staff_id=? AND kind='biller')", who.role, who.staffId ?? '')
}

/** Calendar-day limits, with their service-date scope and the actual source.
 * Nothing is inferred from a payer name, Medicare status or another payer. */
export async function saveFilingRule(db: D1Database, initial: Actor, input: Data) {
  const who = await billingActor(db, initial), payerId = text(input.payerId, 'payer', 100)
  const kind = text(input.kind, 'filing_kind', 20), basis = text(input.basis, 'filing_basis', 30)
  insist(['initial', 'correction', 'appeal'].includes(kind), 'invalid_filing_kind')
  insist(['service_date', 'adjudication_date'].includes(basis) && (kind !== 'initial' || basis === 'service_date'), 'invalid_filing_basis')
  const days = integer(input.days, 'calendar_days', 0, 3660), effectiveFrom = day(input.effectiveFrom, 'service_dates_from')
  const effectiveTo = input.effectiveTo ? day(input.effectiveTo, 'service_dates_through') : null
  insist(!effectiveTo || effectiveFrom <= effectiveTo, 'filing_service_date_range_reversed')
  const source = text(input.source, 'payer_instruction_source', 2000), key = id(), at = now()
  await commit(db, who, [billingGuard(db, who), guard(db, 'EXISTS(SELECT 1 FROM bm_payers WHERE id=?)', payerId),
    stmt(db, 'INSERT INTO bm_claim_filing_rules(id,payer_id,kind,basis,days,effective_from,effective_to,source,recorded_by,recorded_at) VALUES(?,?,?,?,?,?,?,?,?,?)', key, payerId, kind, basis, days, effectiveFrom, effectiveTo, source, who.email, at),
    audit(db, who, 'insurance.filing_rule_recorded', null, key)])
  return { id: key, recorded: true }
}

/** Staff record the payer's actual decision date, never the import timestamp. */
export async function recordFilingDate(db: D1Database, initial: Actor, input: Data) {
  const who = await billingActor(db, initial), claim = await one(db, 'SELECT * FROM bm_claims WHERE id=?', text(input.id, 'claim', 100))
  insist(claim, 'insurance_claim_not_found', 404)
  const adjudicationOn = day(input.adjudicationOn, 'payer_decision_date'), source = text(input.source, 'payer_decision_source', 2000)
  const settings = await one(db, 'SELECT time_zone FROM bm_settings WHERE id=1')
  insist(['denied', 'partial', 'rejected', 'corrected'].includes(claim.status), 'record_a_payer_decision_before_its_date', 409)
  insist(adjudicationOn >= claim.service_date && adjudicationOn <= hostDateAt(new Date(), String(settings!.time_zone)), 'payer_decision_date_out_of_range')
  const key = id()
  await commit(db, who, [billingGuard(db, who), guard(db, 'EXISTS(SELECT 1 FROM bm_claims c JOIN bm_clients n ON n.id=c.client_id WHERE c.id=? AND c.version=? AND n.erased_at IS NULL)', claim.id, claim.version),
    stmt(db, 'INSERT INTO bm_claim_events(id,claim_id,kind,detail,created_at) VALUES(?,?,?,?,?)', key, claim.id, 'filing_date', JSON.stringify({ adjudicationOn, source, recordedBy: who.email }), now()),
    audit(db, who, 'insurance.filing_date_recorded', claim.client_id, claim.id)])
  return { id: key, claimId: claim.id, adjudicationOn }
}

/** Record completed external billing work; this command sends nothing. Keep
 * payer references in the claim event, never in the access audit's detail. */
export async function recordClaimAction(db: D1Database, initial: Actor, input: Data) {
  const who = await billingActor(db, initial), claim = await one(db, 'SELECT * FROM bm_claims WHERE id=?', text(input.id, 'claim', 100))
  insist(claim, 'insurance_claim_not_found', 404)
  const kind = text(input.kind, 'billing_action', 30), on = day(input.on, 'action_date'), source = text(input.source, 'billing_action_reference', 2000)
  insist(['followup', 'appeal_sent'].includes(kind), 'invalid_billing_action')
  insist(kind !== 'appeal_sent' || ['denied','partial','rejected','corrected'].includes(claim.status), 'appeal_requires_a_payer_denial', 409)
  const settings = await one(db, 'SELECT time_zone FROM bm_settings WHERE id=1')
  insist(on >= claim.service_date && on <= hostDateAt(new Date(), String(settings!.time_zone)), 'billing_action_date_out_of_range')
  await commit(db, who, [billingGuard(db, who), guard(db, 'EXISTS(SELECT 1 FROM bm_claims c JOIN bm_clients n ON n.id=c.client_id WHERE c.id=? AND c.version=? AND n.erased_at IS NULL)', claim.id, claim.version),
    stmt(db, 'INSERT INTO bm_claim_events(id,claim_id,kind,detail,created_at) VALUES(?,?,?,?,?)', id(), claim.id, kind, JSON.stringify({ on, source, recordedBy: who.email }), now()),
    audit(db, who, 'insurance.' + kind + '_recorded', claim.client_id, claim.id)])
  return { id: claim.id, recorded: true }
}

const ageOf = (days: number) => days <= 30 ? '0-30' : days <= 60 ? '31-60' : days <= 90 ? '61-90' : days <= 120 ? '91-120' : 'over-120'
export const claimAgeBands = ['0-30', '31-60', '61-90', '91-120', 'over-120'] as const

/** The public work read includes closed attempts in the history, but never in
 * receivables. Amounts use the same invoice/payment/adjustment basis as the ledger. */
export async function claimWork(db: D1Database, initial: Actor, input: Data = {}) {
  const who = await billingActor(db, initial), settings = await one(db, 'SELECT time_zone FROM bm_settings WHERE id=1')
  insist(settings?.time_zone, 'clinic_time_zone_not_set', 409)
  const zone = String(settings.time_zone), today = hostDateAt(new Date(), zone)
  const payerId = input.payerId ? text(input.payerId, 'payer', 100) : '', age = input.age ? text(input.age, 'age', 20) : '', reason = input.reason ? text(input.reason, 'reason', 100) : ''
  insist(!age || (claimAgeBands as readonly string[]).includes(age), 'invalid_claim_age')
  const [claims, rules, payers, actions, events] = await Promise.all([
    rows(db, `SELECT c.id,c.client_id,c.invoice_id,c.policy_id,c.replaces_id,c.status,i.status AS invoice_status,c.service_date,c.created_at,c.errors,c.payer_control,
      p.payer_id,y.name AS payer_name,n.first_name||' '||n.last_name AS patient,
      MAX(0,i.amount_cents-(SELECT COALESCE(SUM(amount_cents),0) FROM bm_invoice_payments WHERE invoice_id=i.id)
      -(SELECT COALESCE(SUM(amount_cents),0) FROM bm_invoice_adjustments WHERE invoice_id=i.id)) AS open_cents
      FROM bm_claims c JOIN bm_invoices i ON i.id=c.invoice_id JOIN bm_policies p ON p.id=c.policy_id
      JOIN bm_payers y ON y.id=p.payer_id JOIN bm_clients n ON n.id=c.client_id WHERE n.erased_at IS NULL ORDER BY c.service_date,c.id`),
    rows(db, 'SELECT * FROM bm_claim_filing_rules ORDER BY effective_from DESC,rowid DESC'),
    rows(db, 'SELECT id,name FROM bm_payers ORDER BY name'),
    rows(db, `SELECT a.sequence,a.at,a.actor_email,a.action,a.subject_id AS claim_id FROM bm_audit a JOIN bm_claims c ON c.id=a.subject_id WHERE a.action LIKE 'insurance.%' ORDER BY a.sequence`),
    rows(db, "SELECT claim_id,kind,detail,created_at FROM bm_claim_events WHERE kind IN ('followup','appeal_sent','filing_date') ORDER BY rowid")
  ])
  const filingDates = events.filter(e => e.kind === 'filing_date').map(e => ({ claim_id: e.claim_id, ...JSON.parse(e.detail) })).reverse()
  // Group once: a large unpaid backlog must not multiply history scans per row.
  const familyKey = (c: Data) => `${c.invoice_id}:${c.policy_id}`
  const byId = new Map(claims.map(c => [c.id, c])), families = new Map<string, Data[]>()
  const familyActions = new Map<string, Data[]>(), externalActions = new Map<string, Data[]>()
  for (const c of claims) { const key = familyKey(c); families.set(key, [...(families.get(key) ?? []), c]) }
  for (const a of actions) {
    const c = byId.get(a.claim_id); if (!c) continue
    const key = familyKey(c); familyActions.set(key, [...(familyActions.get(key) ?? []), a])
  }
  for (const e of events) {
    const c = byId.get(e.claim_id); if (!c || e.kind === 'filing_date') continue
    const key = familyKey(c); externalActions.set(key, [...(externalActions.get(key) ?? []), { ...e, detail: JSON.parse(e.detail) }])
  }
  // The audit carries the person and every action, including export versus
  // submission. Keep the full replacement family after payment clears the queue.
  const history = claims.map(c => ({ id: c.id, clientId: c.client_id, status: c.status,
    actions: familyActions.get(familyKey(c)) ?? [], externalActions: externalActions.get(familyKey(c)) ?? [] }))
  const historyById = new Map(history.map(c => [c.id, c]))
  const queue = claims.filter(c => c.invoice_status === 'approved' && c.status !== 'corrected' && c.status !== 'paid' && (Number(c.open_cents) > 0 || ['denied', 'rejected'].includes(c.status))).map(c => {
    const errors = JSON.parse(c.errors) as Data[], reasons = errors.map(e => ({ code: String(e.code),
      ...(String(e.code).startsWith('carc_') ? payerReason(e.code, e.message) : { reason: e.message, next: 'Fix the named claim information, then check the claim again.', remarks: [], codes: [e.code] }) }))
    const ageDays = Math.max(0, Math.round((Date.parse(today) - Date.parse(c.service_date)) / 86400000))
    const family = families.get(familyKey(c))!, actionHistory = familyActions.get(familyKey(c)) ?? []
    const adjudication = filingDates.find(d => family.some(relative => relative.id === d.claim_id))
    const deadlines = ['initial', 'correction', 'appeal'].map(kind => {
      const rule = rules.find(r => r.payer_id === c.payer_id && r.kind === kind && r.effective_from <= c.service_date && (!r.effective_to || r.effective_to >= c.service_date))
      const anchor = rule?.basis === 'service_date' ? c.service_date : adjudication?.adjudicationOn ?? null
      const dueOn = rule && anchor ? datePlus(anchor, Number(rule.days)) : null
      const completed = kind === 'initial' ? actionHistory.some(a => a.action === 'insurance.claim_submitted')
        : kind === 'correction' ? actionHistory.some(a => a.claim_id === c.id && a.action === 'insurance.claim_submitted')
        : (externalActions.get(familyKey(c)) ?? []).some(e => e.kind === 'appeal_sent' && e.claim_id === c.id)
      return { kind, rule: rule ?? null, dueOn, completed, adjudication: adjudication ?? null, overdue: !completed && !!dueOn && dueOn < today,
        unknown: !rule ? 'No payer filing instruction recorded.' : !anchor ? 'Payer adjudication date must be recorded before this deadline can be calculated.' : null }
    })
    return { ...c, ageDays, age: ageOf(ageDays), reasons, reasonCodes: reasons.length ? reasons.map(r => r.code) : ['unpaid'], deadlines,
      next: reasons.length ? reasons.map(r => r.next).join(' ') : ['exported', 'batched'].includes(c.status) ? 'Submit the prepared claim; downloading a file does not send it.' : 'Follow up with the payer and record its answer.',
      actions: historyById.get(c.id)!.actions, externalActions: historyById.get(c.id)!.externalActions }
  })
  const reasonOptions = [...new Set(queue.flatMap(c => c.reasonCodes))].sort()
  const filtered = queue.filter(c => (!payerId || c.payer_id === payerId) && (!age || c.age === age) && (!reason || c.reasonCodes.includes(reason)))
  const clientIds = [...new Set(claims.map(c => c.client_id))]
  await commit(db, who, [billingGuard(db, who), ...clientIds.map(clientId => audit(db, who, 'insurance.claim_work_read', clientId))])
  return { today, timeZone: zone, filters: { payerId, age, reason }, payers, rules, reasons: reasonOptions, queue: filtered, history }
}
