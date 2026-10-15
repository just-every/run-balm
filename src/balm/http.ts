// Every handler below resolves the actor and enforces its role server-side;
// pages and JSON share the same domain commands. Adapted from Strap's HTTP layer.
import { operatorAuth, runtimeBindings, type Bindings } from '../auth.server'
import { operatorMail } from '../mail.server.mjs'
import { approvals, command, preparations, snapshot, type Actor } from './domain'
import { bookOnline, openSlots } from './domain/booking'
import { clientFile } from './domain/clients'
import { intakeView, submitIntake } from './domain/intake'
import { invoiceDownload, localTime } from './domain/invoices'
import { reminderDownload } from './domain/reminders'
import { importCommand } from './movein'
import { agentKeys, credentialCommand, fail, principal } from './credentials'
import { renderApp, renderPublic } from './ui'

const headers = { 'cache-control': 'no-store', 'x-content-type-options': 'nosniff', 'referrer-policy': 'no-referrer' }
const json = (value: unknown, status = 200) => Response.json(value, { status, headers })
const pages = /^\/app(\/clients(\/[\w-]+)?|\/invoices|\/clinic|\/intake|\/import|\/agent|\/mail)?$/
const redirect = (location: string) => new Response(null, { status: 303, headers: { ...headers, location } })

async function state(env: Bindings, who: Actor) {
  const importJobs = who.role === 'owner' ? (await env.DB.prepare("SELECT id,state,checkpoint,total,fingerprint,error FROM ik_jobs WHERE destination='balm:clients' AND principal_id=? ORDER BY rowid DESC LIMIT 30").bind(who.id).all()).results : []
  const localMail = env.AUTH_LOCAL === 'true' && who.role === 'owner'
  const developmentMail = localMail ? (await env.DB.prepare('SELECT id,created_at AS createdAt,message FROM rer_mail_development_outbox ORDER BY sequence DESC LIMIT 100').all()).results.map((row: any) => ({ id: row.id, createdAt: row.createdAt, ...JSON.parse(row.message) })) : []
  return { ...await snapshot(env.DB, who), agentKeys: await agentKeys(env, who), importJobs, localMail, developmentMail }
}

async function execute(request: Request, env: Bindings, who: Actor, name: string, input: Record<string, unknown>) {
  if (name.startsWith('agent.') || name === 'staff.invite') return credentialCommand(request, env, who, name, input)
  if (name.startsWith('import.')) {
    if (who.role !== 'owner') fail('only_the_owner_imports', 403)
    return importCommand(env.DB, who, name, input)
  }
  const result: any = await command(env.DB, who, name, input)
  if (name === 'appointment.book') result.mail = await sendIntake(env, String(input.clientId), result.token, result.startAt)
  return result
}

async function inputBody(request: Request): Promise<Record<string, unknown>> {
  const raw = await request.text()
  if (new TextEncoder().encode(raw).length > 2_100_000) fail('request_too_large', 413)
  if (request.headers.get('content-type')?.includes('application/json')) {
    let input; try { input = JSON.parse(raw) } catch { fail('invalid_json') }
    if (!input || Array.isArray(input) || typeof input !== 'object') fail('expected_an_object')
    return input
  }
  if (!request.headers.get('content-type')?.includes('application/x-www-form-urlencoded')) fail('use_json_or_a_form', 415)
  return Object.fromEntries(new URLSearchParams(raw))
}

/** The intake link goes to the client by the clinic's mail; local development keeps it in the outbox. */
async function sendIntake(env: Bindings, clientId: string, token: string, startAt: string): Promise<'sent' | 'no_email' | 'mail_unavailable'> {
  const row = await env.DB.prepare('SELECT c.email,c.first_name,s.clinic_name,s.time_zone FROM bm_clients c, bm_settings s WHERE c.id=?').bind(clientId).first<any>()
  if (!row?.email) return 'no_email'
  const sender = operatorMail(env)
  if (!sender || !env.MAIL_FROM) return 'mail_unavailable'
  const link = new URL('/intake/' + token, env.AUTH_ORIGIN).href
  try {
    const text = `Hello ${row.first_name},\n\nYour appointment is booked for ${localTime(startAt, row.time_zone)}.\n\nPlease complete your intake form before your visit:\n${link}\n\nThis link is private to you.\n`
    const html = text.split('\n\n').map(part => `<p>${part.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!)).replace(/\n/g, '<br>')}</p>`).join('')
    const result: any = await sender.send({ deliveryId: crypto.randomUUID(), from: env.MAIL_FROM, to: [row.email], subject: `Your appointment at ${row.clinic_name}: intake form`, text, html, headers: { 'Auto-Submitted': 'auto-generated' } })
    return ['accepted', 'development'].includes(result?.status) ? 'sent' : 'mail_unavailable'
  } catch { return 'mail_unavailable' }
}

