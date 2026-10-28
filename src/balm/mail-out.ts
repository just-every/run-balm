import { baaBlock } from './domain/readiness'
// Mail Balm sends to clients through the clinic's own mail provider: the
// intake link, waitlist offers, "that time is taken" notices, the
// confirmation of an accepted offer, pay links and receipts (payments/notify.ts),
// and a plan of care's signing link to the referring physician.
// Text messages wait for an SMS provider.
import type { Bindings } from '../auth.server'
import { operatorMail } from '../mail.server.mjs'
import { localTime } from './domain/invoices'
import type { OfferMail } from './domain/waitlist'
import { dispatchPatientMail, submissionDelivery } from './mail/dispatch'
import { sendVisitChange } from './mail/changes'

export type Delivery = 'sent' | 'suppressed' | 'no_email' | 'mail_unavailable'
const escape = (value: string) => value.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!))

export async function send(env: Bindings, to: string | null | undefined, subject: string, text: string, attachments?: { filename: string; contentType: string; content: Uint8Array }[]): Promise<Delivery> {
  if (!to) return 'no_email'
  if (env.AUTH_LOCAL === 'true' || env.RER_DEMO === '1') return 'suppressed'
  if (await baaBlock(env.DB, 'mail')) return 'mail_unavailable'
  const sender = operatorMail(env)
  if (!sender || !env.MAIL_FROM) return 'mail_unavailable'
  const html = text.split('\n\n').map(part => `<p>${escape(part).replace(/\n/g, '<br>')}</p>`).join('')
  try {
    const result: any = await sender.send({ deliveryId: crypto.randomUUID(), from: env.MAIL_FROM, to: [to], subject, text, html, headers: { 'Auto-Submitted': 'auto-generated' }, ...(attachments ? { attachments } : {}) })
    return result?.status === 'accepted' ? 'sent' : result?.status === 'development' ? 'suppressed' : 'mail_unavailable'
  } catch { return 'mail_unavailable' }
}
const clinicRow = (env: Bindings) => env.DB.prepare('SELECT clinic_name,time_zone FROM bm_settings WHERE id=1').first<{ clinic_name: string; time_zone: string }>()
const link = (env: Bindings, path: string) => new URL(path, env.AUTH_ORIGIN).href

/** The intake link for a booking, to the file's address or `to`: the address a public booking typed, which a new file may hold back (bookOnline). */
export async function sendIntake(env: Bindings, clientId: string, token: string, startAt: string, opening = 'Your appointment is booked', appointmentIds: string[] = [], to?: string): Promise<Delivery> {
  const row = await env.DB.prepare('SELECT c.email,c.first_name,s.clinic_name,s.time_zone FROM bm_clients c, bm_settings s WHERE c.id=?').bind(clientId).first<any>()
  if (!row) return 'no_email'
  return submissionDelivery(await dispatchPatientMail(env, to ?? row.email, `Your appointment at ${row.clinic_name}: intake form`,
    `Hello ${row.first_name},\n\n${opening} for ${localTime(startAt, row.time_zone)}.\n\nPlease complete your intake form before your visit:\n${link(env, '/intake/' + token)}\n\nThis link is private to you.\n`, { clientId, appointmentIds, kind: 'intake' }))
}

/** A booking for a client whose intake is already on file or already asked for: the time only. */
export async function sendBooked(env: Bindings, clientId: string, startAt: string, visits = 1, appointmentIds: string[] = [], to?: string): Promise<Delivery> {
  const row = await env.DB.prepare('SELECT c.email,c.first_name,s.clinic_name,s.time_zone FROM bm_clients c, bm_settings s WHERE c.id=?').bind(clientId).first<any>()
  if (!row) return 'no_email'
  return submissionDelivery(await dispatchPatientMail(env, to ?? row.email, `Your appointment at ${row.clinic_name}`,
    `Hello ${row.first_name},\n\n${visits === 1 ? 'Your appointment is booked' : `Your ${visits} appointments are booked. The first is`} for ${localTime(startAt, row.time_zone)}.\n\nNo new intake form is needed.\n`, { clientId, appointmentIds, kind: 'booking' }))
}

export async function sendOffer(env: Bindings, offer: OfferMail): Promise<Delivery> {
  const clinic = await clinicRow(env)
  return send(env, offer.email, `A time opened up at ${clinic!.clinic_name}`,
    `Hello ${offer.firstName},\n\nYou are on ${clinic!.clinic_name}'s waitlist, and a time has opened up: ${offer.service} with ${offer.practitioner} on ${localTime(offer.startAt, clinic!.time_zone)}.\n\n${offer.expiresAt ? 'This time is held for you until ' + localTime(offer.expiresAt, clinic!.time_zone) + '. After that, the next matching patient gets a turn.' : 'The first person to accept gets it:'}\n${link(env, '/offer/' + offer.token)}\n\nIf your turn expires, you stay on the waitlist. We will tell you when this opening is taken.\n`)
}

export async function sendTaken(env: Bindings, row: { email: string; first_name: string; start_at: string; service: string }): Promise<Delivery> {
  const clinic = await clinicRow(env)
  return send(env, row.email, `That time at ${clinic!.clinic_name} has been taken`,
    `Hello ${row.first_name},\n\nThe ${row.service} time on ${localTime(row.start_at, clinic!.time_zone)} has been taken by someone else on the waitlist.\n\nYou are still on the waitlist, and we will email you when another time opens up.\n`)
}

/** The physician gets only the clinic's name and the private link; the plan itself stays behind the link. */
export async function sendPlanLink(env: Bindings, to: string, token: string): Promise<Delivery> {
  const clinic = await clinicRow(env)
  return send(env, to, `Plan of care to sign from ${clinic!.clinic_name}`,
    `Hello,\n\n${clinic!.clinic_name} asks you to review and sign a therapy plan of care for a patient you referred.\n\nOpen the plan and sign it here (no account needed):\n${link(env, '/plan/' + token)}\n\nThis link is private to you and expires in 30 days.\n`)
}

/** The patient hears about canceled dates in one message. */
export const sendCanceled = (env: Bindings, appointmentIds: string[]): Promise<Delivery> => sendVisitChange(env, appointmentIds, 'cancelled')
