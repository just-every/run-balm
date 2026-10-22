import { estimateNotice } from './estimates'
import { h, hidden } from './shared'
import { portalHomeContent } from './portal-content'
import { portalScheduleContent } from './portal-scheduling'
import { portalStyle } from './portal-style'
import { baseStyle } from './base-style'
import { shellStyle } from './shell-style'
import { icon, iconSprite } from './icons'
import { avatar, lockup } from './shell'

const css = baseStyle + shellStyle + portalStyle
const digest = async (text: string) => btoa(String.fromCharCode(...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)))))
const notice = (d: any) => `${d.notice ? `<p class="portal-notice" role="status">${h(d.notice)}</p>` : ''}${d.error ? `<p class="portal-notice portal-error" role="alert">${h(d.error)}</p>` : ''}`

export async function renderPortal(kind: 'signin' | 'confirm' | 'home' | 'schedule', data: any, status = 200) {
  const home = kind === 'home' || kind === 'schedule'
  const schedule = kind === 'schedule'
  const title = schedule ? (data.moving ? 'Move your appointment' : 'Book a follow-up') : 'Your care'
  const nav = [['visits', 'Upcoming visits', 'calendar'], ['intake', 'Intake forms', 'form'], ['program', 'Home program', 'list'], ['messages', 'Messages', 'message'], ['statements', 'Statements', 'card']]
  const signOut = '<form method="post" action="/portal/signout"><button type="submit" class="quiet">' + icon('signout') + 'Sign out</button></form>'
  const body = home ? `${iconSprite}<a class="skip" href="#portal-content">Skip to content</a><div class="app"><aside class="rail"><div class="rail-inner"><input type="checkbox" id="menu" class="menu-toggle"><div class="rail-head"><a class="brand" href="/portal/home" aria-label="Your care">${lockup}</a><label class="menu-button" for="menu">${icon('menu')}<span>Menu</span></label></div>`
    + `<div class="rail-body"><nav class="rail-nav" aria-label="Patient portal">${nav.map(([id, label, glyph]) => `<a href="${schedule ? '/portal/home' : ''}#${id}">${icon(glyph)}<span>${label}</span></a>`).join('')}</nav><div class="rail-foot"><div class="me">${avatar(`${data.patient.firstName} ${data.patient.lastName}`)}<div><strong>${h(data.patient.firstName)} ${h(data.patient.lastName)}</strong><span>Private portal</span></div></div><div class="me-actions">${signOut}</div></div></div></div></aside>`
    + `<div class="workspace"><main id="portal-content"><header class="portal-top"><h1>${schedule ? h(title) : `Welcome, ${h(data.patient.firstName)}.`}</h1><p>${schedule ? 'Choose an available time for your care.' : 'Your next visit and home program, together.'}</p></header>${notice(data)}${estimateNotice}${schedule ? portalScheduleContent(data) : portalHomeContent(data)}</main></div></div>`
    : `<main class="public signin"><header class="public-head"><a class="brand" href="/portal">${lockup}</a></header><h1>${kind === 'confirm' ? 'Open your patient portal' : 'Your patient portal'}</h1>${notice(data)}<section class="panel">${kind === 'confirm' ? `<p>Continue to your private visits, forms, home program, messages and statements.</p><form method="post" action="/portal/confirm">${hidden('token', data.token)}<button type="submit">Sign in to my portal</button></form>` : `<p>Use the email address on your patient file. We’ll email you a private link to sign in.</p><form method="post" action="/portal"><label>Email address<input name="email" type="email" required maxlength="254" autocomplete="email"></label><button type="submit">Email me a sign-in link</button></form><p class="help">Need to change your email? Contact your clinic.</p>`}</section></main>`
  return new Response(`<!doctype html><html lang="en-US"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${home ? h(title) : 'Patient sign-in'} · Balm</title><link rel="preload" href="/fonts/inter/inter-latin-wght-normal.woff2" as="font" type="font/woff2" crossorigin="anonymous"><link rel="stylesheet" href="/fonts/fonts.css"><link rel="stylesheet" href="/rer-theme.css"><style>${css}</style></head><body${home ? '' : ' class="public-page"'}>${body}</body></html>`, { status, headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', 'referrer-policy': 'same-origin', 'x-content-type-options': 'nosniff', 'x-robots-tag': 'noindex, nofollow', 'content-security-policy': `default-src 'none'; style-src 'self' 'sha256-${await digest(css)}'; font-src 'self'; img-src 'self' data:; form-action 'self'; base-uri 'none'; frame-ancestors 'none'` } })
}
