import type { Bindings } from '../../auth.server'
import { operatorMail } from '../../mail.server.mjs'

export type MailContext = { clientId: string; appointmentIds: string[]; kind: 'booking' | 'intake' | 'moved' | 'cancelled' | 'reminder'; deliveryId?: string }
export type Submission = { deliveryId: string; state: string; providerMessageId: string | null }
export const mailTenant = 'balm'
export function mailNamespace(env: Bindings, provider = env.MAIL_PROVIDER) {
  return provider === 'resend' ? env.BALM_RESEND_EVENT_NAMESPACE ?? '' : provider === 'sendgrid' ? env.BALM_SENDGRID_EVENT_NAMESPACE ?? '' : ''
}
export const mailHtml = (text: string) => text.split('\n\n').map(part => `<p>${part.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!)).replace(/\n/g, '<br>')}</p>`).join('')

/** Persist the recipient and visit association before making exactly one provider call. */
export async function dispatchPatientMail(env: Bindings, to: string | null | undefined, subject: string, text: string, context: MailContext): Promise<Submission> {
  const deliveryId = context.deliveryId ?? crypto.randomUUID(), provider = env.MAIL_PROVIDER ?? 'unconfigured'
  const inserted = await env.DB.prepare(`INSERT INTO bm_mail_attempts(id,client_id,kind,provider,tenant_id,event_namespace,recipient,submission_state,created_at)
    VALUES(?,?,?,?,?,?,?,'sending',?) ON CONFLICT(id) DO NOTHING RETURNING id`).bind(deliveryId, context.clientId, context.kind, provider, mailTenant, mailNamespace(env), to ?? '', new Date().toISOString()).first()
  if (!inserted) return (await env.DB.prepare('SELECT id AS deliveryId,submission_state AS state,provider_message_id AS providerMessageId FROM bm_mail_attempts WHERE id=?').bind(deliveryId).first<Submission>())!
  if (context.appointmentIds.length) await env.DB.batch(context.appointmentIds.map(appointmentId => env.DB.prepare('INSERT INTO bm_mail_attempt_visits(delivery_id,appointment_id) VALUES(?,?)').bind(deliveryId, appointmentId)))
  let state = 'failed', providerMessageId: string | null = null
  if (!to) state = 'no_email'
  else if (env.AUTH_LOCAL === 'true' || env.RER_DEMO === '1') state = 'suppressed'
  else {
    const sender = operatorMail(env)
    if (!sender || !env.MAIL_FROM) state = 'unavailable'
    else try {
      const result: any = await sender.send({ deliveryId, from: env.MAIL_FROM, to: [to], subject, text, html: mailHtml(text), headers: { 'Auto-Submitted': 'auto-generated' } })
      state = result?.status === 'accepted' ? 'accepted' : result?.status === 'development' ? 'suppressed' : result?.status === 'uncertain' ? 'uncertain' : 'failed'
      providerMessageId = result?.providerMessageId ?? null
    } catch (error) { state = (error as any)?.outcome === 'rejected' || (error as any)?.name === 'MailValidationError' ? 'failed' : 'uncertain' }
  }
  await env.DB.prepare("UPDATE bm_mail_attempts SET submission_state=?,provider_message_id=?,completed_at=? WHERE id=? AND submission_state='sending'").bind(state, providerMessageId, new Date().toISOString(), deliveryId).run()
  return { deliveryId, state, providerMessageId }
}

export const submissionDelivery = (result: Submission) => result.state === 'accepted' ? 'sent' : result.state === 'suppressed' ? 'suppressed' : result.state === 'no_email' ? 'no_email' : 'mail_unavailable'
