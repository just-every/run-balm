import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { clinic, pastVisit } from './clinic.mjs'
import { portalLogin } from './portal-billing.mjs'

export async function inboxFixture(h) {
  await h.finishSetup()
  const { service, practitioners: [priya, other] } = await clinic(h, ['Priya', 'Evan'])
  const desk = await h.staff('InboxDesk', 'reception')
  const patient = await h.cmd('client.save', { firstName: 'Synthetic', lastName: 'Inbox', dateOfBirth: '1980-01-01', email: ['synthetic-balm-701', 'patient.example'].join('@') })
  const foreign = await h.cmd('client.save', { firstName: 'Synthetic', lastName: 'Other inbox', email: ['synthetic-balm-702', 'patient.example'].join('@') })
  await pastVisit(h, patient.id, priya, service.id)
  await pastVisit(h, foreign.id, other, service.id)
  const patientCookie = await portalLogin(h, ['synthetic-balm-701', 'patient.example'].join('@'))
  const incoming = async (body, recipient = 'front_desk', extra = {}) => {
    const sent = await h.form('/portal/action', { name: 'message.send', recipient, body, clientId: foreign.id, ...extra }, patientCookie)
    assert.equal(sent.status, 303, sent.text)
    const file = (await h.send('/api/balm/clients/' + patient.id, undefined, h.owner)).value
    return file.messages.messages.findLast(m => m.sender === 'patient' && m.body === body)
  }
  const messages = {}
  for (const [intent, body, recipient] of [
    ['reschedule', 'Please reschedule my appointment.', 'front_desk'],
    ['billing', 'I have a billing question about my invoice.', 'front_desk'],
    ['referral', 'I have a new referral to share.', 'front_desk'],
    ['records', 'Please review my records request.', 'front_desk'],
    ['mixed', 'Please reschedule my appointment and explain my invoice.', 'front_desk'],
    ['unknown', 'Could somebody help with this?', 'front_desk'],
    ['clinical', 'My shoulder pain increased after the exercise.', priya.id],
    ['misdirected', 'Please reschedule. My medication is causing dizziness.', 'front_desk'],
  ]) messages[intent] = await incoming(body, recipient)
  return { patient, foreign, priya, other, desk, patientCookie, messages, incoming }
}

