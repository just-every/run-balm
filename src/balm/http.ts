// Every handler below resolves the actor and enforces its role server-side;
// pages and JSON share the same domain commands. Adapted from Strap's HTTP layer.
import { operatorAuth, runtimeBindings, type Bindings } from '../auth.server'
import { approvals, command, preparations, snapshot, type Actor } from './domain'
import { bookOnline, openSlots } from './domain/booking'
import { calendarView } from './domain/calendar'
import { clientFile } from './domain/clients'
import { intakeAsk, intakeView, submitIntake } from './domain/intake'
import { invoiceDownload } from './domain/invoices'
import { reminderDownload } from './domain/reminders'
import { acceptOffer, offerFreedSlots, offerView, recordDelivery, takenNotices } from './domain/waitlist'
import { certifyPlan, planView, resendPlan, sendPlan } from './domain/plans'
import { sendBooked, sendCanceled, sendIntake, sendOffer, sendPlanLink, sendTaken } from './mail-out'
import { scribeCommand, scribeStatus } from './scribe'
import { importCommand, importOriginal, undoCounts } from './movein'
import { builderRows, editRows, fileFromField, hoursFromForm, questionsFromRows } from './forms'
import { plain } from './refusals'
import { hostDateAt } from './availability/timezone'
import { agentKeys, credentialCommand, fail, principal } from './credentials'
import { clientBilling, paymentCommand, paymentsState } from './payments'
import { parseDollars } from './payments/ledger'
import { WEBHOOK_PATH } from './payments/connect'
import { paymentDocument, paymentsPublicResponse } from './payments/http'
import { renderApp, renderPublic } from './ui'
import { agentOpenApi } from './agent-openapi'

const headers = { 'cache-control': 'no-store', 'x-content-type-options': 'nosniff', 'referrer-policy': 'no-referrer' }
const json = (value: unknown, status = 200) => Response.json(value, { status, headers })
const pages = /^\/app(\/clients(\/[\w-]+)?|\/invoices|\/clinic|\/intake|\/import|\/agent|\/mail|\/waitlist)?$/
const redirect = (location: string) => new Response(null, { status: 303, headers: { ...headers, location } })

async function state(env: Bindings, who: Actor) {
  const jobs = who.role === 'owner' ? (await env.DB.prepare("SELECT id,state,checkpoint,total,fingerprint,error FROM ik_jobs WHERE destination='balm:clients' AND principal_id=? ORDER BY rowid DESC LIMIT 30").bind(who.id).all()).results : []
  const importJobs = await Promise.all(jobs.map(async (j: any) => j.state === 'undone' ? { ...j, undo: await undoCounts(env.DB, who, j.id) } : j))
  const localMail = env.AUTH_LOCAL === 'true' && env.RER_DEMO !== '1' && who.role === 'owner'
  const developmentMail = localMail ? (await env.DB.prepare('SELECT id,created_at AS createdAt,message FROM rer_mail_development_outbox ORDER BY sequence DESC LIMIT 100').all()).results.map((row: any) => ({ id: row.id, createdAt: row.createdAt, ...JSON.parse(row.message) })) : []
  return { ...await snapshot(env.DB, who), ...await paymentsState(env, env.DB, who), agentKeys: await agentKeys(env, who), origin: env.AUTH_ORIGIN, importJobs, local: env.AUTH_LOCAL === 'true' && env.RER_DEMO !== '1', localMail, developmentMail, scribe: await scribeStatus(env, who) }
}

/** A client file as the pages show it: the audited file plus its billing. */
async function fileFor(env: Bindings, who: Actor, clientId: string) {
  const file = await clientFile(env.DB, who, clientId)
  return { ...file, billing: await clientBilling(env, env.DB, who, file.client.id as string) }
}

/** One signed-in page: `target` is a page path with an optional calendar query. */
async function page(env: Bindings, who: Actor, target: string, notice: Parameters<typeof renderApp>[2] = {}, status = 200) {
  const [path, query = ''] = target.split('?'), s: any = await state(env, who)
  if (path === '/app') s.calendar = await calendarView(env.DB, who, Object.fromEntries(new URLSearchParams(query)))
  const file = path.match(/^\/app\/clients\/([\w-]+)$/)
  return renderApp(s, target, notice, file ? await fileFor(env, who, file[1]).catch(error => { if (status === 200) throw error }) : undefined, status)
}
/** A same-app page to return to, keeping only a plain calendar query. */
function returnTarget(requested: string) {
  const [path, query] = requested.split('?')
  if (!pages.test(path)) return '/app'
  return query && /^[\w=&%.:-]{1,300}$/.test(query) ? `${path}?${query}` : path
}

