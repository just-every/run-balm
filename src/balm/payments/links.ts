// A patient's private link (/pay/<token>): their statement across visits, a way
// to pay any balance, receipts and superbills, and the form that saves a card on
// file. The token is shown or sent once and kept only as its hash; it lasts 30 days.
import { runtimeBindings } from '../../auth.server'
import { clientVisible } from '../domain/clients'
import { audit, commit, human, id, insist, need, now, one, sha256, stmt, type Actor, type Data } from '../domain/model'
import type { SmsEnv } from '../sms'
import { ledger } from './ledger'
import { deliverLink } from './notify'

const DAYS = 30
const token = () => btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(24)))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
export const linkUrl = (env: SmsEnv, value: string) => new URL('/pay/' + value, runtimeBindings(env).AUTH_ORIGIN).href

/** The desk makes a link and sends it by email or text, or opens it here for the patient. */
export async function createLink(env: SmsEnv, db: D1Database, who: Actor, input: Data) {
  need(who, 'owner', 'reception'); human(who)
  const client = await clientVisible(db, who, input.clientId)
  const purpose = input.purpose === 'card' ? 'card' : 'balance', delivery = ['email', 'text', 'shown'].includes(input.delivery) ? input.delivery : 'email'
  const balance = (await ledger(db, client.id as string)).balanceCents
  if (purpose === 'balance' && delivery !== 'shown') insist(balance > 0, 'there_is_no_balance_to_pay', 409)
  if (delivery === 'email') insist(client.email, 'the_patient_has_no_email_address', 409)
  const value = token(), linkId = id(), url = linkUrl(env, value)
  const result = delivery === 'shown' ? 'shown' : await deliverLink(env, db, client.id as string, url, purpose, delivery, balance)
  insist(delivery === 'shown' || result === 'sent', result === 'texts_unavailable' ? 'texts_are_not_available_on_this_install' : result === 'no_mobile_number' ? 'the_patient_has_no_us_mobile_number' : 'the_link_could_not_be_sent_check_the_mail_settings', 409)
  await commit(db, who, [
    stmt(db, 'INSERT INTO bm_pay_links(id,token_hash,client_id,purpose,created_by,created_at,expires_at,delivery,delivery_result) VALUES(?,?,?,?,?,?,?,?,?)',
      linkId, await sha256(value), client.id, purpose, who.email, now(), new Date(Date.now() + DAYS * 86400_000).toISOString(), delivery, result),
    audit(db, who, `paylink.${delivery === 'shown' ? 'opened_at_desk' : 'sent'}`, client.id as string, linkId, `${purpose}; ${delivery}`),
  ])
  return { id: linkId, purpose, delivery, delivered: result, ...(delivery === 'shown' ? { url } : {}) }
}

/** The live link for a token, or a 404 for anything else (unknown, expired, erased patient). */
export async function linkFor(db: D1Database, value: string) {
  const link = await one(db, `SELECT l.* FROM bm_pay_links l JOIN bm_clients c ON c.id=l.client_id WHERE l.token_hash=? AND c.erased_at IS NULL`, await sha256(value))
  insist(link, 'link_not_found', 404)
  insist(Date.parse(link.expires_at as string) > Date.now(), 'link_expired', 410)
  return link
}
