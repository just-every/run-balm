import { createPortability } from '@runeditrun/rer/modules/portability'
import archivePolicy from '../archive-policy.mjs'
import { clientVisible } from '../domain/clients'
import { audit, commit, guard, human, id, insist, need, now, one, rows, sha256, stmt, text, type Actor, type Data } from '../domain/model'
import { anniversary, eligibility } from './eligibility'
import { preserveRetail } from './accounting'
import { captureScope, counts, type Inventory } from './inventory'

const children=['bm_package_assignments','bm_package_uses','bm_membership_events','bm_membership_cancellations','bm_membership_settlements']

/** Gift funding and finite renewals keep a connected set of originals together. */
export async function retailRetention(db:D1Database,client:Data,policy:Data|null) {
  const review=await eligibility(db,client,policy,false)
  const sales=await rows(db,'SELECT * FROM bm_retail_sales WHERE client_id=? ORDER BY recorded_at,id',client.id)
  const facts=await rows(db,`SELECT sale_id,recorded_at AS at FROM bm_membership_events WHERE client_id=?
    UNION ALL SELECT sale_id,used_at FROM bm_package_uses WHERE client_id=?
    UNION ALL SELECT sale_id,recorded_at FROM bm_membership_cancellations WHERE client_id=?
    UNION ALL SELECT sale_id,recorded_at FROM bm_membership_settlements WHERE client_id=?`,...Array(4).fill(client.id))
  const booked=await rows(db,"SELECT x.sale_id FROM bm_package_assignments x JOIN bm_appointments a ON a.id=x.appointment_id WHERE x.client_id=? AND a.status='booked'",client.id)
  const usage=await rows(db,'SELECT sale_id,COUNT(*) AS n FROM bm_package_uses WHERE client_id=? GROUP BY sale_id',client.id)
  const settled=await rows(db,'SELECT sale_id,units FROM bm_membership_settlements WHERE client_id=?',client.id)
  const pending=new Set(sales.map(s=>s.id)),groups:Data[]=[]
  const today=(await one(db,"SELECT date('now') AS today"))!.today
  while(pending.size) {
    const connected=new Set([pending.values().next().value!])
    let changed=true
    while(changed) {
      changed=false
      for(const s of sales)for(const parent of [s.gift_id,s.renewal_of])if(parent && (connected.has(s.id)||connected.has(parent))) {
        for(const key of [s.id,parent])if(!connected.has(key)){connected.add(key);changed=true}
      }
    }
    const selected=sales.filter(s=>connected.has(s.id))
    for(const s of selected)pending.delete(s.id)
    const latest=[...selected.map(s=>s.recorded_at),...facts.filter(f=>connected.has(f.sale_id)).map(f=>f.at)].sort().at(-1)!
    const eligibleAfter=review.policy&&review.eligibleAfter?[review.eligibleAfter,anniversary(latest,review.policy.adult)].sort().at(-1)!:null
    const reasons=review.reasons.filter(r=>r!=='retention_period_not_complete')
    if(!eligibleAfter || eligibleAfter>=today)reasons.push('retention_period_not_complete')
    if(selected.some(s=>s.kind==='gift_card'
      ? Number(s.amount_cents)>sales.filter(x=>x.gift_id===s.id).reduce((n,x)=>n+Number(x.amount_cents)+Number(x.tax_cents),0)
      : ['package','membership'].includes(s.kind)&&Number(s.units)>Number(usage.find(u=>u.sale_id===s.id)?.n??0)+Number(settled.find(z=>z.sale_id===s.id)?.units??0)))reasons.push('unresolved_retail_entitlement')
    if(booked.some(x=>connected.has(x.sale_id)))reasons.push('booked_retail_assignment')
    groups.push({saleIds:selected.map(s=>s.id).sort(),eligibleAfter,eligible:!reasons.length,reasons:[...new Set(reasons)]})
  }
  return {groups,policy:review.policy}
}

async function selectedInventory(db:D1Database,clientId:string,saleIds:string[]):Promise<Inventory> {
  const found:Inventory={}
  const encoded=JSON.stringify(saleIds)
  found.bm_retail_sales=(await rows(db,'SELECT rowid AS rid FROM bm_retail_sales WHERE client_id=? AND id IN (SELECT value FROM json_each(?)) ORDER BY rowid',clientId,encoded)).map(r=>Number(r.rid))
  for(const table of children)found[table]=(await rows(db,`SELECT rowid AS rid FROM ${table} WHERE client_id=? AND sale_id IN (SELECT value FROM json_each(?)) ORDER BY rowid`,clientId,encoded)).map(r=>Number(r.rid))
  return found
}

