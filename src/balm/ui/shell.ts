// The signed-in app's frame, as the owner-picked screen draws it: a slim left rail
// (the Balm lockup, the pages with their counts, the clinic and the signed-in
// person at its foot) and a top bar with the page's own controls and Book a visit.
// On phones the rail folds into a header whose menu opens without JavaScript.
import branding from '../../branding.json'
import { icon, iconSprite } from './icons'
import { desk, h, owner, rows } from './shared'

export type Tab = { url: string; label: string; icon: string; count?: number; tone?: 'honey' | 'coral' }

/** The pages this person can open, with the counts that need them. */
export function tabsFor(s: any): Tab[] {
  if (s.location) return [{url:'/app',label:'Location schedule',icon:'calendar'},{url:'/app/reports',label:'Location reports',icon:'bars'}]
  if (s.actor.role !== 'owner' && s.actor.staffKind === 'biller') return [{url:'/app/clients',label:'Clients',icon:'person'},{url:'/app/invoices',label:'Invoices',icon:'card'},{url:'/app/insurance',label:'Insurance',icon:'claim'},{url:'/app/reports',label:'Financial reports',icon:'bars'}]
  const waiting = rows(s, 'invoices').filter(i => i.status === 'draft').length + rows(s, 'drafts').filter(d => d.type === 'reminder' && d.status === 'draft').length
  const fixes = (s.insurance?.queue ?? []).filter((q: any) => ['denied', 'rejected', 'partial'].includes(q.status)).length
  return [
    { url: '/app', label: 'Schedule', icon: 'calendar' },
    ...(desk(s) || s.actor.staffId ? [{ url: '/app/waitlist', label: 'Waitlist', icon: 'clock', count: (s.waitlist?.entries ?? []).filter((e: any) => e.status === 'waiting').length }] : []),
    { url: '/app/clients', label: 'Clients', icon: 'person' },
    ...(desk(s) ? [
      { url: '/app/invoices', label: 'Invoices and reminders', icon: 'card', count: waiting, tone: 'honey' as const },
      { url: '/app/insurance', label: 'Insurance', icon: 'claim', count: fixes, tone: 'coral' as const },
      { url: '/app/cases', label: 'Cases', icon: 'case' },
    ] : []),
    ...(owner(s) ? [
      { url: '/app/clinic', label: 'Clinic', icon: 'gear' }, { url: '/app/reports', label: 'Reports', icon: 'bars' }, { url: '/app/intake', label: 'Intake form', icon: 'form' },
      { url: '/app/import', label: 'Move in', icon: 'upload' }, { url: '/app/agent', label: 'Agent access', icon: 'key' },
    ] : []),
  ]
}

const initials = (name: string) => name.replace(/^(Dr|Mr|Mrs|Ms)\.?\s+/i, '').split(/[\s@.]+/).filter(Boolean).slice(0, 2).map(w => w[0]!.toUpperCase()).join('')
export const avatar = (name: string, extra = '') => `<span class="avatar${extra ? ' ' + extra : ''}" aria-hidden="true">${h(initials(name))}</span>`

/** The signed-in person as the rail's foot names them: their staff name and credentials when they have a staff row. */
function person(s: any) {
  const me = rows(s, 'staff').find(p => p.id === s.actor.staffId) ?? rows(s, 'staff').find(p => String(p.email ?? '').toLowerCase() === String(s.actor.email).toLowerCase())
  return { name: me ? `${me.name}${me.credentials ? `, ${me.credentials}` : ''}` : s.actor.email, initials: me?.name ?? s.actor.email }
}

export const lockup = `<span class="lockup"><img src="/brand/mark.svg" alt="" width="30" height="30"><span>${h(branding.name)}</span></span>`

export function shell(s: any, o: { tabs: Tab[]; section: string; zoneUnset: boolean; top: string; content: string }) {
  const clinicName = s.settings?.clinic_name ?? branding.name, me = person(s)
  const nav = o.zoneUnset ? '' : `<nav class="rail-nav" aria-label="Clinic">${o.tabs.map(t => `<a href="${h(t.url)}"${o.section === t.url ? ' aria-current="page"' : ''}>${icon(t.icon)}<span>${h(t.label)}</span>${t.count ? `<span class="count${t.tone ? ' ' + t.tone : ''}" aria-label="${t.count} waiting">${t.count}</span>` : ''}</a>`).join('')}</nav>`
  const foot = `<div class="rail-foot"><p class="clinic">${icon('pin')}<span>${h(clinicName)}</span></p><div class="me">${avatar(me.initials)}<div><strong>${h(me.name)}</strong><span title="${h(s.actor.email)}">${h(s.actor.role === 'owner' ? 'Owner' : s.actor.staffKind && !['practitioner','reception'].includes(s.actor.staffKind) ? s.actor.staffKind.replace('_',' ') : s.actor.staffRole === 'reception' ? 'Reception' : s.actor.staffRole === 'practitioner' ? 'Practitioner' : s.actor.role)}</span></div></div>`
    + `<div class="me-actions">${owner(s) ? `<a href="/auth/settings/identity">Sign-in settings</a>` : ''}<form method="post" action="/app/action?name=session.signout&amp;returnTo=/app"><button type="submit" class="quiet">${icon('signout')}Sign out</button></form></div></div>`
  return `${iconSprite}<a class="skip" href="#content">Skip to content</a><div class="app">`
    + `<aside class="rail"><div class="rail-inner">${nav ? '<input type="checkbox" id="menu" class="menu-toggle">' : ''}<div class="rail-head"><a class="brand" href="/app" aria-label="${h(branding.name)} schedule">${lockup}</a>${nav ? `<label class="menu-button" for="menu">${icon('menu')}<span>Menu</span></label>` : ''}</div><div class="rail-body">${nav}${foot}</div></div></aside>`
    + `<div class="workspace"><header class="topbar">${o.top}</header><main id="main"><div id="content">${o.content}</div></main></div></div>`
}
