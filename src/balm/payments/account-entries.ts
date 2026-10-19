// PAY-004: immutable proposals, exact digest approval, and guarded postings.
import { hostDateAt } from '../availability/timezone'
import { clientVisible } from '../domain/clients'
import { audit, commit, day, guard, human, id, insist, integer, need, now, one, rows, sha256, stmt, text, type Actor, type Data } from '../domain/model'
import { allocateExternalCredit } from './account-credit'
import { prepareExternalReceipt } from './account-documents'
import { openInvoices, parseDollars } from './ledger'

const kinds = ['adjustment', 'write_off', 'credit', 'refund']
const basis = (e: Data) => ({ id: e.id, client_id: e.client_id, invoice_id: e.invoice_id, credit_id: e.credit_id, kind: e.kind,
  amount_cents: e.amount_cents, reason: e.reason, reference: e.reference, occurred_on: e.occurred_on, prepared_by: e.prepared_by, prepared_at: e.prepared_at })

async function validateTarget(db: D1Database, e: Data) {
  if (e.invoice_id) {
    const invoice = await one(db, "SELECT id FROM bm_invoices WHERE id=? AND client_id=? AND status='approved'", e.invoice_id, e.client_id)
    insist(invoice, 'approved_invoice_not_found', 404)
    const open = (await openInvoices(db, e.client_id)).find(i => i.id === e.invoice_id)
    insist(open && open.open_cents >= e.amount_cents, 'adjustment_exceeds_patient_invoice_balance', 409)
  }
  if (e.credit_id) {
    const credit = await one(db, 'SELECT * FROM bm_credit_balances WHERE id=? AND client_id=?', e.credit_id, e.client_id)
    insist(credit && credit.remaining_cents >= e.amount_cents, 'refund_exceeds_unused_external_credit', 409)
    insist(e.occurred_on >= credit.occurred_on, 'refund_precedes_original_receipt')
  }
}

export async function prepareAccountEntry(db: D1Database, who: Actor, input: Data) {
  human(who); need(who, 'owner', 'reception')
  const client = await clientVisible(db, who, input.clientId), kind = text(input.kind, 'entry_kind', 20)
  insist(kinds.includes(kind), 'unknown_account_entry_kind')
  const zone = (await one(db, 'SELECT time_zone FROM bm_settings WHERE id=1'))!.time_zone
  const occurredOn = day(input.occurredOn, 'transaction_date')
  insist(occurredOn <= hostDateAt(new Date(), zone), 'transaction_cannot_be_in_the_future')
  const e = { id: id(), client_id: client.id, invoice_id: ['adjustment', 'write_off'].includes(kind) ? text(input.invoiceId, 'invoice', 100) : null,
    credit_id: kind === 'refund' ? text(input.creditId, 'original_external_credit', 100) : null, kind,
    amount_cents: integer(input.amountCents ?? parseDollars(input.amount), 'amount_cents', 1, 10_000_000),
    reason: text(input.reason, 'reason', 500), reference: text(input.reference, 'external_reference', 120), occurred_on: occurredOn,
    prepared_by: who.email, prepared_at: now() }
  await validateTarget(db, e)
  const digest = await sha256(JSON.stringify(basis(e)))
  await commit(db, who, [guard(db, 'NOT EXISTS(SELECT 1 FROM bm_payments WHERE reference=?)', e.reference),
    stmt(db, `INSERT INTO bm_account_entries(id,client_id,invoice_id,credit_id,kind,amount_cents,reason,reference,occurred_on,prepared_by,prepared_at,sha256)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`, ...Object.values(e), digest), audit(db, who, 'account_entry.prepared', String(client.id), e.id, kind)])
  return { ...basis(e), sha256: digest }
}

export async function approveAccountEntry(db: D1Database, who: Actor, input: Data) {
  human(who); insist(who.role === 'owner', 'only_the_owner_approves_account_entries', 403)
  insist(input.attest === true || input.attest === 'on', 'confirm_the_exact_account_entry')
  const e = await one(db, 'SELECT * FROM bm_account_entries WHERE id=?', text(input.id, 'entry', 100))
  insist(e, 'account_entry_not_found', 404)
  await clientVisible(db, who, e.client_id)
  insist(!await one(db, 'SELECT 1 FROM bm_account_postings WHERE entry_id=?', e.id), 'account_entry_already_posted', 409)
  insist(input.sha256 === e.sha256 && await sha256(JSON.stringify(basis(e))) === e.sha256, 'account_entry_changed_review_again', 409)
  await validateTarget(db, e)
  const at = now(), receipt = ['credit', 'refund'].includes(e.kind) ? await prepareExternalReceipt(db, e, who.email, at) : null
  const statements = [stmt(db, 'INSERT INTO bm_account_postings(entry_id,approved_by,posted_at,sha256,receipt_base64) VALUES(?,?,?,?,?)', e.id, who.email, at, e.sha256, receipt)]
  if (e.invoice_id) statements.push(guard(db, `EXISTS(SELECT 1 FROM bm_invoices i WHERE i.id=? AND i.client_id=? AND i.status='approved'
    AND NOT EXISTS(SELECT 1 FROM bm_claims c WHERE c.invoice_id=i.id AND c.status NOT IN ('corrected','paid','partial'))
    AND i.amount_cents>=(SELECT COALESCE(SUM(amount_cents),0) FROM bm_payments WHERE invoice_id=i.id)
      +(SELECT COALESCE(SUM(amount_cents),0) FROM bm_invoice_adjustments WHERE invoice_id=i.id))`, e.invoice_id, e.client_id))
  if (e.kind === 'credit') statements.push(...allocateExternalCredit(db, e, await openInvoices(db, e.client_id), e.amount_cents).statements)
  if (e.kind === 'refund') statements.push(guard(db, 'EXISTS(SELECT 1 FROM bm_credit_balances WHERE id=? AND client_id=? AND remaining_cents>=0)', e.credit_id, e.client_id))
  statements.push(audit(db, who, 'account_entry.posted', e.client_id, e.id, `${e.kind}; ${e.amount_cents} cents`))
  await commit(db, who, statements)
  return { id: e.id, posted: true, kind: e.kind }
}

export async function accountEntriesFor(db: D1Database, clientId: string) {
  return { entries: await rows(db, `SELECT e.*,p.approved_by,p.posted_at FROM bm_account_entries e LEFT JOIN bm_account_postings p ON p.entry_id=e.id WHERE e.client_id=? ORDER BY e.prepared_at DESC,e.id`, clientId),
    credits: await rows(db, 'SELECT id,reference,amount_cents,remaining_cents FROM bm_credit_balances WHERE client_id=? AND remaining_cents>0 ORDER BY posted_at,id', clientId) }
}
