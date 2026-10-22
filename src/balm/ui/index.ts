import { locationPage } from './location'
import { noteDraftScript } from './note-drafts'
import branding from '../../branding.json'
import { agent, copyScript } from './agent'
import { clientFilePage, clientList } from './clients'
import { clinic } from './clinic'
import { recoveryStrip } from './backups'
import { intakeForms } from './intake'
import { insurancePage } from './insurance'
import { casesPage } from './cases'
import { reportsPage } from './reports'
import { breakGlassRequest } from './care-team'
import { insuranceBookingNotice } from './insurance-shared'
import { invoices } from './invoices'
import { movein } from './import'
import { patientMessagePage } from './messages'
import { visitReplyPage } from './reminders'
import { payPage } from './pay'
import { bookPage, consentPage, intakePage, localLinkPage, missingPage, offerPage, planPage, refusedPage } from './public'
import { dragScript } from './drag'
import { schedule, scheduleTop } from './schedule'
import { icon } from './icons'
import { lockup, shell, tabsFor } from './shell'
import { desk, h, rows, stamp, zoneOf } from './shared'
import { style } from './style'
import { waitlist } from './waitlist'
import { browserZoneScript, timeZoneStep } from './time-zone'
import { intakeSignatureScript } from './intake-patient'

type Notice = { breakGlass?: string; message?: string; error?: string; result?: any; invited?: string | null; ask?: Record<string, string>; builder?: { title: string; rows: any[] } }

