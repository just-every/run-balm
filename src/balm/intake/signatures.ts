import { audit, guard, id, insist, one, stmt, text, type Data } from '../domain/model'
import { consentPdf } from './consent-pdf'
import { signature } from './input'
import { currentPolicies, optionalPolicy, pendingPolicies, policiesFence, policyField } from './policies'

export async function consentStatements(db: D1Database, appointment: Data, form: Data, answers: Record<string, string | boolean>, responseId: string, input: Data, metadata: { ip?: string }, at: string) {
  const current = await currentPolicies(db), pending = await pendingPolicies(db, appointment.client_id)
  if (!pending.length) return [policiesFence(db, current)]
  const drawn = signature(input), signer = text(input.signerName, 'signer_name', 150)
  const relationship = text(input.signerRelationship, 'signer_relationship', 20)
  insist(['patient', 'parent', 'guardian'].includes(relationship), 'invalid_signer_relationship')
  const ip = (metadata.ip ?? '').slice(0, 100)
  const client = await one(db, 'SELECT first_name,last_name FROM bm_clients WHERE id=?', appointment.client_id)
  const statements = [policiesFence(db, current)]
  for (const p of pending) {
    insist(input[policyField(p.kind, 'Version')] === p.id, 'consent_policy_changed_reload', 409)
    const choice = input[policyField(p.kind, 'Accepted')]
    const accepted = choice === true || choice === 'on' || choice === 'yes'
    insist(accepted || (optionalPolicy(p.kind) && choice === 'decline'), `review_consent_${p.kind}`)
    statements.push(guard(db, 'NOT EXISTS(SELECT 1 FROM bm_intake_consents WHERE client_id=? AND policy_version=?) AND NOT EXISTS(SELECT 1 FROM bm_consent_declines WHERE client_id=? AND policy_id=?)', appointment.client_id, p.id, appointment.client_id, p.id))
    if (!accepted) {
      statements.push(stmt(db, 'INSERT INTO bm_consent_declines(client_id,policy_id,decided_at) VALUES(?,?,?)', appointment.client_id, p.id, at),
        audit(db, { email: 'consent link holder', role: 'client' }, 'consent.declined', appointment.client_id, p.id))
      continue
    }
    const pdf = consentPdf({ clinic: appointment.clinic_name, patient: `${client!.first_name} ${client!.last_name}`, formTitle: form.title,
      formVersion: String(form.number), formId: form.id, questions: form.questions, answers, policyTitle: p.title, policyVersion: p.id, policyText: p.body,
      signer, relationship, signature: drawn, signedAt: at, ip, responseId })
    const digest = [...new Uint8Array(await crypto.subtle.digest('SHA-256', pdf))].map(n => n.toString(16).padStart(2, '0')).join(''), key = id()
    statements.push(stmt(db, `INSERT INTO bm_intake_consents(id,response_id,client_id,form_id,policy_version,policy_text,signer_name,signer_relationship,signature,signed_at,signed_ip,pdf,pdf_sha256,policy_kind,policy_title) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      key, responseId, appointment.client_id, form.id, p.id, p.body, signer, relationship, JSON.stringify(drawn), at, ip, pdf, digest, p.kind, p.title),
      audit(db, { email: 'consent link holder', role: 'client' }, 'consent.signed', appointment.client_id, key, `${p.kind} v${p.version}`))
  }
  return statements
}