const sameOrigin = (request: Request, env: Bindings) => request.headers.get('origin') === env.AUTH_ORIGIN && request.headers.get('sec-fetch-site') !== 'cross-site'
const message = (error: unknown) => {
  const status = Number((error as any)?.status) || 500
  return { status, text: status < 500 ? String((error as Error).message).replace(/_/g, ' ') : 'Could not complete this change. Refresh and try again.' }
}

async function publicResponse(request: Request, env: Bindings, path: string): Promise<Response | null> {
  const url = new URL(request.url)
  if (path === '/book') {
    const params = Object.fromEntries(url.searchParams)
    const clinic = await env.DB.prepare('SELECT clinic_name,time_zone,booking_open FROM bm_settings WHERE id=1').first<any>()
    const options = { clinic, services: (await env.DB.prepare('SELECT id,name,duration_minutes,price_cents FROM bm_services WHERE active=1 ORDER BY name').all()).results,
      practitioners: (await env.DB.prepare("SELECT id,name,profession FROM bm_staff WHERE role='practitioner' AND active=1 AND erased_at IS NULL ORDER BY name").all()).results }
    if (request.method === 'POST') {
      try {
        if (!sameOrigin(request, env)) fail('cross_site_request_refused', 403)
        const input = await inputBody(request)
        if (input.website) fail('booking_refused', 400) // A filled hidden field is a bot.
        const booked = await bookOnline(env.DB, input)
        const mail = await sendIntake(env, booked.clientId, booked.token, booked.startAt)
        return redirect(`/intake/${booked.token}?booked=1&mail=${mail}`)
      } catch (error) {
        const failure = message(error)
        return renderPublic('book', { ...options, params, error: failure.text }, failure.status)
      }
    }
    let slots = null, error = ''
    if (params.serviceId && params.practitionerId) {
      try { slots = await openSlots(env.DB, params) } catch (e) { error = message(e).text }
    }
    return renderPublic('book', { ...options, params, slots, error })
  }
  const intake = path.match(/^\/intake\/([A-Za-z0-9_-]{20,64})$/)
  if (intake) {
    try {
      if (request.method === 'POST') {
        if (!sameOrigin(request, env)) fail('cross_site_request_refused', 403)
        await submitIntake(env.DB, intake[1], await inputBody(request))
        return redirect(`/intake/${intake[1]}`)
      }
      return renderPublic('intake', { ...await intakeView(env.DB, intake[1]), booked: url.searchParams.get('booked') === '1', mail: url.searchParams.get('mail') })
    } catch (error) {
      const failure = message(error)
      if (failure.status === 404) return renderPublic('missing', {}, 404)
      return renderPublic('intake', { ...await intakeView(env.DB, intake[1]), error: failure.text }, failure.status)
    }
  }
  return null
}