/** A canceled visit's freed time goes to the waitlist by email; delivery is recorded per person. */
async function offerFreed(env: Bindings, appointmentIds: string[]) {
  const offers = await offerFreedSlots(env.DB, appointmentIds)
  for (const offer of offers) await recordDelivery(env.DB, offer.offerId, offer.entryId, 'delivery', await sendOffer(env, offer))
  return { offered: new Set(offers.map(o => o.offerId)).size, people: offers.length }
}
async function noticeOthers(env: Bindings, offerId: string) {
  for (const row of await takenNotices(env.DB, offerId)) await recordDelivery(env.DB, offerId, row.entry_id as string, 'taken_notice', await sendTaken(env, row as any))
}

async function execute(request: Request, env: Bindings, who: Actor, name: string, input: Record<string, unknown>) {
  if (name.startsWith('agent.') || name === 'staff.invite') return credentialCommand(request, env, who, name, input)
  if (name.startsWith('pay.')) return paymentCommand(env, env.DB, who, name, input)
  if (name.startsWith('import.')) {
    if (who.role !== 'owner') fail('only_the_owner_imports', 403)
    return importCommand(env.DB, who, name, input)
  }
  if (name.startsWith('scribe.') || name === 'note.scribe') return scribeCommand(env, who, name, input)
  if (name === 'plan.send' || name === 'plan.resend') {
    const plan = await (name === 'plan.send' ? sendPlan : resendPlan)(env.DB, who, input)
    return { ...plan, mail: await sendPlanLink(env, plan.physicianEmail, plan.token) }
  }
  const result: any = await command(env.DB, who, name, input)
  if (name === 'appointment.book' || name === 'series.book') {
    // A past visit emails nothing; a client with intake on file, or an open link already, is not asked again.
    const booked = name === 'series.book' ? result.appointmentIds : [result.appointmentId], clientId = String(input.clientId)
    result.intake = await intakeAsk(env.DB, clientId, result.startAt, booked)
    result.mail = result.intake === 'ask' ? await sendIntake(env, clientId, result.token, result.startAt)
      : result.intake === 'past' ? 'not_sent' : await sendBooked(env, clientId, result.startAt, booked.length)
    if (result.intake !== 'ask') delete result.token
  }
  if (name === 'appointment.cancel' || name === 'series.cancel_rest') {
    const canceled: string[] = name === 'appointment.cancel' ? [result.id] : result.cancelled
    result.mail = await sendCanceled(env, canceled)
    result.waitlist = await offerFreed(env, canceled)
  }
  return result
}

