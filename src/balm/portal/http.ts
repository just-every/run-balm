import { patientLetter } from '../charting/letters'
import { portalRefundReceipt } from './data'
import {guardianActor} from './guardians'
import {programPdf} from './programs'
import {consumeSmsCode,requestSmsCode} from './sms-auth'
import { recordDownload } from './records'
import {aeobOriginal} from '../payments/aeobs'
import { estimateOriginal } from '../payments/estimates'
import { audit,commit } from '../domain/model'
import { portalGuard,patientActor } from './auth'
import { takeAddressRate } from '../public-rates'
import { portalNotice } from './auth'
import { portalSchedule } from './scheduling'
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
    if (request.method === 'POST' && (path === '/portal' || path === '/portal/confirm'||path==='/portal/sms'||path==='/portal/sms/confirm')) {
      const kind = (path === '/portal/confirm'||path==='/portal/sms/confirm') ? 'confirm' : 'signin'
      if (!await takeAddressRate(env, request, 'portal', kind)) return renderPortal('signin', { notice: portalNotice }, kind === 'signin' ? 200 : 429)
    }
    const input = request.method === 'POST' ? await parseMessageInput(request) : {}
    if(path==='/portal/sms'&&request.method==='POST')return renderPortal('sms',await requestSmsCode(env,request,input.phone))
    if(path==='/portal/sms/confirm'&&request.method==='POST')return redirect('/portal/home',(await consumeSmsCode(env,request,input)).cookie)
    if (path === '/portal/confirm') {
      const token = String(input.token ?? url.searchParams.get('token') ?? '')
      if (request.method === 'GET') return renderPortal('confirm', { token,language:url.searchParams.get('lang')==='es'?'es':'en' })
      const result = await consumePortalLink(env, request, token)
      return redirect('/portal/home', result.cookie)
    }
    if (path === '/portal') {
      if (request.method === 'POST') return renderPortal('signin', await requestPortalLink(env, request, input.email))
      const patient = await portalPatient(env.DB, request).catch(() => null)
      return patient ? redirect('/portal/home' + (url.searchParams.has('rescheduled') ? '?rescheduled=1' : url.searchParams.has('cancelled') ? '?cancelled=1' : '')) : renderPortal('signin', { language:url.searchParams.get('lang')==='es'?'es':'en',notice: url.searchParams.has('rescheduled') ? 'Your appointment was moved. Sign in to see your updated visit.' : url.searchParams.has('cancelled') ? 'Your appointment was cancelled. Sign in to see your visits.' : '' })
    }
    const patient = await portalPatient(env.DB, request)
    const letterPath=path.match(/^\/portal\/letters\/([\w-]+)\.pdf$/)
    if(letterPath && request.method==='GET')return await patientLetter(env.DB,patient,letterPath[1])
    if(path==='/portal/program.pdf'&&request.method==='GET')return new Response(await programPdf(env.DB,patient),{headers:{...headers,'content-type':'application/pdf','content-disposition':'attachment; filename="home-program.pdf"'}})
    const recordPath=path.match(/^\/portal\/records\/([\w-]+)\.(pdf|json)$/)
    if(recordPath&&request.method==='GET')return await recordDownload(env.DB,recordPath[1],recordPath[2]==='pdf'?'pdf':'fhir',patient)
    const payerEstimate=path.match(/^\/portal\/aeobs\/([\w-]+)\.pdf$/)
    if(payerEstimate&&request.method==='GET'){const doc=await aeobOriginal(env.DB,patient.clientId,payerEstimate[1],true);await commit(env.DB,null,[portalGuard(env.DB,patient),audit(env.DB,guardianActor(patient),'aeob.downloaded',patient.clientId,payerEstimate[1])]);return new Response(doc.bytes,{headers:{...headers,'content-type':'application/pdf','content-disposition':`attachment; filename="${doc.name}"`}})}
    const estimate=path.match(/^\/portal\/estimates\/([\w-]+)\.pdf$/)
    if(estimate && request.method==='GET'){const doc=await estimateOriginal(env.DB,patient.clientId,estimate[1]);await commit(env.DB,null,[portalGuard(env.DB,patient),audit(env.DB,guardianActor(patient),'estimate.downloaded',patient.clientId,estimate[1])]);return new Response(doc.bytes,{headers:{...headers,'content-type':'application/pdf','content-disposition':`attachment; filename="${doc.name}"`}})}
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
    const refundPath = path.match(/^\/portal\/refund-receipts\/([\w-]+)\.pdf$/)
    if (refundPath && request.method === 'GET') {
      const doc = await portalRefundReceipt(env.DB, patient, refundPath[1])
      return new Response(doc.bytes, { headers: { ...headers, 'content-type': 'application/pdf', 'content-disposition': `attachment; filename="${doc.name}"` } })
    }
    const documentPath = path.match(/^\/portal\/(receipts|superbills|statements)\/([\w-]+)\.pdf$/)
    if (documentPath && request.method === 'GET') {
      const doc = await portalDocument(env.DB, patient, documentPath[1] === 'receipts' ? 'receipt' : documentPath[1] === 'statements' ? 'statement' : 'superbill', documentPath[2])
      return new Response(doc.bytes, { headers: { ...headers, 'content-type': 'application/pdf', 'content-disposition': `attachment; filename="${doc.name}"` } })
    }
    const movePath = path.match(/^\/portal\/appointments\/([\w-]+)\/move$/)
    if (request.method === 'GET' && (path === '/portal/schedule' || movePath)) return renderPortal('schedule', await portalSchedule(env, patient, Object.fromEntries(url.searchParams), movePath?.[1]))
    if (path === '/portal/action' && request.method === 'POST') {
      const result = await portalAction(env, patient, String(input.name ?? ''), input)
      if (result && 'redirect' in result) return redirect(result.redirect)
      return redirect('/portal/home?saved=1' + (input.name === 'message.send' ? '#messages' : '#program'))
    }
    if (path === '/portal/home' && request.method === 'GET') return renderPortal('home', { ...await portalHome(env, patient, url.searchParams.get('setup')), notice: url.searchParams.has('rescheduled') ? 'Your appointment was moved. Your updated visit is listed below.' : url.searchParams.has('scheduled') ? 'Your follow-up is booked.' : url.searchParams.has('cancelled') ? 'Your visit was cancelled.' : url.searchParams.has('saved') ? 'Saved to your patient record.' : '' })
    return renderPortal('signin', { error: 'This page is not available.' }, 404)
  } catch (error) {
    const status = Number((error as any)?.status) || 500
    if (status === 401) return redirect('/portal')
    const text = status < 500 ? plain(String((error as Error).message)) : 'Could not complete this change. Please try again.'
    if (path === '/portal/action') {
      const patient = await portalPatient(env.DB, request).catch(() => null)
      if (patient) return renderPortal('home', { ...await portalHome(env, patient, url.searchParams.get('setup')), error: text }, status)
    }
    return renderPortal('signin', { error: text }, status)
  }
}
