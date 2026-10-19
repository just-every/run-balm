import { preserveReferrals } from '../reports/referrals'
// @ts-ignore The pinned Base module is JavaScript without declarations.
import { createPortability } from '@runeditrun/rer/modules/portability'
import archivePolicy from '../archive-policy.mjs'
import { clientIdentity, clientVisible } from '../domain/clients'
import { audit, commit, guard, human, id, insist, need, now, one, sha256, stmt, text, type Actor, type Data } from '../domain/model'
import { targetErasure } from '../../modules/import-kit/src/d1/erasure'
import { readonlyChecks } from '../../modules/import-kit/src/d1/database'
import { d1RequestContext } from '../../modules/import-kit/src/d1/index'
import { importContext } from '../movein'
import { eligibility } from './eligibility'
import { captureScope, counts, inventory, purgeScope } from './inventory'
import { preserveOperations } from './operations'
import { preserveAccounting } from './accounting'
import { purgeCopies, sharedCopies } from './shared-copies'

export async function previewDestruction(db: D1Database, who: Actor, input: Data) {
  need(who,'owner'); human(who)
  const client = await clientVisible(db,who,input.clientId)
  const epoch = (await one(db,'SELECT version FROM bm_retention_epoch WHERE id=1'))!.version
  const policy = await one(db,'SELECT * FROM bm_retention_policy WHERE id=1')
  const review = await eligibility(db,client,policy)
  insist(review.eligible,'records_not_eligible_for_destruction',409)
  const found = await inventory(db,client.id), copies = await sharedCopies(db,found,client.id)
  const list = { auditFieldsScrubbed:['bm_audit.detail'], records:counts(found), withdrawnSharedImports:copies.moveinJobs.length, withdrawnClaimBatches:copies.claimBatches.length }
  const previewId = id(), at = now(), expires = new Date(Date.now()+15*60_000).toISOString()
  const digest = await sha256(JSON.stringify({ previewId,clientId:client.id,epoch,policy,eligibleAfter:review.eligibleAfter,list,expires }))
  await commit(db,who,[guard(db,'EXISTS(SELECT 1 FROM bm_retention_epoch WHERE id=1 AND version=?)',epoch),
    stmt(db,"DELETE FROM bm_retention_previews WHERE expires_at<strftime('%Y-%m-%dT%H:%M:%fZ','now')"),
    stmt(db,`INSERT INTO bm_retention_previews(id,client_id,digest,epoch,policy_version,expires_at,eligible_after,inventory,created_by,created_at)
      VALUES(?,?,?,?,?,?,?,?,?,?)`,previewId,client.id,digest,epoch,policy!.version,expires,review.eligibleAfter,JSON.stringify(list),who.id,at),
    audit(db,who,'retention.previewed',client.id,previewId)])
  return { previewId,digest,expiresAt:expires,client:{id:client.id,firstName:client.first_name,lastName:client.last_name},eligibleAfter:review.eligibleAfter,...list }
}

export async function destroyRecords(db: D1Database, who: Actor, input: Data) {
  need(who,'owner'); human(who)
  insist(input.confirm===true || input.confirm==='on','destruction_confirmation_required')
  const previewId = text(input.previewId,'preview_id',100), digest = text(input.digest,'digest',64)
  const preview = await one(db,'SELECT * FROM bm_retention_previews WHERE id=? AND digest=? AND created_by=?',previewId,digest,who.id)
  insist(preview,'destruction_preview_changed',409)
  const client = await clientVisible(db,who,preview.client_id), policy = await one(db,'SELECT * FROM bm_retention_policy WHERE id=1')
  const review = await eligibility(db,client,policy)
  insist(review.eligible,'records_not_eligible_for_destruction',409)
  const found = await inventory(db,client.id), copies = await sharedCopies(db,found,client.id)
  const context = d1RequestContext({...importContext(db,who),originalErasurePolicy:'withdraw-affected-artifacts'})
  const imported = await targetErasure({kind:'client',id:client.id},context)
  const prepared = (q: {sql:string;params?:unknown[]}) => stmt(db,q.sql,...q.params??[])
  const portability = await createPortability({db,policy:archivePolicy}), receiptId = id(), at=now()
  const receiptPolicy = { state:policy!.state,adultYears:review.policy!.adult,minorYears:review.policy!.minor,payerYears:policy!.payer_years,majorityAge:review.policy!.majority,
    ruleSource:review.policy!.rule.source,tableReviewedOn:review.policy!.rule.reviewedOn }
  await commit(db,who,[
    guard(db,`EXISTS(SELECT 1 FROM bm_retention_previews p JOIN bm_retention_epoch e ON e.id=1 JOIN bm_retention_policy r ON r.id=1
      WHERE p.id=? AND p.digest=? AND p.created_by=? AND p.epoch=e.version AND p.policy_version=r.version
      AND p.expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now') AND p.eligible_after<date('now'))
      AND NOT EXISTS(SELECT 1 FROM bm_retention_holds WHERE client_id=?)`,previewId,digest,who.id,client.id),
    ...imported.before.map(prepared),
    ...await portability.redactionStatements(),...await portability.invalidateTransfersStatements(),
    stmt(db,'INSERT INTO bm_retention_permits(client_id,preview_id) VALUES(?,?)',client.id,previewId),...captureScope(db,previewId,found),
    stmt(db,"UPDATE bm_audit SET detail='' WHERE client_id=? AND detail<>''",client.id),
    ...preserveAccounting(db,client.id,receiptId),...preserveOperations(db,client.id,receiptId),...await preserveReferrals(db,client.id,(await one(db,'SELECT time_zone FROM bm_settings WHERE id=1'))!.time_zone as string),...purgeCopies(db,client.id,copies),
    stmt(db,'INSERT OR IGNORE INTO bm_erasure_journal(identity_hash,kind,erased_at) VALUES(?,?,?)',await clientIdentity(client.first_name,client.last_name,client.date_of_birth),'client',Date.now()),
    ...purgeScope(db,found),...imported.after.map(prepared),...readonlyChecks(imported.final).map(prepared),stmt(db,'DELETE FROM ik_d1_assertions'),
    stmt(db,'INSERT INTO bm_destructions(id,preview_digest,destroyed_at,approved_by,policy,inventory) VALUES(?,?,?,?,?,?)',receiptId,digest,at,who.id,JSON.stringify(receiptPolicy),preview.inventory),
    stmt(db,'DELETE FROM bm_retention_scope WHERE preview_id=?',previewId),stmt(db,'DELETE FROM bm_retention_permits WHERE preview_id=?',previewId),
    stmt(db,'DELETE FROM bm_retention_previews WHERE client_id=?',client.id),
    audit(db,who,'retention.destroyed',null,receiptId),
  ])
  return {destroyed:true,receiptId,digest,destroyedAt:at,inventory:JSON.parse(preview.inventory),policy:receiptPolicy}
}
