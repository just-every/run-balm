import type { Bindings } from '../../auth.server'
// @ts-expect-error The pinned Base mail module ships JavaScript without declarations.
import { createDeliveryEventIntake, createD1EventStore } from '../../modules/mail/index.mjs'
import { mailNamespace, mailTenant } from './dispatch'

const limit = 1024 * 1024
const reply = (status: number) => Response.json(status === 200 ? { received: true } : { error: 'Delivery event was not accepted' }, { status, headers: { 'cache-control': 'no-store' } })
async function rawBytes(request: Request) {
  if (Number(request.headers.get('content-length') ?? 0) > limit) return null
  const reader = request.body?.getReader()
  if (!reader) return new Uint8Array()
  const chunks: Uint8Array[] = []; let length = 0
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      length += value.byteLength
      if (length > limit) { void reader.cancel().catch(() => {}); return null }
      chunks.push(value)
    }
  } finally { reader.releaseLock() }
  const bytes = new Uint8Array(length); let offset = 0
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength }
  return bytes
}

/** Provider authentication and D1 receipt/state commit precede acknowledgment. No browser session is involved. */
export async function mailEventResponse(request: Request, env: Bindings): Promise<Response | null> {
  const match = new URL(request.url).pathname.match(/^\/api\/balm\/mail\/events\/(resend|sendgrid)$/)
  if (!match) return null
  const provider = match[1] as 'resend' | 'sendgrid', eventNamespace = mailNamespace(env, provider)
  const key = provider === 'resend' ? env.BALM_RESEND_WEBHOOK_KEY : env.BALM_SENDGRID_WEBHOOK_KEY
  if (!key || !eventNamespace || env.AUTH_LOCAL === 'true' || env.RER_DEMO === '1') return reply(404)
  if (request.method !== 'POST') return reply(405)
  try {
    const rawBody = await rawBytes(request)
    if (!rawBody) return reply(413)
    const intake = createDeliveryEventIntake({ provider, key, tenantId: mailTenant, eventNamespace,
      store: createD1EventStore({ db: env.DB }),
      authorize: async (event: any) => {
        const row = await env.DB.prepare(`SELECT recipient FROM bm_mail_attempts WHERE provider=? AND tenant_id=? AND event_namespace=?
          AND submission_state IN ('sending','accepted','uncertain') AND ${provider === 'resend' ? 'provider_message_id' : 'id'}=?`)
          .bind(provider, mailTenant, eventNamespace, provider === 'resend' ? event.providerMessageId : event.deliveryId ?? '').first<{ recipient: string }>()
        return !!row && event.recipients.every((recipient: string) => recipient === row.recipient)
      },
    })
    await intake.ingestWebhook({ rawBody, headers: request.headers })
    return reply(200)
  } catch (error) {
    const code = (error as any)?.code
    return reply(code === 'event_signature_invalid' ? 401 : code === 'event_unauthorized' || code === 'event_storage_failed' ? 503 : code === 'event_identity_conflict' ? 409 : 400)
  }
}
