// Review and sign: the author signs the exact revision they reviewed with their
// typed name and credentials; the signature records the time and the SHA-256 of
// what was signed, and the database refuses any later change to a signed note
// (migrations/core/0017_balm_charting.sql). Later changes are signed addenda.
import { documentationAlerts } from '../charting/compliance'
import { template } from '../charting/templates'
import { payerBilling, primaryUnitMethod } from '../insurance/unit-method'
import { audit, commit, guard, human, id, insist, now, one, practitionerId, sha256, stmt, text, type Actor, type Data } from './model'

const same = (a: string, b: string) => a.trim().replace(/\s+/g, ' ').toLowerCase() === b.trim().replace(/\s+/g, ' ').toLowerCase()

async function authored(db: D1Database, who: Actor, noteId: unknown) {
  human(who)
  const note = await one(db, 'SELECT * FROM bm_notes WHERE id=?', text(noteId, 'id', 100))
  insist(note && note.author_id === practitionerId(who), 'note_not_found', 404)
  const staff = (await one(db, 'SELECT name,credentials FROM bm_staff WHERE id=?', note.author_id))!
  return { note, staff }
}

/** The signer's typed name must be their own; credentials (PT, DPT · OTR/L · CCC-SLP) are required. */
function signer(staff: Data, input: Data) {
  insist(input.attest === true || input.attest === 'on', 'confirm_you_reviewed_this_note')
  const typed = text(input.signature, 'signature', 160)
  insist(same(typed, staff.name), 'type_your_full_name_as_it_appears_on_your_staff_record')
  const credentials = String(input.credentials ?? staff.credentials ?? '').trim()
  insist(credentials, 'enter_your_credentials_to_sign')
  return { name: staff.name as string, credentials: text(credentials, 'credentials', 60) }
}

/** What a signature seals: the note, the exact revision, its content and the signer, at the time of signing. */
export const signedDigest = (note: Data, revision: Data, sections: unknown, by: { name: string; credentials: string }, signedAt: string) =>
  sha256(JSON.stringify({ note: note.id, revision: revision.number, template: note.template, body: revision.body, sections, charges: revision.charges, documentation: revision.documentation, signer: by, signedAt }))

export async function signNote(db: D1Database, who: Actor, input: Data) {
  const { note, staff } = await authored(db, who, input.id)
  insist(!note.signed_at, 'note_already_signed', 409)
  // A note records care given: it is signed once its visit has started, and never for a canceled visit.
  const visit = note.appointment_id ? await one(db, 'SELECT start_at,status FROM bm_appointments WHERE id=?', note.appointment_id) : null
  if (visit) {
    insist(visit.status !== 'cancelled', 'the_visit_was_canceled_so_this_note_cannot_be_signed', 409)
    insist(Date.parse(visit.start_at as string) <= Date.now(), 'sign_the_note_once_the_visit_has_started', 409)
  }
  const latest = (await one(db, 'SELECT * FROM bm_note_revisions WHERE note_id=? ORDER BY number DESC LIMIT 1', note.id))!
  insist(input.revision !== undefined && Number(input.revision) === latest.number, 'note_changed_reload', 409)
  const t = template(note.template), sections = latest.sections ? JSON.parse(latest.sections as string) : null
  if (t) {
    const blank = t.sections.find(s => s.required && !sections.find((x: Data) => x.id === s.id)?.text)
    insist(!blank, `complete_${blank?.id}_before_signing`)
  } else insist(String(latest.body).trim(), 'note_is_empty')
  const requiredVersion = await one(db, 'SELECT COALESCE(SUM(version),0) AS total FROM bm_payer_documentation')
  const policyVersion = await one(db, 'SELECT COALESCE(SUM(version),0) AS total FROM bm_policies')
  const alerts = note.appointment_id ? await documentationAlerts(db, note.appointment_id, latest, note.template) : []
  const missing = alerts.find(a => a.blocking)
  insist(!missing, missing?.message ?? 'complete_required_documentation')
  const basis = await primaryUnitMethod(db, note.client_id as string, (visit?.start_at ?? note.created_at) as string)
  const billing = payerBilling(JSON.parse(latest.charges as string || '[]'), basis.method, basis.fixedUnitMinutes)
  if ('cmsTie' in billing && billing.cmsTie && !billing.cmsTie.resolved) {
    insist(false, `Choose exactly ${billing.cmsTie.units} tied CMS code${billing.cmsTie.units === 1 ? '' : 's'} before signing: ${billing.cmsTie.codes.join(', ')}`)
  }
  const by = signer(staff, input), signedAt = now()
  const digest = await signedDigest(note, latest, sections, by, signedAt)
  await commit(db, who, [
    ...(basis.payerId ? [guard(db, 'EXISTS(SELECT 1 FROM bm_payers WHERE id=? AND version=?)', basis.payerId, basis.payerVersion)] : []),
    guard(db, '(SELECT COALESCE(SUM(version),0) FROM bm_payer_documentation)=?', requiredVersion!.total),
    guard(db, '(SELECT COALESCE(SUM(version),0) FROM bm_policies)=?', policyVersion!.total),
    guard(db, 'NOT EXISTS(SELECT 1 FROM bm_note_revisions WHERE note_id=? AND number>?)', note.id, latest.number),
    ...(visit ? [guard(db, "EXISTS(SELECT 1 FROM bm_appointments WHERE id=? AND status!='cancelled')", note.appointment_id)] : []),
    stmt(db, 'UPDATE bm_notes SET signed_at=?,signed_revision=?,signer_name=?,signer_credentials=?,signed_sha256=? WHERE id=? AND signed_at IS NULL', signedAt, latest.number, by.name, by.credentials, digest, note.id),
    guard(db, 'EXISTS(SELECT 1 FROM bm_notes WHERE id=? AND signed_at=?)', note.id, signedAt),
    audit(db, who, 'note.signed', note.client_id as string, note.id as string, `revision ${latest.number}`),
  ])
  return { id: note.id, status: 'signed', signedAt, revision: latest.number, signer: by, sha256: digest }
}

export async function addAddendum(db: D1Database, who: Actor, input: Data) {
  const { note, staff } = await authored(db, who, input.id)
  insist(note.signed_at, 'sign_the_note_first_or_edit_the_draft', 409)
  const body = text(input.body, 'addendum', 8000), writtenAt = now(), addendumId = id()
  const by = { name: staff.name as string, credentials: (note.signer_credentials as string) || (staff.credentials as string) }
  await commit(db, who, [
    stmt(db, 'INSERT INTO bm_note_addenda(id,note_id,author_id,body,written_at,signer_name,signer_credentials,sha256) VALUES(?,?,?,?,?,?,?,?)', addendumId, note.id, note.author_id, body, writtenAt, by.name, by.credentials,
      await sha256(JSON.stringify({ note: note.id, body, signer: by, writtenAt }))),
    audit(db, who, 'note.addendum', note.client_id as string, note.id as string),
  ])
  return { id: addendumId, noteId: note.id, writtenAt }
}
