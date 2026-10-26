import type { Bindings } from '../../auth.server'
import { audit, commit, day, guard, id, insist, now, one, rows, sha256, stmt, type Actor, type Data } from '../domain/model'
import { accountingCall, accountingConnection, accountingToken } from './accounting-api'
import { accountingSources } from './accounting-sources'

const signature = (journal: Data) => JSON.stringify({ date: journal.TxnDate, number: journal.DocNumber, lines: (journal.Line ?? []).map((l: Data) => [l.Description ?? '', Math.round(Number(l.Amount) * 100), l.JournalEntryLineDetail?.PostingType, String(l.JournalEntryLineDetail?.AccountRef?.value)]).sort((a: unknown[], b: unknown[]) => JSON.stringify(a).localeCompare(JSON.stringify(b))) })

async function confirmReadback(env: Bindings, who: Actor, c: Data, token: string, batch: Data, providerId: string) {
  const actual = (await accountingCall(c, token, 'journalentry/' + encodeURIComponent(providerId))).JournalEntry
  if (!actual || signature(actual) !== signature(JSON.parse(batch.payload))) {
    await commit(env.DB, who, [stmt(env.DB, "UPDATE bm_accounting_batches SET status='conflict',error='The books differ from the saved journal. Owner reconciliation required.' WHERE id=?", batch.id), audit(env.DB, who, 'accounting.conflict', null, batch.id)])
    insist(false, 'The books differ from the saved journal. Reconcile the existing entry in QuickBooks; Balm will not create a replacement.', 409)
  }
  await commit(env.DB, who, [stmt(env.DB, "UPDATE bm_accounting_batches SET status='confirmed',provider_id=?,confirmed_at=?,error=NULL WHERE id=?", providerId, now(), batch.id), audit(env.DB, who, 'accounting.readback_confirmed', null, batch.id)])
  return { id: batch.id, status: 'confirmed', providerId }
}

export async function prepareAccounting(env: Bindings, who: Actor, input: Data) {
  const date = day(input.day, 'day'), c = await accountingConnection(env.DB)
  insist(c?.mappings, 'Connect QuickBooks and review every account mapping first.', 409)
  const token = await accountingToken(env, who, c)
  const prior = await rows(env.DB, "SELECT * FROM bm_accounting_batches WHERE realm_id=? AND sandbox=? AND day=? AND status<>'prepared' ORDER BY prepared_at", c.realm_id, c.sandbox, date)
  for (const batch of prior) {
    insist(batch.provider_id, 'Resume the pending batch before preparing another handoff for this day.', 409)
    await confirmReadback(env, who, c, token, batch, batch.provider_id)
  }
  const sources = await accountingSources(env.DB, date)
  const claims = await rows(env.DB, 'SELECT s.* FROM bm_accounting_claims s JOIN bm_accounting_batches b ON b.id=s.batch_id WHERE s.realm_id=? AND s.sandbox=? AND b.day=?', c.realm_id, c.sandbox, date)
  for (const claim of claims) insist(sources.some(s => s.id === claim.source_id && JSON.stringify(s) === claim.source_json), 'An exported source changed. Reconcile the original batch before continuing.', 409)
  const pending = sources.filter(s => !claims.some(c => c.source_id === s.id))
  if (!pending.length) return { status: 'up_to_date', day: date, entries: prior.length, sources: sources.length }
  const mappings = JSON.parse(c.mappings), key = id(), grouped = new Map<string, number>()
  for (const source of pending) {
    insist(mappings[source.debit] && mappings[source.credit], 'Review all required account mappings.', 409)
    const group = JSON.stringify([source.kind, source.method, source.debit, source.credit])
    grouped.set(group, (grouped.get(group) ?? 0) + source.cents)
  }
  const Line = [...grouped].flatMap(([key, cents]) => {
    const [kind, method, debit, credit] = JSON.parse(key)
    return [['Debit', debit], ['Credit', credit]].map(([PostingType, account]) => ({ Description: `${kind} · ${method}`, Amount: cents / 100, DetailType: 'JournalEntryLineDetail', JournalEntryLineDetail: { PostingType, AccountRef: { value: mappings[account] } } }))
  })
  insist(Line.length <= 1000, 'This day needs a smaller accounting batch before it can be sent.', 409)
  const payload = JSON.stringify({ TxnDate: date, DocNumber: 'BM-' + key.replaceAll('-', '').slice(0, 18), PrivateNote: 'Balm daily accounting handoff', Line }), sourceJson = JSON.stringify(pending)
  const digest = await sha256(payload + sourceJson)
  await commit(env.DB, who, [guard(env.DB, 'EXISTS(SELECT 1 FROM bm_accounting_connection WHERE id=1 AND version=?)', c.version), stmt(env.DB, "INSERT INTO bm_accounting_batches(id,realm_id,sandbox,day,connection_version,payload,sources,sha256,status,prepared_at) VALUES(?,?,?,?,?,?,?,?,'prepared',?)", key, c.realm_id, c.sandbox, date, c.version, payload, sourceJson, digest, now()), audit(env.DB, who, 'accounting.prepared', null, key, date)])
  return { id: key, sha256: digest, day: date, status: 'prepared', sources: pending.length, lines: Line }
}

