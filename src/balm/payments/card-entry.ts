import type { Bindings } from '../../auth.server'
import { audit, commit, guard, id, insist, now, one, sha256, stmt, type Data } from '../domain/model'
import { intakeView } from '../domain/intake'
import { guardianActor } from '../portal/guardians'
import { portalGuard, portalToken, type Patient } from '../portal/auth'
import { consentText, liveCard, startCardSetup, syncCardSetup } from './cards'
import { paymentBlock } from './connect'

/** Read only the setup belonging to this patient and entry door. */
export async function cardEntryView(env: Bindings, clientId: string, source: string, setupId?: string | null) {
  if (setupId && await one(env.DB, 'SELECT 1 FROM bm_card_setups WHERE id=? AND client_id=? AND source=?', setupId, clientId, source)) await syncCardSetup(env, env.DB, setupId)
  const clinic = await one(env.DB, 'SELECT clinic_name FROM bm_settings WHERE id=1')
  const card = await liveCard(env.DB, clientId)
  return { card: card ? { brand: card.brand, last4: card.last4 } : null, consent: consentText(String(clinic!.clinic_name)), block: await paymentBlock(env, env.DB) }
}

async function begin(env: Bindings, clientId: string, source: string, actor: { email: string; role: string }, expiresAt: string, returnUrl: string, input: Data, authority: D1PreparedStatement[]) {
  insist(input.consent === 'on' || input.consent === true, 'tick_the_authorization_to_save_a_card')
  const db = env.DB, linkId = id(), token = portalToken()
  const reservation = [...authority,
    stmt(db, 'INSERT INTO bm_pay_links(id,token_hash,client_id,purpose,created_by,created_at,expires_at,delivery,delivery_result) VALUES(?,?,?,?,?,?,?,?,?)', linkId, await sha256(token), clientId, 'card', actor.email, now(), expiresAt, 'shown', source),
    audit(db, actor, 'card.entry_authorized', clientId, linkId, source),
  ]
  // Reserve the patient-bound entry before requesting hosted fields. No raw card input is accepted.
  await commit(db, null, reservation)
  return startCardSetup(env, db, { id: linkId, client_id: clientId, source, actor }, returnUrl, input, authority)
}

export async function intakeCardEntry(env: Bindings, token: string, input: Data) {
  const { appointment } = await intakeView(env.DB, token)
  const tokenHash = await sha256(token), at = now()
  return begin(env, appointment.client_id, 'intake', { email: 'intake link holder', role: 'patient' }, appointment.end_at, new URL('/intake/' + token, env.AUTH_ORIGIN).href, input, [
    guard(env.DB, "EXISTS(SELECT 1 FROM bm_appointments a JOIN bm_clients c ON c.id=a.client_id WHERE a.id=? AND a.client_id=? AND a.intake_token_hash=? AND a.status='booked' AND a.end_at>? AND c.erased_at IS NULL)", appointment.id, appointment.client_id, tokenHash, at),
  ])
}

export async function portalCardEntry(env: Bindings, patient: Patient, input: Data) {
  const url = await begin(env, patient.clientId, 'portal', guardianActor(patient), patient.expiresAt, new URL('/portal/home', env.AUTH_ORIGIN).href, input, [portalGuard(env.DB, patient)])
  return { redirect: url }
}
