// What an approved step does. Each runs through the same commands a person
// would use by hand (eligibility, claims, batches, pay links), under the
// approving person's own authority, so every fence and audit row still applies.
import type { Bindings } from '../../auth.server'
import { template } from '../charting/templates'
import { hostDateAt } from '../availability/timezone'
import { insist, one, type Actor, type Data } from '../domain/model'
import { send } from '../mail-out'
import { adapterStatus } from '../insurance/adapter'
import { prepareEligibility, submitEligibility } from '../insurance/eligibility'
import { correctClaim, prepareClaim } from '../insurance/claims'
import { prepareBatch, submitBatch } from '../insurance/batches'
import { createLink } from '../payments/links'
import { pdf } from '../payments/pdf'
import { usDay } from './stages'
import { letterFoot, supportingNote } from './steps'
import type { CaseFacts, Step } from './types'

/** A signed note as the PDF a payer reads: who, when, and the exact signed text. */
async function notePdf(db: D1Database, f: CaseFacts, note: Data) {
  const signed = await one(db, 'SELECT body FROM bm_note_revisions WHERE note_id=? AND number=?', note.id, note.signed_revision)
  insist(signed, 'note_not_found', 404)
  const visit = f.visits.find(v => v.id === note.appointment_id), title = template(note.template)?.title ?? 'Treatment note'
  const bytes = pdf({ header: f.clinic.clinic_name, title, blocks: [
    { kind: 'facts', rows: [['Patient', `${f.client.first_name} ${f.client.last_name}`], ...(f.client.date_of_birth ? [['Born', usDay(f.client.date_of_birth, f.zone)] as [string, string]] : []),
      ...(visit ? [['Date of service', usDay(visit.start_at, f.zone)] as [string, string]] : []), ['Signed', `${usDay(note.signed_at, f.zone)} by ${note.signer_name}${note.signer_credentials ? ', ' + note.signer_credentials : ''}`]] },
    { kind: 'notes', lines: String(signed.body).split('\n') },
  ] })
  return { filename: `${title.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-${note.signed_at.slice(0, 10)}.pdf`, contentType: 'application/pdf', content: bytes }
}

/** A ready claim goes into its own batch, and through the clearinghouse when one is connected. */
async function sendClaim(env: Bindings, who: Actor, claim: Data) {
  if (claim.status !== 'ready') return { claimId: claim.id, claimStatus: claim.status, held: (claim.errors ?? []).map((e: Data) => e.message) }
  const batch = await prepareBatch(env.DB, who, { claimIds: [claim.id] }), adapter = adapterStatus(env)
  if (!adapter.available) return { claimId: claim.id, batchId: batch.id, claimStatus: 'batched', line: adapter.reason }
  const sent: Data = await submitBatch(env, who, { id: batch.id })
  return { claimId: claim.id, batchId: batch.id, claimStatus: sent.status === 'submitted' ? 'submitted' : 'batched', ...(sent.status === 'submitted' ? { reference: sent.reference } : { line: sent.reason }) }
}

export async function perform(env: Bindings, who: Actor, f: CaseFacts, step: Step, wording: string): Promise<{ ok: boolean; result: Data }> {
  const db = env.DB, target = step.key.split(':')[1]
  switch (step.kind) {
    case 'eligibility.check': {
      const next = f.visits.find(v => v.status === 'booked' && Date.parse(v.start_at) >= Date.now())
      const inquiry = await prepareEligibility(db, who, { policyId: f.policy!.id, serviceDate: next ? hostDateAt(new Date(next.start_at), f.zone) : f.today })
      const adapter = adapterStatus(env)
      if (!adapter.available) return { ok: true, result: { eligibilityId: inquiry.id, status: 'prepared', line: adapter.reason } }
      const sent = await submitEligibility(env, who, { id: inquiry.id })
      return { ok: true, result: { eligibilityId: inquiry.id, status: sent.status } }
    }
    case 'authorization.request': {
      const note = supportingNote(f), body = `${step.sends!.fixed}\n\n${wording}\n\n${letterFoot(f, note)}`
      const delivery = await send(env, step.sends!.to, step.sends!.subject, body, note ? [await notePdf(db, f, note)] : undefined)
      return { ok: delivery === 'sent', result: { delivery, to: step.sends!.to, attachment: note ? step.sends!.attachment!.label : null } }
    }
    case 'claim.send': {
      const r = f.referral, claim = await prepareClaim(db, who, { appointmentId: target, policyId: f.policy!.id, ...(r.referring_npi ? { referringFirst: r.referring_first, referringLast: r.referring_last, referringNpi: r.referring_npi } : {}) })
      return { ok: true, result: await sendClaim(env, who, claim) }
    }
    case 'denial.fix': {
      const prior = f.claims.find(c => c.id === target)!
      return { ok: true, result: { replaces: prior.id, ...await sendClaim(env, who, await correctClaim(db, who, { id: prior.id, payerControl: prior.payer_control })) } }
    }
    case 'statement.send': {
      const link = await createLink(env, db, who, { clientId: f.client.id, purpose: 'balance', delivery: 'email' })
      return { ok: link.delivered === 'sent', result: { delivery: link.delivered, to: step.sends!.to, linkId: link.id } }
    }
  }
}
