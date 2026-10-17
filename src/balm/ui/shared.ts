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
/** A cancel button that first asks: the person ticks to confirm, and is told who gets emailed. */
export const cancelForm = (command: string, path: string, fields: string, summary: string, button: string, client: string, count = 1) => `<details class="confirm"><summary>${h(summary)}</summary>${form(command, path, fields
  + `<label class="check"><input type="checkbox" name="confirm" value="on" required><span>Yes, cancel ${count === 1 ? 'this visit' : `these ${count} visits`}. Balm emails ${h(client)} that ${count === 1 ? 'it is' : 'they are'} canceled, if their file has an email address.</span></label>`, button, true)}</details>`
/** A card; `icon` (from icons.ts) sits in a tinted disc beside the title, `extra` adds classes (`full`, `facts`). */
export const panel = (title: string, body: string, extra = '', icon = '') => `<section class="panel${extra ? ' ' + extra : ''}"><h2>${icon ? `<span class="disc">${icon}</span>` : ''}${h(title)}</h2>${body}</section>`
export const empty = (message: string) => `<p class="empty">${h(message)}</p>`
export const exact = (value: unknown) => `<pre>${h(JSON.stringify(value, null, 2))}</pre>`
/** What a chip's words mean, for its tint: closed (grey), refused (coral), needs a look (honey), done (sage), else booked or informational (sky). */
const tone = (text: string) => /^(canceled|void|inactive|revoked|expired|removed|closed|no show|did not attend|taken)/i.test(text) ? 'closed'
  : /(failed|declined|refused)/i.test(text) ? 'refused'
    : /(not signed|no note|not yet|no intake|outstanding|^draft|waiting|sent to|no key|not available|pending|^\d+ of \d+ notes)/i.test(text) ? 'todo'
      : /(^attended|signed|^paid|paid$|^approved|^active|^done|received|^ready|succeeded|checked in|^booked from|accepted)/i.test(text) ? 'done' : 'info'
export const status = (value: unknown) => { const text = String(value ?? '').replace(/_/g, ' ').replace(/^cancelled$/, 'canceled').replace(/^./, c => c.toUpperCase()); return `<span class="status ${tone(text)}">${h(text)}</span>` }
/** A person as initials in a tinted circle; the tint follows the name, so a person keeps theirs on every page. */
export const avatar = (name: string, size = '') => {
  const initials = name.split(/\s+/).filter(Boolean).map(part => part[0]).slice(0, 2).join('').toUpperCase()
  const tint = ['', 'sage', 'sky'][[...name].reduce((sum, c) => sum + c.charCodeAt(0), 0) % 3]
  return `<span class="avatar${tint ? ' ' + tint : ''}${size ? ' ' + size : ''}" aria-hidden="true">${h(initials)}</span>`
}
export const entry = (title: string, body: string) => `<article class="entry"><h3>${h(title)}</h3>${body}</article>`
export const result = (notice: any) => notice.result?.result ?? notice.result
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
