import { clientVisible } from '../domain/clients'
import { audit, commit, guard, human, id, insist, integer, now, one, practitionerId, rows, stmt, text, type Actor, type Data } from '../domain/model'
import { photo } from './input'
import { consentStatements } from './signatures'
import { pendingPolicies } from './policies'

export type IntakeMetadata = { ip?: string }

/** Prepared inside submitIntake's transaction, so a signature cannot be orphaned. */
export async function intakeRecordStatements(db: D1Database, appointment: Data, form: Data, answers: Record<string, string | boolean>, responseId: string, input: Data, metadata: IntakeMetadata, at: string) {
  const statements = await consentStatements(db, appointment, form, answers, responseId, input, metadata, at)
  const front = photo(input.insuranceFront), back = photo(input.insuranceBack)
  if (front || back || ['insurancePayer', 'insuranceMemberId', 'insuranceGroup', 'insuranceSubscriber'].some(k => !!input[k])) {
    const fields = insuranceFields(input, 'insurance')
    const insuranceId = id()
    statements.push(stmt(db, `INSERT INTO bm_intake_insurance(id,response_id,client_id,payer,member_id,group_number,subscriber_name,relationship,front,front_mime,back,back_mime,received_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      insuranceId, responseId, appointment.client_id, fields.payer, fields.memberId, fields.group, fields.subscriber, fields.relationship,
      front?.bytes ?? null, front?.mime ?? null, back?.bytes ?? null, back?.mime ?? null, at),
      audit(db, { email: 'intake link holder', role: 'client' }, 'insurance.submitted', appointment.client_id, insuranceId))
  }
  return statements
}

export function insuranceFields(input: Data, prefix = '') {
  const get = (key: string) => input[prefix ? prefix + key[0].toUpperCase() + key.slice(1) : key]
  const relationship = text(get('relationship'), 'subscriber_relationship', 40)
  insist(['self', 'spouse', 'child', 'other'].includes(relationship), 'invalid_subscriber_relationship')
  return { payer: text(get('payer'), 'payer', 150), memberId: text(get('memberId'), 'member_id', 100), group: typeof get('group') === 'string' ? get('group').trim().slice(0,100) : '',
    subscriber: text(get('subscriber'), 'subscriber', 150), relationship }
}

/** Clinical documents are narrower than the administrative insurance panel. */
export async function clinicalClient(db: D1Database, who: Actor, clientId: string, appointmentId?: string) {
  human(who)
  insist(who.role === 'owner' || practitionerId(who), 'clinical_access_required', 403)
  await clientVisible(db, who, clientId)
  if (who.role !== 'owner') insist(await one(db, `SELECT 1 FROM bm_appointments WHERE client_id=? AND practitioner_id=?${appointmentId ? ' AND id=?' : ''}`, clientId, practitionerId(who), ...(appointmentId ? [appointmentId] : [])), 'document_not_found', 404)
}

export async function intakeChart(db: D1Database, who: Actor, clientId: string) {
  human(who); await clientVisible(db, who, clientId)
  const clinical = who.role === 'owner' || !!practitionerId(who)
  const consents = clinical ? await rows(db, `SELECT c.id,c.response_id,c.policy_version,(SELECT version FROM bm_consent_policies WHERE id=c.policy_version) AS policy_number,c.policy_title,c.policy_kind,c.signer_name,c.signer_relationship,c.signed_at,c.pdf_sha256 FROM bm_intake_consents c JOIN bm_intake_responses r ON r.id=c.response_id JOIN bm_appointments a ON a.id=r.appointment_id WHERE c.client_id=? AND (?='owner' OR a.practitioner_id=?) ORDER BY c.signed_at DESC`, clientId, who.role, practitionerId(who) ?? '') : null
  const insurance = await rows(db, `SELECT id,payer,member_id,group_number,subscriber_name,relationship,front IS NOT NULL AS has_front,back IS NOT NULL AS has_back,received_at,version,verified_at,verified_by,ai_draft,ai_read_at FROM bm_intake_insurance WHERE client_id=? ORDER BY received_at DESC`, clientId)
  await commit(db, who, [audit(db, who, 'insurance.read', clientId), ...(consents ?? []).map(c => audit(db, who, 'consent.read', clientId, c.id))])
  return { consents, pendingPolicies: clinical ? await pendingPolicies(db, clientId) : [], insurance: insurance.map(i => ({ ...i, ai_draft: i.ai_draft ? JSON.parse(i.ai_draft) : null })) }
}

export async function consentDocument(db: D1Database, who: Actor, key: unknown) {
  human(who)
  const row = await one(db, `SELECT c.*,r.appointment_id FROM bm_intake_consents c JOIN bm_intake_responses r ON r.id=c.response_id WHERE c.id=?`, text(key, 'document', 100))
  insist(row, 'document_not_found', 404)
  await clinicalClient(db, who, row.client_id, row.appointment_id)
  await commit(db, who, [audit(db, who, 'consent.downloaded', row.client_id, row.id)])
  return { bytes: new Uint8Array(row.pdf), mime: 'application/pdf', filename: `signed-consent-${row.id}.pdf` }
}

export async function insuranceRecord(db: D1Database, who: Actor, key: unknown) {
  human(who)
  const row = await one(db, 'SELECT * FROM bm_intake_insurance WHERE id=?', text(key, 'insurance', 100))
  insist(row, 'insurance_not_found', 404); await clientVisible(db, who, row.client_id)
  return row
}

export async function insurancePhoto(db: D1Database, who: Actor, key: unknown, side: unknown) {
  insist(side === 'front' || side === 'back', 'invalid_card_side')
  const row = await insuranceRecord(db, who, key); insist(row[side], 'photo_not_found', 404)
  await commit(db, who, [audit(db, who, 'insurance.photo_downloaded', row.client_id, row.id, side)])
  return { bytes: new Uint8Array(row[side]), mime: row[side + '_mime'] as string, filename: `insurance-${side}-${row.id}.${row[side + '_mime'] === 'image/jpeg' ? 'jpg' : row[side + '_mime'] === 'image/png' ? 'png' : 'webp'}` }
}

export async function verifyInsurance(db: D1Database, who: Actor, input: Data) {
  const row = await insuranceRecord(db, who, input.id), fields = insuranceFields(input)
  insist(input.confirm === true || input.confirm === 'on', 'confirm_you_checked_the_card')
  const version = integer(input.version, 'version', 1, 1000000)
  await commit(db, who, [guard(db, 'EXISTS(SELECT 1 FROM bm_intake_insurance WHERE id=? AND version=?)', row.id, version),
    stmt(db, 'UPDATE bm_intake_insurance SET payer=?,member_id=?,group_number=?,subscriber_name=?,relationship=?,verified_at=?,verified_by=?,version=version+1 WHERE id=?', fields.payer, fields.memberId, fields.group, fields.subscriber, fields.relationship, now(), who.email, row.id),
    audit(db, who, 'insurance.verified', row.client_id, row.id)])
  return { id: row.id, verified: true }
}
