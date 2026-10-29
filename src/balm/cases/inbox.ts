import { audit, commit, guard, id, insist, now, one, rows, sha256, stmt, text, type Actor, type Data } from '../domain/model'
import { clientAuthority, messageActor, messageClient } from '../messages/access'
import { destinationGuard, staffScope } from '../messages/routing'

const enabled = (who: Actor) => who.role === 'owner' || ['reception', 'practitioner'].includes(who.staffKind ?? who.staffRole ?? '')
async function reader(db: D1Database, who: Actor) {
  const live = await messageActor(db, who)
  insist(enabled(live), 'inbox_native_staff_required', 403)
  return live
}

/** No inference changes a conversation's existing destination or readership. */
function triage(source: Data, attachments: Data[]) {
  const clinical = /\b(pain|symptom\w*|medicat\w*|diagnos\w*|treatment|exercise\w*|injur\w*|bleed\w*|numb\w*|dizz\w*)\b/i.test(source.body)
  if (source.route === 'practitioner' || clinical) return { intent: 'clinical', state: 'clinical', reason: source.route === 'practitioner' ? 'Remains in the existing clinician conversation, without a drafted answer.' : 'Clinical content needs human review. No destination or access was changed.', draft: null }
  const rules = [
    ['reschedule', /\b(reschedul\w*|move (?:my |the )?(?:visit|appointment)|change (?:my |the )?(?:visit|appointment))\b/i],
    ['billing', /\b(bill\w*|invoice\w*|payment\w*|charge\w*|copay\w*|balance)\b/i],
    ['referral', /\breferral\w*\b/i],
    ['records', /\b(records? request|request (?:my |the )?records|copy of (?:my |the )?records|medical records)\b/i],
  ] as const
  const found = rules.filter(([, pattern]) => pattern.test(source.body)).map(([intent]) => intent)
  if (found.length !== 1 || attachments.length) return { intent: 'review', state: 'review', reason: attachments.length ? 'Attached originals require human review before drafting.' : found.length > 1 ? 'More than one intent needs human review before drafting.' : 'Intent is uncertain. Human review is required before drafting.', draft: null }
  const drafts = {
    reschedule: { reply: 'We received your request to reschedule. The front desk will review available times with you.', action: 'Review current visit details and availability with the patient. No visit has been changed.' },
    billing: { reply: 'We received your billing question. The front desk will review the relevant billed items with you.', action: 'Review the patient’s billing question against the original billing records. No balance or payment has been changed.' },
    referral: { reply: 'We received your referral message. The front desk will review the referral details with you.', action: 'Review the referral original and confirm the patient and referring source. No referral has been filed.' },
    records: { reply: 'We received your records request. The clinic will review the requested records and authorized recipient with you.', action: 'Review identity, requested scope and recipient authority through the existing records process. No records have been released.' },
  }
  return { intent: found[0], state: 'prepared', reason: 'One supported administrative intent. A native human must review the cited original.', draft: drafts[found[0]] }
}

async function sourceFor(db: D1Database, who: Actor, clientId: string, messageId: unknown) {
  const client = await messageClient(db, who, clientId), scope = staffScope(who)
  const source = await one(db, `SELECT m.id,m.client_id,m.sequence,m.body,m.sent_at,m.route,m.practitioner_id
    FROM bm_messages m WHERE m.id=? AND m.client_id=? AND m.sender='patient' AND (${scope.sql})`, text(messageId, 'message', 100), clientId, ...scope.values)
  insist(source, 'message_not_found', 404)
  const attachments = await rows(db, 'SELECT id,filename,mime,byte_length FROM bm_message_attachments WHERE message_id=? ORDER BY id', source.id)
  const latest = await one(db, 'SELECT MAX(sequence) AS sequence FROM bm_messages WHERE client_id=? AND route=? AND practitioner_id IS ?', clientId, source.route, source.practitioner_id)
  const snapshot = { clientId, patientVersion: client.version, source, attachments, conversationSequence: latest!.sequence }
  return { client, source, attachments, snapshot, sourceDigest: await sha256(JSON.stringify(snapshot)) }
}

/** The source, destination and conversation watermark are fenced in the approval transaction. */
function sourceGuards(db: D1Database, who: Actor, current: Awaited<ReturnType<typeof sourceFor>>) {
  const { client, source, snapshot } = current, scope = staffScope(who)
  return [clientAuthority(db, who, client.id), destinationGuard(db, client.id, { route: source.route, practitionerId: source.practitioner_id }),
    guard(db, 'EXISTS(SELECT 1 FROM bm_clients WHERE id=? AND version=? AND erased_at IS NULL)', client.id, client.version),
    guard(db, `EXISTS(SELECT 1 FROM bm_messages m WHERE m.id=? AND m.client_id=? AND m.sender='patient' AND m.body=? AND m.sent_at=? AND m.route=? AND m.practitioner_id IS ? AND (${scope.sql}))
      AND (SELECT MAX(sequence) FROM bm_messages WHERE client_id=? AND route=? AND practitioner_id IS ?)=?`, source.id, client.id, source.body, source.sent_at, source.route, source.practitioner_id, ...scope.values, client.id, source.route, source.practitioner_id, snapshot.conversationSequence),
    guard(db, '(SELECT COUNT(*) FROM bm_message_attachments WHERE message_id=?)=?', source.id, current.attachments.length),
  ]
}

