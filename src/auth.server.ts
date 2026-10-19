import { rejectedResponse } from './base/rejected-response'
import { createDependencies } from './modules/dependencies/index.mjs'
import { createIdpOwnerClaimHandler, createOwnerClaimHandler } from './modules/owner-claim/index.mjs'
import { firstRunResponse } from './base/setup'
import { fontDocumentResponse } from './base/font-response'
import { createOperatorAuth, createAuthHandler, createSignInHandler, type AuthConfig } from './modules/operator-auth/index.mjs'
import { operatorMail } from './mail.server.mjs'
import branding from './branding.json'
import { clinicZone, identitySettingsView, linkState } from './balm/identity-settings'

// The edition's declared theme (public/rer-theme.css), as Base frames link it.
const theme = { href: '/rer-theme.css', productName: branding.name, accentColor: branding.primaryColor }

export interface Bindings {
 DB: D1Database
 /** Built browser files; hosted deploys run the Worker first (staticAssetResponse). */
 ASSETS?: Fetcher
 RER_DEPLOY_SOURCE?: string
 RER_DEPLOY_FINGERPRINT?: string
 BALM_INSURANCE_ADAPTER_URL?: string
 BALM_INSURANCE_ADAPTER_TOKEN?: string
 RER_VERSION?: { id: string }
 IDENTITY_PROVIDER?: string
 AUTH_ORIGIN: string
 AUTH_LOCAL?: string
 RER_DEV_ORIGIN?: string
 /** Local runtimes only: the checkout's key gate and dev identity switch. Deploy refuses both. */
 RER_MODELS_SERVICE?: string
 RER_MODELS_KEY?: string
 RER_DEMO?: string
 RER_DEV_KEY?: string
 RER_DEV_IDENTITY?: string
 RER_INSTALLATION_ID?: string
 RER_MANAGEMENT_ORIGIN?: string
 /** A signed owner claim (the hosted demo's front, RER Managed); set together or not at all. */
 RER_OWNER_CLAIM_PUBLIC_KEYS?: string
 RER_OWNER_CLAIM_ISSUER?: string
 RER_OWNER_CLAIM_INSTALLATION_ID?: string
 OWNER_EMAIL: string
 SESSION_SECRET: string
 SETUP_TOKEN?: string
 MAIL_PROVIDER?: 'development' | 'resend' | 'sendgrid' | 'cloudflare'
 MAIL_FROM?: string
 MAIL_API_KEY?: string
 MAIL_ACCOUNT_ID?: string
 BALM_RESEND_WEBHOOK_KEY?: string
 BALM_RESEND_EVENT_NAMESPACE?: string
 BALM_SENDGRID_WEBHOOK_KEY?: string
 BALM_SENDGRID_EVENT_NAMESPACE?: string
}

export const runtimeBindings = (env: Bindings): Bindings => env.RER_DEV_ORIGIN && env.AUTH_LOCAL === 'true' ? { ...env, AUTH_ORIGIN: env.RER_DEV_ORIGIN } : env
export const authConfig = (env: Bindings): AuthConfig => ({ dependencies: true, origin: env.AUTH_ORIGIN, local: env.AUTH_LOCAL === 'true', OWNER_EMAIL: env.OWNER_EMAIL, SESSION_SECRET: env.SESSION_SECRET, SETUP_TOKEN: env.SETUP_TOKEN, MAIL_FROM: env.MAIL_FROM, branding: { productName: branding.name, accentColor: branding.primaryColor, signInPath: '/signin', theme: theme.href } })
export function operatorAuth(env: Bindings) {
 return createOperatorAuth({ db: env.DB, config: authConfig(env), mailSender: operatorMail(env), clientIp: request => request.headers.get('CF-Connecting-IP') ?? '' })
}

const dependencies = (env: Bindings, request: Request) => createDependencies({ db: env.DB, origin: env.AUTH_ORIGIN, name: branding.name, provider: env.IDENTITY_PROVIDER, local: env.AUTH_LOCAL === 'true', auth: operatorAuth(env), claimOwner: token => createIdpOwnerClaimHandler({db:env.DB,authConfig:authConfig(env),clientIp:()=>request.headers.get('CF-Connecting-IP')??''})(new Request(env.AUTH_ORIGIN+'/auth/owner-claim',{method:'POST',headers:{Host:new URL(env.AUTH_ORIGIN).host,Origin:env.AUTH_ORIGIN,'Content-Type':'application/json'},body:JSON.stringify({token})})) })

const seeSettings = (notice: string, issuer = '') => new Response(null, { status: 303, headers: { location: `/auth/settings/identity?${new URLSearchParams({ notice, ...(issuer ? { issuer } : {}) })}`, 'cache-control': 'no-store' } })

