// The two pages a client sees: online booking and the private intake link.
import { localTime } from '../domain/invoices'
import { h, money } from './shared'

const option = (value: unknown, label: unknown, current: unknown) => `<option value="${h(value)}" ${value === current ? 'selected' : ''}>${h(label)}</option>`

export function bookPage(d: any) {
  if (!d.clinic?.booking_open) return '<h1>Online booking is closed</h1><p>Please contact the clinic to make an appointment.</p>'
  if (!d.services.length || !d.practitioners.length) return '<h1>Online booking is not set up yet</h1><p>The clinic has not published services and practitioners for online booking. Please contact the clinic.</p>'
  const p = d.params ?? {}, zone = d.clinic.time_zone
  const chooser = `<section class="panel"><h2>1. Choose a service and practitioner</h2><form method="get" action="/book">
    <label>Service<select name="serviceId" required><option value="">Choose a service</option>${d.services.map((s: any) => option(s.id, `${s.name} · ${s.duration_minutes} min · ${money(s.price_cents)}`, p.serviceId)).join('')}</select></label>
    <label>Practitioner<select name="practitionerId" required><option value="">Choose a practitioner</option>${d.practitioners.map((s: any) => option(s.id, s.profession ? `${s.name} (${s.profession})` : s.name, p.practitionerId)).join('')}</select></label>
    <label>From date<input type="date" name="from" value="${h(p.from ?? '')}"></label><button type="submit">Show available times</button></form></section>`
  let times = ''
  if (d.slots) {
    const byDay = new Map<string, any[]>()
    for (const slot of d.slots.slots) byDay.set(slot.hostDate, [...(byDay.get(slot.hostDate) ?? []), slot])
    const link = (start: string) => `/book?${new URLSearchParams({ serviceId: p.serviceId, practitionerId: p.practitionerId, from: d.slots.from, start })}`
    times = `<section class="panel"><h2>2. Choose a time</h2><p>Times are in the clinic's time zone (${h(zone)}).</p>${byDay.size ? [...byDay].map(([day, slots]) => `<h3>${h(new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', weekday: 'long', day: 'numeric', month: 'long' }).format(new Date(day + 'T00:00:00Z')))}</h3><div class="slots">${slots.map(s => `<a class="slot${s.startAt === p.start ? ' chosen' : ''}" href="${h(link(s.startAt))}">${h(new Intl.DateTimeFormat('en-US', { timeZone: zone, hour: 'numeric', minute: '2-digit' }).format(new Date(s.startAt)))}</a>`).join('')}</div>`).join('') : '<p class="empty">No times are available this week.</p>'}
      <p><a href="/book?${h(new URLSearchParams({ serviceId: p.serviceId, practitionerId: p.practitionerId, from: d.slots.next }))}">Show the next week</a></p></section>`
  }
  const details = p.start && d.slots ? `<section class="panel"><h2>3. Your details</h2><p>Booking <strong>${h(d.slots.service.name)}</strong> with <strong>${h(d.slots.practitioner.name)}</strong> on <strong>${h(localTime(p.start, zone))}</strong>.</p>
    <form method="post" action="/book"><input type="hidden" name="serviceId" value="${h(p.serviceId)}"><input type="hidden" name="practitionerId" value="${h(p.practitionerId)}"><input type="hidden" name="start" value="${h(p.start)}">
    <div class="pair"><label>First name<input name="firstName" required maxlength="80" autocomplete="given-name"></label><label>Last name<input name="lastName" required maxlength="80" autocomplete="family-name"></label></div>
    <div class="pair"><label>Date of birth<input type="date" name="dateOfBirth" required autocomplete="bday"></label><label>Mobile (optional)<input name="phone" maxlength="40" autocomplete="tel"></label></div>
    <label>Email<input type="email" name="email" required maxlength="254" autocomplete="email"></label>
    <label class="trap" aria-hidden="true">Website<input name="website" tabindex="-1" autocomplete="off"></label>
    <label class="check"><input type="checkbox" name="privacy" value="on" required><span>I agree that ${h(d.clinic.clinic_name)} keeps my details and health information in its own clinic records to provide my care.</span></label>
    <button type="submit">Book this appointment</button></form><p class="help">Next you will get a private link to your intake form.</p></section>` : ''
  return `<h1>Book an appointment</h1><p>New clients can book online. You will complete a short intake form before your first visit.</p>${chooser}${times}${details}`
}

function question(q: any) {
  const name = 'q_' + q.id, req = q.required ? ' required' : '', label = h(q.label) + (q.required ? '' : ' <span class="help">(optional)</span>')
  if (q.type === 'yes') return `<label class="check"><input type="checkbox" name="${h(name)}" value="yes"${req}><span>${label}</span></label>`
  if (q.type === 'long') return `<label>${label}<textarea name="${h(name)}" maxlength="5000"${req}></textarea></label>`
  return `<label>${label}<input name="${h(name)}" type="${q.type === 'date' ? 'date' : 'text'}" maxlength="300"${req}></label>`
}

export function intakePage(d: any) {
  const a = d.appointment, when = localTime(a.start_at, a.time_zone)
  const booked = d.booked ? `<div class="notice" role="status"><strong>You're booked.</strong> ${h(a.service_name)} with ${h(a.practitioner_name)} on ${h(when)}. ${d.mail === 'sent' ? 'We emailed you this private link.' : 'Keep this page’s address: it is your private link to the form.'}</div>` : ''
  if (d.submittedAt) return `${booked}<h1>Thank you, ${h(a.first_name)}</h1><p>${h(a.clinic_name)} received your intake form on ${h(localTime(d.submittedAt, a.time_zone))}. Your practitioner will read it before your visit.</p><p>Appointment: ${h(a.service_name)} with ${h(a.practitioner_name)}, ${h(when)}.</p>`
  return `${booked}<h1>Intake form</h1><p>Hello ${h(a.first_name)}. Please complete this before your ${h(a.service_name)} appointment with ${h(a.practitioner_name)} on ${h(when)}. Only your treating practitioner and the clinic owner can read your answers.</p>
    <section class="panel"><h2>${h(d.form.title)}</h2><form method="post" action=""><input type="hidden" name="formId" value="${h(d.form.id)}">${d.form.questions.map(question).join('')}<button type="submit">Send my intake form</button></form></section>`
}

export const missingPage = () => '<h1>This link is not available</h1><p>The link may be mistyped, or the appointment was canceled. Please contact the clinic.</p>'
