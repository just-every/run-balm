// The owner's Sign-in settings, completable from the page alone: what a linked
// identity provider is, which one works (an Auth install), how to link it step by
// step from here, and the provider sign-in switch only once a provider is linked.
// Linking itself is Base's dependencies module: the owner's fresh email proof opens
// a ten-minute app approval (/auth/dependencies/relink), and Auth's administrator
// approves the same link on Auth's Apps page.
// @ts-expect-error Base's auth page frame ships without type declarations.
import { pageResponse } from '../modules/operator-auth/page.mjs'

type Link = { issuer: string; linked: boolean } | null
type Pending = { issuer: string; expiresAt: number } | null
type View = { idpSignIn: boolean; link: Link; pending: Pending; origin: string; local: boolean; notice: string; issuer: string }

const escape = (value: unknown) => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!))
const clock = (ms: number) => new Intl.DateTimeFormat('en-US', { hour: 'numeric', minute: '2-digit', timeZoneName: 'short' }).format(new Date(ms))

const notices: Record<string, [string, boolean]> = {
  saved: ['Saved. Invited people can now sign in through Auth as well as by email link.', false],
  saved_off: ['Saved. Invited people sign in by email link only.', false],
  pending: ['Balm is ready to accept the link. Now approve it in Auth (step 3) within ten minutes.', false],
  emailed: ['We emailed you a confirmation link. Open it in this browser, then come back and select Connect to Auth again.', false],
  step_up_required: ['Balm needs to check it is you before linking. Select “Email me a confirmation link” below.', true],
  invalid_issuer: ['Enter Auth’s address exactly as it appears in your browser, starting with https://, with nothing after the host name.', true],
  confirm_failed: ['Balm could not email you a confirmation link just now. Wait a minute and try again.', true],
  link_unavailable: ['Balm could not start the link. Check Auth’s address and try again.', true],
}

const what = '<p>A <strong>linked identity provider</strong> is a separate sign-in service your clinic runs for all its apps. Once linked, staff you invited to Balm can sign in with that one account (a passkey or Auth’s own email link) instead of waiting for Balm’s email link, and turning someone off there signs them out of Balm too.</p>'
  + '<p><strong>Which providers work:</strong> Balm links to <a href="https://run-auth.com">Auth</a>, the open-source sign-in service from Run Edit Run, deployed to your own Cloudflare account. Google Workspace, Microsoft 365 and Okta cannot be linked directly. Without a provider, everyone signs in with email links, which always keeps working.</p>'

function steps(v: View) {
  // Base links only to a provider at an https address, so a Balm on this computer has nothing to link yet.
  if (v.local) return '<h2>Link Auth</h2><p>Linking needs Balm and Auth at secure <code>https://</code> addresses, so it is done on a deployed Balm, not on this computer. Deploy Balm (see <a href="https://run-balm.com/docs/deploy">Deploy</a>) and Auth (see <a href="https://run-auth.com/run">run-auth.com/run</a>), then open this page in the deployed Balm: it walks you through linking there. Until then, everyone signs in with email links, and to try another person here, run <code>rer dev --as their@email</code>.</p>'
  return '<h2>Link Auth</h2><ol>'
    + `<li><strong>Have Auth running</strong> at its own <code>https://</code> address, such as <code>https://auth.yourclinic.com</code>. To set one up, follow <a href="https://run-auth.com/run">run-auth.com/run</a>. Each staff member needs an Auth account with the same email address Balm invited.</li>`
    + `<li><strong>Connect from here.</strong> Enter Auth’s address and select <strong>Connect to Auth</strong>. If Balm asks, select <strong>Email me a confirmation link</strong>, open that email in this browser, and select Connect to Auth again.<form action="/auth/settings/identity" method="post"><input type="hidden" name="setting" value="link"><label for="issuer">Auth’s address</label><input id="issuer" name="issuer" type="url" required placeholder="https://auth.yourclinic.com" value="${escape(v.issuer || v.pending?.issuer || '')}"><button>Connect to Auth</button></form>`
    + `<form action="/auth/settings/identity" method="post"><input type="hidden" name="setting" value="confirm"><button class="secondary">Email me a confirmation link</button></form></li>`
    + `<li><strong>Approve in Auth within ten minutes.</strong> Sign in to Auth as an administrator, open <strong>Apps</strong>, enter Balm’s address under <strong>Add an app</strong>:<br><code>${escape(v.origin)}</code><br>then select <strong>Check app</strong> and <strong>Approve app</strong>.</li>`
    + '<li><strong>Come back and refresh this page.</strong> It shows “Linked to Auth”. Then tick <strong>Allow provider sign-in</strong> and save.</li></ol>'
}

export async function identitySettingsView(v: View, branding: unknown) {
  const [text, error] = notices[v.notice] ?? ['', false]
  const note = text ? `<div class="notice${error ? ' error' : ''}" role="${error ? 'alert' : 'status'}">${escape(text)}</div>` : ''
  const linked = v.link?.linked
  const state = linked
    ? `<p><strong>Linked to Auth at ${escape(v.link!.issuer)}.</strong> Provider sign-in is <strong>${v.idpSignIn ? 'on' : 'off'}</strong>.</p>`
      + `<form action="/auth/settings/identity" method="post"><input type="hidden" name="setting" value="identity"><label class="check"><input type="checkbox" name="idpSignIn" value="true"${v.idpSignIn ? ' checked' : ''}>Allow provider sign-in: invited staff may sign in through Auth. Email links remain available to everyone, and to you as the owner.</label><button>Save settings</button></form>`
    : v.pending && v.pending.expiresAt > Date.now()
      ? `<p><strong>Waiting for Auth to approve the link</strong> to ${escape(v.pending.issuer)} until ${escape(clock(v.pending.expiresAt))}. Approve it in Auth (step 3), then refresh this page.</p>`
      : `<p><strong>No identity provider is linked.</strong> Everyone signs in with email links. Provider sign-in can be turned on once Auth is linked.</p>`
  const content = note + state + what + (linked ? '<details><summary>How linking works</summary>' + steps(v) + '</details>' : steps(v)) + '<p class="secondary-link"><a href="/app">Back to app</a></p>'
  return pageResponse({ branding, title: 'Sign-in settings', heading: 'Sign-in settings', content, referrer: 'strict-origin' })
}

/** The link and pending approval as the dependencies module stores them. */
export async function linkState(db: D1Database): Promise<{ link: Link; pending: Pending }> {
  const link = await db.prepare("SELECT issuer,needs_relink FROM rer_dependency_link WHERE interface='oidc-provider@1'").first<{ issuer: string; needs_relink: number }>()
  const pending = await db.prepare("SELECT issuer,expires_at FROM rer_dependency_pending WHERE interface='oidc-provider@1'").first<{ issuer: string; expires_at: number }>()
  return { link: link ? { issuer: link.issuer, linked: !link.needs_relink } : null, pending: pending ? { issuer: pending.issuer, expiresAt: Number(pending.expires_at) } : null }
}
