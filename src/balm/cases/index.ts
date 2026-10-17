// The case agent: one case per referral, followed from referral and intake
// through eligibility, authorization, visits, signed notes, claims and the ERA
// to paid or denied. Where a case stands and what to do next are rules in code
// (stages.ts, steps.ts); a person approves every step before anything is sent,
// and each approval is kept with who gave it.
import type { Bindings } from '../../auth.server'
import { audit, commit, day, email, guard, human, id, insist, need, now, one, optional, rows, stmt, text, type Actor, type Data } from '../domain/model'
import { clientVisible } from '../domain/clients'
import { validNpi } from '../payments/codes'
import { perform } from './actions'
import { caseFacts } from './facts'
import { stages, standing } from './stages'
import { steps } from './steps'
import { draftWording, wordingStatus } from './wording'

const deskOnly = (who: Actor) => { human(who); need(who, 'owner', 'reception') }

async function view(env: Bindings, referral: Data) {
  const f = await caseFacts(env.DB, referral), list = stages(f)
  return { referral, client: { id: f.client.id, name: `${f.client.first_name} ${f.client.last_name}` }, payer: f.policy?.payer_name ?? null, stages: list, standing: standing(list), steps: await steps(f),
    history: f.done.map(d => ({ ...d, citations: JSON.parse(d.citations), result: JSON.parse(d.result) })), facts: f }
}

/** Every case in one list, the ones with a step to approve first; each read is in the patient's access audit. */
export async function caseList(env: Bindings, who: Actor) {
  deskOnly(who)
  const referrals = await rows(env.DB, 'SELECT r.* FROM bm_referrals r JOIN bm_clients c ON c.id=r.client_id WHERE c.erased_at IS NULL ORDER BY r.received_on DESC,r.created_at DESC')
  const cases = (await Promise.all(referrals.map(r => view(env, r)))).map(({ facts, ...c }) => c)
  await commit(env.DB, who, [...new Set(referrals.map(r => r.client_id as string))].map(clientId => audit(env.DB, who, 'case.list_read', clientId)))
  const rank = (c: typeof cases[number]) => c.steps.some(s => !s.blocked) ? 0 : c.standing.state === 'stalled' ? 1 : c.standing.state === 'waiting' ? 2 : 3
  const choices = await rows(env.DB, `SELECT c.id,c.first_name,c.last_name,p.id AS policy_id,y.name AS payer_name,p.member_id FROM bm_clients c LEFT JOIN bm_policies p ON p.client_id=c.id LEFT JOIN bm_payers y ON y.id=p.payer_id
    WHERE c.erased_at IS NULL ORDER BY c.last_name,c.first_name,p.priority`)
  return { cases: cases.sort((a, b) => rank(a) - rank(b)), wording: await wordingStatus(env), choices }
}

async function saveReferral(db: D1Database, who: Actor, input: Data) {
  const client = await clientVisible(db, who, input.clientId), policyId = optional(input.policyId, 'policy', 100)
  if (policyId) insist(await one(db, 'SELECT 1 FROM bm_policies WHERE id=? AND client_id=?', policyId, client.id), 'choose_one_of_the_patient’s_policies')
  const npi = optional(input.referringNpi, 'referring_npi', 10)
  if (npi) insist(validNpi(npi), 'the_referring_npi_is_not_a_valid_npi')
  const at = now(), contact = optional(input.authorizationEmail, 'authorization_email', 254)
  const values = [client.id, policyId, day(input.receivedOn, 'received_on'), text(input.referringFirst, 'referring_first_name', 80), text(input.referringLast, 'referring_last_name', 80), npi ?? '',
    optional(input.diagnosis, 'diagnosis', 200) ?? '', optional(input.reason, 'referral_reason', 2000) ?? '', contact ? email(contact, 'authorization_email') : '']
  if (input.id) {
    const referral = await one(db, 'SELECT * FROM bm_referrals WHERE id=?', text(input.id, 'case', 100))
    insist(referral && referral.client_id === client.id, 'case_not_found', 404)
    await commit(db, who, [stmt(db, 'UPDATE bm_referrals SET client_id=?,policy_id=?,received_on=?,referring_first=?,referring_last=?,referring_npi=?,diagnosis=?,reason=?,authorization_email=?,version=version+1 WHERE id=? AND version=?', ...values, referral.id, referral.version), guard(db, 'changes()=1'), audit(db, who, 'case.changed', client.id as string, referral.id)])
    return { id: referral.id }
  }
  const key = id()
  await commit(db, who, [stmt(db, 'INSERT INTO bm_referrals(client_id,policy_id,received_on,referring_first,referring_last,referring_npi,diagnosis,reason,authorization_email,id,created_by,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)', ...values, key, who.email, at), audit(db, who, 'case.opened', client.id as string, key)])
  return { id: key }
}

