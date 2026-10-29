import { audit, commit, day, guard, human, id, insist, integer, now, one, rows, sha256, stmt, text, type Actor, type Data } from '../domain/model'

const owner = (who: Actor) => { human(who); insist(who.role === 'owner', 'only_the_owner_reviews_finance', 403) }
const epoch = async (db: D1Database) => (await one(db, 'SELECT version FROM bm_retention_epoch WHERE id=1'))!.version
const unchanged = (db: D1Database, version: number) => guard(db, 'EXISTS(SELECT 1 FROM bm_retention_epoch WHERE id=1 AND version=?)', version)

async function comparison(db: D1Database, eftId: string) {
  const deposit = await one(db, 'SELECT * FROM bm_finance_efts WHERE id=?', eftId)
  insist(deposit, 'eft_not_found', 404)
  const link = await one(db, 'SELECT * FROM bm_finance_eft_eras WHERE eft_id=?', eftId)
  const era = link ? await one(db, `SELECT m.id,m.sha256,m.trace,m.payer_id,m.amount_cents,d.native_cents,d.billed_cents,d.adjustment_cents,d.responsibility_cents,d.claim_count,
    COALESCE((SELECT SUM(paid_cents) FROM bm_runout_postings WHERE import_id=m.id),0) AS migrated_cents,
    COALESCE((SELECT SUM(paid_cents) FROM bm_remittance_suspense WHERE import_id=m.id AND resolved_claim IS NULL),0) AS suspense_cents
    FROM bm_insurance_imports m JOIN bm_runout_deposits d ON d.import_id=m.id WHERE m.id=?`, link.import_id) : null
  insist(!link || era, 'eft_remittance_source_unavailable', 409)
  const sources = await rows(db, `SELECT s.*,l.id AS link_id,l.recorded_at AS linked_at FROM bm_finance_eft_sources l
    JOIN bm_finance_sources s ON s.id=l.source_id JOIN bm_clients c ON c.id=s.client_id
    WHERE l.eft_id=? AND c.erased_at IS NULL ORDER BY s.id`, eftId)
  const accounting = sources.filter(s => s.kind === 'accounting').reduce((n,s) => n+s.amount_cents,0)
  const charge = sources.filter(s => s.kind === 'charge').reduce((n,s) => n+s.amount_cents,0)
  const attributed = era ? era.native_cents+era.migrated_cents : 0
  const explanations: string[] = []
  if (!era) explanations.push('Missing ERA: no explicitly linked imported remittance. No claim is marked paid by this comparison.')
  else {
    if (era.amount_cents !== deposit.amount_cents) explanations.push('Recorded deposit differs from the imported ERA by '+(deposit.amount_cents-era.amount_cents)+' cents.')
    if (era.native_cents+era.migrated_cents+era.suspense_cents !== era.amount_cents) explanations.push('Imported ERA components do not account for the complete deposit; owner review required.')
    if (era.billed_cents === null) explanations.push('Original ERA billed, adjustment and responsibility totals are unavailable for this older import; no gross-charge reconciliation is claimed.')
    else {
      if (era.billed_cents !== era.amount_cents+era.adjustment_cents+era.responsibility_cents) explanations.push('Imported original gross, adjustments, responsibility and deposit do not reconcile.')
      if (charge !== era.billed_cents) explanations.push('Imported billed charges differ from explicitly linked charge originals by '+(era.billed_cents-charge)+' cents.')
    }
    if (era.suspense_cents) explanations.push('Unmatched ERA money remains in suspense: '+era.suspense_cents+' cents. Matching the deposit never assigns a patient or clears suspense.')
  }
  if (accounting !== deposit.amount_cents) explanations.push('Recorded deposit differs from explicitly linked accounting originals by '+(deposit.amount_cents-accounting)+' cents.')
  if (!sources.some(s => s.kind === 'charge')) explanations.push('No charge original explicitly cited. Billed charges are context, not the net amount paid after adjudication.')
  return { deposit, era, sources, requestDraft:era?null:{purpose:'missing_era',payerId:deposit.payer_id,accountReference:deposit.account_reference,trace:deposit.trace,amountCents:deposit.amount_cents,occurredOn:deposit.occurred_on,
    message:'Please provide the ERA for EFT trace '+deposit.trace+', recorded deposit '+deposit.amount_cents+' USD cents on '+deposit.occurred_on+'. This draft has not been sent.'}, totals: { depositCents:deposit.amount_cents, eraCents:era?.amount_cents??0,
    nativeCents:era?.native_cents??0, migratedCents:era?.migrated_cents??0, suspenseCents:era?.suspense_cents??0,
    eraChargeCents:era?.billed_cents??null, eraAdjustmentCents:era?.adjustment_cents??null, eraPatientCents:era?.responsibility_cents??null,
    chargeCents:charge, chargeDifferenceCents:era?.billed_cents===null||!era?null:era.billed_cents-charge, accountingCents:accounting, unattributedCents:deposit.amount_cents-attributed,
    accountingDifferenceCents:deposit.amount_cents-accounting }, status:explanations.length?'owner_review_required':'recorded_amounts_agree',
    explanations:[...explanations,'Preparation only. Imported facts and owner recordings establish no bank verification, recipient consent, correction, refund or outbound authority.'] }
}

