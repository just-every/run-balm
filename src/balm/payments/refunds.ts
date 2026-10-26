// PAY-002: an exact, freshly reviewed human decision precedes one processor send.
import type { Bindings } from '../../auth.server'
import { clientVisible } from '../domain/clients'
import { dollars } from '../domain/invoices'
import { biller } from '../domain/role-access'
import { audit, commit, guard, human, id, insist, integer, need, now, one, rows, sha256, stmt, text, type Actor, type Data } from '../domain/model'
import { base64Bytes, receiptBytes } from './account-documents'
import { stripeReady } from './connect'
import { parseDollars } from './ledger'
import { pdf } from './pdf'
import { stripeCall } from './stripe-api'

const payment = (db: D1Database, key: string) => one(db, 'SELECT * FROM bm_card_payments WHERE id=?', key)
const refund = (db: D1Database, key: string) => one(db, 'SELECT * FROM bm_card_refunds WHERE id=?', key)
const objectId = (value: any) => typeof value === 'object' && value ? value.id : value
const terminal = (r: Data) => ['confirmed','failed','superseded'].includes(r.status)
function authority(who: Actor, approval = false) {
  human(who); need(who, 'owner', 'reception')
  insist(who.role === 'owner' || !who.staffKind || ['reception','biller'].includes(who.staffKind), 'role_cannot_prepare_stripe_refund', 403)
  if (approval) insist(who.role === 'owner' || biller(who), 'owner_or_biller_must_approve_stripe_refund', 403)
}
function roleFence(db: D1Database, who: Actor) {
  return who.role === 'owner' ? [] : [guard(db, `EXISTS(SELECT 1 FROM bm_staff s LEFT JOIN bm_staff_access a ON a.staff_id=s.id WHERE s.id=? AND COALESCE(a.kind,s.role)=?)`, who.staffId, who.staffKind ?? 'reception')]
}
const basis = (r: Data) => ({ id:r.id,payment_id:r.payment_id,client_id:r.client_id,account_id:r.account_id,customer_id:r.customer_id,
  payment_intent:r.payment_intent,charge_id:r.charge_id,amount_cents:r.amount_cents,reason:r.reason,source_json:r.source_json,prepared_by:r.prepared_by,prepared_at:r.prepared_at })

async function providerRefunds(key: string, intent: string) {
  const found: Data[] = []
  let after: string | undefined
  do {
    const page = await stripeCall(key, 'GET', '/refunds', { payment_intent:intent, limit:100, starting_after:after })
    insist(Array.isArray(page.data), 'stripe_refund_list_unavailable', 409)
    found.push(...page.data)
    if (!page.has_more) break
    const next = page.data.at(-1)?.id
    insist(next && next !== after, 'stripe_refund_list_incomplete', 409)
    after = next
  } while (true)
  return found
}

/** Fetch only payment facts. Patient names, reasons and clinical data never go to Stripe. */
async function original(env: Bindings, db: D1Database, p: Data) {
  const { settings, key } = await stripeReady(env, db)
  insist(p.status === 'succeeded' && p.payment_intent, 'original_succeeded_stripe_payment_required', 409)
  insist(p.stripe_account_id == null || p.stripe_account_id === settings.account_id, 'original_stripe_account_must_be_connected', 409)
  const intent = await stripeCall(key, 'GET', `/payment_intents/${encodeURIComponent(p.payment_intent)}`, { expand:['latest_charge'] })
  const charge = intent.latest_charge, customerId = objectId(intent.customer) ?? ''
  insist(intent.id === p.payment_intent && intent.status === 'succeeded' && intent.currency === 'usd'
    && intent.amount_received === p.amount_cents && (p.stripe_customer_id == null || customerId === p.stripe_customer_id)
    && intent.metadata?.balm_payment === p.id && intent.metadata?.balm_client === p.client_id
    && typeof charge === 'object' && charge && charge.id && objectId(charge.payment_intent) === p.payment_intent
    && charge.paid === true && charge.captured === true && charge.currency === 'usd' && charge.amount === p.amount_cents
    && (objectId(charge.customer) ?? '') === customerId && Boolean(intent.livemode) === Boolean(settings.livemode), 'stripe_original_does_not_match_patient_payment', 409)
  const refunds = await providerRefunds(key, p.payment_intent)
  return { settings, key, intent, charge, refunds, customerId }
}

