// The two pages a client sees: online booking and the private intake link.
import { localTime } from '../domain/invoices'
import { h, money } from './shared'
import { frequency, usDate } from './plans'

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

export function offerPage(d: any) {
  const o = d.offer, when = localTime(o.start_at, o.time_zone), what = `${h(o.service)} with ${h(o.practitioner)} on ${h(when)}`
  if (d.state === 'yours') return `<h1>You're booked, ${h(o.first_name)}</h1><p>${what}. We emailed you the details and your intake link.</p>`
  if (d.state === 'taken') return `<h1>This time has been taken</h1><p>Sorry, ${h(o.first_name)}: someone else on the waitlist accepted ${what} first. You are still on ${h(o.clinic_name)}'s waitlist, and we will email you when another time opens up.</p>`
  if (d.state === 'past') return `<h1>This offer has closed</h1><p>${what} is too close to book from the waitlist now. You are still on the waitlist.</p>`
  return `<h1>A time opened up</h1><p>Hello ${h(o.first_name)}. ${h(o.clinic_name)} has a time for you: <strong>${what}</strong>.</p><p>It was offered to everyone waiting for it, and the first person to accept gets it.</p>
    <form method="post" action=""><button type="submit">Book this time</button></form>`
}

export const missingPage = () => '<h1>This link is not available</h1><p>The link may be mistyped, or the appointment was canceled. Please contact the clinic.</p>'

/** The referring physician's page: read the plan of care and sign it, no account needed. */
export function planPage(d: any) {
  if (d.status === 'certified') return `<h1>Plan of care signed</h1><p>Thank you, ${h(d.certifierName)}. You signed this plan of care on ${h(usDate(d.certifiedAt))}. The clinic has your certification; you can close this page.</p>`
  const c = d.content
  return `<h1>Plan of care to sign</h1><p>${h(c.clinic.name)} asks you, ${h(d.physicianName)}, to review and certify this therapy plan of care.</p>
    <section class="panel"><h2>${h(c.patient.name)}</h2><p>${c.patient.dateOfBirth ? `Date of birth ${h(usDate(c.patient.dateOfBirth))}<br>` : ''}${h(c.clinic.name)}${c.clinic.address ? ` · ${h(c.clinic.address)}` : ''}</p>
    <dl class="answers"><dt>Diagnoses</dt><dd>${h(c.diagnoses)}</dd><dt>Short-term goals</dt><dd>${h(c.shortTermGoals)}</dd><dt>Long-term goals</dt><dd>${h(c.longTermGoals)}</dd>
    <dt>Frequency and duration</dt><dd>${h(frequency(c))}, starting ${h(usDate(c.startDate))}</dd><dt>Certification period</dt><dd>${h(usDate(c.startDate))} to ${h(usDate(c.certifiedThrough))}</dd><dt>Planned interventions</dt><dd>${h(c.interventions)}</dd></dl>
    <p>Signed by the treating therapist <strong>${h(c.therapist.name)}, ${h(c.therapist.credentials)}</strong>.</p></section>
    <section class="panel"><h2>Sign</h2><form method="post" action=""><div class="pair"><label>Your full name<input name="name" required maxlength="160" autocomplete="name"></label><label>Credentials<input name="credentials" required maxlength="40" placeholder="MD, DO, NP or PA-C"></label></div>
    <label>NPI (optional)<input name="npi" inputmode="numeric" pattern="[0-9]{10}" maxlength="10"></label>
    <label class="check"><input type="checkbox" name="attest" value="on" required><span>I certify that these services are needed and are furnished under this plan of care while the patient is under my care.</span></label>
    <button type="submit">Sign plan of care</button></form><p class="help">Your name, credentials and the time are recorded on the patient's chart. To ask for changes, contact the clinic instead of signing.</p></section>`
}
