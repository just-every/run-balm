import { pendingSubmission } from '../domain/supervision'
import type { Bindings } from '../../auth.server'
import { hostDateAt } from '../availability/timezone'
import { actor, audit, commit, guard, human, id, insist, now, one, practitionerId, rows, sha256, stmt, text, type Actor, type Data } from '../domain/model'
import { installModel } from '../scribe'
import { unitMethodLabel } from '../insurance/unit-method'
import { billedLines } from '../insurance/authorization-accounting'
import { documentationAlerts, documentationElements } from './compliance'
import { reviewNote, type ReviewRule } from './defensibility-model'

const benefit = 'https://www.cms.gov/Regulations-and-Guidance/Guidance/Manuals/Downloads/bp102c15.pdf'
const claims = 'https://www.cms.gov/Regulations-and-Guidance/Guidance/Manuals/downloads/clm104c05.pdf'
// Summaries, not copies. CMS manuals retrieved 20 October 2026; sources remain visible with each result.
const cmsRules: ReviewRule[] = [
  { id: 'cms.time', title: 'CMS Claims Processing Manual ch. 5 §20.2', source: claims, rule: 'Pool skilled timed treatment minutes: fewer than 8 minutes support no unit; otherwise total units are floor((minutes + 7) / 15). Exclude unskilled and independent activity from billable skilled time.' },
  { id: 'cms.skilled', title: 'CMS Benefit Policy Manual ch. 15 §220.2 and §220.3(E)', source: benefit, rule: 'The record must support a need for therapist skills, including skilled maintenance where appropriate. Independent unskilled activity is not billable. Supporting rationale may appear in the plan or progress report rather than each daily note.' },
  { id: 'cms.progress', title: 'CMS Benefit Policy Manual ch. 15 §220.3(D)', source: benefit, rule: 'A clinician progress report is required at least every 10 treatment days.' },
  { id: 'cms.plan', title: 'CMS Benefit Policy Manual ch. 15 §220.1.2–220.1.3', source: benefit, rule: 'Therapy must follow a plan of care meeting applicable certification requirements.' },
]
async function context(db: D1Database, noteId: string, who: Actor) {
  const note = await one(db, 'SELECT n.*,r.number,r.body,r.sections,r.charges,r.documentation FROM bm_notes n JOIN bm_note_revisions r ON r.note_id=n.id WHERE n.id=? ORDER BY r.number DESC LIMIT 1', noteId)
  const submission=note ? await pendingSubmission(db,note.id) : null
  insist(note && (note.author_id === practitionerId(who) || submission?.supervisor_id === practitionerId(who)), 'note_not_found', 404)
  insist(!note.signed_at, 'check_an_unsigned_note', 409)
  insist(note.appointment_id, 'choose_a_visit_before_checking', 409)
  const visit = (await one(db, 'SELECT a.*,s.time_zone FROM bm_appointments a JOIN bm_settings s ON s.id=1 WHERE a.id=?', note.appointment_id))!
  const date = hostDateAt(new Date(visit.start_at), visit.time_zone)
  const payer = await one(db, `SELECT y.id,y.name,y.medicare,y.unit_method,y.fixed_unit_minutes,y.version,p.id AS policy_id,p.version AS policy_version,COALESCE(d.required,'[]') AS required,COALESCE(d.version,0) AS documentation_version
    FROM bm_policies p JOIN bm_payers y ON y.id=p.payer_id LEFT JOIN bm_payer_documentation d ON d.payer_id=y.id
    WHERE p.client_id=? AND p.starts_on<=? AND (p.ends_on IS NULL OR p.ends_on='' OR p.ends_on>=?) ORDER BY p.priority,p.starts_on DESC LIMIT 1`, note.client_id, date, date)
  // Match the visit's explicitly assigned episode; never guess across episodes.
  const plans = await rows(db, `SELECT p.id,p.content,p.status FROM bm_plans_of_care p
    LEFT JOIN bm_episode_records pr ON pr.record_kind='plan' AND pr.record_id=p.id
    LEFT JOIN bm_episode_records vr ON vr.record_kind='visit' AND vr.record_id=?
    WHERE p.client_id=? AND p.author_id=? AND pr.episode_id IS vr.episode_id
    AND json_extract(p.content,'$.startDate')<=? ORDER BY p.created_at DESC,p.id DESC LIMIT 1`, visit.id, note.client_id, note.author_id, date)
  const plan = plans[0] ?? null
  const rules = payer?.medicare ? [...cmsRules] : []
  const dailyRules=await rows(db,'SELECT r.* FROM bm_assistant_daily_rules r WHERE r.staff_id=? AND NOT EXISTS(SELECT 1 FROM bm_assistant_daily_revocations v WHERE v.rule_id=r.id)',note.author_id)
  for(const rule of dailyRules)rules.push({id:'role.assistant_daily.'+rule.id,title:'Owner-recorded assistant daily-note permission',source:'/app/clinic',rule:JSON.stringify(rule)})
  const supervision=await one(db,'SELECT kind,supervisor_id FROM bm_staff_access WHERE staff_id=?',note.author_id)
  if (supervision && ['assistant','student','fellow'].includes(supervision.kind)) rules.push({id:'role.supervision',title:'Clinic supervision and co-signature policy',source:'/app/clinic',rule:'This author documents under a named licensed supervisor. Students and fellows require co-signature. An assistant may finalize only a daily note under a matching explicit owner-recorded state/payer rule; otherwise co-signature is required. Evaluation notes/codes remain prohibited for assistants. The named therapist must record actual supervision before claiming; payer-recorded billability/minimum/rendering rules still apply.'})
  if (payer) rules.push({ id: 'payer.configuration', title: `${payer.name}: clinic-recorded documentation rules v${payer.documentation_version}, unit method v${payer.version}`, source: '/app/clinic#documentation', rule: `Configured unit method: ${unitMethodLabel(payer.fixed_unit_minutes != null ? 'fixed' : payer.unit_method, payer.fixed_unit_minutes)}. Required elements: ${(JSON.parse(payer.required) as (keyof typeof documentationElements)[]).map(k => documentationElements[k]).join(', ') || 'none configured'}. These are clinic-entered requirements, not provider verification.` })
  const rawPlan = plan ? JSON.parse(plan.content) : null
  const planContent = rawPlan ? Object.fromEntries(['diagnoses', 'shortTermGoals', 'longTermGoals', 'frequencyPerWeek', 'durationWeeks', 'interventions', 'startDate', 'certifiedThrough'].map(k => [k, rawPlan[k]])) : null
  const facts = { note: { template: note.template, revision: note.number, body: note.body, sections: JSON.parse(note.sections ?? 'null'), documentation: JSON.parse(note.documentation ?? '{}') },
    charges: JSON.parse(note.charges ?? '[]'), billed: billedLines(JSON.parse(note.charges ?? '[]'), payer?.unit_method ?? (payer ? null : 'cms'), payer?.fixed_unit_minutes),
    plan: plan ? { content: planContent, status: plan.status } : null,
    payer: payer ? { name: payer.name, medicare: !!payer.medicare, method: payer.fixed_unit_minutes != null ? 'fixed' : payer.unit_method, fixedUnitMinutes: payer.fixed_unit_minutes } : null,
    supervision: supervision ?? null, alerts: await documentationAlerts(db, visit.id, note, note.template), rules }
  return { note, visit, payer, plan, rules, facts, digest: await sha256(JSON.stringify(facts)), evidence: note.body + '\n' + JSON.stringify({ charges: facts.charges, documentation: facts.note.documentation, plan: facts.plan, alerts: facts.alerts }) }
}