async function source(db: D1Database, p: Data, truth: Awaited<ReturnType<typeof original>>) {
  const client = await one(db, 'SELECT version FROM bm_clients WHERE id=? AND erased_at IS NULL', p.client_id)
  insist(client, 'client_not_found', 404)
  const allocations = await rows(db, `SELECT p.id,p.invoice_id,p.amount_cents,p.reference,p.recorded_at,i.client_id,i.version,i.status
    FROM bm_payments p JOIN bm_invoices i ON i.id=p.invoice_id WHERE p.card_payment_id=? ORDER BY p.id`, p.id)
  insist(allocations.every(a => a.client_id === p.client_id && a.status === 'approved'), 'original_payment_allocation_changed', 409)
  return JSON.stringify({ account_id:truth.settings.account_id,connected_at:truth.settings.connected_at,livemode:truth.settings.livemode,
    client_version:client.version,payment:{id:p.id,client_id:p.client_id,payment_intent:p.payment_intent,account_id:p.stripe_account_id,
      customer_id:p.stripe_customer_id,amount_cents:p.amount_cents,applied_cents:p.applied_cents,refunded_cents:p.refunded_cents,
      appointment_id:p.appointment_id,invoice_id:p.invoice_id,status:p.status},
    charge:{id:truth.charge.id,amount_refunded:truth.charge.amount_refunded,disputed:Boolean(truth.charge.disputed)},
    refunds:truth.refunds.map(r => ({id:r.id,amount:r.amount,currency:r.currency,payment_intent:objectId(r.payment_intent),charge:objectId(r.charge),status:r.status})).sort((a,b)=>a.id.localeCompare(b.id)),allocations })
}

function sourceFences(db: D1Database, p: Data, value: string, settings: Data) {
  const s = JSON.parse(value)
  return [guard(db, `EXISTS(SELECT 1 FROM bm_clients WHERE id=? AND version=? AND erased_at IS NULL)`, p.client_id,s.client_version),
    guard(db, `EXISTS(SELECT 1 FROM bm_stripe WHERE id=1 AND account_id=? AND connected_at=? AND key_sealed=?)`,settings.account_id,settings.connected_at,settings.key_sealed),
    guard(db, `EXISTS(SELECT 1 FROM bm_card_payments WHERE id=? AND client_id=? AND status='succeeded' AND payment_intent=? AND stripe_account_id IS ? AND stripe_customer_id IS ? AND amount_cents=? AND applied_cents=? AND refunded_cents=? AND appointment_id IS ? AND invoice_id IS ?)`,p.id,p.client_id,p.payment_intent,p.stripe_account_id,p.stripe_customer_id,p.amount_cents,p.applied_cents,p.refunded_cents,p.appointment_id,p.invoice_id),
    guard(db, `(SELECT COUNT(*) FROM bm_payments WHERE card_payment_id=?)=?`,p.id,s.allocations.length),
    ...s.allocations.map((a: Data)=>guard(db, `EXISTS(SELECT 1 FROM bm_payments p JOIN bm_invoices i ON i.id=p.invoice_id WHERE p.id=? AND p.card_payment_id=? AND p.invoice_id=? AND p.amount_cents=? AND p.reference=? AND i.client_id=? AND i.version=? AND i.status='approved')`,a.id,p.id,a.invoice_id,a.amount_cents,a.reference,p.client_id,a.version))]
}

