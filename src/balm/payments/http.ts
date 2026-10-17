// Payment doors: the patient's private link (/pay/<token>: statement, pay, save a
// card, receipts and superbills), Stripe's signed webhook, and the desk's
// document downloads. Every opening and download is audited for the patient.
import type { Bindings } from '../../auth.server'
import { audit, commit, DomainError, human, insist, need, one, rows, type Actor } from '../domain/model'
import { renderPublic } from '../ui'
import { liveCard, startCardSetup, syncCardSetup } from './cards'
import { startLinkPayment, syncCheckout, syncIntent } from './charges'
import { paymentBlock, stripeSettings, WEBHOOK_PATH } from './connect'
import { receiptPdf, statementPdf, superbillFacts, superbillPdf } from './documents'
import { ledger, parseDollars, receiptNumber } from './ledger'
import { linkFor, linkUrl } from './links'
import { unseal, verifySignature } from './stripe-api'

const patient = { email: 'patient link', role: 'patient' }
const noStore = { 'cache-control': 'no-store', 'x-content-type-options': 'nosniff', 'referrer-policy': 'no-referrer' }
const pdfResponse = (doc: { name: string; bytes: Uint8Array<ArrayBuffer> }) => new Response(doc.bytes, { headers: { ...noStore, 'content-type': 'application/pdf', 'content-disposition': `attachment; filename="${doc.name}"` } })
const failureText = (error: unknown) => { const status = Number((error as any)?.status) || 500; return { status, text: status < 500 ? String((error as Error).message).replace(/_/g, ' ') : 'Something went wrong. Refresh and try again.' } }

/** Bring this link's unfinished Stripe sessions up to date (the patient may have closed the tab). */
async function syncLink(env: Bindings, db: D1Database, link: any, url: URL) {
  if (await paymentBlock(env, db)) return
  const paid = url.searchParams.get('paid'), setup = url.searchParams.get('setup')
  if (paid) await syncCheckout(env, db, paid)
  if (setup) await syncCardSetup(env, db, setup)
  const since = new Date(Date.now() - 86400_000).toISOString()
  for (const p of await rows(db, "SELECT checkout_session FROM bm_card_payments WHERE link_id=? AND status IN ('open','processing') AND created_at>? AND checkout_session IS NOT NULL LIMIT 5", link.id, since)) await syncCheckout(env, db, p.checkout_session as string)
  for (const s of await rows(db, "SELECT id FROM bm_card_setups WHERE link_id=? AND status='open' AND created_at>? LIMIT 5", link.id, since)) await syncCardSetup(env, db, s.id as string)
}

async function payPage(env: Bindings, db: D1Database, link: any, token: string, url: URL, notice: { error?: string; status?: number } = {}) {
  let error = notice.error
  try { await syncLink(env, db, link, url) } catch (e) { error ??= failureText(e).text }
  const client = await one(db, 'SELECT id,first_name,last_name FROM bm_clients WHERE id=?', link.client_id), clinic = await one(db, 'SELECT clinic_name,time_zone,address FROM bm_settings WHERE id=1')
  const card = await liveCard(db, link.client_id)
  const payments = await rows(db, "SELECT id,kind,amount_cents,status,card_brand,card_last4,receipt_number,succeeded_at,failure,checkout_session FROM bm_card_payments WHERE client_id=? AND status IN ('succeeded','processing') ORDER BY created_at DESC LIMIT 30", link.client_id)
  const invoices = await rows(db, "SELECT id FROM bm_invoices WHERE client_id=? AND status='approved' ORDER BY number DESC LIMIT 24", link.client_id)
  const superbills = (await Promise.all(invoices.map(async i => { const f = await superbillFacts(db, i.id as string); return f.missing.length ? null : { invoiceId: i.id, serviceDate: f.v.serviceDate } }))).filter(Boolean)
  const justPaid = url.searchParams.get('paid') ? payments.find(p => p.checkout_session === url.searchParams.get('paid')) : null
  const justSaved = url.searchParams.get('setup') ? await one(db, "SELECT status FROM bm_card_setups WHERE id=?", url.searchParams.get('setup')) : null
  if (!link.opened_at) await db.prepare('UPDATE bm_pay_links SET opened_at=? WHERE id=? AND opened_at IS NULL').bind(new Date().toISOString(), link.id).run()
  await commit(db, null, [audit(db, patient, 'statement.opened', link.client_id, link.id)])
  return renderPublic('pay', { clinic, client, token, purpose: link.purpose, card, ledger: await ledger(db, link.client_id), payments, superbills, block: await paymentBlock(env, db),
    justPaid: justPaid ? { amount: justPaid.amount_cents, receipt: justPaid.receipt_number ? receiptNumber(justPaid.receipt_number as number) : null, status: justPaid.status } : null,
    justSaved: justSaved?.status ?? null, error }, notice.status ?? 200)
}