/** A native clinician asks about their own draft, under the existing scribe and BALM-001 fences. */
export async function checkDefensibility(env: Bindings, who: Actor, input: Data) {
  human(who)
  const live = await actor(env.DB, who.id)
  insist(practitionerId(live), 'only_practitioners_write_notes', 403)
  const noteId = text(input.id, 'note', 100), before = await context(env.DB, noteId, live)
  insist(Number(input.revision) === before.note.number, 'note_changed_reload', 409)
  const model = await installModel(env)
  insist('config' in model, 'configure_the_clinic_ai_model_in_clinic_scribe', 409)
  insist(model.checked, 'the_scribe_has_not_passed_its_test', 409)
  await commit(env.DB, live, [audit(env.DB, live, 'note.read', before.note.client_id, noteId, `defensibility revision ${before.note.number}`),
    ...(before.plan ? [audit(env.DB, live, 'plan.read', before.note.client_id, before.plan.id)] : [])])
  const findings = await reviewNote(model.config, before.facts, before.rules, before.evidence)
  const after = await context(env.DB, noteId, live)
  insist(before.digest === after.digest, 'note_or_rules_changed_recheck', 409)
  const result = { findings, rules: before.rules, revision: before.note.number, contextSha256: before.digest, model: model.config.model, checkedAt: now() }
  await commit(env.DB, live, [
    guard(env.DB, 'EXISTS(SELECT 1 FROM bm_notes WHERE id=? AND signed_at IS NULL AND (author_id=? OR EXISTS(SELECT 1 FROM bm_note_submissions s WHERE s.note_id=bm_notes.id AND s.supervisor_id=? AND NOT EXISTS(SELECT 1 FROM bm_note_reviews r WHERE r.submission_id=s.id)))) AND (SELECT MAX(number) FROM bm_note_revisions WHERE note_id=?)=?', noteId, practitionerId(live)!, practitionerId(live)!, noteId, before.note.number),
    ...(before.payer ? [guard(env.DB, `EXISTS(SELECT 1 FROM bm_payers y JOIN bm_policies p ON p.payer_id=y.id LEFT JOIN bm_payer_documentation d ON d.payer_id=y.id WHERE y.id=? AND y.version=? AND p.id=? AND p.version=? AND COALESCE(d.version,0)=?)`, before.payer.id, before.payer.version, before.payer.policy_id, before.payer.policy_version, before.payer.documentation_version)] : []),
    stmt(env.DB, 'INSERT INTO bm_note_checks(id,note_id,revision,context_sha256,model,result,checked_by,checked_at) VALUES(?,?,?,?,?,?,?,?)', id(), noteId, before.note.number, before.digest, model.config.model, JSON.stringify(result), live.email, result.checkedAt),
    audit(env.DB, live, 'note.defensibility_checked', before.note.client_id, noteId, `revision ${before.note.number}; ${findings.length} questions`),
  ])
  return result
}
