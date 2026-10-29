import { audit, commit, day, guard, human, id, insist, integer, now, one, rows, sha256, stmt, text, type Actor, type Data } from '../domain/model'

const owner = (who: Actor) => { human(who); insist(who.role === 'owner', 'only_the_owner_reviews_finance', 403) }
export function financeMonth(value: unknown) {
  const month = text(value, 'month', 7)
  insist(/^\d{4}-(0[1-9]|1[0-2])$/.test(month), 'invalid_month')
  return month
}
const epoch = async (db: D1Database) => (await one(db, 'SELECT version FROM bm_retention_epoch WHERE id=1'))!.version
const unchanged = (db: D1Database, version: number) => guard(db, 'EXISTS(SELECT 1 FROM bm_retention_epoch WHERE id=1 AND version=?)', version)

async function comparison(db: D1Database, payoutId: string) {
  const payout = await one(db, 'SELECT * FROM bm_finance_payouts WHERE id=?', payoutId)
  insist(payout, 'payout_not_found', 404)
  const links = await rows(db, 'SELECT * FROM bm_finance_payout_links WHERE payout_id=? ORDER BY source_id', payoutId)
  const portions: Data[] = [], originals = new Map<string, Data>()
  for (const link of links) {
    const source = await one(db, 'SELECT s.* FROM bm_finance_sources s JOIN bm_clients c ON c.id=s.client_id WHERE s.id=? AND c.erased_at IS NULL', link.source_id)
    const settlement = await one(db, 'SELECT * FROM bm_finance_observations WHERE id=?', link.observation_id)
    insist(source && settlement, 'payout_source_unavailable', 409)
    const related = await rows(db, 'SELECT * FROM bm_finance_sources WHERE client_id=? AND source_reference=? AND substr(occurred_on,1,7)=? ORDER BY id', source.client_id, source.source_reference, payout.occurred_on.slice(0,7))
    for (const original of related) originals.set(original.id, original)
    portions.push({ link, source, settlement })
  }
  const total = (pick: (portion: Data) => number) => portions.reduce((n, portion) => n + pick(portion), 0)
  const net = total(p => p.source.amount_cents), fees = total(p => p.source.fee_cents)
  const gross = net + fees, settlement = total(p => p.settlement.amount_cents)
  const relatedOriginals = [...originals.values()].sort((a,b) => a.id.localeCompare(b.id))
  const sum = (kind: string) => relatedOriginals.filter(s => s.kind === kind).reduce((n,s) => n + s.amount_cents, 0)
  const explanations = []
  if (payout.gross_cents !== gross) explanations.push('Unallocated gross: '+(payout.gross_cents-gross)+' cents; missing portions require owner review.')
  if (payout.fee_cents !== fees) explanations.push('Unallocated recorded fees: '+(payout.fee_cents-fees)+' cents.')
  if (payout.net_cents !== net) explanations.push('Unallocated net payout: '+(payout.net_cents-net)+' cents.')
  if (sum('charge') !== settlement) explanations.push('Linked charge originals differ from linked settlements by '+(settlement-sum('charge'))+' cents.')
  if (sum('accounting') !== settlement) explanations.push('Linked accounting originals differ from linked settlements by '+(settlement-sum('accounting'))+' cents.')
  return { payout, portions, relatedOriginals,
    totals: { grossCents: gross, feeCents: fees, netCents: net, settlementCents: settlement, chargeCents: sum('charge'), accountingCents: sum('accounting'),
      unallocatedGrossCents: payout.gross_cents-gross, unallocatedFeeCents: payout.fee_cents-fees, unallocatedNetCents: payout.net_cents-net },
    status: explanations.length ? 'owner_review_required' : 'recorded_amounts_agree',
    explanations: [...explanations, 'Owner-recorded comparison only; no processor verification, allocation correction, balance change, refund or outbound request.'] }
}

/** Invoked only after the existing finance scope or native owner check. */
export async function preparePayouts(db: D1Database, who: Actor, month: string) {
  const version = await epoch(db)
  const payouts = await rows(db, 'SELECT id FROM bm_finance_payouts WHERE substr(occurred_on,1,7)=? ORDER BY id', month)
  const statements: D1PreparedStatement[] = [unchanged(db,version)]
  for (const payout of payouts) {
    const payload = JSON.stringify(await comparison(db,payout.id)), digest = await sha256(payload)
    statements.push(stmt(db, 'INSERT OR IGNORE INTO bm_finance_payout_reviews(id,payout_id,payload,sha256,prepared_by,prepared_at) VALUES(?,?,?,?,?,?)', id(),payout.id,payload,digest,who.email,now()),
      audit(db,who,'finance.payout_prepared',null,payout.id,digest))
  }
  await commit(db,who,statements)
  return readReviews(db,month)
}
async function readReviews(db: D1Database, month: string) {
  const reviews = await rows(db, `SELECT r.*,a.approved_by,a.approved_at FROM bm_finance_payout_reviews r
    JOIN bm_finance_payouts p ON p.id=r.payout_id LEFT JOIN bm_finance_payout_approvals a ON a.review_id=r.id
    WHERE substr(p.occurred_on,1,7)=? ORDER BY r.prepared_at,r.id`, month)
  return reviews.map(r => ({...r,payload:JSON.parse(r.payload),preparationOnly:true}))
}