async function inputBody(request: Request): Promise<Record<string, unknown>> {
  // An uploaded file (Move in) arrives as its text, with its name beside it.
  if (request.headers.get('content-type')?.includes('multipart/form-data')) {
    if (Number(request.headers.get('content-length') ?? 0) > 2_100_000) fail('request_too_large', 413)
    const input: Record<string, unknown> = {}
    for (const [key, value] of await request.formData()) {
      if (typeof value === 'string') { input[key] = value; continue }
      if (value.size > 1_000_000) fail('The file is larger than 1,000,000 bytes. Export a smaller date range from Cliniko and import each file in turn.', 413)
      if (value.size) { input[key] = await value.text(); input[key + 'Name'] = value.name }
    }
    return input
  }
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

const sameOrigin = (request: Request, env: Bindings) => request.headers.get('origin') === env.AUTH_ORIGIN && request.headers.get('sec-fetch-site') !== 'cross-site'
const message = (error: unknown) => {
  const status = Number((error as any)?.status) || 500
  return { status, text: status < 500 ? plain(String((error as Error).message)) : 'Could not complete this change. Refresh and try again.' }
}

async function publicResponse(request: Request, env: Bindings, path: string): Promise<Response | null> {
  const url = new URL(request.url)
  if (path === '/book') {
    const params = Object.fromEntries(url.searchParams)
    const clinic = await env.DB.prepare('SELECT clinic_name,time_zone,booking_open FROM bm_settings WHERE id=1').first<any>()
    const options = { clinic, services: (await env.DB.prepare('SELECT id,name,duration_minutes,price_cents FROM bm_services WHERE active=1 ORDER BY name').all()).results,
      practitioners: (await env.DB.prepare("SELECT id,name,profession FROM bm_staff WHERE role='practitioner' AND active=1 AND erased_at IS NULL ORDER BY name").all()).results }
    if (request.method === 'POST') {
      let input: Record<string, unknown> = {}
      try {
        if (!sameOrigin(request, env)) fail('cross_site_request_refused', 403)
        input = await inputBody(request)
        if (input.website) fail('booking_refused', 400) // A filled hidden field is a bot.
        const booked = await bookOnline(env.DB, input)
        const mail = await sendIntake(env, booked.clientId, booked.token, booked.startAt)
        return redirect(`/intake/${booked.token}?booked=1&mail=${mail}`)
      } catch (error) {
        const failure = message(error), code = (error as any)?.code ?? (error as Error)?.message
        // The patient's details come back filled in; a taken or missing time offers the open times instead.
        const typed = Object.fromEntries(['firstName', 'lastName', 'dateOfBirth', 'phone', 'email', 'privacy'].map(key => [key, typeof input[key] === 'string' ? input[key] : '']))
        const chosen = { serviceId: String(input.serviceId ?? ''), practitionerId: String(input.practitionerId ?? ''), start: String(input.start ?? '') }
        const retime = code === 'slot_unavailable' || code === 'invalid_start' || !chosen.start
        const from = Number.isNaN(Date.parse(chosen.start)) ? undefined : hostDateAt(new Date(chosen.start), clinic!.time_zone)
        const slots = chosen.serviceId && chosen.practitionerId ? await openSlots(env.DB, { ...chosen, from }).catch(() => null) : null
        return renderPublic('book', { ...options, params: chosen, slots, typed, retime, error: failure.text }, failure.status)
      }
    }
    let slots = null, error = ''
    if (params.serviceId && params.practitionerId) {
      try { slots = await openSlots(env.DB, params) } catch (e) { error = message(e).text }
    }
    return renderPublic('book', { ...options, params, slots, error })
  }
  const offer = path.match(/^\/offer\/([A-Za-z0-9_-]{20,64})$/)
  if (offer) {
    try {
      if (request.method === 'POST') {
        if (!sameOrigin(request, env)) fail('cross_site_request_refused', 403)
        try {
          const accepted = await acceptOffer(env.DB, offer[1])
          await sendIntake(env, accepted.clientId, accepted.intakeToken, accepted.startAt, 'You accepted a time from the waitlist, and your appointment is booked')
          await noticeOthers(env, accepted.offerId)
          return redirect(`/intake/${accepted.intakeToken}?booked=1&mail=sent`)
        } catch (error) {
          const view = await offerView(env.DB, offer[1])
          if (view.offer.status !== 'open') await noticeOthers(env, view.offer.offer_id as string)
          const failure = message(error)
          return renderPublic('offer', { ...await offerView(env.DB, offer[1]), error: failure.status === 409 ? '' : failure.text }, failure.status)
        }
      }
      return renderPublic('offer', await offerView(env.DB, offer[1]))
    } catch (error) {
      const failure = message(error)
      return failure.status === 404 ? renderPublic('missing', {}, 404) : renderPublic('missing', { error: failure.text }, failure.status)
    }
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
  if (path.startsWith('/pay/')) return paymentsPublicResponse(request, env, path, sameOrigin(request, env))
  const plan = path.match(/^\/plan\/([A-Za-z0-9_-]{40,64})$/)
  if (plan) {
    try {
      if (request.method === 'POST') {
        if (!sameOrigin(request, env)) fail('cross_site_request_refused', 403)
        await certifyPlan(env.DB, plan[1], await inputBody(request))
        return redirect(`/plan/${plan[1]}`)
      }
      return renderPublic('plan', await planView(env.DB, plan[1]))
    } catch (error) {
      const failure = message(error)
      if (failure.status === 404) return renderPublic('missing', {}, 404)
      return renderPublic('plan', { ...await planView(env.DB, plan[1]), error: failure.text }, failure.status)
    }
  }
  return null
}

export async function balmResponse(request: Request, original: Bindings): Promise<Response | null> {
  const url = new URL(request.url), path = url.pathname
  const isPublic = path === '/book' || path.startsWith('/intake/') || path.startsWith('/offer/') || path.startsWith('/pay/') || path.startsWith('/plan/')
  if (!isPublic && !path.startsWith('/api/balm/') && !pages.test(path) && path !== '/app/action') return null
  const env = runtimeBindings(original), isAgent = path.startsWith('/api/balm/agent/')
  let who: Actor | undefined
  const back = returnTarget(url.searchParams.get('returnTo') ?? '')
  try {
    if (url.origin !== env.AUTH_ORIGIN || (request.headers.has('host') && request.headers.get('host') !== url.host)) fail('wrong_application_origin', 403)
    if (!['GET', 'POST'].includes(request.method)) return json({ error: 'Method not allowed' }, 405)
    if (isPublic) return await publicResponse(request, env, path)
    // The agent door's schema, for assistants that import one; it holds no clinic data.
    if (path === '/api/balm/agent/openapi.json' && request.method === 'GET') return json(agentOpenApi(env.AUTH_ORIGIN))
    // Stripe signs its webhook; it carries no session.
    if (path === WEBHOOK_PATH) return await paymentsPublicResponse(request, env, path, false) ?? json({ error: 'Not found' }, 404)
    if (request.method === 'POST' && !isAgent && !sameOrigin(request, env)) fail('cross_site_request_refused', 403)
    who = await principal(request, env, isAgent)
    if (request.method === 'GET') {
      if (pages.test(path)) return await page(env, who, path === '/app' && url.search ? returnTarget(path + url.search) : path, path.startsWith('/app/clients/') ? { ask: Object.fromEntries(url.searchParams) } : path === '/app/clinic' && url.searchParams.has('invited') ? { invited: url.searchParams.get('invited') } : {})
      if (path === '/api/balm/state' || path === '/api/balm/agent/context') return json(await state(env, who))
      if (path === '/api/balm/commands') return json({ preparations, approvals, rule: 'Agent keys prepare; a signed-in person approves. Approvals keep the digest of the exact approved bytes.' })
      const file = path.match(/^\/api\/balm\/clients\/([\w-]+)$/)
      if (file) return json(await fileFor(env, who, file[1]))
      const invoice = path.match(/^\/api\/balm\/invoices\/([\w-]+)\.html$/)
      if (invoice) {
        const download = await invoiceDownload(env.DB, who, invoice[1])
        return new Response(download.bytes, { headers: { ...headers, 'content-type': 'text/html; charset=utf-8', 'content-disposition': `attachment; filename="${download.name}"`, 'content-security-policy': "default-src 'none'; style-src 'unsafe-inline'" } })
      }
      const document = await paymentDocument(env.DB, who, path)
      if (document) return document
      const original = path.match(/^\/api\/balm\/imports\/([\w-]+)\/original\.csv$/)
      if (original) {
        if (who.role !== 'owner') fail('only_the_owner_imports', 403)
        const file = await importOriginal(env.DB, who, original[1])
        return new Response(file.bytes, { headers: { ...headers, 'content-type': 'text/csv; charset=utf-8', 'content-disposition': `attachment; filename="cliniko-import-${original[1].slice(0, 12)}.csv"` } })
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
        for (const key of ['amountCents', 'durationMinutes', 'priceCents', 'version', 'revision', 'noteId']) if (input[key] === '') delete input[key]
        // People type money in dollars on every page; commands keep integer cents.
        if (typeof input.price === 'string') input.priceCents = parseDollars(input.price, 'price')
        if (typeof input.amount === 'string' && input.amount.trim()) input.amountCents = parseDollars(input.amount)
        delete input.price; delete input.amount
        if (name === 'hours.save' && input.hoursForm === 'on') input.hours = hoursFromForm(input)
        if (name === 'intake.prepare' && 'questionCount' in input) {
          // Builder edits (move, remove, add) only redraw the form; preparing saves the draft.
          const rows = builderRows(input), builder = { title: String(input.title ?? ''), rows }
          if (typeof input.edit === 'string' && input.edit) return await page(env, who, '/app/intake', { builder: { ...builder, rows: editRows(rows, input.edit) } })
          try { input.questions = questionsFromRows(rows) } catch (error) { return await page(env, who, '/app/intake', { error: message(error).text, builder }, 400) }
        }
        if (name === 'import.preview' && typeof input.file === 'string') input.csv = input.file
        if ((name === 'import.preview' || name === 'import.apply') && typeof input.csvBase64 === 'string') input.csv = fileFromField(input.csvBase64)
        const result = await execute(request, env, who, name, input)
        // A refresh must read the result, never repeat the change. Results shown
        // once (an import review or journal, a new key, a booking's intake link) render directly.
        if (!['import.preview', 'import.journal', 'agent.create', 'appointment.book', 'series.preview', 'series.book', 'pay.link.create', 'plan.send', 'plan.resend', 'scribe.check'].includes(name)) {
          // An invitation says who it went to, and how, once the page reloads.
          if (name === 'staff.invite') return redirect(`/app/clinic?invited=${encodeURIComponent(String(input.id ?? ''))}`)
          const offered = (result as any)?.waitlist?.people
          return redirect(offered && back.startsWith('/app?') ? `${back}&offered=${offered}` : offered && back === '/app' ? `/app?offered=${offered}` : back)
        }
        return await page(env, who, back, { ...(['series.preview', 'import.preview', 'import.journal'].includes(name) ? {} : { message: 'Saved.' }), result: name === 'import.preview' ? { ...(result as object), csv: input.csv } : result })
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
    const detail = (error as any)?.detail
    if (path === '/app/action' && who && failure.status !== 401) return page(env, who, back, { error: failure.text, ...(detail ? { result: detail } : {}) }, failure.status)
    if ((pages.test(path) || path === '/app/action') && failure.status === 401) return redirect('/signin?returnTo=' + encodeURIComponent(pages.test(path) ? path : back))
    if (pages.test(path) && who) return page(env, who, '/app', { error: failure.text }, failure.status)
    return json({ error: failure.text, code: (error as any)?.code ?? (error as Error)?.message, ...(detail ? { detail } : {}) }, failure.status)
  }
}
