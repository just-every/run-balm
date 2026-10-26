import { DomainError, type Data } from '../domain/model'
import { reportRange } from '../reports/range'

export type AccountingSource = {
  id: string; kind: string; method: string; cents: number; debit: string; credit: string
}

/** Only fixed money facts enter the handoff; invoice allocations never create cash. */
export async function accountingSources(db: D1Database, date: string): Promise<AccountingSource[]> {
  const range = await reportRange(db, { from: date, to: date })
  const timed = (sql: string) => db.prepare(sql).bind(range.start, range.end)
  const results = await db.batch<Data>([
    timed(`WITH day AS (SELECT ? AS start,? AS end)
      SELECT 'accounting_legacy_destroyed_invoice_approval_date_unavailable' AS code
      WHERE EXISTS(SELECT 1 FROM bm_destroyed_invoices WHERE approved_at IS NULL
        AND start_at>=(SELECT start FROM day) AND start_at<(SELECT end FROM day))
      UNION ALL SELECT 'accounting_legacy_destroyed_payer_source_unavailable' WHERE EXISTS(
        SELECT 1 FROM bm_destroyed_payments WHERE kind='insurance' AND accounting_prefix IS NULL
          AND remittance_id IS NULL AND card_payment_id IS NULL AND account_entry_id IS NULL
          AND recorded_at>=(SELECT start FROM day) AND recorded_at<(SELECT end FROM day))
      UNION ALL SELECT 'accounting_receipt_date_missing' WHERE
      EXISTS(SELECT 1 FROM bm_card_payments WHERE status='succeeded' AND succeeded_at IS NULL)
      OR EXISTS(SELECT 1 FROM bm_card_refunds WHERE status='confirmed' AND confirmed_at IS NULL)
      OR EXISTS(SELECT 1 FROM bm_invoices WHERE status='approved' AND approved_at IS NULL)
      UNION ALL SELECT 'accounting_invoice_void_history_unavailable' WHERE EXISTS(
        SELECT 1 FROM bm_invoices i WHERE i.status='void' AND i.approved_at IS NOT NULL
          AND (SELECT COUNT(*) FROM bm_audit a WHERE a.subject_id=i.id AND a.action='invoice.voided')<>1)`),
    timed(`SELECT 'accounting_remittance_suspense_requires_resolution_history' AS code
      WHERE EXISTS(SELECT 1 FROM (
        SELECT s.created_at FROM bm_remittance_suspense s WHERE s.paid_cents<>0
        UNION ALL SELECT r.created_at FROM bm_runout_postings r JOIN bm_remittance_suspense s
          ON s.resolved_claim=r.migrated_id AND (s.import_id=r.import_id OR s.paper_batch_id=r.paper_batch_id)
          WHERE s.paid_cents<>0) WHERE created_at>=? AND created_at<?)`),
    timed(`WITH day AS (SELECT ? AS start,? AS end)
      SELECT 'accounting_remittance_cash_does_not_reconcile' AS code FROM bm_insurance_imports m
      WHERE m.kind='835' AND m.imported_at>=(SELECT start FROM day) AND m.imported_at<(SELECT end FROM day) AND
      (m.amount_cents IS NULL OR m.amount_cents<>
        COALESCE((SELECT SUM(p.amount_cents) FROM bm_payments p
          WHERE substr(p.reference,1,length('era:'||m.payer_id||':'||m.trace||':'))='era:'||m.payer_id||':'||m.trace||':'),0)
        +COALESCE((SELECT SUM(p.amount_cents) FROM bm_destroyed_payments p WHERE p.remittance_id=m.id),0)
        +COALESCE((SELECT SUM(p.paid_cents) FROM bm_runout_postings p WHERE p.import_id=m.id),0))
      UNION ALL SELECT 'accounting_payer_batch_cash_does_not_reconcile' FROM bm_payer_payment_batches b
      WHERE b.status='closed' AND b.closed_at>=(SELECT start FROM day) AND b.closed_at<(SELECT end FROM day)
        AND (b.amount_cents<>b.paid_cents+b.interest_cents-b.recouped_cents OR b.amount_cents<>
          COALESCE((SELECT SUM(p.amount_cents) FROM bm_invoice_payments p
            WHERE substr(p.reference,1,length('payer:'||b.payer_id||':'||b.reference||':'))='payer:'||b.payer_id||':'||b.reference||':'),0)
          +COALESCE((SELECT SUM(p.amount_cents) FROM bm_destroyed_payments p WHERE p.payer_batch_id=b.id),0)
          +COALESCE((SELECT SUM(l.amount_cents) FROM bm_payer_payment_lines l WHERE l.batch_id=b.id AND l.kind='interest'),0)
          +COALESCE((SELECT SUM(p.paid_cents) FROM bm_runout_postings p WHERE p.paper_batch_id=b.id),0))`),
    timed(`SELECT 'invoice:'||id AS id,'charge' AS kind,'invoice' AS method,amount_cents AS cents,
        'receivable' AS debit,'income' AS credit FROM (
        SELECT id,amount_cents,approved_at FROM bm_invoices WHERE status IN ('approved','void')
        UNION ALL SELECT id,amount_cents,approved_at FROM bm_destroyed_invoices)
      WHERE approved_at>=? AND approved_at<?`),
    timed(`SELECT 'invoice-void:'||id AS id,'void' AS kind,'invoice' AS method,amount_cents AS cents,
        'income' AS debit,'receivable' AS credit FROM (
        SELECT i.id,i.amount_cents,a.at AS voided_at FROM bm_invoices i JOIN bm_audit a
          ON a.subject_id=i.id AND a.action='invoice.voided' WHERE i.approved_at IS NOT NULL
        UNION ALL SELECT id,amount_cents,voided_at FROM bm_destroyed_invoices WHERE approved_at IS NOT NULL)
      WHERE voided_at>=? AND voided_at<?`),
    timed(`SELECT 'card:'||id AS id,'payment' AS kind,'card' AS method,amount_cents AS cents,
        'card' AS debit,'receivable' AS credit FROM bm_card_payments
      WHERE status='succeeded' AND succeeded_at>=? AND succeeded_at<?`),
    timed(`SELECT 'payment:'||p.id AS id,'payment' AS kind,
        CASE WHEN t.method IN ('cash','check','bank') THEN t.method ELSE 'external' END AS method,
        p.amount_cents AS cents,CASE WHEN t.method='cash' THEN 'cash' ELSE 'external' END AS debit,
        'receivable' AS credit FROM bm_payments p LEFT JOIN bm_payment_tenders t ON t.payment_id=p.id
      WHERE p.card_payment_id IS NULL AND p.account_entry_id IS NULL
        AND substr(p.reference,1,4)<>'era:' AND substr(p.reference,1,6)<>'payer:'
        AND p.recorded_at>=? AND p.recorded_at<?`),
    timed(`SELECT 'payment:'||id AS id,'payment' AS kind,'era' AS method,amount_cents AS cents,
        'era' AS debit,'receivable' AS credit FROM bm_payments
      WHERE card_payment_id IS NULL AND account_entry_id IS NULL AND substr(reference,1,4)='era:'
        AND recorded_at>=? AND recorded_at<?`),
    timed(`SELECT 'payer:'||id AS id,'payment' AS kind,'era' AS method,amount_cents AS cents,
        'era' AS debit,'receivable' AS credit FROM bm_invoice_payments
      WHERE substr(reference,1,6)='payer:' AND card_payment_id IS NULL AND account_entry_id IS NULL
        AND recorded_at>=? AND recorded_at<?`),
    timed(`SELECT 'adjustment:'||id AS id,'adjustment' AS kind,'adjustment' AS method,amount_cents AS cents,
        'adjustments' AS debit,'receivable' AS credit FROM bm_invoice_adjustments
      WHERE recorded_at>=? AND recorded_at<?`),
    timed(`SELECT 'external:'||id AS id,kind,'external' AS method,
        CASE WHEN kind='refund' THEN -amount_cents ELSE amount_cents END AS cents,
        'external' AS debit,'receivable' AS credit FROM bm_posted_account_entries
      WHERE kind IN ('credit','refund') AND posted_at>=? AND posted_at<?`),
    timed(`SELECT 'refund:'||id AS id,'refund' AS kind,'card' AS method,amount_cents AS cents,
        'receivable' AS debit,'card' AS credit FROM bm_card_refunds
      WHERE status='confirmed' AND confirmed_at>=? AND confirmed_at<?`),
    db.prepare(`SELECT 'payout:'||id AS id,'payout' AS kind,'card' AS method,amount_cents AS cents,
        'bank' AS debit,'card' AS credit FROM bm_finance_sources WHERE kind='payout' AND occurred_on=?
      UNION ALL SELECT 'fee:'||id,'fee','card',fee_cents,'fees','card'
        FROM bm_finance_sources WHERE kind='payout' AND occurred_on=?`).bind(date, date),
    timed(`SELECT 'payer-interest:'||l.id AS id,'interest' AS kind,'era' AS method,l.amount_cents AS cents,
        'era' AS debit,'income' AS credit FROM bm_payer_payment_lines l
        JOIN bm_payer_payment_batches b ON b.id=l.batch_id
      WHERE l.kind='interest' AND b.status='closed' AND b.closed_at>=? AND b.closed_at<?`),
    timed(`SELECT 'runout:'||id AS id,'payment' AS kind,'era' AS method,paid_cents AS cents,
        'era' AS debit,'receivable' AS credit FROM bm_runout_postings WHERE created_at>=? AND created_at<?`),
    timed(`SELECT 'runout-adjustment:'||id AS id,'adjustment' AS kind,'adjustment' AS method,
        adjustment_cents AS cents,'adjustments' AS debit,'receivable' AS credit
      FROM bm_runout_postings WHERE created_at>=? AND created_at<?`),
    timed(`SELECT id,kind,amount_cents,tax_cents,gift_id FROM
        (SELECT id,kind,amount_cents,tax_cents,gift_id,recorded_at FROM bm_retail_sales
        UNION ALL SELECT id,kind,amount_cents,tax_cents,gift_id,recorded_at FROM bm_destroyed_retail)
      WHERE recorded_at>=? AND recorded_at<?`),
    timed(`SELECT 'card:'||id AS id,'payment' AS kind,'card' AS method,amount_cents AS cents,
        'card' AS debit,'receivable' AS credit FROM bm_destroyed_cards WHERE succeeded_at>=? AND succeeded_at<?`),
    timed(`SELECT 'refund:'||id AS id,'refund' AS kind,'card' AS method,amount_cents AS cents,
        'receivable' AS debit,'card' AS credit FROM bm_destroyed_card_refunds WHERE confirmed_at>=? AND confirmed_at<?`),
    timed(`SELECT 'external:'||id AS id,kind,'external' AS method,
        CASE WHEN kind='refund' THEN -amount_cents ELSE amount_cents END AS cents,
        'external' AS debit,'receivable' AS credit FROM bm_destroyed_account_entries
      WHERE kind IN ('credit','refund') AND posted_at>=? AND posted_at<?`),
    timed(`SELECT COALESCE(accounting_prefix,'payment')||':'||id AS id,'payment' AS kind,
        CASE WHEN kind='insurance' THEN 'era' WHEN tender_method IN ('cash','check','bank') THEN tender_method ELSE 'external' END AS method,
        amount_cents AS cents,CASE WHEN kind='insurance' THEN 'era' WHEN tender_method='cash' THEN 'cash' ELSE 'external' END AS debit,'receivable' AS credit
      FROM bm_destroyed_payments WHERE card_payment_id IS NULL AND account_entry_id IS NULL
        AND recorded_at>=? AND recorded_at<?`),
    timed(`SELECT 'adjustment:'||id AS id,'adjustment' AS kind,'adjustment' AS method,amount_cents AS cents,
        'adjustments' AS debit,'receivable' AS credit FROM bm_destroyed_adjustments WHERE recorded_at>=? AND recorded_at<?`),
  ])
  for (const result of results.slice(0, 3)) {
    if (result.results.length) throw new DomainError(String(result.results[0].code), 409)
  }
  const output: AccountingSource[] = [], seen = new Set<string>()
  const add = (source: AccountingSource) => {
    if (!Number.isSafeInteger(source.cents)) throw new DomainError('accounting_invalid_source_amount', 409)
    if (source.cents === 0) return
    if (seen.has(source.id)) throw new DomainError('accounting_duplicate_source', 409)
    seen.add(source.id)
    output.push(source.cents > 0 ? source : {
      ...source, cents: -source.cents, debit: source.credit, credit: source.debit,
    })
  }
  results.forEach((result, index) => {
    if (index < 3) return
    if (index === 16) {
      for (const sale of result.results) {
        if (!['package', 'membership', 'product', 'gift_card'].includes(sale.kind)
          || !Number.isSafeInteger(sale.amount_cents) || sale.amount_cents <= 0
          || !Number.isSafeInteger(sale.tax_cents) || sale.tax_cents < 0
          || (sale.kind !== 'product' && sale.tax_cents !== 0) || (sale.kind === 'gift_card' && sale.gift_id)) {
          throw new DomainError('accounting_invalid_retail_source', 409)
        }
        // Retail currently records completed cash sales; gift value remains deferred until redemption.
        const method = sale.gift_id ? 'gift' : 'cash', debit = sale.gift_id ? 'liability' : 'cash'
        add({ id: 'retail:'+sale.id, kind: sale.kind === 'gift_card' ? 'gift' : 'retail', method,
          cents: sale.amount_cents, debit, credit: sale.kind === 'gift_card' ? 'liability' : 'income' })
        add({ id: 'retail-tax:'+sale.id, kind: 'tax', method, cents: sale.tax_cents, debit, credit: 'tax' })
      }
    } else {
      for (const source of result.results) add({ id: source.id, kind: source.kind, method: source.method,
        cents: source.cents, debit: source.debit, credit: source.credit })
    }
  })
  return output.sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
}