async function caseStep(env: Bindings, input: Data) {
  const referral = await one(env.DB, 'SELECT r.* FROM bm_referrals r JOIN bm_clients c ON c.id=r.client_id WHERE r.id=? AND c.erased_at IS NULL', text(input.caseId, 'case', 100))
  insist(referral, 'case_not_found', 404)
  const c = await view(env, referral), step = c.steps.find(s => s.key === input.key)
  insist(step, 'This step is no longer proposed: the case has moved on. Review the case again.', 409)
  return { c, step }
}

/** The model rewords the request paragraph; the draft waits on the case for a person to review. */
async function draft(env: Bindings, who: Actor, input: Data) {
  const { c, step } = await caseStep(env, input)
  insist(step.draftable, 'only_letters_have_drafted_wording')
  const wording = await draftWording(env, c.facts)
  await commit(env.DB, who, [stmt(env.DB, 'INSERT INTO bm_case_drafts(referral_id,step_key,wording,drafted_by,drafted_at) VALUES(?,?,?,?,?) ON CONFLICT(referral_id,step_key) DO UPDATE SET wording=excluded.wording,drafted_by=excluded.drafted_by,drafted_at=excluded.drafted_at', c.referral.id, step.key, wording, who.email, now()),
    audit(env.DB, who, 'case.wording_drafted', c.client.id, c.referral.id, step.kind)])
  return { caseId: c.referral.id, key: step.key, wording }
}

/** A person approves the exact step they reviewed; Balm then does it and keeps the record. */
async function approve(env: Bindings, who: Actor, input: Data) {
  const { c, step } = await caseStep(env, input), db = env.DB
  insist(input.digest === step.digest, 'The case changed after this page was opened. Review the step again before approving.', 409)
  insist(!step.blocked, step.blocked ?? 'step_blocked', 409)
  const wording = step.draftable ? text(input.wording, 'wording', 4000) : '', key = id()
  await commit(db, who, [stmt(db, `INSERT INTO bm_case_steps(id,referral_id,step_key,kind,title,digest,citations,wording,approved_by,approved_role,approved_at,status) VALUES(?,?,?,?,?,?,?,?,?,?,?,'sending')`,
    key, c.referral.id, step.key, step.kind, step.title, step.digest, JSON.stringify(step.citations), wording, who.email, who.role, now()), audit(db, who, 'case.step_approved', c.client.id, key, step.kind)])
  const finish = (status: 'done' | 'failed', result: Data) => commit(db, null, [stmt(db, "UPDATE bm_case_steps SET status=?,result=?,finished_at=? WHERE id=? AND status='sending'", status, JSON.stringify(result), now(), key)])
  let outcome
  try { outcome = await perform(env, who, c.facts, step, wording) }
  catch (error) { await finish('failed', { error: String((error as Error).message) }); throw error }
  await finish(outcome.ok ? 'done' : 'failed', outcome.result)
  insist(outcome.ok, outcome.result.delivery === 'mail_unavailable' ? 'Nothing was sent: mail is not set up on this install. The step stays proposed.' : 'Nothing was sent. The step stays proposed.', 409)
  return { id: key, kind: step.kind, approvedBy: who.email, result: outcome.result }
}

export async function caseCommand(env: Bindings, who: Actor, name: string, input: Data) {
  deskOnly(who)
  if (name === 'case.open') return saveReferral(env.DB, who, input)
  if (name === 'case.draft') return draft(env, who, input)
  if (name === 'case.approve') return approve(env, who, input)
  insist(false, 'unknown_command', 404)
}