function presented(row: Data) {
  return { id: row.id, clientId: row.client_id, messageId: row.message_id, digest: row.digest, sourceDigest: row.source_digest,
    ...JSON.parse(row.payload), preparedAt: row.prepared_at, preparedBy: row.prepared_by, historical: !row.authority,
    approvedAt: row.approved_at ?? null, approvedBy: row.approved_by ?? null }
}

/** Scope is applied before counting or returning saved snippets and cited originals. */
export async function inboxFor(db: D1Database, who: Actor, clientId: string) {
  if (!enabled(who) || who.role === 'agent') return null
  const live = await reader(db, who), client = await messageClient(db, live, clientId), scope = staffScope(live)
  const found = await rows(db, `SELECT p.*,a.approved_at,a.approved_by FROM bm_inbox_preparations p
    JOIN bm_messages m ON m.id=p.message_id AND m.client_id=p.client_id
    LEFT JOIN bm_inbox_approvals a ON a.preparation_id=p.id
    WHERE p.client_id=? AND (${scope.sql}) ORDER BY p.rowid DESC`, clientId, ...scope.values)
  await commit(db, live, [clientAuthority(db, live, client.id), audit(db, live, 'inbox.read', clientId),
    ...found.flatMap(p => [audit(db, live, 'inbox.preparation_read', clientId, p.id), audit(db, live, 'message.read', clientId, p.message_id)])])
  return { total: found.length, preparations: found.map(presented) }
}

export async function inboxCommand(db: D1Database, who: Actor, name: string, input: Data) {
  const live = await reader(db, who), clientId = text(input.clientId, 'client', 100)
  insist(name === 'inbox.prepare' || name === 'inbox.approve', 'unknown_command', 404)
  if (name === 'inbox.prepare') {
    const current = await sourceFor(db, live, clientId, input.messageId)
    const payload = { ...triage(current.source, current.attachments), source: current.snapshot,
      citation: { messageId: current.source.id, href: `/app/clients/${clientId}#message-${current.source.id}`, label: 'Original incoming portal message', body: current.source.body },
      destination: { route: current.source.route, practitionerId: current.source.practitioner_id } }
    const digest = await sha256(JSON.stringify(payload)), key = id()
    await commit(db, live, [...sourceGuards(db, live, current),
      stmt(db, `INSERT INTO bm_inbox_preparations(id,client_id,message_id,source_digest,digest,payload,state,prepared_by,prepared_at)
        VALUES(?,?,?,?,?,?,?,?,?) ON CONFLICT(message_id,source_digest) DO NOTHING`, key, clientId, current.source.id, current.sourceDigest, digest, JSON.stringify(payload), payload.state, live.id, now()),
      audit(db, live, 'message.read', clientId, current.source.id), audit(db, live, 'inbox.prepared', clientId, current.source.id, digest)])
    return presented((await one(db, 'SELECT p.*,a.approved_at,a.approved_by FROM bm_inbox_preparations p LEFT JOIN bm_inbox_approvals a ON a.preparation_id=p.id WHERE p.message_id=? AND p.source_digest=?', current.source.id, current.sourceDigest))!)
  }
  insist(input.confirm === true || input.confirm === 'on', 'preparation_review_required')
  // Resolve by both patient and source scope before reading the private payload.
  await messageClient(db, live, clientId)
  const scope = staffScope(live)
  const saved = await one(db, `SELECT p.* FROM bm_inbox_preparations p JOIN bm_messages m ON m.id=p.message_id AND m.client_id=p.client_id
    WHERE p.id=? AND p.client_id=? AND (${scope.sql})`, text(input.id, 'preparation', 100), clientId, ...scope.values)
  insist(saved, 'preparation_not_found', 404)
  insist(saved.state === 'prepared' && saved.authority === 1, 'preparation_requires_human_review_or_is_historical', 409)
  insist(input.digest === saved.digest && await sha256(saved.payload) === saved.digest, 'preparation_digest_changed', 409)
  const current = await sourceFor(db, live, clientId, saved.message_id)
  insist(current.sourceDigest === saved.source_digest, 'conversation_changed_prepare_again', 409)
  await commit(db, live, [...sourceGuards(db, live, current),
    guard(db, "EXISTS(SELECT 1 FROM bm_inbox_preparations WHERE id=? AND digest=? AND authority=1 AND state='prepared')", saved.id, saved.digest),
    stmt(db, 'INSERT INTO bm_inbox_approvals(preparation_id,client_id,digest,approved_by,approved_at) VALUES(?,?,?,?,?)', saved.id, clientId, saved.digest, live.id, now()),
    audit(db, live, 'inbox.preparation_approved', clientId, saved.id, saved.digest)])
  return { id: saved.id, approved: true, digest: saved.digest, outbound: false, executed: false }
}