function refundable(p: Data, truth: Awaited<ReturnType<typeof original>>, amount: number) {
  insist(!truth.charge.disputed, 'disputed_payment_needs_processor_review', 409)
  // Out-of-band refunds must be reconciled before Balm can approve another send.
  const successful = truth.refunds.filter(r=>r.status === 'succeeded').reduce((sum,r)=>sum+Number(r.amount),0)
  insist(successful === p.refunded_cents && truth.charge.amount_refunded === p.refunded_cents
    && truth.refunds.every(r=>['succeeded','failed','canceled'].includes(r.status)), 'stripe_refunds_need_reconciliation', 409)
  insist(amount <= p.amount_cents-p.refunded_cents, 'refund_exceeds_original_payment', 409)
}

export async function prepareCardRefund(env: Bindings, db: D1Database, who: Actor, input: Data) {
  authority(who)
  const p = await payment(db, text(input.paymentId,'original_payment',100))
  insist(p, 'original_payment_not_found', 404)
  const client = await clientVisible(db, who, p.client_id)
  if (input.clientId) insist(input.clientId === client.id, 'original_payment_patient_mismatch', 409)
  const amount = integer(input.amountCents ?? parseDollars(input.amount), 'amount_cents',1,10_000_000), reason = text(input.reason,'refund_reason',500)
  const truth = await original(env,db,p)
  refundable(p,truth,amount)
  const value = await source(db,p,truth), active = await one(db,"SELECT * FROM bm_card_refunds WHERE payment_id=? AND status IN ('prepared','approved','attempted','uncertain')",p.id)
  if (active && active.status !== 'prepared') return active
  if (active?.amount_cents === amount && active.reason === reason && active.source_json === value) return active
  const r = {id:id(),payment_id:p.id,client_id:p.client_id,account_id:truth.settings.account_id,customer_id:truth.customerId,
    payment_intent:p.payment_intent,charge_id:truth.charge.id,amount_cents:amount,reason,source_json:value,prepared_by:who.email,prepared_at:now()}
  const digest = await sha256(JSON.stringify(basis(r)))
  await commit(db,who,[...roleFence(db,who),...sourceFences(db,p,value,truth.settings),
    ...(active ? [stmt(db,"UPDATE bm_card_refunds SET status='superseded' WHERE id=? AND status='prepared'",active.id),guard(db,'changes()=1')] : []),
    stmt(db,`INSERT INTO bm_card_refunds(id,payment_id,client_id,account_id,customer_id,payment_intent,charge_id,amount_cents,reason,source_json,prepared_by,prepared_at,sha256) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)`,...Object.values(r),digest),
    audit(db,who,'payment.refund_prepared',p.client_id,r.id,`${amount} cents; original ${p.id}`)])
  return refund(db,r.id)
}