async function stripeWebhook(request: Request, env: Bindings) {
  const db = env.DB, settings = await stripeSettings(db)
  if (!settings?.webhook_secret_sealed) return Response.json({ error: 'No webhook is configured' }, { status: 404, headers: noStore })
  const body = await request.text()
  if (!await verifySignature(await unseal(env, settings.webhook_secret_sealed as string), request.headers.get('stripe-signature') ?? '', body)) return Response.json({ error: 'Invalid signature' }, { status: 400, headers: noStore })
  const event = JSON.parse(body), object = event.data?.object ?? {}
  if (await one(db, 'SELECT 1 FROM bm_stripe_events WHERE id=?', event.id)) return Response.json({ received: true, duplicate: true }, { headers: noStore })
  if (String(event.type).startsWith('checkout.session.')) object.mode === 'setup' ? await syncCardSetup(env, db, object.id) : await syncCheckout(env, db, object.id)
  else if (String(event.type).startsWith('payment_intent.')) await syncIntent(env, db, object.id, object.metadata?.balm_payment)
  // Recorded after handling, so a delivery that failed part-way is handled again on Stripe's retry.
  await db.prepare('INSERT INTO bm_stripe_events(id,type,received_at) VALUES(?,?,?) ON CONFLICT DO NOTHING').bind(event.id, event.type, new Date().toISOString()).run()
  return Response.json({ received: true }, { headers: noStore })
}

/** Patient and Stripe doors, before any session is read. Null when the path is not one of them. */
export async function paymentsPublicResponse(request: Request, env: Bindings, path: string, sameOrigin: boolean): Promise<Response | null> {
  if (path === WEBHOOK_PATH && request.method === 'POST') return stripeWebhook(request, env)
  const match = path.match(/^\/pay\/([A-Za-z0-9_-]{24,64})(?:\/(statement\.pdf|superbills\/([\w-]+)\.pdf|receipts\/([\w-]+)\.pdf))?$/)
  if (!match) return null
  const [, token, file, superbill, receipt] = match, db = env.DB, url = new URL(request.url)
  let link: any
  try { link = await linkFor(db, token) } catch (error) {
    return renderPublic('missing', { error: (error as DomainError).status === 410 ? 'This link has expired. Ask the clinic to send you a new one.' : undefined }, (error as DomainError).status ?? 404)
  }
  try {
    if (file) {
      const doc = superbill ? (insist(await one(db, "SELECT 1 FROM bm_invoices WHERE id=? AND client_id=? AND status='approved'", superbill, link.client_id), 'superbill_not_found', 404), await superbillPdf(db, superbill))
        : receipt ? (insist(await one(db, 'SELECT 1 FROM bm_card_payments WHERE id=? AND client_id=?', receipt, link.client_id), 'receipt_not_found', 404), await receiptPdf(db, receipt))
          : await statementPdf(db, link.client_id)
      await commit(db, null, [audit(db, patient, superbill ? 'superbill.downloaded' : receipt ? 'receipt.downloaded' : 'statement.downloaded', link.client_id, superbill ?? receipt ?? link.id)])
      return pdfResponse(doc)
    }
    if (request.method === 'POST') {
      insist(sameOrigin, 'cross_site_request_refused', 403)
      const input = Object.fromEntries(new URLSearchParams(await request.text())), here = linkUrl(env, token)
      if (url.searchParams.get('do') === 'card') return new Response(null, { status: 303, headers: { ...noStore, location: await startCardSetup(env, db, link, here, input) } })
      const balance = (await ledger(db, link.client_id)).balanceCents, amount = parseDollars(input.amount)
      insist(balance > 0, 'there_is_nothing_to_pay', 409)
      insist(amount >= 50 && amount <= balance, 'pay_between_$0.50_and_your_balance', 400)
      return new Response(null, { status: 303, headers: { ...noStore, location: await startLinkPayment(env, db, link, here, amount) } })
    }
    return await payPage(env, db, link, token, url)
  } catch (error) {
    const failure = failureText(error)
    if (failure.status >= 500) console.error(error)
    if (failure.status === 404) return renderPublic('missing', {}, 404)
    return payPage(env, db, link, token, new URL(url.origin + url.pathname), { error: failure.text, status: failure.status })
  }
}

/** The desk's downloads: a superbill, a statement or a receipt (owner and reception). */
export async function paymentDocument(db: D1Database, who: Actor, path: string): Promise<Response | null> {
  const match = path.match(/^\/api\/balm\/(superbills|statements|receipts)\/([\w-]+)\.pdf$/)
  if (!match) return null
  need(who, 'owner', 'reception'); human(who)
  const [, kind, key] = match
  const owner = kind === 'superbills' ? await one(db, "SELECT client_id FROM bm_invoices WHERE id=? AND status='approved'", key)
    : kind === 'receipts' ? await one(db, 'SELECT client_id FROM bm_card_payments WHERE id=? AND status=?', key, 'succeeded') : await one(db, 'SELECT id AS client_id FROM bm_clients WHERE id=? AND erased_at IS NULL', key)
  insist(owner, 'not_found', 404)
  const doc = kind === 'superbills' ? await superbillPdf(db, key) : kind === 'receipts' ? await receiptPdf(db, key) : await statementPdf(db, key)
  await commit(db, who, [audit(db, who, `${kind.slice(0, -1)}.downloaded`, owner.client_id as string, key)])
  return pdfResponse(doc)
}