export async function syncAccounting(env: Bindings, who: Actor, input: Data) {
  const batch = await one(env.DB, 'SELECT * FROM bm_accounting_batches WHERE id=?', input.id), c = await accountingConnection(env.DB)
  insist(batch && c && batch.realm_id === c.realm_id && batch.sandbox === c.sandbox, 'Connect the original QuickBooks company to resume this batch.', 409)
  insist(input.confirm === true || input.confirm === 'on', 'Review the journal and explicitly approve sending it to QuickBooks.')
  insist(batch.sha256 === input.sha256 && batch.sha256 === await sha256(batch.payload + batch.sources), 'The reviewed journal digest changed.', 409)
  const token = await accountingToken(env, who, c)
  if (batch.provider_id) return confirmReadback(env, who, c, token, batch, batch.provider_id)
  if (batch.status !== 'prepared') {
    const document = JSON.parse(batch.payload).DocNumber
    const recovered = (await accountingCall(c, token, 'query?query=' + encodeURIComponent(`select * from JournalEntry where DocNumber = '${document}'`))).QueryResponse?.JournalEntry ?? []
    insist(recovered.length <= 1, 'More than one matching journal exists. Reconcile QuickBooks before continuing.', 409)
    if (recovered.length) return confirmReadback(env, who, c, token, batch, String(recovered[0].Id))
    insist(Date.now() - Date.parse(batch.attempted_at) < 86_400_000, 'The old uncertain send has no matching journal. Owner reconciliation is required; Balm will not send a new request.', 409)
  }
  if (batch.status === 'prepared') {
    insist(batch.connection_version === c.version, 'Mappings changed. Prepare a new journal before sending.', 409)
    const epoch = await one(env.DB, 'SELECT version FROM bm_retention_epoch WHERE id=1')
    const current = await accountingSources(env.DB, batch.day), frozen: Data[] = JSON.parse(batch.sources)
    insist(frozen.every(s => current.some(v => v.id === s.id && JSON.stringify(v) === JSON.stringify(s))), 'Recorded money changed. Prepare a new journal before sending.', 409)
    await commit(env.DB, who, [guard(env.DB, 'EXISTS(SELECT 1 FROM bm_accounting_connection WHERE id=1 AND version=?)', c.version), guard(env.DB, 'EXISTS(SELECT 1 FROM bm_retention_epoch WHERE id=1 AND version=?)', epoch!.version),
      ...frozen.map(s => stmt(env.DB, 'INSERT INTO bm_accounting_claims(realm_id,sandbox,source_id,source_json,batch_id) VALUES(?,?,?,?,?)', c.realm_id, c.sandbox, s.id, JSON.stringify(s), batch.id)),
      stmt(env.DB, "UPDATE bm_accounting_batches SET status='sending',approved_by=?,attempted_at=? WHERE id=? AND status='prepared'", who.email, now(), batch.id), guard(env.DB, 'changes()=1'), audit(env.DB, who, 'accounting.send_approved', null, batch.id, batch.sha256)])
  }
  // The saved request id and body survive an uncertain response and a process restart.
  await commit(env.DB, who, [guard(env.DB, 'EXISTS(SELECT 1 FROM bm_accounting_connection WHERE id=1 AND version=?)', c.version), guard(env.DB, "EXISTS(SELECT 1 FROM bm_accounting_batches WHERE id=? AND status='sending')", batch.id), audit(env.DB, who, 'accounting.send_attempted', null, batch.id)])
  const result = await accountingCall(c, token, 'journalentry', JSON.parse(batch.payload), batch.id)
  insist(result.JournalEntry?.Id, 'QuickBooks did not return a journal identity. Resume this saved batch.', 409)
  return confirmReadback(env, who, c, token, batch, String(result.JournalEntry.Id))
}
