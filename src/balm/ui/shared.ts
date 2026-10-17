// Server-rendered forms on Base's theme; the helpers follow Strap's (src/strap/ui/shared.ts).
import { localTime } from '../domain/invoices'
const escapes: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }
export const h = (value: unknown) => String(value ?? '').replace(/[&<>"']/g, c => escapes[c])
export const rows = (s: any, key: string): any[] => Array.isArray(s[key]) ? s[key] : []
export const owner = (s: any) => s.actor.role === 'owner'
export const desk = (s: any) => owner(s) || s.actor.staffRole === 'reception'
export const clinician = (s: any) => s.actor.staffRole === 'practitioner'
export const hidden = (name: string, value: unknown) => `<input type="hidden" name="${h(name)}" value="${h(value)}">`
export const field = (name: string, label: string, value: unknown = '', type = 'text', attrs = '') => `<label>${h(label)}<input name="${h(name)}" type="${h(type)}" value="${h(value)}" ${attrs}></label>`
export const textarea = (name: string, label: string, value: unknown = '', attrs = '') => `<label>${h(label)}<textarea name="${h(name)}" ${attrs}>${h(value)}</textarea></label>`
export const select = (name: string, label: string, choices: [unknown, unknown][], value: unknown = '', attrs = 'required') => `<label>${h(label)}<select name="${h(name)}" ${attrs}>${choices.map(([id, text]) => `<option value="${h(id)}" ${id === value ? 'selected' : ''}>${h(text)}</option>`).join('')}</select></label>`
export const check = (name: string, label: string, attrs = 'required') => `<label class="check"><input type="checkbox" name="${h(name)}" value="on" ${attrs}><span>${h(label)}</span></label>`
export const form = (command: string, path: string, body: string, button: string, secondary = false) => `<form method="post" action="/app/action?name=${encodeURIComponent(command)}&amp;returnTo=${encodeURIComponent(path)}">${body}<button type="submit"${secondary ? ' class="secondary"' : ''}>${h(button)}</button></form>`
/** A cancel button that first asks: the person checks to confirm, and is told who gets emailed. */
export const cancelForm = (command: string, path: string, fields: string, summary: string, button: string, client: string, count = 1) => `<details class="confirm"><summary>${h(summary)}</summary>${form(command, path, fields
  + `<label class="check"><input type="checkbox" name="confirm" value="on" required><span>Yes, cancel ${count === 1 ? 'this visit' : `these ${count} visits`}. Balm emails ${h(client)} that ${count === 1 ? 'it is' : 'they are'} canceled, if their file has an email address.</span></label>`, button, true)}</details>`
/** `id` anchors the card, for links such as the day view's patient tabs and the case agent's citations. */
export const panel = (title: string, body: string, extra = '', id = '') => `<section class="panel${extra ? ' ' + extra : ''}"${id ? ` id="${h(id)}"` : ''}><h2>${h(title)}</h2>${body}</section>`
export const empty = (message: string) => `<p class="empty">${h(message)}</p>`
export const exact = (value: unknown) => `<pre>${h(JSON.stringify(value, null, 2))}</pre>`
/** A status chip's colour from its words: sage when done, honey when waiting on someone, sky when booked, coral only for a denial or rejection. */
export function tone(text: string) {
  const t = text.toLowerCase()
  if (/\b(denied|rejected|partial|kx required)\b/.test(t)) return 'coral'
  if (/^(paid|approved|attended|active|signed|done|accepted|reconciled|connected|live mode)\b|signed|intake received|intake on file|copay .* paid|checked in|booked from an offer/.test(t) && !/not (yet )?(signed|received)/.test(t)) return 'sage'
  if (/^booked\b|booked online|from the waitlist|series/.test(t)) return 'sky'
  if (/draft|outstanding|not (yet )?(signed|received)|no note yet|waiting|pending|prepared|sending|ready|sent to|expired|inactive|test mode|stalled|due|did not attend/.test(t)) return 'honey'
  return ''
}
export const status = (value: unknown) => {
  const text = String(value ?? '').replace(/_/g, ' ').replace(/^cancelled$/, 'canceled'), t = tone(text)
  return `<span class="status${t ? ' ' + t : ''}">${h(text)}</span>`
}
/** A visit's intake: answered for this visit, already on the client's file from an earlier visit, or still to come. */
export const intakeChip = (a: any) => status(a.intake_received ? 'Intake received' : a.intake_on_file ? 'Intake on file' : 'Intake not yet received')
/** `anchor` gives the record an id the case agent's citations link to. */
export const entry = (title: string, body: string, anchor = '') => `<article class="entry"${anchor ? ` id="${h(anchor)}"` : ''}><h3>${h(title)}</h3>${body}</article>`
export const result = (notice: any) => notice.result?.result ?? notice.result
/** Cents as a person types dollars: 9500 is 95.00. */
export const dollarsField = (cents: unknown) => cents === null || cents === undefined || cents === '' ? '' : (Number(cents) / 100).toFixed(2)
export const money = (cents: unknown) => `${Number(cents ?? 0) < 0 ? '-' : ''}$${(Math.abs(Number(cents ?? 0)) / 100).toFixed(2)}`
/** The clinic's IANA time zone; every date and time on a page is shown in it. */
export const zoneOf = (s: any): string => s.settings.time_zone
/** An instant in the clinic's time zone, with the weekday. */
export const when = (s: any, iso: unknown) => iso ? `<time datetime="${h(iso)}">${h(localTime(String(iso), zoneOf(s)))}</time>` : '—'
/** A recorded moment (an ISO string or epoch milliseconds) in the clinic's time zone, for example Oct 16, 2026, 10:28 PM CDT. */
export const stamp = (s: any, value: unknown) => {
  if (!value) return '—'
  const iso = typeof value === 'number' ? new Date(value).toISOString() : String(value)
  const text = new Intl.DateTimeFormat('en-US', { timeZone: zoneOf(s), month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit', timeZoneName: 'short' }).format(new Date(iso))
  return `<time datetime="${h(iso)}">${h(text)}</time>`
}
/** A calendar date (YYYY-MM-DD) as is, or the clinic-local date of an instant: Oct 16, 2026. */
export const usDate = (value: unknown, zone: string) => {
  if (!value) return '—'
  const plain = /^\d{4}-\d\d-\d\d$/.test(String(value))
  return new Intl.DateTimeFormat('en-US', { timeZone: plain ? 'UTC' : zone, month: 'short', day: 'numeric', year: 'numeric' }).format(new Date(plain ? value + 'T00:00:00Z' : String(value)))
}
export const clientName = (c: any) => `${c.first_name} ${c.last_name}`
export const services = (s: any) => rows(s, 'services').filter(x => x.active)
export const practitioners = (s: any) => rows(s, 'staff').filter(x => x.role === 'practitioner' && (x.active === undefined || x.active))

/** What a staff booking did about intake and email, in one or two sentences, with the private link when one was made. */
/** A value shown for copying whole: a read-only field that never widens its card, with a Copy button (copyScript). */
export const copyBox = (id: string, label: string, value: string, lines = 1) => `<div class="copy"><label for="${h(id)}">${h(label)}</label>${lines > 1
  ? `<textarea id="${h(id)}" readonly rows="${lines}" spellcheck="false">${h(value)}</textarea>`
  : `<input id="${h(id)}" type="text" readonly value="${h(value)}" autocomplete="off" spellcheck="false">`}<button type="button" class="secondary" data-copy="${h(id)}">Copy</button></div>`

export function intakeLine(r: any, first = '', local = false, origin = '') {
  // Balm on this computer sends no email, so it never says it emailed anyone; it shows the link instead.
  const mail = local && r.mail === 'sent' ? 'local' : r.mail
  const timeMail = mail === 'sent' ? ' The booking time was emailed to them.' : ''
  if (r.intake === 'past') return { text: 'This visit is in the past, so no email was sent and no intake form was asked for.', link: '' }
  if (r.intake === 'on_file') return { text: 'Their intake form is already on file, so none was asked for.' + timeMail, link: '' }
  if (r.intake === 'link_open') return { text: 'They already have an intake link for an upcoming visit, so no new one was sent.' + timeMail, link: '' }
  const text = mail === 'sent' ? `The intake link${first} was emailed to the client.` : mail === 'local' ? `Balm on this computer sends no email, so give the client the intake link${first} yourself.` : mail === 'no_email' ? `The client has no email address: give them the intake link${first} yourself.` : `Mail is not set up: give the client the intake link${first} yourself.`
  // The one-time link sits in a copy field inside the notice, so a long token never runs past the card on a phone.
  return { text, link: r.token ? `${copyBox('intake-link', 'Private intake link (shown once)', `${origin}/intake/${r.token}`)}<a class="open-intake" href="/intake/${h(r.token)}">Open the intake form</a>` : '' }
}
