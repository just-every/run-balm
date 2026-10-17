import { bundleCommand, bundleJobs, importedForClient } from './movein/bundle'
import { bundleFormInput } from './movein/form-input'
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
import { insuranceCommand, insuranceState, insuranceFile, insuranceDownload, bookingWarnings } from './insurance'
import { DomainError, human, insist, need } from './domain/model'
import { messageCommand, messageFile, patientMessages, patientSend } from './messages'
import { reminderSettings, reminderCommand, reminderHistory } from './reminders/settings'
import { visitReply, visitReplyView } from './reminders/replies'
import { portalResponse } from './portal/http'
import { portalCommand, portalExercisesFor } from './portal'
import { consentDocument, insuranceAiStatus, insurancePhoto, intakeChart, parseIntakeInput, readInsurance, verifyInsurance } from './intake'
import { caseCommand, caseList } from './cases'
import { visitSummary } from './visit-summary'

const headers = { 'cache-control': 'no-store', 'x-content-type-options': 'nosniff', 'referrer-policy': 'no-referrer' }
const json = (value: unknown, status = 200) => Response.json(value, { status, headers })
const pages = /^\/app(\/clients(\/[\w-]+)?|\/invoices|\/clinic|\/intake|\/import|\/agent|\/waitlist|\/insurance|\/cases)?$/
const redirect = (location: string) => new Response(null, { status: 303, headers: { ...headers, location } })

async function state(env: Bindings, who: Actor) {
  const jobs = who.role === 'owner' ? (await env.DB.prepare("SELECT id,state,checkpoint,total,fingerprint,error FROM ik_jobs WHERE destination='balm:clients' AND principal_id=? ORDER BY rowid DESC LIMIT 30").bind(who.id).all()).results : []
  const importJobs = await Promise.all(jobs.map(async (j: any) => j.state === 'undone' ? { ...j, undo: await undoCounts(env.DB, who, j.id) } : j))
  return { ...await snapshot(env.DB, who), ...await paymentsState(env, env.DB, who), agentKeys: await agentKeys(env, who), origin: env.AUTH_ORIGIN, importJobs, moveinJobs: who.role === 'owner' ? await bundleJobs(env.DB) : [], local: env.AUTH_LOCAL === 'true' && env.RER_DEMO !== '1', scribe: await scribeStatus(env, who), reminders: await reminderSettings(env, who), insurance: who.role === 'agent' ? undefined : await insuranceState(env, who) }
}

/** A client file as the pages show it: the audited file plus its billing. */
async function fileFor(env: Bindings, who: Actor, clientId: string, auditBefore?: string) {
  const file = await clientFile(env.DB, who, clientId, auditBefore)
  return { ...file, imported: await importedForClient(env.DB, who, file.client.id as string), insurance: who.role === 'agent' ? undefined : await insuranceFile(env.DB, who, file.client.id as string), intakeDocuments: { ...await intakeChart(env.DB, who, file.client.id as string), ai: await insuranceAiStatus(env) }, billing: await clientBilling(env, env.DB, who, file.client.id as string), messages: await messageFile(env.DB, who, file.client.id as string), homeExercises: who.role === 'owner' || who.staffRole === 'practitioner' ? await portalExercisesFor(env.DB, who, file.client.id as string) : null, reminderHistory: await reminderHistory(env.DB, file.appointments.map(a => a.id as string)) }
}