export async function inboxJourney(h) {
  const f = await inboxFixture(h), { patient, foreign, desk, priya, other, messages } = f
  const read = async (cookie = h.owner, clientId = patient.id) => h.send('/api/balm/clients/' + clientId + '/inbox', undefined, cookie)
  const prepare = (message, cookie = desk.cookie, clientId = patient.id) => h.cmd('inbox.prepare', { clientId, messageId: message.id }, cookie)
  const approve = (p, cookie = desk.cookie, status = 200, extra = {}) => h.cmd('inbox.approve', { clientId: patient.id, id: p.id, digest: p.digest, confirm: true, ...extra }, cookie, status)
  const effects = async () => Object.fromEntries(await Promise.all(['bm_messages', 'bm_appointments', 'bm_referrals', 'bm_record_requests', 'bm_record_packages', 'bm_invoices', 'bm_account_entries'].map(async table => [table, (await h.db.prepare('SELECT COUNT(*) n FROM ' + table).first()).n])))
  const before = await effects(), outbound = h.outboundRequests.length
  const prepared = {}
  for (const intent of ['reschedule', 'billing', 'referral', 'records']) {
    const p = prepared[intent] = await prepare(messages[intent])
    assert.equal(p.intent, intent); assert.equal(p.state, 'prepared')
    assert.equal(p.clientId, patient.id, 'posted foreign patient did not change the incoming patient identity')
    assert.deepEqual(p.destination, { route: 'front_desk', practitionerId: null })
    assert.equal(p.citation.body, messages[intent].body)
    assert.equal(p.citation.messageId, messages[intent].id)
    assert.equal(p.citation.href, '/app/clients/' + patient.id + '#message-' + messages[intent].id)
    assert.equal(createHash('sha256').update(JSON.stringify({ intent: p.intent, state: p.state, reason: p.reason, draft: p.draft, source: p.source, citation: p.citation, destination: p.destination })).digest('hex'), p.digest)
    assert.match(p.draft.reply, /received/)
    assert.match(p.draft.action, { reschedule: /availability.*No visit has been changed/, billing: /billing records.*No balance or payment/, referral: /referral original.*No referral has been filed/, records: /recipient authority.*No records have been released/ }[intent])
    assert.equal((await prepare(messages[intent])).id, p.id, 'repeated preparation keeps one original')
  }
  for (const key of ['mixed', 'unknown', 'misdirected']) {
    const p = await prepare(messages[key])
    assert.equal(p.draft, null); assert.ok(['review', 'clinical'].includes(p.state))
    await approve(p, desk.cookie, 409)
  }
  const clinicalBefore = (await h.db.prepare('SELECT * FROM bm_messages WHERE id=?').bind(messages.clinical.id).first())
  const clinical = await prepare(messages.clinical, priya.cookie)
  assert.equal(clinical.intent, 'clinical'); assert.equal(clinical.draft, null)
  assert.deepEqual(clinical.destination, { route: 'practitioner', practitionerId: priya.id })
  await approve(clinical, priya.cookie, 409)
  assert.deepEqual(await h.db.prepare('SELECT * FROM bm_messages WHERE id=?').bind(messages.clinical.id).first(), clinicalBefore)
  assert.ok(h.mail.some(m => m.subject === 'A secure message needs your attention' && m.to.includes(priya.email)), 'the clinical original reached its existing clinician')
  assert.equal((await read(desk.cookie)).value.total, 7)
  assert.equal((await read(priya.cookie)).value.total, 1)
  assert.doesNotMatch(JSON.stringify((await read(desk.cookie)).value), /shoulder pain|exercise/)
  assert.doesNotMatch(JSON.stringify((await read(priya.cookie)).value), /new referral|records request|billing question/)
  assert.equal((await read(h.owner, foreign.id)).value.total, 0)
  assert.equal((await read(other.cookie)).status, 404)
  await h.cmd('inbox.prepare', { clientId: patient.id, messageId: messages.clinical.id }, desk.cookie, 404)
  await h.cmd('inbox.prepare', { clientId: foreign.id, messageId: messages.billing.id }, h.owner, 404)
  await approve(prepared.billing, priya.cookie, 404)
  await approve(clinical, desk.cookie, 404)
  await approve(prepared.billing, desk.cookie, 409, { digest: 'synthetic-balm-changed' })
  await approve(prepared.billing, desk.cookie, 400, { confirm: false })
  const key = await h.cmd('agent.create', { label: 'Synthetic inbox refusal' })
  const agent = { authorization: 'Bearer ' + key.token }
  assert.equal((await h.send('/api/balm/agent/command', { name: 'inbox.prepare', input: { clientId: patient.id, messageId: messages.billing.id } }, '', agent)).status, 403)
  assert.equal((await h.send('/api/balm/agent/command', { name: 'inbox.approve', input: { clientId: patient.id, id: prepared.billing.id, digest: prepared.billing.digest, confirm: true } }, '', agent)).status, 403)
  assert.equal((await h.send('/api/balm/agent/clients/' + patient.id + '/inbox', undefined, '', agent)).status, 403)
  assert.equal((await read(f.patientCookie)).status, 401)
  await h.cmd('inbox.prepare', { clientId: patient.id, messageId: messages.billing.id }, f.patientCookie, 401)
  const approved = await approve(prepared.reschedule)
  assert.deepEqual([approved.approved, approved.outbound, approved.executed], [true, false, false])
  await approve(prepared.reschedule, desk.cookie, 409)
  const race = await Promise.all([0, 1].map(() => h.send('/api/balm/command', { name: 'inbox.approve', input: { clientId: patient.id, id: prepared.billing.id, digest: prepared.billing.digest, confirm: true } }, desk.cookie)))
  assert.deepEqual(race.map(r => r.status).sort(), [200, 409])
  assert.equal((await h.db.prepare('SELECT COUNT(*) n FROM bm_inbox_approvals WHERE preparation_id=?').bind(prepared.billing.id).first()).n, 1)
  await approve(prepared.referral, h.owner)
  assert.deepEqual(await effects(), before, 'preparation and approvals change no messages, bookings, referrals, records or balances')
  assert.equal(h.outboundRequests.length, outbound, 'no provider request occurs during triage or approval')
  await f.incoming('An additional invoice question for the same conversation.')
  await approve(prepared.records, desk.cookie, 409)
  const fresh = await prepare(messages.records)
  assert.notEqual(fresh.digest, prepared.records.digest)
  await h.cmd('client.save', { id: patient.id, firstName: 'Synthetic', lastName: 'Updated inbox', dateOfBirth: '1980-01-01', email: ['synthetic-balm-701', 'patient.example'].join('@') })
  await approve(fresh, desk.cookie, 409)
  const current = await prepare(messages.records)
  assert.equal((await h.form('/app/action?name=session.signout', {}, desk.cookie)).status, 303)
  await approve(current, desk.cookie, 401)
  const biller = await h.staff('InboxBiller', 'biller')
  await h.cmd('inbox.prepare', { clientId: patient.id, messageId: messages.records.id }, biller.cookie, 403)
  assert.equal((await read(biller.cookie)).status, 403)
  await h.cmd('staff.save', { id: priya.id, name: 'Priya', email: priya.email, role: 'practitioner', active: false })
  await h.cmd('inbox.prepare', { clientId: patient.id, messageId: messages.clinical.id }, priya.cookie, 403)
  await h.cmd('client.erase', { id: patient.id }, h.owner, 409)
  const audit = (await h.db.prepare("SELECT action,detail FROM bm_audit WHERE client_id=? AND action LIKE 'inbox.%'").bind(patient.id).all()).results
  assert.ok(audit.some(a => a.action === 'inbox.preparation_read'))
  assert.equal(audit.filter(a => a.action === 'inbox.preparation_approved').length, 3)
  assert.ok(audit.every(a => !a.detail.includes(messages.billing.body)))
  await assert.rejects(h.db.prepare("UPDATE bm_inbox_preparations SET payload='changed' WHERE id=?").bind(current.id).run(), /inbox_original_fixed/)
  await assert.rejects(h.db.prepare('DELETE FROM bm_inbox_preparations WHERE id=?').bind(current.id).run(), /inbox_requires_retention_review/)
}

