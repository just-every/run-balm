// The two pages a client sees: online booking and the private intake link.
import { coverageFields, estimateNotice } from './estimates'
import { localTime } from '../domain/invoices'
import { h, money, usDate } from './shared'
import { frequency } from './plans'
import { zoneLabel } from './time-zone'
import { intakePatientEnhancement, patientSignature } from './intake-patient'

const option = (value: unknown, label: unknown, current: unknown) => `<option value="${h(value)}" ${value === current ? 'selected' : ''}>${h(label)}</option>`

export function bookPage(d: any) {
  if (!d.clinic?.time_zone) return '<h1>Online booking is not open yet</h1><p>The clinic is still setting up online booking. Please contact the clinic to make an appointment.</p>'
  if (!d.clinic?.booking_open) return '<h1>Online booking is closed</h1><p>Please contact the clinic to make an appointment.</p>'
  if (!d.services.length || !d.practitioners.length) return '<h1>Online booking is not set up yet</h1><p>The clinic has not published services and practitioners for online booking. Please contact the clinic.</p>'
  const p = d.params ?? {}, zone = d.slots?.timeZone ?? d.clinic.time_zone
  if (p.booked === '1') return `<h1>You're booked.</h1><p>${p.intake === 'link_open' ? 'Please use your existing private intake link before your visit.' : 'Your current intake form is already on file. No new intake form is needed.'}</p><p><a href="/book">Book another appointment</a></p>`
  const chooser = `<section class="panel"><h2>1. Choose a service and practitioner</h2><form method="get" action="/book">
    <label>Service<select name="serviceId" required><option value="">Choose a service</option>${d.services.map((s: any) => option(s.id, `${s.name} · ${s.duration_minutes} min · ${money(s.price_cents)}`, p.serviceId)).join('')}</select></label>
    <label>Practitioner<select name="practitionerId" required><option value="">Choose a practitioner</option>${d.practitioners.map((s: any) => option(s.id, s.profession ? `${s.name} (${s.profession})` : s.name, p.practitionerId)).join('')}</select></label>
    ${d.rooms?.length?`<label>Location / room<select name="roomId"><option value="">No location selected</option>${d.rooms.map((r:any)=>option(r.id,r.location+' · '+r.name,p.roomId)).join('')}</select></label>`:''}
    <label>From date<input type="date" name="from" value="${h(p.from ?? '')}"></label><button type="submit">Show available times</button></form></section>`
  let times = ''
  if (d.slots && !d.retime) {
    const byDay = new Map<string, any[]>()
    for (const slot of d.slots.slots) byDay.set(slot.hostDate, [...(byDay.get(slot.hostDate) ?? []), slot])
    const link = (start: string) => `/book?${new URLSearchParams({ serviceId: p.serviceId, practitionerId: p.practitionerId, roomId:p.roomId??'', from: d.slots.from, start })}`
    times = `<section class="panel"><h2>2. Choose a time</h2><p>Times are in the appointment location’s time zone: ${h(zoneLabel(zone))}.</p>${byDay.size ? [...byDay].map(([day, slots]) => `<h3>${h(new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', weekday: 'long', day: 'numeric', month: 'long' }).format(new Date(day + 'T00:00:00Z')))}</h3><div class="slots">${slots.map(s => `<a class="slot${s.startAt === p.start ? ' chosen' : ''}" href="${h(link(s.startAt))}">${h(new Intl.DateTimeFormat('en-US', { timeZone: zone, hour: 'numeric', minute: '2-digit' }).format(new Date(s.startAt)))}</a>`).join('')}</div>`).join('') : '<p class="empty">No times are available this week.</p>'}
      <p><a href="/book?${h(new URLSearchParams({ serviceId: p.serviceId, practitionerId: p.practitionerId, roomId:p.roomId??'', from: d.slots.next }))}">Show the next week</a></p></section>`
  }
  // After a refusal the patient's typed details come back filled in; a taken time is swapped for a list of open times.
  const typed = d.typed ?? {}, value = (name: string) => h(typed[name] ?? '')
  const retime = d.retime && d.slots
  const timeChoice = retime ? (d.slots.slots.length
    ? `<label>Time<select name="start" required><option value="">Choose another time</option>${d.slots.slots.map((s: any) => option(s.startAt, localTime(s.startAt, zone), '')).join('')}</select></label>`
    : '<p class="empty">No other times are open this week. Choose another week above; your details stay here.</p>')
    : `<input type="hidden" name="start" value="${h(p.start)}">`
  const heading = retime ? `<p>Booking <strong>${h(d.slots.service.name)}</strong> with <strong>${h(d.slots.practitioner.name)}</strong>.</p>`
    : `<p>Booking <strong>${h(d.slots?.service.name)}</strong> with <strong>${h(d.slots?.practitioner.name)}</strong> on <strong>${h(p.start ? localTime(p.start, zone) : '')}</strong>.</p>`
  const details = (p.start || retime) && d.slots ? `<section class="panel" id="details"><h2>3. Your details</h2>${heading}
    <form method="post" action="/book#details" target="_top"><input type="hidden" name="roomId" value="${h(p.roomId??'')}"><input type="hidden" name="serviceId" value="${h(p.serviceId)}"><input type="hidden" name="practitionerId" value="${h(p.practitionerId)}">${timeChoice}
    <div class="pair"><label>First name<input name="firstName" required maxlength="80" autocomplete="given-name" value="${value('firstName')}"></label><label>Last name<input name="lastName" required maxlength="80" autocomplete="family-name" value="${value('lastName')}"></label></div>
    <div class="pair"><label>Date of birth<input type="date" name="dateOfBirth" required autocomplete="bday" value="${value('dateOfBirth')}"></label><label>Mobile (optional)<input name="phone" type="tel" placeholder="+1 (312) 555-0100" maxlength="40" autocomplete="tel" value="${value('phone')}"></label></div>
    <label>Email<input type="email" name="email" required maxlength="254" autocomplete="email" value="${value('email')}"></label>
    ${coverageFields(typed)}
    <label class="trap" aria-hidden="true">Website<input name="website" tabindex="-1" autocomplete="off"></label>
    <label class="check"><input type="checkbox" name="privacy" value="on" required${typed.privacy === 'on' ? ' checked' : ''}><span>I agree that ${h(d.clinic.clinic_name)} keeps my details and health information in its own clinic records to provide my care.</span></label>
    <button type="submit">Book this appointment</button></form><p class="help">Next you will get a private link to your intake form.</p></section>` : ''
  return `${estimateNotice}<h1>Book an appointment</h1><p>New and returning clients can book online. Use the same name, date of birth and email to continue your existing patient file. New clients complete intake before their first visit.</p>${chooser}${times}${details}`
}

function question(q: any) {
  const name = 'q_' + q.id, req = q.required ? ' required' : '', label = h(q.label) + (q.required ? '' : ' <span class="help">(optional)</span>')
  if(q.type==='number')return `<label>${label}<input name="${h(name)}" type="number" min="${q.min}" max="${q.max}" step="1"${req}><span class="help">Whole number ${q.min}–${q.max} from the questionnaire supplied by your clinic.</span></label>`
  if (q.type === 'yes') return `<label class="check"><input type="checkbox" name="${h(name)}" value="yes"${req}><span>${label}</span></label>`
  if (q.type === 'long') return `<label>${label}<textarea name="${h(name)}" maxlength="5000"${req}></textarea></label>`
  return `<label>${label}<input name="${h(name)}" type="${q.type === 'date' ? 'date' : 'text'}" maxlength="300"${req}></label>`
}

export function intakePage(d: any) {
  const a = d.appointment, when = localTime(a.start_at, a.time_zone)
  const booked = d.booked ? `<div class="notice" role="status"><strong>You're booked.</strong> ${h(a.service_name)} with ${h(a.practitioner_name)} on ${h(when)}. ${d.mail === 'sent' ? 'We emailed you this private link.' : 'Keep this page’s address: it is your private link to the form.'}</div>` : ''
  if (d.submittedAt) return `${booked}<h1>Thank you, ${h(a.first_name)}</h1><p>${h(a.clinic_name)} received your intake form on ${h(localTime(d.submittedAt, a.time_zone))}. Your practitioner will read it before your visit.</p><p>Appointment: ${h(a.service_name)} with ${h(a.practitioner_name)}, ${h(when)}.</p>`
  return `${booked}<h1>Intake form</h1><p>Hello ${h(a.first_name)}. Please complete this before your ${h(a.service_name)} appointment with ${h(a.practitioner_name)} on ${h(when)}. Only your treating practitioner and the clinic owner can read your answers.</p>
    <section class="panel"><h2>${h(d.form.title)}</h2><form method="post" enctype="multipart/form-data" action=""><input type="hidden" name="formId" value="${h(d.form.id)}">${d.form.questions.map(question).join('')}${intakePatientEnhancement(d)}<button type="submit">Send my intake form</button></form></section>`
}

export function offerPage(d: any) {
  const o = d.offer, when = localTime(o.start_at, o.time_zone), what = `${h(o.service)} with ${h(o.practitioner)} on ${h(when)}`
  if (d.state === 'yours') return `<h1>You're booked, ${h(o.first_name)}</h1><p>${what}.</p><p>${o.intake_on_file ? 'Your intake form is already on file. No new form is needed.' : o.intake_requested ? 'Please complete your intake form using your private intake link before the visit.' : 'You already have an open intake link. Please complete that form before the visit.'}</p>`
  if (d.state === 'taken') return `<h1>This time has been taken</h1><p>Sorry, ${h(o.first_name)}: someone else on the waitlist accepted ${what} first. You are still on ${h(o.clinic_name)}'s waitlist, and we will email you when another time opens up.</p>`
  if (d.state === 'past') return `<h1>This offer has closed</h1><p>${what} is too close to book from the waitlist now. You are still on the waitlist.</p>`
  return `<h1>A time opened up</h1><p>Hello ${h(o.first_name)}. ${h(o.clinic_name)} has a time for you: <strong>${what}</strong>.</p><p>It was offered to everyone waiting for it, and the first person to accept gets it.</p>
    <form method="post" action=""><button type="submit">Book this time</button></form>`
}

/** Balm on this computer: a sign-in or invitation link opens only in a browser that already opened Balm with rer's link. */
export const localLinkPage = () => `<h1>Open this link in a browser that already has Balm open</h1><p>This copy of Balm runs on this computer only. To keep other programs out, a sign-in or invitation link works only in a browser that first opened Balm with the link <code>rer dev</code> prints. The link itself is fine.</p>
  <h2>To sign in as the invited person</h2><ol class="steps"><li>In the Balm folder, run <code>rer dev --as person@example.com</code>, with the email the invitation went to in place of person@example.com.</li><li>Open the <code>RER_OPEN</code> link it prints, in this browser. Balm opens signed in as that person.</li></ol>
  <p>To use this invitation link instead, open the owner’s <code>RER_OPEN</code> link in this browser once, sign out, then open the invitation link again. Once Balm is hosted, invitation emails open in any browser.</p>`

/** A signed-in person Balm refuses outright, such as staff the owner set inactive. */
export const refusedPage = (d: any) => `<h1>You can’t open Balm right now</h1><p>${h(d.reason)}</p>`
export const missingPage = () => '<h1>This link is not available</h1><p>The link may be mistyped, or the appointment was canceled. Please contact the clinic.</p>'

/** The referring physician's page: read the plan of care and sign it, no account needed. */
export function planPage(d: any) {
  if (d.status === 'certified') return `<h1>Plan of care signed</h1><p>Thank you, ${h(d.certifierName)}. You signed this plan of care on ${h(usDate(d.certifiedAt, d.timeZone))}. The clinic has your certification; you can close this page.</p>`
  const c = d.content
  return `<h1>Plan of care to sign</h1><p>${h(c.clinic.name)} asks you, ${h(d.physicianName)}, to review and certify this therapy plan of care.</p>
    <section class="panel"><h2>${h(c.patient.name)}</h2><p>${c.patient.dateOfBirth ? `Date of birth ${h(usDate(c.patient.dateOfBirth, d.timeZone))}<br>` : ''}${h(c.clinic.name)}${c.clinic.address ? ` · ${h(c.clinic.address)}` : ''}</p>
    <dl class="answers"><dt>Diagnoses</dt><dd>${h(c.diagnoses)}</dd><dt>Short-term goals</dt><dd>${h(c.shortTermGoals)}</dd><dt>Long-term goals</dt><dd>${h(c.longTermGoals)}</dd>
    <dt>Frequency and duration</dt><dd>${h(frequency(c))}, starting ${h(usDate(c.startDate, d.timeZone))}</dd><dt>Certification period</dt><dd>${h(usDate(c.startDate, d.timeZone))} to ${h(usDate(c.certifiedThrough, d.timeZone))}</dd><dt>Planned interventions</dt><dd>${h(c.interventions)}</dd></dl>
    <p>Signed by the treating therapist <strong>${h(c.therapist.name)}, ${h(c.therapist.credentials)}</strong>.</p></section>
    <section class="panel"><h2>Sign</h2><form method="post" action=""><div class="pair"><label>Your full name<input name="name" required maxlength="160" autocomplete="name"></label><label>Credentials<input name="credentials" required maxlength="40" placeholder="MD, DO, NP or PA-C"></label></div>
    <label>NPI (optional)<input name="npi" inputmode="numeric" pattern="[0-9]{10}" maxlength="10"></label>
    <label class="check"><input type="checkbox" name="attest" value="on" required><span>I certify that these services are needed and are furnished under this plan of care while the patient is under my care.</span></label>
    <button type="submit">Sign plan of care</button></form><p class="help">Your name, credentials and the time are recorded on the patient's chart. To ask for changes, contact the clinic instead of signing.</p></section>`
}

export function consentPage(d: any) {
  return `<h1>${d.policies.length ? 'Documents to review' : 'Your documents are up to date'}</h1><p>Hello ${h(d.appointment.first_name)}. ${h(d.appointment.clinic_name)} ${d.policies.length ? 'asks you to review only the new or updated documents below.' : 'has your decisions. Thank you.'}</p>`
    + (d.policies.length ? `<section class="panel"><form method="post">${patientSignature(d.policies)}<button type="submit">Sign accepted documents</button></form></section>` : '')
}
