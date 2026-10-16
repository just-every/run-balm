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
export const panel = (title: string, body: string, extra = '') => `<section class="panel${extra ? ' ' + extra : ''}"><h2>${h(title)}</h2>${body}</section>`
export const empty = (message: string) => `<p class="empty">${h(message)}</p>`
export const exact = (value: unknown) => `<pre>${h(JSON.stringify(value, null, 2))}</pre>`
export const status = (value: unknown) => `<span class="status">${h(String(value ?? '').replace(/_/g, ' ').replace(/^cancelled$/, 'canceled'))}</span>`
export const entry = (title: string, body: string) => `<article class="entry"><h3>${h(title)}</h3>${body}</article>`
export const result = (notice: any) => notice.result?.result ?? notice.result
export const money = (cents: unknown) => `$${(Number(cents ?? 0) / 100).toFixed(2)}`
/** An instant in the clinic's time zone. */
export const when = (s: any, iso: unknown) => iso ? `<time datetime="${h(iso)}">${h(localTime(String(iso), s.settings?.time_zone ?? 'Australia/Brisbane'))}</time>` : '—'
export const stamp = (value: unknown) => {
  if (!value) return '—'
  const iso = typeof value === 'number' ? new Date(value).toISOString() : String(value)
  return `<time datetime="${h(iso)}">${h(iso.replace('T', ' ').replace(/\.\d{3}Z$/, ' UTC').replace(/Z$/, ' UTC'))}</time>`
}
export const clientName = (c: any) => `${c.first_name} ${c.last_name}`
export const services = (s: any) => rows(s, 'services').filter(x => x.active)
export const practitioners = (s: any) => rows(s, 'staff').filter(x => x.role === 'practitioner' && (x.active === undefined || x.active))
