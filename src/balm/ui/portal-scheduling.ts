import { localTime } from '../domain/invoices'
import { h, hidden, money, select } from './shared'
import { zoneLabel } from './time-zone'

const card = (title: string, body: string) => `<section class="card portal-section"><h2>${h(title)}</h2>${body}</section>`

function timeOptions(slots: any[], zone: string) {
  const days = new Map<string, any[]>()
  for (const slot of slots) days.set(slot.hostDate, [...(days.get(slot.hostDate) ?? []), slot])
  return [...days].map(([date, times]) => {
    const label = new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' }).format(new Date(`${date}T00:00:00Z`))
    return `<optgroup label="${h(label)}">${times.map(slot => `<option value="${h(slot.startAt)}">${h(localTime(slot.startAt, zone))}</option>`).join('')}</optgroup>`
  }).join('')
}

export function portalScheduleContent(d: any) {
  const p = d.params ?? {}, moving = d.moving, zone = d.slots?.timeZone ?? d.clinic.time_zone
  const path = moving ? `/portal/appointments/${encodeURIComponent(moving.id)}/move` : '/portal/schedule'
  const back = '<p><a href="/portal/home#visits">Back to your visits</a></p>'
  const original = moving ? `<p>Current visit: <strong>${h(moving.service)}</strong> with <strong>${h(moving.practitioner)}</strong><br>${h(localTime(moving.start_at, zone))}.</p><p>Your service and practitioner stay the same when you move this visit.</p>` : `<p>Book a follow-up for ${h(d.patient.firstName)} ${h(d.patient.lastName)} at ${h(d.clinic.clinic_name)}.</p>`
  if (!moving && (!d.services.length || !d.practitioners.length)) {
    return card('Book a follow-up', `${original}<p>Online follow-up booking is unavailable. Contact the clinic to arrange your next visit.</p>${back}`)
  }
  const choices = moving ? '' : select('serviceId', 'Service', [['', 'Choose a service'], ...d.services.map((s: any) => [s.id, `${s.name} · ${s.duration_minutes} min · ${money(s.price_cents)}`])], p.serviceId)
    + select('practitionerId', 'Practitioner', [['', 'Choose a practitioner'], ...d.practitioners.map((s: any) => [s.id, s.profession ? `${s.name} (${s.profession})` : s.name])], p.practitionerId)
    + ((d.rooms??[]).length?select('roomId','Location / room',[['','No location selected'],...d.rooms.map((r:any)=>[r.id,r.location+' · '+r.name])],p.roomId,''):'')
  const chooser = card(moving ? 'Choose another week' : 'Choose a service and practitioner', `${original}<form method="get" action="${h(path)}">${choices}<label>From date<input type="date" name="from" value="${h(p.from ?? d.slots?.from ?? '')}"></label><button type="submit">Show available times</button></form><p class="help">Appointments follow the clinic’s booking rules. If online booking or changes are unavailable, contact the clinic.</p>`)
  if (!d.slots) return `<div class="left">${chooser}${back}</div>`
  const params = new URLSearchParams({ from: d.slots.next })
  if (!moving) {
    params.set('serviceId', p.serviceId)
    params.set('practitionerId', p.practitionerId)
    params.set('roomId',p.roomId??'')
  }
  const fields = moving ? hidden('id', moving.id) : hidden('serviceId', p.serviceId) + hidden('practitionerId', p.practitionerId)+hidden('roomId',p.roomId??'')
  const times = d.slots.slots.length
    ? `<form method="post" action="/portal/action">${hidden('name', moving ? 'appointment.move' : 'appointment.book')}${fields}<label>Available appointment times<select name="start" required><option value="">Choose a time</option>${timeOptions(d.slots.slots, zone)}</select></label><button type="submit">${moving ? 'Move my appointment' : 'Book my follow-up'}</button></form>`
    : '<p class="empty">No appointment times are available this week. Try another week or contact the clinic.</p>'
  return `<div class="left">${chooser}${card('Choose a time', `<p>Times are in the appointment location’s time zone: ${h(zoneLabel(zone))}.</p>${times}<p><a href="${h(`${path}?${params}`)}">Show the next week</a></p>`)}${back}</div>`
}