const digest = async (text: string) => btoa(String.fromCharCode(...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)))))
/** `script` is one inline script the page runs, allowed by its hash alone. /fonts/fonts.css and the theme carry the tokens and fonts; the style is allowed by its hash. */
async function documentFor(title: string, body: string, status: number, script = '', formTargets = '', bodyClass = '', allowDraftRequests = false, frameOrigins: string[] = []) {
  const policy = `style-src 'self' 'sha256-${await digest(style)}'; font-src 'self'; img-src 'self' data:` + (script ? `; script-src 'sha256-${await digest(script)}'` : '') + (allowDraftRequests ? "; connect-src 'self'" : '')
  const html = `<!doctype html><html lang="en-US"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${h(title)}</title><link rel="preload" href="/fonts/inter/inter-latin-wght-normal.woff2" as="font" type="font/woff2" crossorigin="anonymous"><link rel="stylesheet" href="/fonts/fonts.css"><link rel="stylesheet" href="/rer-theme.css"><style>${style}</style></head><body${bodyClass ? ` class="${bodyClass}"` : ''}>${body}${script ? `<script>${script}</script>` : ''}</body></html>`
  return new Response(html, { status, headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', 'content-security-policy': `default-src 'none'; ${policy}; base-uri 'none'; form-action 'self'${formTargets}; frame-ancestors ${frameOrigins.length ? frameOrigins.join(' ') : "'none'"}`, 'referrer-policy': 'same-origin', 'x-content-type-options': 'nosniff', 'x-robots-tag': 'noindex, nofollow' } })
}

export async function renderApp(state: any, path: string, notice: Notice = {}, file?: any, status = 200): Promise<Response> {
  const current = path.split('?')[0].replace(/\/$/, '') || '/app'
  const tabs = tabsFor(state)
  const section = current.startsWith('/app/clients/') ? '/app/clients' : current
  const allowed = tabs.some(t => t.url === section)
  // A new install opens on the time zone step until the owner saves one.
  const zoneUnset = !zoneOf(state)
  const tab = tabs.find(t => t.url === current)
  const title = zoneUnset ? 'Clinic time zone' : notice.breakGlass ? 'Chart outside your care' : current.startsWith('/app/clients/') && file ? `${file.client.first_name} ${file.client.last_name}` : tab?.label ?? 'Page unavailable'
  const content = state.location ? locationPage(state,path) : zoneUnset ? timeZoneStep(state, allowed ? path : '/app') : !allowed ? '<div class="empty-state">' + icon('shield') + '<h1>Page unavailable</h1><p>Your role cannot open this page.</p><a class="button secondary" href="/app">Open the schedule</a></div>'
    : notice.breakGlass ? breakGlassRequest(notice.breakGlass)
    : file ? clientFilePage(state, file, notice)
      : current === '/app/clients' ? clientList(state)
        : current === '/app/insurance' ? insurancePage(state, notice)
        : current === '/app/cases' ? casesPage(state)
        : current === '/app/reports' ? reportsPage(state)
        : current === '/app/invoices' ? invoices(state)
          : current === '/app/clinic' ? clinic(state, notice)
            : current === '/app/intake' ? intakeForms(state, notice)
              : current === '/app/import' ? movein(state, notice)
                : current === '/app/agent' ? agent(state, notice)
                    : current === '/app/waitlist' ? waitlist(state)
                      : schedule(state, notice)
  const book = !zoneUnset && allowed && current !== '/app' && (desk(state) || state.actor.staffId) && rows(state, 'services').some(x => x.active) ? `<a class="button new" href="/app#book">${icon('plus')}Book a visit</a>` : ''
  const top = zoneUnset ? '<div class="crumb"><strong>First run</strong></div>' : current === '/app' && allowed && state.calendar ? scheduleTop(state)
    : `<div class="crumb">${file ? `<a href="/app/clients">Clients</a>${icon('chevron')}<strong>${h(title)}</strong>` : `<strong>${h(title)}</strong>`}</div><span class="grow"></span>${book}`
  const queue = (state.coSignQueue ?? []).length ? `<section class="panel full"><h2>Notes awaiting your co-signature</h2>${state.coSignQueue.map((n:any)=>`<p><a href="/app/clients/${h(n.client_id)}#note-${h(n.note_id)}">${h(n.client)} · ${h(n.author)} · revision ${h(n.revision)}</a>${n.kind==='supervision_details'?' · supervision details needed':''} · ${n.due_at ? (n.overdue ? '<strong>Overdue</strong> · ' : 'Due · ')+stamp(state,n.due_at) : 'State deadline not recorded'}</p>`).join('')}</section>` : ''
  const notices = queue + `${notice.error ? `<div class="notice error" role="alert">${h(notice.error)}</div>` : ''}${notice.message ? `<div class="notice" role="status">${h(notice.message)}</div>` : ''}${insuranceBookingNotice(notice, path)}`
  const body = shell(state, { tabs, section, zoneUnset, top, content: notices + (current === '/app' && allowed && !zoneUnset ? recoveryStrip(state) : '') + content })
  return documentFor(`${title} · ${branding.name}`, body, allowed || zoneUnset ? status : 403, zoneUnset ? browserZoneScript : !allowed ? '' : current === '/app' ? dragScript + ';' + copyScript : current.startsWith('/app/clients/') ? copyScript + ';' + noteDraftScript : current === '/app/agent' ? copyScript : current === '/app/clinic' ? browserZoneScript : '', '', '', allowed && !zoneUnset && !!file)
}

export async function renderPublic(kind: 'book' | 'consent' | 'intake' | 'offer' | 'pay' | 'plan' | 'visit' | 'messages' | 'missing' | 'local-link' | 'refused', data: any, status = 200): Promise<Response> {
  const clinicName = data.clinic?.clinic_name ?? data.appointment?.clinic_name ?? data.offer?.clinic_name ?? data.content?.clinic.name ?? branding.name
  const content = kind === 'consent' ? consentPage(data) : kind === 'book' ? bookPage(data) : kind === 'intake' ? intakePage(data) : kind === 'offer' ? offerPage(data) : kind === 'pay' ? payPage(data) : kind === 'plan' ? planPage(data) : kind === 'visit' ? visitReplyPage(data) : kind === 'messages' ? patientMessagePage(data) : kind === 'local-link' ? localLinkPage() : kind === 'refused' ? refusedPage(data) : missingPage()
  const body = `<main id="main" class="public"><header class="public-head">${lockup}${clinicName === branding.name ? '' : `<span class="clinic">${h(clinicName)}</span>`}</header>${data.error ? `<div class="notice error" role="alert">${h(data.error)}</div>` : ''}${content}</main>`
  // The pay page's forms continue on Stripe's own checkout page.
  return documentFor(`${kind === 'book' ? 'Book online' : kind === 'consent' ? 'Consent documents' : kind === 'intake' ? 'Intake form' : kind === 'offer' ? 'Waitlist offer' : kind === 'pay' ? 'Your account' : kind === 'plan' ? 'Plan of care' : kind === 'visit' ? 'Your visit' : kind === 'messages' ? 'Secure messages' : kind === 'local-link' ? 'Open this link on this computer' : kind === 'refused' ? 'No access' : 'Link not found'} · ${clinicName}`, body, status, (kind === 'intake' || kind === 'consent') ? intakeSignatureScript : '', kind === 'pay' ? ' https://checkout.stripe.com' : '', 'public-page', false, kind === 'book' ? data.embedOrigins ?? [] : [])
}