/** A replay returns the reserved attempt; it never posts the request a second time. */
export async function approveCardRefund(env: Bindings, db: D1Database, who: Actor, input: Data) {
  authority(who,true)
  const r = await refund(db,text(input.id,'refund',100))
  insist(r,'refund_not_found',404)
  await clientVisible(db,who,r.client_id)
  insist(input.sha256 === r.sha256 && await sha256(JSON.stringify(basis(r))) === r.sha256,'refund_changed_review_again',409)
  if (r.status !== 'prepared') return r
  insist(input.attest === true || input.attest === 'on','confirm_exact_stripe_refund_and_originals')
  const p = (await payment(db,r.payment_id))!, truth = await original(env,db,p)
  refundable(p,truth,r.amount_cents)
  const value = await source(db,p,truth)
  insist(value === r.source_json && truth.charge.id === r.charge_id,'refund_source_changed_prepare_again',409)
  const at = now()
  try {
    await commit(db,who,[...roleFence(db,who),...sourceFences(db,p,value,truth.settings),
      ...(p.stripe_account_id == null || p.stripe_customer_id == null ? [
        stmt(db,'UPDATE bm_card_payments SET stripe_account_id=?,stripe_customer_id=? WHERE id=? AND stripe_account_id IS ? AND stripe_customer_id IS ?',truth.settings.account_id,truth.customerId,p.id,p.stripe_account_id,p.stripe_customer_id),guard(db,'changes()=1'),
        audit(db,who,'payment.original_reconciled',p.client_id,p.id,'Original account and customer read from Stripe and approved with this exact refund'),
      ] : []),
      stmt(db,`UPDATE bm_card_refunds SET status='attempted',approved_by=?,approver_id=?,approved_at=?,attempted_at=? WHERE id=? AND status='prepared' AND sha256=?`,who.email,who.id,at,at,r.id,r.sha256),guard(db,'changes()=1'),
      audit(db,who,'payment.refund_approved',r.client_id,r.id,`${r.amount_cents} cents; exact action ${r.sha256}`),audit(db,who,'payment.refund_attempted',r.client_id,r.id)])
  } catch (error) {
    const current = await refund(db,r.id)
    if (current && current.status !== 'prepared') return current
    throw error
  }
  try {
    const result = await stripeCall(truth.key,'POST','/refunds',{charge:r.charge_id,amount:r.amount_cents,metadata:{balm_refund:r.id,balm_payment:r.payment_id}},`balm-refund-${r.id}`)
    // Even an accepted POST is read back through the processor's retrieval door.
    return await reconcileCardRefund(env,db,who,{id:r.id,providerRefundId:result.id})
  } catch {
    await commit(db,who,[...roleFence(db,who),stmt(db,"UPDATE bm_card_refunds SET status='uncertain' WHERE id=? AND status='attempted'",r.id),audit(db,who,'payment.refund_uncertain',r.client_id,r.id,'Read original processor outcome before any further action')])
    return refund(db,r.id)
  }
}