/** One signed-in page: `target` is a page path with an optional calendar query. */
async function page(env: Bindings, who: Actor, target: string, notice: Parameters<typeof renderApp>[2] = {}, status = 200) {
  const [path, query = ''] = target.split('?'), s: any = await state(env, who)
  // Until the owner chooses the clinic's time zone, every page is the time zone step.
  if (!s.settings.time_zone) return renderApp(s, target, notice, undefined, status)
  if (path === '/app') {
    s.calendar = await calendarView(env.DB, who, Object.fromEntries(new URLSearchParams(query)))
    if (s.calendar.selected) s.calendar.summary = await visitSummary(env, who, s.calendar.selected.client_id)
  }
  if (path === '/app/cases' && (who.role === 'owner' || who.staffRole === 'reception')) s.cases = await caseList(env, who)
  const file = path.match(/^\/app\/clients\/([\w-]+)$/)
  return renderApp(s, target, notice, file ? await fileFor(env, who, file[1], notice.ask?.auditBefore).catch(error => { if (status === 200) throw error }) : undefined, status)
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
  if (name.startsWith('exercise.')) return portalCommand(env.DB, who, name, input)
  if (name.startsWith('case.')) return caseCommand(env, who, name, input)
  if (name === 'insurance.verify') return verifyInsurance(env.DB, who, input)
  if (name === 'insurance.read') return readInsurance(env, who, input)
  if (name.startsWith('insurance.')) {
    if (name === 'insurance.batch.prepare' && !Array.isArray(input.claimIds)) input.claimIds = Object.keys(input).filter(k => k.startsWith('claim_') && input[k] === 'on').map(k => k.slice(6))
    if (name === 'insurance.payer.save' && typeof input.feeSchedule === 'string') input.fees = input.feeSchedule.split(/\r?\n/).filter(line => line.trim()).map(line => {
      const [code, amount] = line.trim().split(/\s+/)
      return { code, cents: parseDollars(amount, 'fee') }
    })
    if (name === 'insurance.medicare.save' && input.threshold !== undefined) { input.thresholdCents = parseDollars(input.threshold, 'threshold'); input.externalUsedCents = parseDollars(input.externalUsed || '0', 'outside_expenses') }
    return insuranceCommand(env, who, name, input)
  }
  if (['appointment.book', 'series.book'].includes(name)) {
    need(who, 'owner', 'reception', 'practitioner'); human(who)
    insist(who.role === 'owner' || who.staffRole === 'reception' || input.practitionerId === who.staffId, 'practitioners_book_their_own_diary', 403)
    const dates = name === 'series.book'
      ? (Array.isArray(input.occurrences) ? input.occurrences.filter((o: any) => ![true, 'on', 'yes'].includes(o.skip)).map((o: any) => String(o.date))
        : Object.keys(input).filter(k => /^date_\d+$/.test(k) && input['skip_' + k.slice(5)] !== 'on').map(k => String(input[k])))
      : [String(input.date ?? '')]
    const found = (await Promise.all([...new Set(dates)].map(date => bookingWarnings(env.DB, String(input.clientId), date, String(input.practitionerId ?? ''), undefined, dates)))).flat()
    const warnings = [...new Map(found.map(w => [w.code + ':' + w.authorizationId + ':' + w.policyId, w])).values()]
    if (warnings.some(w => w.blocking) || (warnings.length && input.acknowledgeInsurance !== 'on' && input.acknowledgeInsurance !== true))
      throw new DomainError('Review the insurance authorization warnings before booking.', 409, { insuranceBooking: { name, input, warnings } })
  }
  if (name.startsWith('agent.') || name === 'staff.invite') return credentialCommand(request, env, who, name, input)
  if (name.startsWith('message.')) return messageCommand(env, who, name, input)
  if (name.startsWith('reminders.')) return reminderCommand(env, who, name, input)
  if (name.startsWith('pay.')) return paymentCommand(env, env.DB, who, name, input)
  if (name.startsWith('movein.')) return bundleCommand(env.DB, who, name, input)
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
    if (Number(request.headers.get('content-length') ?? 0) > 7_100_000) fail('request_too_large', 413)
    const input: Record<string, unknown> = {}
    for (const [key, value] of await request.formData()) {
      if (typeof value === 'string') { input[key] = value; continue }
      if (value.size > 1_000_000) fail('The file is larger than 1,000,000 bytes. Export a smaller date range from Cliniko and import each file in turn.', 413)
      if (value.size) {
        if (key === 'exerciseImage') {
          if (!['image/png', 'image/jpeg', 'image/webp'].includes(value.type)) fail('choose_a_png_jpeg_or_webp_image')
          const bytes = new Uint8Array(await value.arrayBuffer())
          let binary = ''; for (const byte of bytes) binary += String.fromCharCode(byte)
          input.image = `data:${value.type};base64,${btoa(binary)}`
        } else { input[key] = await value.text(); input[key + 'Name'] = value.name }
      }
    }
    return input
  }
  const raw = await request.text()
  if (new TextEncoder().encode(raw).length > 7_100_000) fail('request_too_large', 413)
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
        // Balm on this computer sends no email: the patient keeps this page's address instead.
        return redirect(`/intake/${booked.token}?booked=1&mail=${mail === 'sent' && env.AUTH_LOCAL === 'true' && env.RER_DEMO !== '1' ? 'local' : mail}`)
      } catch (error) {
        const failure = message(error), code = (error as any)?.code ?? (error as Error)?.message
        // The patient's details come back filled in; a taken or missing time offers the open times instead.
        const typed = Object.fromEntries(['firstName', 'lastName', 'dateOfBirth', 'phone', 'email', 'privacy'].map(key => [key, typeof input[key] === 'string' ? input[key] : '']))
        const chosen = { serviceId: String(input.serviceId ?? ''), practitionerId: String(input.practitionerId ?? ''), start: String(input.start ?? '') }
        const retime = code === 'slot_unavailable' || code === 'invalid_start' || !chosen.start
        const from = !clinic?.time_zone || Number.isNaN(Date.parse(chosen.start)) ? undefined : hostDateAt(new Date(chosen.start), clinic!.time_zone)
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
        await submitIntake(env.DB, intake[1], await parseIntakeInput(request), { ip: request.headers.get('CF-Connecting-IP') ?? '' })
        return redirect(`/intake/${intake[1]}`)
      }
      return renderPublic('intake', { ...await intakeView(env.DB, intake[1]), booked: url.searchParams.get('booked') === '1', mail: url.searchParams.get('mail') })
    } catch (error) {
      const failure = message(error)
      if (failure.status === 404) return renderPublic('missing', {}, 404)
      return renderPublic('intake', { ...await intakeView(env.DB, intake[1]), error: failure.text }, failure.status)
    }
  }
  const privatePage = path.match(/^\/(visit|messages)\/([A-Za-z0-9_-]{20,64})$/)
  if (privatePage) {
    const [, matchedKind, token] = privatePage
    const kind = matchedKind as 'visit' | 'messages'
    try {
      if (request.method === 'POST') {
        if (!sameOrigin(request, env)) fail('cross_site_request_refused', 403)
        const input = await inputBody(request)
        if (kind === 'visit') await visitReply(env, token, input)
        else await patientSend(env, token, input)
        return redirect(`/${kind}/${token}?saved=1`)
      }
      const data = kind === 'visit' ? await visitReplyView(env, token) : await patientMessages(env, token)
      return renderPublic(kind, { ...data, notice: url.searchParams.has('saved') ? 'Your reply is saved for the clinic.' : '' })
    } catch (error) {
      const failure = message(error)
      if (failure.status === 404) return renderPublic('missing', {}, 404)
      const data = kind === 'visit' ? await visitReplyView(env, token) : await patientMessages(env, token)
      return renderPublic(kind, { ...data, error: failure.text }, failure.status)
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
  const isPortal = path === '/portal' || path.startsWith('/portal/')
  const intakeDocumentPath = path.match(/^\/app\/intake\/(consents|insurance)\/([\w-]+)(\.pdf|\/(front|back))$/)
  const isPublic = isPortal || path === '/book' || path.startsWith('/intake/') || path.startsWith('/offer/') || path.startsWith('/pay/') || path.startsWith('/plan/') || path.startsWith('/visit/') || path.startsWith('/messages/')
  if (!isPublic && !intakeDocumentPath && !path.startsWith('/api/balm/') && !pages.test(path) && path !== '/app/action') return null
  const env = runtimeBindings(original), isAgent = path.startsWith('/api/balm/agent/')
  let who: Actor | undefined
  const back = returnTarget(url.searchParams.get('returnTo') ?? '')
  try {
    if (url.origin !== env.AUTH_ORIGIN || (request.headers.has('host') && request.headers.get('host') !== url.host)) fail('wrong_application_origin', 403)
    if (!['GET', 'POST'].includes(request.method)) return json({ error: 'Method not allowed' }, 405)
    if (isPortal) return portalResponse(request, env)
    if (isPublic) return await publicResponse(request, env, path)
    // The agent door's schema, for assistants that import one; it holds no clinic data.
    if (path === '/api/balm/agent/openapi.json' && request.method === 'GET') return json(agentOpenApi(env.AUTH_ORIGIN))
    // Stripe signs its webhook; it carries no session.
    if (path === WEBHOOK_PATH) return await paymentsPublicResponse(request, env, path, false) ?? json({ error: 'Not found' }, 404)
    if (request.method === 'POST' && !isAgent && !sameOrigin(request, env)) fail('cross_site_request_refused', 403)
    who = await principal(request, env, isAgent)
    if (request.method === 'GET') {
      if (intakeDocumentPath) {
        const [, kind, id, suffix, side] = intakeDocumentPath
        if ((kind === 'consents' && suffix !== '.pdf') || (kind === 'insurance' && !side)) fail('not_found', 404)
        const doc = kind === 'consents' ? await consentDocument(env.DB, who, id) : await insurancePhoto(env.DB, who, id, side)
        return new Response(doc.bytes, { headers: { ...headers, 'content-type': doc.mime, 'content-disposition': `${kind === 'consents' ? 'attachment' : 'inline'}; filename="${doc.filename}"`, 'content-security-policy': "default-src 'none'" } })
      }
      if (pages.test(path)) return await page(env, who, path === '/app' && url.search ? returnTarget(path + url.search) : path, path.startsWith('/app/clients/') ? { ask: Object.fromEntries(url.searchParams) } : path === '/app/clinic' && url.searchParams.has('invited') ? { invited: url.searchParams.get('invited') } : {})
      if (path === '/api/balm/state' || path === '/api/balm/agent/context') return json(await state(env, who))
      if (path === '/api/balm/cases') return json(await caseList(env, who))
      if (path === '/api/balm/commands') return json({ preparations, approvals, rule: 'Agent keys prepare; a signed-in person approves. Approvals keep the digest of the exact approved bytes.' })
      const file = path.match(/^\/api\/balm\/clients\/([\w-]+)$/)
      if (file) return json(await fileFor(env, who, file[1], url.searchParams.get('auditBefore') ?? undefined))
      const invoice = path.match(/^\/api\/balm\/invoices\/([\w-]+)\.html$/)
      if (invoice) {
        const download = await invoiceDownload(env.DB, who, invoice[1])
        return new Response(download.bytes, { headers: { ...headers, 'content-type': 'text/html; charset=utf-8', 'content-disposition': `attachment; filename="${download.name}"`, 'content-security-policy': "default-src 'none'; style-src 'unsafe-inline'" } })
      }
      const x12 = path.match(/^\/api\/balm\/insurance\/(270|837P)\/([\w-]+)$/)
      if (x12) {
        const download = await insuranceDownload(env, who, x12[1], x12[2])
        return new Response(download.body, { headers: { ...headers, 'content-type': download.contentType, 'content-disposition': `attachment; filename="${download.filename}"` } })
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
        let input = await inputBody(request); const name = url.searchParams.get('name') ?? ''
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
        if (name.startsWith('movein.')) input = bundleFormInput(input)
        let result: unknown
        try { result = await execute(request, env, who, name, input) } catch (error) {
          const failure = message(error)
          if (name !== 'movein.apply' || failure.status >= 500) throw error
          const preview = await bundleCommand(env.DB, who, 'movein.preview', input)
          return await page(env, who, back, { error: failure.text, result: { ...preview, reviewInput: input } }, failure.status)
        }
        // A refresh must read the result, never repeat the change. Results shown
        // once (an import review or journal, a new key, a booking's intake link) render directly.
        if (!['movein.preview', 'movein.journal', 'movein.apply', 'movein.undo', 'import.preview', 'import.journal', 'agent.create', 'appointment.book', 'series.preview', 'series.book', 'pay.link.create', 'message.link', 'message.send', 'plan.send', 'plan.resend', 'scribe.check', 'insurance.batch.submit', 'insurance.eligibility.submit', 'insurance.denial.appeal'].includes(name)) {
          // An invitation says who it went to, and how, once the page reloads.
          if (name === 'staff.invite') return redirect(`/app/clinic?invited=${encodeURIComponent(String(input.id ?? ''))}`)
          const offered = (result as any)?.waitlist?.people
          return redirect(offered && back.startsWith('/app?') ? `${back}&offered=${offered}` : offered && back === '/app' ? `/app?offered=${offered}` : back)
        }
        if (name === 'movein.preview') return await page(env, who, back, { result: { ...(result as object), reviewInput: input } })
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
    // Refused before any page could load (staff set inactive): a page to read, not JSON.
    if ((pages.test(path) || path === '/app/action') && failure.status === 403) return renderPublic('refused', { reason: failure.text }, 403)
    return json({ error: failure.text, code: (error as any)?.code ?? (error as Error)?.message, ...(detail ? { detail } : {}) }, failure.status)
  }
}