/** Historical originals establish eligible destruction and later-journal replay fences. */
export async function historicalInbox(h, clientId) {
  const messageId = crypto.randomUUID(), preparationId = crypto.randomUUID(), at = '1990-01-02T03:00:00.000Z'
  await h.db.prepare("INSERT INTO bm_messages(id,client_id,sender,author_name,body,sent_at,notification_state,route) VALUES(?,?,'patient','Patient','Historical private billing question',?,'shown','front_desk')").bind(messageId, clientId, at).run()
  const payload = JSON.stringify({ intent: 'billing', state: 'prepared', draft: { reply: 'Historical private reply', action: 'Historical review only' }, citation: { body: 'Historical private billing question' } })
  const digest = createHash('sha256').update(payload).digest('hex')
  await h.db.prepare("INSERT INTO bm_inbox_preparations(id,client_id,message_id,source_digest,digest,payload,state,prepared_by,prepared_at) VALUES(?,?,?,'synthetic-balm-historical-source',?,?,'prepared','historical-operator',?)").bind(preparationId, clientId, messageId, digest, payload, at).run()
  await h.db.prepare("INSERT INTO bm_inbox_approvals VALUES(?,?,?,'historical-operator',?)").bind(preparationId, clientId, digest, at).run()
  return { messageId, preparationId }
}