async function reviews(db: D1Database, month: string) {
  const found = await rows(db, `SELECT r.*,a.approved_by,a.approved_at FROM bm_finance_eft_reviews r
    JOIN bm_finance_efts e ON e.id=r.eft_id LEFT JOIN bm_finance_eft_approvals a ON a.review_id=r.id
    WHERE substr(e.occurred_on,1,7)=? ORDER BY r.prepared_at,r.id`, month)
  return found.map(r => ({...r,payload:JSON.parse(r.payload),preparationOnly:true}))
}

/** The caller checks the existing explicit finance preparation scope or owner session. */
export async function prepareEfts(db: D1Database, who: Actor, month: string) {
  const version = await epoch(db), deposits = await rows(db, 'SELECT id FROM bm_finance_efts WHERE substr(occurred_on,1,7)=? ORDER BY id', month)
  const statements: D1PreparedStatement[] = [unchanged(db,version)]
  for (const deposit of deposits) {
    const payload=JSON.stringify(await comparison(db,deposit.id)), digest=await sha256(payload)
    statements.push(stmt(db,'INSERT OR IGNORE INTO bm_finance_eft_reviews(id,eft_id,payload,sha256,prepared_by,prepared_at) VALUES(?,?,?,?,?,?)',id(),deposit.id,payload,digest,who.email,now()),audit(db,who,'finance.eft_prepared',null,deposit.id,digest))
  }
  await commit(db,who,statements)
  return reviews(db,month)
}

export async function eftView(db: D1Database, month: string) {
  return { payers:await rows(db,'SELECT id,name FROM bm_payers ORDER BY name,id'), deposits:await rows(db, 'SELECT e.*,p.name AS payer_name FROM bm_finance_efts e JOIN bm_payers p ON p.id=e.payer_id WHERE substr(e.occurred_on,1,7)=? ORDER BY e.occurred_on,e.id',month),
    reviews:await reviews(db,month),
    imports:await rows(db,"SELECT id,trace,payer_id,amount_cents,sha256 FROM bm_insurance_imports WHERE kind='835' ORDER BY imported_at DESC"),
    sources:await rows(db,`SELECT s.*,c.first_name,c.last_name FROM bm_finance_sources s JOIN bm_clients c ON c.id=s.client_id
      WHERE s.kind IN ('charge','accounting') AND c.erased_at IS NULL AND substr(s.occurred_on,1,7)<=? ORDER BY s.occurred_on,s.id`,month) }
}

