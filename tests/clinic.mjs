// Shared clinic setup for the public-door tests.
import assert from 'node:assert/strict'

const brisbane = t => new Date(t + 10 * 3600_000).toISOString() // Australia/Brisbane has no daylight saving.
const allWeek = [0, 1, 2, 3, 4, 5, 6].map(weekday => ({ weekday, start: '00:00', end: '24:00' }))

/** A clinic with one service and the named practitioners, open every day. */
export async function clinic(h, names = ['Priya']) {
  await h.cmd('settings.save', { clinicName: 'Riverside Physio', timeZone: 'Australia/Brisbane', taxId: '12-3456789', address: '1 River St, Brisbane QLD' })
  const service = await h.cmd('service.save', { name: 'Initial consultation', durationMinutes: 45, priceCents: 9500 })
  const practitioners = []
  for (const name of names) {
    const p = await h.staff(name, 'practitioner', { discipline: 'pt', profession: 'Physiotherapist', providerNumber: '2' + name.length + '34567A' })
    await h.cmd('hours.save', { practitionerId: p.id, hours: allWeek })
    practitioners.push(p)
  }
  return { service, practitioners }
}
/** Slots offered on the public booking page, read from its own links. */
export async function slots(h, serviceId, practitionerId) {
  const from = brisbane(Date.now() + 2 * 86400_000).slice(0, 10)
  const page = await h.send(`/book?serviceId=${serviceId}&practitionerId=${practitionerId}&from=${from}`)
  assert.equal(page.status, 200)
  return [...page.text.matchAll(/start=([0-9T%A-Z.-]+Z)/g)].map(m => decodeURIComponent(m[1]))
}
export async function bookOnline(h, serviceId, practitionerId, start, client = {}) {
  const fields = { serviceId, practitionerId, start, firstName: 'Maya', lastName: 'Lee', dateOfBirth: '1988-04-02', email: 'maya@client.example', phone: '(312) 555-0100', privacy: 'on', ...client }
  return h.form('/book', fields)
}
/** A staff booking that has already started, so it can be marked attended. */
export async function pastVisit(h, clientId, practitioner, serviceId, cookie = h.owner, hoursAgo = 2, extra = {}) {
  // Count back only through 01:00-21:59 clinic hours, so distinct hoursAgo stay distinct and in order at any time of day.
  const late = t => +brisbane(t).slice(11, 13) < 1 || +brisbane(t).slice(11, 13) > 21
  let t = Math.floor(Date.now() / 900_000) * 900_000, left = hoursAgo
  while (left > 0 || late(t)) { t -= 3600_000; if (!late(t)) left-- }
  const local = brisbane(t)
  const booked = await h.cmd('appointment.book', { clientId, practitionerId: practitioner.id, serviceId, date: local.slice(0, 10), time: local.slice(11, 16), ...extra }, cookie)
  return booked.appointmentId
}
/** The clinic's date of a visit: a visit from just before midnight is on yesterday's schedule, not today's. */
export async function visitDate(h, visitId, cookie = h.owner) {
  const visit = (await h.state(cookie)).appointments.find(a => a.id === visitId)
  return brisbane(Date.parse(visit.start_at)).slice(0, 10)
}
