import { actor, audit, commit, guard, human, insist, need, one, practitionerId, text, type Actor } from '../domain/model'
import { clientVisible } from '../domain/clients'

export async function insuranceActor(db: D1Database, who: Actor, desk = false) {
  human(who)
  const live = await actor(db, who.id)
  need(live, ...(desk ? ['owner', 'reception'] as const : ['owner', 'reception', 'practitioner'] as const))
  return {...live,sessionId:who.sessionId}
}
export function clientGuard(db: D1Database, who: Actor, clientId: string) {
  return guard(db, `EXISTS(SELECT 1 FROM bm_clients c WHERE c.id=? AND c.erased_at IS NULL
    AND (? IN ('owner','reception') OR EXISTS(SELECT 1 FROM bm_appointments a WHERE a.client_id=c.id AND a.practitioner_id=?)))`, clientId, who.role, practitionerId(who) ?? '')
}
export async function insuranceClient(db: D1Database, who: Actor, clientId: unknown, action = 'insurance.read') {
  const client = await clientVisible(db, who, clientId)
  await commit(db, who, [clientGuard(db, who, client.id), audit(db, who, action, client.id)])
  return client
}
export async function policyFor(db: D1Database, who: Actor, key: unknown) {
  const policy = await one(db, 'SELECT p.*,y.name AS payer_name,y.payer_id AS payer_code,y.receiver_id,y.medicare,y.unit_method,y.fixed_unit_minutes,y.requires_referral,y.version AS payer_version FROM bm_policies p JOIN bm_payers y ON y.id=p.payer_id WHERE p.id=?', text(key, 'policy', 100))
  insist(policy, 'insurance_policy_not_found', 404)
  await insuranceClient(db, who, policy.client_id)
  return policy
}
export async function claimFor(db: D1Database, who: Actor, key: unknown) {
  const claim = await one(db, 'SELECT * FROM bm_claims WHERE id=?', text(key, 'claim', 100))
  insist(claim, 'insurance_claim_not_found', 404)
  insist(who.role==='owner'||who.staffRole==='reception'||!!await one(db,'SELECT 1 FROM bm_appointments WHERE id=? AND practitioner_id=?',claim.appointment_id,practitionerId(who)??''),'insurance_claim_not_found',404)
  await insuranceClient(db, who, claim.client_id, 'insurance.claim_read')
  await commit(db,who,[guard(db,"EXISTS(SELECT 1 FROM bm_appointments WHERE id=? AND (? IN ('owner','reception') OR practitioner_id=?))",claim.appointment_id,who.role,practitionerId(who)??''),audit(db,who,'insurance.claim_access',claim.client_id,claim.id)])
  return claim
}
export const yes = (v: unknown) => v === true || v === 'on' || v === '1'
