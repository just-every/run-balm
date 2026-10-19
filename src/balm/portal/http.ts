import type { Bindings } from '../../auth.server'
import { portalAttachment } from './messages'
import { parseMessageInput } from '../messages/input'
import { plain } from '../refusals'
import { renderPortal } from '../ui/portal'
import { consumePortalLink, portalAction, portalHome, portalPatient, portalStatement, portalDocument, portalPeriodSuperbill, requestPortalLink, signOutPortal } from './index'

const headers = { 'cache-control': 'no-store', 'referrer-policy': 'no-referrer', 'x-content-type-options': 'nosniff' }
const redirect = (location: string, cookie?: string) => new Response(null, { status: 303, headers: { ...headers, location, ...(cookie ? { 'set-cookie': cookie } : {}) } })

/** Patient sessions have their own door and never grant access to staff routes. */
export async function portalResponse(request: Request, env: Bindings): Promise<Response> {
  const url = new URL(request.url), path = url.pathname
  try {
    if (request.method === 'POST' && (request.headers.get('origin') !== env.AUTH_ORIGIN || request.headers.get('sec-fetch-site') === 'cross-site')) return renderPortal('signin', { error: 'Open this page again before submitting.' }, 403)
    const input = request.method === 'POST' ? await parseMessageInput(request) : {}
    if (path === '/portal/confirm') {
      const token = String(input.token ?? url.searchParams.get('token') ?? '')
      if (request.method === 'GET') return renderPortal('confirm', { token })
      const result = await consumePortalLink(env, request, token)
      return redirect('/portal/home', result.cookie)
    }
    if (path === '/portal') {
      if (request.method === 'POST') return renderPortal('signin', await requestPortalLink(env, request, input.email))
      const patient = await portalPatient(env.DB, request).catch(() => null)
      return patient ? redirect('/portal/home' + (url.searchParams.has('rescheduled') ? '?rescheduled=1' : '')) : renderPortal('signin', { notice: url.searchParams.has('rescheduled') ? 'Your appointment was moved. Sign in to see your updated visit.' : '' })
    }
    const patient = await portalPatient(env.DB, request)
    const attachment = path.match(/^\/portal\/messages\/attachments\/([\w-]+)$/)
    if (attachment && request.method === 'GET') return await portalAttachment(env.DB, patient, attachment[1])
    if (path === '/portal/signout' && request.method === 'POST') return redirect('/portal', (await signOutPortal(env.DB, request)).cookie)
    if (path === '/portal/statement.pdf' && request.method === 'GET') {
      const doc = await portalStatement(env.DB, patient)
      return new Response(doc.bytes, { headers: { ...headers, 'content-type': 'application/pdf', 'content-disposition': `attachment; filename="${doc.name}"` } })
    }
    if (path === '/portal/superbill.pdf' && request.method === 'GET') {
      const doc = await portalPeriodSuperbill(env.DB, patient, url.searchParams.get('from') ?? '', url.searchParams.get('to') ?? '')
      return new Response(doc.bytes, { headers: { ...headers, 'content-type': 'application/pdf', 'content-disposition': `attachment; filename="${doc.name}"` } })
    }
    const documentPath = path.match(/^\/portal\/(receipts|superbills)\/([\w-]+)\.pdf$/)
    if (documentPath && request.method === 'GET') {
      const doc = await portalDocument(env.DB, patient, documentPath[1] === 'receipts' ? 'receipt' : 'superbill', documentPath[2])
      return new Response(doc.bytes, { headers: { ...headers, 'content-type': 'application/pdf', 'content-disposition': `attachment; filename="${doc.name}"` } })
    }
    if (path === '/portal/action' && request.method === 'POST') {
      const result = await portalAction(env, patient, String(input.name ?? ''), input)
      if (result && 'redirect' in result) return redirect(result.redirect)
      return redirect('/portal/home?saved=1' + (input.name === 'message.send' ? '#messages' : '#program'))
    }
    if (path === '/portal/home' && request.method === 'GET') return renderPortal('home', { ...await portalHome(env, patient), notice: url.searchParams.has('rescheduled') ? 'Your appointment was moved. Your updated visit is listed below.' : url.searchParams.has('saved') ? 'Saved to your patient record.' : '' })
    return renderPortal('signin', { error: 'This page is not available.' }, 404)
  } catch (error) {
    const status = Number((error as any)?.status) || 500
    if (status === 401) return redirect('/portal')
    const text = status < 500 ? plain(String((error as Error).message)) : 'Could not complete this change. Please try again.'
    if (path === '/portal/action') {
      const patient = await portalPatient(env.DB, request).catch(() => null)
      if (patient) return renderPortal('home', { ...await portalHome(env, patient), error: text }, status)
    }
    return renderPortal('signin', { error: text }, status)
  }
}