export async function balmResponse(request: Request, original: Bindings): Promise<Response | null> {
  const url = new URL(request.url), path = url.pathname
  const isPublic = path === '/book' || path.startsWith('/intake/')
  if (!isPublic && !path.startsWith('/api/balm/') && !pages.test(path) && path !== '/app/action') return null
  const env = runtimeBindings(original), isAgent = path.startsWith('/api/balm/agent/')
  let who: Actor | undefined
  const requested = url.searchParams.get('returnTo') ?? ''
  const back = pages.test(requested) ? requested : '/app'
  try {
    if (url.origin !== env.AUTH_ORIGIN || (request.headers.has('host') && request.headers.get('host') !== url.host)) fail('wrong_application_origin', 403)
    if (!['GET', 'POST'].includes(request.method)) return json({ error: 'Method not allowed' }, 405)
    if (isPublic) return await publicResponse(request, env, path)
    if (request.method === 'POST' && !isAgent && !sameOrigin(request, env)) fail('cross_site_request_refused', 403)
    who = await principal(request, env, isAgent)
    if (request.method === 'GET') {
      if (pages.test(path)) {
        const file = path.match(/^\/app\/clients\/([\w-]+)$/)
        return renderApp(await state(env, who), path, {}, file ? await clientFile(env.DB, who, file[1]) : undefined)
      }
      if (path === '/api/balm/state' || path === '/api/balm/agent/context') return json(await state(env, who))
      if (path === '/api/balm/commands') return json({ preparations, approvals, rule: 'Agent keys prepare; a signed-in person approves. Approvals keep the digest of the exact approved bytes.' })
      const file = path.match(/^\/api\/balm\/clients\/([\w-]+)$/)
      if (file) return json(await clientFile(env.DB, who, file[1]))
      const invoice = path.match(/^\/api\/balm\/invoices\/([\w-]+)\.html$/)
      if (invoice) {
        const download = await invoiceDownload(env.DB, who, invoice[1])
        return new Response(download.bytes, { headers: { ...headers, 'content-type': 'text/html; charset=utf-8', 'content-disposition': `attachment; filename="${download.name}"`, 'content-security-policy': "default-src 'none'; style-src 'unsafe-inline'" } })
      }
      const reminder = path.match(/^\/api\/balm\/reminders\/([\w-]+)\.txt$/)
      if (reminder) return new Response(await reminderDownload(env.DB, who, reminder[1]), { headers: { ...headers, 'content-type': 'text/plain; charset=utf-8', 'content-disposition': `attachment; filename="balm-reminder-${reminder[1]}.txt"` } })
    } else {
      if (path === '/app/action') {
        const input = await inputBody(request), name = url.searchParams.get('name') ?? ''
        if (name === 'session.signout') {
          const response = await operatorAuth(env).signOut(request)
          return new Response(null, { status: 303, headers: { ...headers, 'set-cookie': response.cookie, location: '/signin' } })
        }
        for (const key of ['amountCents', 'durationMinutes', 'priceCents', 'version', 'revision']) if (input[key] === '') delete input[key]
        const result = await execute(request, env, who, name, input)
        // A refresh must read the result, never repeat the change. Results shown
        // once (an import review or journal, a new key, a booking's intake link) render directly.
        if (!['import.preview', 'import.journal', 'agent.create', 'appointment.book'].includes(name)) return redirect(back)
        const file = back.match(/^\/app\/clients\/([\w-]+)$/)
        return renderApp(await state(env, who), back, { message: 'Saved.', result: name === 'import.preview' ? { ...(result as object), csv: input.csv } : result }, file ? await clientFile(env.DB, who, file[1]) : undefined)
      }
      if (path === '/api/balm/command' || path === '/api/balm/agent/command') {
        const body = await inputBody(request)
        if (typeof body.name !== 'string' || !body.input || typeof body.input !== 'object' || Array.isArray(body.input)) fail('provide_a_command_name_and_input_object')
        if (isAgent && !preparations.includes(String(body.name))) fail('agents_can_only_prepare', 403)
        return json({ result: await execute(request, env, who, String(body.name), body.input as Record<string, unknown>) })
      }
    }
    return json({ error: 'Not found' }, 404)
  } catch (error) {
    const failure = message(error)
    if (failure.status >= 500) console.error(error)
    if (path === '/app/action' && who && failure.status !== 401) {
      const file = back.match(/^\/app\/clients\/([\w-]+)$/)
      return renderApp(await state(env, who), back, { error: failure.text }, file ? await clientFile(env.DB, who, file[1]).catch(() => undefined) : undefined, failure.status)
    }
    if ((pages.test(path) || path === '/app/action') && failure.status === 401) return redirect('/signin?returnTo=' + encodeURIComponent(pages.test(path) ? path : back))
    if (pages.test(path) && who) return renderApp(await state(env, who), '/app', { error: failure.text }, undefined, failure.status)
    return json({ error: failure.text, code: (error as any)?.code ?? (error as Error)?.message }, failure.status)
  }
}