export async function previewRetailDestruction(db:D1Database,who:Actor,input:Data) {
  need(who,'owner');human(who)
  const client=await clientVisible(db,who,input.clientId)
  const epoch=(await one(db,'SELECT version FROM bm_retention_epoch WHERE id=1'))!.version
  const policy=await one(db,'SELECT * FROM bm_retention_policy WHERE id=1')
  const review=await retailRetention(db,client,policy)
  const saleIds=review.groups.filter(g=>g.eligible).flatMap(g=>g.saleIds).sort()
  insist(saleIds.length,'retail_records_not_eligible_for_destruction',409)
  const found=await selectedInventory(db,client.id,saleIds),previewId=id(),expires=new Date(Date.now()+15*60_000).toISOString()
  const eligibleAfter=review.groups.filter(g=>g.eligible).map(g=>g.eligibleAfter).sort().at(-1)!
  const list={scope:'retail',saleIds,records:counts(found),auditFieldsScrubbed:[],withdrawnSharedImports:0,withdrawnClaimBatches:0}
  const digest=await sha256(JSON.stringify({previewId,clientId:client.id,epoch,policy,eligibleAfter,list,expires}))
  await commit(db,who,[guard(db,'EXISTS(SELECT 1 FROM bm_retention_epoch WHERE id=1 AND version=?)',epoch),
    stmt(db,'INSERT INTO bm_retention_previews(id,client_id,digest,epoch,policy_version,expires_at,eligible_after,inventory,created_by,created_at) VALUES(?,?,?,?,?,?,?,?,?,?)',previewId,client.id,digest,epoch,policy!.version,expires,eligibleAfter,JSON.stringify(list),who.id,now()),
    audit(db,who,'retention.retail_previewed',client.id,previewId)])
  return {previewId,digest,expiresAt:expires,eligibleAfter,client:{id:client.id,firstName:client.first_name,lastName:client.last_name},...list}
}

export async function destroyRetailRecords(db:D1Database,who:Actor,input:Data) {
  need(who,'owner');human(who)
  insist(input.confirm===true||input.confirm==='on','destruction_confirmation_required')
  const previewId=text(input.previewId,'preview_id',100),digest=text(input.digest,'digest',64)
  const preview=await one(db,'SELECT * FROM bm_retention_previews WHERE id=? AND digest=? AND created_by=?',previewId,digest,who.id)
  insist(preview,'destruction_preview_changed',409)
  const list=JSON.parse(preview.inventory)
  insist(list.scope==='retail','retail_destruction_preview_required',409)
  const client=await clientVisible(db,who,preview.client_id),policy=await one(db,'SELECT * FROM bm_retention_policy WHERE id=1')
  const review=await retailRetention(db,client,policy)
  const eligible=new Set(review.groups.filter(g=>g.eligible).flatMap(g=>g.saleIds))
  const saleIds:string[]=list.saleIds
  insist(saleIds.length&&saleIds.every(key=>eligible.has(key)),'retail_records_not_eligible_for_destruction',409)
  const found=await selectedInventory(db,client.id,saleIds)
  insist(JSON.stringify(counts(found))===JSON.stringify(list.records),'destruction_preview_changed',409)
  const references=await rows(db,"SELECT 'sale' AS kind,reference FROM bm_retail_sales WHERE id IN (SELECT value FROM json_each(?)) UNION ALL SELECT 'settlement',reference FROM bm_membership_settlements WHERE sale_id IN (SELECT value FROM json_each(?))",JSON.stringify(saleIds),JSON.stringify(saleIds))
  const fingerprints=await Promise.all(references.map(async r=>stmt(db,'INSERT OR IGNORE INTO bm_retired_retail_references(kind,digest) VALUES(?,?)',r.kind,await sha256(r.reference))))
  const portability=await createPortability({db,policy:archivePolicy}),receiptId=id(),at=now()
  const receiptPolicy={scope:'retail',state:policy!.state,adultYears:review.policy!.adult,minorYears:review.policy!.minor,payerYears:policy!.payer_years,majorityAge:review.policy!.majority,ruleSource:review.policy!.rule.source,tableReviewedOn:review.policy!.rule.reviewedOn}
  await commit(db,who,[guard(db,`EXISTS(SELECT 1 FROM bm_retention_previews p JOIN bm_retention_epoch e ON e.id=1 JOIN bm_retention_policy r ON r.id=1
    WHERE p.id=? AND p.digest=? AND p.created_by=? AND p.epoch=e.version AND p.policy_version=r.version
    AND p.expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now') AND p.eligible_after<date('now'))
    AND NOT EXISTS(SELECT 1 FROM bm_retention_holds WHERE client_id=?)`,previewId,digest,who.id,client.id),
    ...await portability.redactionStatements(),...await portability.invalidateTransfersStatements(),
    stmt(db,'INSERT INTO bm_retention_permits(client_id,preview_id) VALUES(?,?)',client.id,previewId),...captureScope(db,previewId,found),
    preserveRetail(db,client.id,saleIds),...fingerprints,
    stmt(db,'INSERT INTO bm_retired_package_visits(appointment_id) SELECT appointment_id FROM bm_package_uses WHERE rowid IN (SELECT value FROM json_each(?))',JSON.stringify(found.bm_package_uses)),
    ...children.map(table=>stmt(db,`DELETE FROM ${table} WHERE rowid IN (SELECT value FROM json_each(?))`,JSON.stringify(found[table]))),
    stmt(db,'DELETE FROM bm_retail_sales WHERE rowid IN (SELECT value FROM json_each(?))',JSON.stringify(found.bm_retail_sales)),
    stmt(db,'INSERT INTO bm_destructions(id,preview_digest,destroyed_at,approved_by,policy,inventory) VALUES(?,?,?,?,?,?)',receiptId,digest,at,who.id,JSON.stringify(receiptPolicy),preview.inventory),
    stmt(db,'DELETE FROM bm_retention_scope WHERE preview_id=?',previewId),stmt(db,'DELETE FROM bm_retention_permits WHERE preview_id=?',previewId),
    stmt(db,'DELETE FROM bm_retention_previews WHERE client_id=?',client.id),audit(db,who,'retention.retail_destroyed',client.id,receiptId)])
  return {destroyed:true,scope:'retail',receiptId,digest,destroyedAt:at,inventory:list,policy:receiptPolicy}
}