export async function payoutView(db: D1Database, who: Actor, inputMonth: unknown) {
  owner(who)
  const month = financeMonth(inputMonth)
  const payouts = await rows(db, 'SELECT * FROM bm_finance_payouts WHERE substr(occurred_on,1,7)=? ORDER BY occurred_on,id', month)
  const sources = await rows(db, `SELECT s.*,c.first_name,c.last_name FROM bm_finance_sources s JOIN bm_clients c ON c.id=s.client_id
    WHERE s.kind='payout' AND c.erased_at IS NULL AND substr(s.occurred_on,1,7)=? ORDER BY s.id`, month)
  const observations = await rows(db, `SELECT o.* FROM bm_finance_observations o JOIN bm_clients c ON c.id=o.client_id
    WHERE o.kind='card' AND c.erased_at IS NULL AND substr(o.occurred_on,1,7)=? ORDER BY o.id`, month)
  const reviews = await readReviews(db,month)
  await commit(db,who,[audit(db,who,'finance.payouts_read',null,null,month)])
  return {month,payouts,sources,observations,reviews}
}

export async function payoutCommand(db: D1Database, who: Actor, name: string, input: Data) {
  owner(who)
  if (name === 'finance.payout.record') {
    insist(input.confirm === true, 'confirm_owner_recorded_payout_only')
    const record = { account_reference:text(input.accountReference,'account_reference',120), payout_reference:text(input.payoutReference,'payout_reference',120),
      gross_cents:integer(input.grossCents,'gross',1,100_000_000), fee_cents:integer(input.feeCents,'fee',0,100_000_000),
      net_cents:integer(input.netCents,'net',0,100_000_000), occurred_on:day(input.occurredOn,'date'), evidence:text(input.evidence,'source_evidence',500) }
    insist(record.gross_cents-record.fee_cents === record.net_cents, 'payout_gross_less_fees_must_equal_net')
    const previous = await one(db,'SELECT * FROM bm_finance_payouts WHERE account_reference=? AND payout_reference=?',record.account_reference,record.payout_reference)
    if (previous) {
      insist(Object.entries(record).every(([key,value]) => previous[key] === value), 'payout_original_conflicts',409)
      await commit(db,who,[])
      return {id:previous.id,recordedOnly:true}
    }
    const key = id()
    await commit(db,who,[stmt(db,`INSERT INTO bm_finance_payouts(id,account_reference,payout_reference,gross_cents,fee_cents,net_cents,occurred_on,evidence,recorded_by,recorded_at) VALUES(?,?,?,?,?,?,?,?,?,?)`,key,...Object.values(record),who.email,now()),audit(db,who,'finance.payout_recorded',null,key)])
    return {id:key,recordedOnly:true}
  }
  if (name === 'finance.payout.link') {
    insist(input.confirm === true,'confirm_owner_reviewed_portion_association')
    const payout = await one(db,'SELECT * FROM bm_finance_payouts WHERE id=?',text(input.payoutId,'payout',100))
    insist(payout,'payout_not_found',404)
    insist(input.accountReference === payout.account_reference && input.payoutReference === payout.payout_reference,'payout_account_or_reference_conflicts',409)
    const sourceId = text(input.sourceId,'source',100), observationId = text(input.observationId,'settlement',100)
    const previous = await one(db,'SELECT * FROM bm_finance_payout_links WHERE source_id=? OR observation_id=?',sourceId,observationId)
    if (previous) {
      insist(previous.payout_id === payout.id && previous.source_id === sourceId && previous.observation_id === observationId,'payout_portion_already_linked',409)
      await commit(db,who,[])
      return {id:previous.id,recordedOnly:true}
    }
    const key = id()
    // The trigger checks live patient, original reference, month, exact cents and cumulative allocation in this batch.
    await commit(db,who,[stmt(db,'INSERT INTO bm_finance_payout_links(id,payout_id,source_id,observation_id,recorded_by,recorded_at) VALUES(?,?,?,?,?,?)',key,payout.id,sourceId,observationId,who.email,now()),audit(db,who,'finance.payout_portion_linked',null,key)])
    return {id:key,recordedOnly:true}
  }
  insist(name === 'finance.payout.approve','unknown_command',404)
  insist(input.confirm === true,'confirm_preparation_only_no_outbound')
  const version = await epoch(db)
  const review = await one(db,'SELECT * FROM bm_finance_payout_reviews WHERE id=?',text(input.id,'review',100))
  insist(review,'review_not_found',404)
  insist(input.sha256 === review.sha256 && await sha256(review.payload) === review.sha256,'review_digest_changed',409)
  const current = JSON.stringify(await comparison(db,review.payout_id))
  insist(current === review.payload,'payout_sources_changed_prepare_again',409)
  await commit(db,who,[unchanged(db,version),stmt(db,'INSERT INTO bm_finance_payout_approvals(review_id,approved_by,approved_at) VALUES(?,?,?)',review.id,who.email,now()),audit(db,who,'finance.payout_preparation_approved',null,review.id,review.sha256)])
  return {approved:true,sha256:review.sha256,preparationOnly:true,outbound:false,refunded:false}
}
