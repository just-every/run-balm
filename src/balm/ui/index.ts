import { fontHead } from '../../base/font-head'
import { themeFrame } from '../../base/theme-frame'
import branding from '../../branding.json'
import { agent, copyScript } from './agent'
import { clientFilePage, clientList } from './clients'
import { clinic } from './clinic'
import { intakeForms } from './intake'
import { insurancePage } from './insurance'
import { insuranceBookingNotice } from './insurance-shared'
import { invoices } from './invoices'
import { movein } from './import'
import { patientMessagePage } from './messages'
import { visitReplyPage } from './reminders'
import { payPage } from './pay'
import { bookPage, intakePage, localLinkPage, missingPage, offerPage, planPage, refusedPage } from './public'
import { dragScript } from './drag'
import { schedule } from './schedule'
import { desk, h, owner, zoneOf } from './shared'
import { style } from './style'
import { waitlist } from './waitlist'
import { browserZoneScript, timeZoneStep } from './time-zone'
import { intakeSignatureScript } from './intake-patient'

type Notice = { message?: string; error?: string; result?: any; invited?: string | null; ask?: Record<string, string>; builder?: { title: string; rows: any[] } }

const digest = async (text: string) => btoa(String.fromCharCode(...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)))))
/** `script` is one inline script the page runs, allowed by its hash alone. */
async function documentFor(title: string, body: string, status: number, script = '', formTargets = '') {
  const frame = await themeFrame({ href: '/rer-theme.css', productName: branding.name, accentColor: branding.primaryColor })
  const policy = frame.policy.replace("img-src 'self'", "img-src 'self' data:").replace("style-src 'self'", `style-src 'self' 'sha256-${await digest(style)}'`) + (script ? `; script-src 'sha256-${await digest(script)}'` : '')
  const html = `<!doctype html><html lang="en-US"${frame.htmlClass}><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${h(title)}</title>${fontHead}${frame.head}<style>${style}</style></head><body>${body.replace('{{brand}}', frame.brand)}${script ? `<script>${script}</script>` : ''}</body></html>`
  return new Response(html, { status, headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', 'content-security-policy': `default-src 'none'; ${policy}; base-uri 'none'; form-action 'self'${formTargets}; frame-ancestors 'none'`, 'referrer-policy': 'same-origin', 'x-content-type-options': 'nosniff', 'x-robots-tag': 'noindex, nofollow' } })
}

export async function renderApp(state: any, path: string, notice: Notice = {}, file?: any, status = 200): Promise<Response> {
  const current = path.split('?')[0].replace(/\/$/, '') || '/app'
  const tabs: [string, string][] = [['/app', 'Schedule'], ...(desk(state) || state.actor.staffId ? [['/app/waitlist', 'Waitlist']] as [string, string][] : []), ['/app/clients', 'Clients'],
    ...(desk(state) ? [['/app/invoices', 'Invoices and reminders'], ['/app/insurance', 'Insurance']] as [string, string][] : []),
    ...(owner(state) ? [['/app/clinic', 'Clinic'], ['/app/intake', 'Intake form'], ['/app/import', 'Move in'], ['/app/agent', 'Agent access']] as [string, string][] : [])]
  const section = current.startsWith('/app/clients/') ? '/app/clients' : current
  const allowed = tabs.some(([url]) => url === section)
  // A new install opens on the time zone step until the owner saves one.
  const zoneUnset = !zoneOf(state)
  const title = zoneUnset ? 'Clinic time zone' : current.startsWith('/app/clients/') && file ? `${file.client.first_name} ${file.client.last_name}` : tabs.find(([url]) => url === current)?.[1] ?? 'Page unavailable'
  const content = zoneUnset ? timeZoneStep(state, allowed ? path : '/app') : !allowed ? '<h1>Page unavailable</h1><p>Your role cannot open this page.</p><p><a href="/app">Open the schedule</a></p>'
    : file ? clientFilePage(state, file, notice)
      : current === '/app/clients' ? clientList(state)
        : current === '/app/insurance' ? insurancePage(state, notice)
        : current === '/app/invoices' ? invoices(state)
          : current === '/app/clinic' ? clinic(state, notice)
            : current === '/app/intake' ? intakeForms(state, notice)
              : current === '/app/import' ? movein(state, notice)
                : current === '/app/agent' ? agent(state, notice)
                    : current === '/app/waitlist' ? waitlist(state)
                      : schedule(state, notice)
  const clinicName = state.settings?.clinic_name ?? branding.name
  const body = `<main id="main"><a class="skip" href="#content">Skip to content</a><header class="app-header"><a href="/app" aria-label="${h(branding.name)} home">{{brand}}</a><div class="identity"><span>${h(clinicName)} · ${h(state.actor.email)} · ${h(state.actor.role)}</span>${owner(state) ? '<a href="/auth/settings/identity">Sign-in settings</a>' : ''}<form method="post" action="/app/action?name=session.signout&amp;returnTo=/app"><button type="submit" class="secondary">Sign out</button></form></div></header>${zoneUnset ? '' : `<nav aria-label="Clinic">${tabs.map(([url, text]) => `<a href="${h(url)}" ${section === url ? 'aria-current="page"' : ''}>${h(text)}</a>`).join('')}</nav>`}<div id="content">${notice.error ? `<div class="notice error" role="alert">${h(notice.error)}</div>` : ''}${notice.message ? `<div class="notice" role="status">${h(notice.message)}</div>` : ''}${insuranceBookingNotice(notice, path)}${content}</div></main>`
  return documentFor(`${title} · ${branding.name}`, body, allowed || zoneUnset ? status : 403, zoneUnset ? browserZoneScript : !allowed ? '' : current === '/app' ? dragScript : current === '/app/agent' ? copyScript : current === '/app/clinic' ? browserZoneScript : '')
}

export async function renderPublic(kind: 'book' | 'intake' | 'offer' | 'pay' | 'plan' | 'visit' | 'messages' | 'missing' | 'local-link' | 'refused', data: any, status = 200): Promise<Response> {
  const clinicName = data.clinic?.clinic_name ?? data.appointment?.clinic_name ?? data.offer?.clinic_name ?? data.content?.clinic.name ?? branding.name
  const content = kind === 'book' ? bookPage(data) : kind === 'intake' ? intakePage(data) : kind === 'offer' ? offerPage(data) : kind === 'pay' ? payPage(data) : kind === 'plan' ? planPage(data) : kind === 'visit' ? visitReplyPage(data) : kind === 'messages' ? patientMessagePage(data) : kind === 'local-link' ? localLinkPage() : kind === 'refused' ? refusedPage(data) : missingPage()
  const body = `<main id="main" class="public"><header class="app-header"><span>{{brand}}</span>${clinicName === branding.name ? '' : `<span class="identity">${h(clinicName)}</span>`}</header>${data.error ? `<div class="notice error" role="alert">${h(data.error)}</div>` : ''}${content}</main>`
  // The pay page's forms continue on Stripe's own checkout page.
  return documentFor(`${kind === 'book' ? 'Book online' : kind === 'intake' ? 'Intake form' : kind === 'offer' ? 'Waitlist offer' : kind === 'pay' ? 'Your account' : kind === 'plan' ? 'Plan of care' : kind === 'visit' ? 'Your visit' : kind === 'messages' ? 'Secure messages' : kind === 'local-link' ? 'Open this link on this computer' : kind === 'refused' ? 'No access' : 'Link not found'} · ${clinicName}`, body, status, kind === 'intake' ? intakeSignatureScript : '', kind === 'pay' ? ' https://checkout.stripe.com' : '')
}
