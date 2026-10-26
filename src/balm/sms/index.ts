import { baaBlock, requireBaa } from '../domain/readiness'
// Text messages to patients go through one adapter. Twilio is the first
// provider; nothing is sent until the clinic's US A2P 10DLC registration is
// approved and the deploy names the provider and its credentials.
import type { Bindings } from '../../auth.server'
import { managedInstall } from '../payments/stripe-api'
import { twilioSender } from './twilio'

export type SmsEnv = Bindings & { SMS_PROVIDER?: string; TWILIO_ACCOUNT_SID?: string; TWILIO_AUTH_TOKEN?: string; TWILIO_FROM?: string }
export type SmsMessage = { to: string; body: string }
export interface SmsSender { send(message: SmsMessage): Promise<{ id: string; status: string }> }

/** Texting is set up in the deployment's settings, which the deploy guide lists. */
export const smsNotSetUp = 'Text reminders and pay links connect once US carriers approve your clinic to text patients (a one-time business registration, called A2P 10DLC, made through a text provider such as Twilio) and that provider’s SMS_PROVIDER and TWILIO_ settings are added to your deployment (run-balm.com/docs/deploy, The settings), then you run rer deploy again. Send them by email for now.'

/** Why texts cannot be sent from this install, or null when they can. */
export async function smsBlock(env: SmsEnv) {
  const baa = await baaBlock(env.DB, 'sms')
  if (baa) return baa
  if (managedInstall(env)) return 'Texts are not available yet on RER Managed hosting: it cannot reach a text provider until RER adds a provider relay.'
  if (env.SMS_PROVIDER !== 'twilio' || !env.TWILIO_ACCOUNT_SID || !env.TWILIO_AUTH_TOKEN || !env.TWILIO_FROM) return smsNotSetUp
  return null
}

export async function smsSender(env: SmsEnv): Promise<SmsSender | null> {
  if (await smsBlock(env)) return null
  const sender=twilioSender({ accountSid: env.TWILIO_ACCOUNT_SID!, authToken: env.TWILIO_AUTH_TOKEN!, from: env.TWILIO_FROM! })
  return {async send(message) { await requireBaa(env.DB, 'sms'); return sender.send(message) }}
}

/** A US mobile number in E.164 (+1XXXXXXXXXX), or null when it is not one. */
export function usMobile(phone: unknown) {
  const raw = String(phone ?? '').trim(), digits = raw.replace(/\D/g, '')
  if (raw.startsWith('+')) return digits.length >= 11 && digits.length <= 15 ? '+' + digits : null
  if (digits.length === 10) return '+1' + digits
  if (digits.length === 11 && digits.startsWith('1')) return '+' + digits
  return null
}