export async function reconcileCardRefund(env: Bindings, db: D1Database, who: Actor, input: Data) {
  authority(who,true)
  const r = await refund(db,text(input.id,'refund',100))
  insist(r,'refund_not_found',404)
  await clientVisible(db,who,r.client_id)
  if (terminal(r)) return r
  insist(r.attempted_at && ['attempted','uncertain'].includes(r.status),'refund_not_attempted',409)
  const p = (await payment(db,r.payment_id))!, truth = await original(env,db,p)
  insist(p.client_id === r.client_id && p.payment_intent === r.payment_intent && p.stripe_account_id === r.account_id
    && p.stripe_customer_id === r.customer_id && truth.charge.id === r.charge_id,'refund_original_binding_changed',409)
  const providerId = r.provider_refund_id ?? input.providerRefundId
  const matches = truth.refunds.filter(v=>v.metadata?.balm_refund === r.id)
  insist(matches.length <= 1,'multiple_processor_refunds_need_review',409)
  const candidate = providerId ?? matches[0]?.id
  if (!candidate) {
    await commit(db,who,[...roleFence(db,who),stmt(db,"UPDATE bm_card_refunds SET status='uncertain' WHERE id=? AND status IN ('attempted','uncertain')",r.id),audit(db,who,'payment.refund_reconciliation_pending',r.client_id,r.id,'No original refund located; no resend')])
    return refund(db,r.id)
  }
  const v = await stripeCall(truth.key,'GET',`/refunds/${encodeURIComponent(text(candidate,'provider_refund',150))}`)
  insist(v.id === candidate && objectId(v.payment_intent) === r.payment_intent && objectId(v.charge) === r.charge_id
    && v.amount === r.amount_cents && v.currency === 'usd' && v.metadata?.balm_refund === r.id && v.metadata?.balm_payment === r.payment_id
    && (!providerId || providerId === v.id),'stripe_refund_does_not_match_approved_action',409)
  const status = v.status === 'succeeded' ? 'confirmed' : ['failed','canceled'].includes(v.status) ? 'failed' : 'uncertain', at = now()
  const statements: D1PreparedStatement[] = []
  let receipt: string | null = null
  if (status === 'confirmed') {
    // Spend unallocated credit first, then restore the newest original allocations.
    let left = Math.max(0,r.amount_cents-(p.amount_cents-p.refunded_cents-p.applied_cents)), restored = 0
    const allocations = await rows(db,`SELECT p.invoice_id,SUM(p.amount_cents)-COALESCE((SELECT SUM(a.amount_cents) FROM bm_card_refund_allocations a JOIN bm_card_refunds r ON r.id=a.refund_id WHERE a.payment_id=? AND a.invoice_id=p.invoice_id AND r.status='confirmed'),0) AS remaining_cents,MAX(p.recorded_at) AS at FROM bm_payments p JOIN bm_invoices i ON i.id=p.invoice_id WHERE p.card_payment_id=? AND i.client_id=? GROUP BY p.invoice_id ORDER BY at DESC,p.invoice_id DESC`,p.id,p.id,r.client_id)
    for (const a of allocations) {
      const take = Math.min(left,Number(a.remaining_cents))
      if (take <= 0) continue
      left -= take; restored += take
      statements.push(stmt(db,'INSERT INTO bm_card_refund_allocations(id,refund_id,payment_id,invoice_id,amount_cents) VALUES(?,?,?,?,?)',id(),r.id,p.id,a.invoice_id,take))
    }
    insist(left === 0,'refund_original_allocations_need_review',409)
    statements.push(stmt(db,'UPDATE bm_card_payments SET refunded_cents=refunded_cents+?,applied_cents=applied_cents-?,updated_at=? WHERE id=? AND refunded_cents=? AND applied_cents=?',r.amount_cents,restored,at,p.id,p.refunded_cents,p.applied_cents),guard(db,'changes()=1'))
    const clinic = (await one(db,'SELECT clinic_name FROM bm_settings WHERE id=1'))!
    const client = (await one(db,'SELECT first_name,last_name FROM bm_clients WHERE id=?',r.client_id))!
    receipt = base64Bytes(pdf({header:clinic.clinic_name,title:'Stripe refund receipt',blocks:[{kind:'facts',rows:[['Refund',r.id],['Patient',`${client.first_name} ${client.last_name}`],['Amount',dollars(r.amount_cents)],['Original payment',r.payment_intent],['Stripe refund',v.id],['Practice Stripe account',r.account_id],['Reason',r.reason],['Approved by',r.approved_by],['Approved at',r.approved_at],['Confirmed at',at]]},{kind:'notes',lines:['Stripe confirmed this refund to the original payment method. The original payment receipt remains unchanged.']}]}))
  }
  try {
    await commit(db,who,[...roleFence(db,who),...sourceFences(db,p,await source(db,p,truth),truth.settings),
      stmt(db,`UPDATE bm_card_refunds SET status=?,provider_refund_id=?,provider_status=?,confirmed_at=?,receipt_base64=? WHERE id=? AND status IN ('attempted','uncertain')`,status,v.id,String(v.status),status==='confirmed'?at:null,receipt,r.id),guard(db,'changes()=1'),...statements,
      audit(db,who,`payment.refund_${status}`,r.client_id,r.id,`${r.amount_cents} cents; processor ${v.id}`)])
  } catch (error) { if ((await refund(db,r.id))?.status === 'confirmed') return refund(db,r.id); throw error }
  return refund(db,r.id)
}

/** Use only after the caller has resolved this patient's portal, private link or billing access. */
export async function cardRefundsFor(db: D1Database, clientId: string) {
  return rows(db,'SELECT * FROM bm_card_refunds WHERE client_id=? ORDER BY prepared_at DESC,id',clientId)
}
export async function cardRefundReceipt(db: D1Database, key: string) {
  const r = await refund(db,key)
  insist(r?.status === 'confirmed' && r.receipt_base64,'refund_receipt_not_found',404)
  return {name:`refund-${r.id}.pdf`,bytes:receiptBytes(r.receipt_base64)}
}