/** The owner's page (GET, HTML) and its three forms: the switch, linking Auth, and the email proof linking needs. JSON callers keep Base's door. */
async function identitySettingsResponse(request: Request, env: Bindings): Promise<Response | null> {
 const auth = operatorAuth(env), url = new URL(request.url), form = (request.headers.get('content-type') ?? '').startsWith('application/x-www-form-urlencoded')
 if (request.method === 'GET') {
  if (!/text\/html/.test(request.headers.get('accept') ?? '')) return null
  let value: { idpSignIn: boolean }
  try { value = await auth.identitySettings(request) } catch { return null } // Base answers signed-out and non-owner visitors.
  return identitySettingsView({ ...value, ...await linkState(env.DB), origin: env.AUTH_ORIGIN, local: env.AUTH_LOCAL === 'true', notice: url.searchParams.get('notice') ?? '', issuer: url.searchParams.get('issuer') ?? '', timeZone: await clinicZone(env.DB) }, auth.presentation)
 }
 if (request.method !== 'POST' || !form) return null
 const input = new URLSearchParams(await request.clone().text())
 if (input.get('setting') === 'identity') {
  const response = await createAuthHandler(auth)(request)
  return response?.status === 303 ? seeSettings(input.get('idpSignIn') === 'true' ? 'saved' : 'saved_off') : response
 }
 if (input.get('setting') === 'confirm') {
  try { await auth.requestStepUp(request, { action: 'providers:relink', returnTo: '/auth/settings/identity' }) } catch { return seeSettings('confirm_failed') }
  return seeSettings('emailed')
 }
 if (input.get('setting') === 'link') {
  const issuer = (input.get('issuer') ?? '').trim().replace(/\/+$/, '')
  let valid = false
  // Base links only to a provider at an https address.
  try { const u = new URL(issuer); valid = u.origin === issuer && u.protocol === 'https:' } catch {}
  if (!valid) return seeSettings('invalid_issuer', issuer)
  const relink = new Request(env.AUTH_ORIGIN + '/auth/dependencies/relink', { method: 'POST', headers: { host: url.host, origin: request.headers.get('origin') ?? '', cookie: request.headers.get('cookie') ?? '', 'content-type': 'application/json' }, body: JSON.stringify({ interface: 'oidc-provider@1', issuer }) })
  const response = await dependencies(env, relink).handle(relink)
  const answer: any = await response?.json().catch(() => null)
  if (response && response.ok) return seeSettings('pending', issuer)
  return seeSettings(answer?.error === 'step_up_required' ? 'step_up_required' : ['invalid_link_origin', 'invalid_link'].includes(answer?.error) ? 'invalid_issuer' : 'link_unavailable', issuer)
 }
 return null
}

async function handleAuthResponse(request: Request, original: Bindings): Promise<Response | null> {
 const env = runtimeBindings(original), url = new URL(request.url)
 // A signed owner claim when its keys are configured; a missing part fails closed.
 if (env.RER_OWNER_CLAIM_PUBLIC_KEYS) {
  const signed = await createOwnerClaimHandler({ db: env.DB, authConfig: authConfig(env), clientIp: req => req.headers.get('CF-Connecting-IP') ?? '', issuer: env.RER_OWNER_CLAIM_ISSUER ?? '', installationId: env.RER_OWNER_CLAIM_INSTALLATION_ID ?? '', appOrigin: env.AUTH_ORIGIN, expectedEmail: env.OWNER_EMAIL, publicKeys: JSON.parse(env.RER_OWNER_CLAIM_PUBLIC_KEYS) })(request)
  if (signed) return signed
 }
 if (url.pathname.startsWith('/.well-known/rer-') || url.pathname.startsWith('/auth/dependencies/')) {
  const linked = await dependencies(env, request).handle(request)
  if (linked) return linked
 }
 // Balm's Sign-in settings page: explains the provider and links it from the page.
 if (url.pathname === '/auth/settings/identity') {
  const settings = await identitySettingsResponse(request, env)
  if (settings) return settings
 }
 if (url.pathname === '/auth/owner-claim') return createIdpOwnerClaimHandler({db:env.DB,authConfig:authConfig(env),clientIp:req=>req.headers.get('CF-Connecting-IP')??''})(request)
 // The shared server-rendered sign-in page: plain forms that work before any script.
 if (url.pathname === '/signin') {
  const page = await createSignInHandler(operatorAuth(env), {
   defaultReturnTo: '/setup',
  })(request)
  if (page) return fontDocumentResponse(page)
 }
 if (url.pathname.startsWith('/auth/')) return fontDocumentResponse(await createAuthHandler(operatorAuth(env))(request))
 if (url.pathname === '/setup' || url.pathname === '/app' || url.pathname.startsWith('/app/')) {
  const setup = await firstRunResponse(request, env, operatorAuth(env), { theme })
  if (setup) return setup
 }
 return null
}

export async function authResponse(request: Request, original: Bindings): Promise<Response | null> {
 const response = await handleAuthResponse(request, original)
 return response ? rejectedResponse(request, response) : null
}