export async function eftCommand(db: D1Database, who: Actor, name: string, input: Data) {
  owner(who)
  if (name === 'finance.eft.record') {
    insist(input.confirm===true,'confirm_owner_recorded_eft_only')
    const record={account_reference:text(input.accountReference,'account_reference',120),payer_id:text(input.payerId,'payer',100),trace:text(input.trace,'eft_trace',120),
      amount_cents:integer(input.amountCents,'amount',1,100_000_000),occurred_on:day(input.occurredOn,'date'),evidence:text(input.evidence,'source_evidence',500)}
    insist(await one(db,'SELECT id FROM bm_payers WHERE id=?',record.payer_id),'payer_not_found',404)
    const previous=await one(db,'SELECT * FROM bm_finance_efts WHERE account_reference=? AND payer_id=? AND trace=?',record.account_reference,record.payer_id,record.trace)
    if(previous){
      insist(Object.entries(record).every(([key,value])=>previous[key]===value),'eft_original_conflicts',409)
      await commit(db,who,[]);return {id:previous.id,recordedOnly:true}
    }
    const key=id()
    await commit(db,who,[stmt(db,'INSERT INTO bm_finance_efts(id,account_reference,payer_id,trace,amount_cents,occurred_on,evidence,recorded_by,recorded_at) VALUES(?,?,?,?,?,?,?,?,?)',key,...Object.values(record),who.email,now()),audit(db,who,'finance.eft_recorded',null,key)])
    return {id:key,recordedOnly:true}
  }
  if (name === 'finance.eft.source.link' || name === 'finance.eft.era.link') {
    insist(input.confirm===true,'confirm_owner_reviewed_eft_association')
    const deposit=await one(db,'SELECT * FROM bm_finance_efts WHERE id=?',text(input.eftId,'eft',100))
    insist(deposit,'eft_not_found',404)
    insist(input.accountReference===deposit.account_reference&&input.trace===deposit.trace,'eft_account_or_trace_conflicts',409)
    const era=name==='finance.eft.era.link', table=era?'bm_finance_eft_eras':'bm_finance_eft_sources', column=era?'import_id':'source_id'
    const sourceId=text(era?input.importId:input.sourceId,'source',100)
    const previous=await one(db,`SELECT * FROM ${table} WHERE ${column}=?${era?' OR eft_id=?':''}`,sourceId,...(era?[deposit.id]:[]))
    if(previous){
      insist(previous.eft_id===deposit.id&&previous[column]===sourceId,'eft_original_already_linked',409)
      await commit(db,who,[]);return {id:previous.id,recordedOnly:true}
    }
    const key=id()
    await commit(db,who,[stmt(db,`INSERT INTO ${table}(id,eft_id,${column},recorded_by,recorded_at) VALUES(?,?,?,?,?)`,key,deposit.id,sourceId,who.email,now()),audit(db,who,'finance.eft_original_linked',null,key)])
    return {id:key,recordedOnly:true}
  }
  insist(name==='finance.eft.approve','unknown_command',404)
  insist(input.confirm===true,'confirm_preparation_only_no_outbound')
  const version=await epoch(db), review=await one(db,'SELECT * FROM bm_finance_eft_reviews WHERE id=?',text(input.id,'review',100))
  insist(review,'review_not_found',404)
  insist(input.sha256===review.sha256&&await sha256(review.payload)===review.sha256,'review_digest_changed',409)
  insist(JSON.stringify(await comparison(db,review.eft_id))===review.payload,'eft_sources_changed_prepare_again',409)
  await commit(db,who,[unchanged(db,version),stmt(db,'INSERT INTO bm_finance_eft_approvals(review_id,approved_by,approved_at) VALUES(?,?,?)',review.id,who.email,now()),audit(db,who,'finance.eft_preparation_approved',null,review.id,review.sha256)])
  return {approved:true,sha256:review.sha256,preparationOnly:true,outbound:false,refunded:false}
}
