import { retailRetention } from './retail'
import { clientVisible } from '../domain/clients'
import { audit, commit, guard, human, insist, integer, need, now, one, optional, rows, stmt, text, type Actor, type Data } from '../domain/model'
import { appliedPolicy, eligibility } from './eligibility'
import { stateRules, TABLE_REVIEW_DATE } from './states'
export { previewDestruction, destroyRecords } from './destruction'

export async function retentionState(db: D1Database, who: Actor) {
  need(who,'owner'); human(who)
  const policy = await one(db,'SELECT * FROM bm_retention_policy WHERE id=1')
  return { policy: appliedPolicy(policy), states: stateRules, reviewedOn: TABLE_REVIEW_DATE,
    destructions: await rows(db,'SELECT * FROM bm_destructions ORDER BY destroyed_at DESC LIMIT 100') }
}
export async function retentionClient(db: D1Database, who: Actor, clientId: string) {
  need(who,'owner'); human(who)
  const client = await clientVisible(db,who,clientId)
  const policy=await one(db,'SELECT * FROM bm_retention_policy WHERE id=1')
  return {...await eligibility(db,client,policy),retail:await retailRetention(db,client,policy)}
}
export async function saveRetention(db: D1Database, who: Actor, input: Data) {
  need(who,'owner'); human(who)
  const state = text(input.state,'state',2).toUpperCase(), rule = stateRules.find(r=>r.state===state)
  insist(rule,'invalid_state')
  const value = (key:string) => input[key] === '' || input[key] === undefined ? undefined : input[key]
  const adult = integer(value('adultYears') ?? rule.adultYears ?? 0,'adult_years',0,100)
  const minor = integer(value('minorYears') ?? rule.minorYears ?? rule.adultYears ?? 0,'minor_years',0,100)
  const payer = integer(value('payerYears') ?? 0,'payer_years',0,100)
  const majority = integer(value('majorityAge') ?? rule.majorityAge ?? 21,'majority_age',18,21)
  const reviewed = optional(input.reviewedRule,'reviewed_rule',2000) ?? ''
  insist(adult >= (rule.adultYears ?? 0) && minor >= (rule.minorYears ?? 0) && majority >= (rule.majorityAge ?? 18),'retention_cannot_shorten_state_rule')
  if (reviewed && rule.status !== 'verified') insist(adult > (rule.adultYears ?? 0) && minor > (rule.minorYears ?? 0),'reviewed_rule_must_be_longer')
  const previous = await one(db,'SELECT version FROM bm_retention_policy WHERE id=1')
  await commit(db,who,[guard(db,previous?'EXISTS(SELECT 1 FROM bm_retention_policy WHERE id=1 AND version=?)':'NOT EXISTS(SELECT 1 FROM bm_retention_policy WHERE id=1)',...(previous?[input.version===undefined?previous.version:integer(input.version,'version',1)]:[])),
    stmt(db,`INSERT INTO bm_retention_policy(id,state,adult_years,minor_years,payer_years,majority_age,reviewed_rule,updated_at,updated_by)
      VALUES(1,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET state=excluded.state,adult_years=excluded.adult_years,minor_years=excluded.minor_years,
      payer_years=excluded.payer_years,majority_age=excluded.majority_age,reviewed_rule=excluded.reviewed_rule,updated_at=excluded.updated_at,updated_by=excluded.updated_by,version=version+1`,
      state,adult,minor,payer,majority,reviewed,now(),who.id), audit(db,who,'retention.policy_saved',null,null,state)])
  return { policy: appliedPolicy(await one(db,'SELECT * FROM bm_retention_policy WHERE id=1')) }
}
export async function holdRecords(db: D1Database, who: Actor, input: Data) {
  need(who,'owner'); human(who)
  const client = await clientVisible(db,who,input.clientId), release = input.release===true || input.release==='on'
  const reason = text(input.reason,'hold_reason',1000)
  await commit(db,who,[guard(db,'EXISTS(SELECT 1 FROM bm_clients WHERE id=? AND erased_at IS NULL)',client.id),
    release ? stmt(db,'DELETE FROM bm_retention_holds WHERE client_id=?',client.id)
      : stmt(db,`INSERT INTO bm_retention_holds(client_id,reason,set_at,set_by) VALUES(?,?,?,?)
        ON CONFLICT(client_id) DO UPDATE SET reason=excluded.reason,set_at=excluded.set_at,set_by=excluded.set_by`,client.id,reason,now(),who.id),
    audit(db,who,release?'retention.hold_released':'retention.hold_set',client.id,client.id)])
  return { clientId: client.id, held: !release }
}

export { anonymousFinancialFacts } from './accounting'
export { anonymousOperationalFacts } from './operations'
