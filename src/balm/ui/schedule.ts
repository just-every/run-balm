import { desk, empty, entry, form, h, hidden, owner, panel, practitioners, rows, services, status } from './shared'

function setupChecklist(s: any) {
  const steps: [boolean, string][] = [
    [s.settings.clinic_name !== 'My clinic', 'Name your clinic and confirm its time zone in <a href="/app/clinic">Clinic</a>.'],
    [services(s).length > 0, 'Add at least one service with its length and price in <a href="/app/clinic">Clinic</a>.'],
    [practitioners(s).length > 0, 'Add a practitioner (yourself too, if you treat clients) in <a href="/app/clinic">Clinic</a>.'],
    [rows(s, 'hours').length > 0, 'Set each practitioner’s weekly hours in <a href="/app/clinic">Clinic</a>.'],
  ]
  if (steps.every(([done]) => done)) return ''
  return panel('Finish setting up', `<ol class="steps">${steps.map(([done, text]) => `<li${done ? ' class="done"' : ''}>${done ? '<span class="status">Done</span> ' : ''}${text}</li>`).join('')}</ol><p>Then share your booking page: <a href="/book">/book</a> on this app’s address.</p>`, 'full')
}

export function schedule(s: any) {
  const zone = s.settings.time_zone, mine = s.actor.staffId
  const dayOf = (iso: string) => new Intl.DateTimeFormat('en-US', { timeZone: zone, weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }).format(new Date(iso))
  const byDay = new Map<string, any[]>()
  for (const a of rows(s, 'appointments')) byDay.set(dayOf(a.start_at), [...(byDay.get(dayOf(a.start_at)) ?? []), a])
  const actions = (a: any) => {
    if (a.status !== 'booked' || !(desk(s) || a.practitioner_id === mine)) return ''
    const started = Date.parse(a.start_at) <= Date.now() + 3600_000
    return `<div class="actions">${started ? form('appointment.attend', '/app', hidden('id', a.id), 'Mark attended') + form('appointment.no_show', '/app', hidden('id', a.id), 'Did not attend', true) : ''}${form('appointment.cancel', '/app', hidden('id', a.id), 'Cancel appointment', true)}</div>`
  }
  const list = [...byDay].map(([label, items]) => `<h3 class="day">${h(label)}</h3>${items.map(a => entry(`${new Intl.DateTimeFormat('en-US', { timeZone: zone, hour: 'numeric', minute: '2-digit' }).format(new Date(a.start_at))} · ${a.client}`,
    `<p>${h(a.service)} with ${h(a.practitioner)}<br>${status(a.status)} ${a.intake_received ? status('Intake received') : status('Intake not yet received')} ${a.booked_via === 'online' ? status('Booked online') : ''}</p><p><a href="/app/clients/${h(a.client_id)}">Open client file</a></p>${actions(a)}`)).join('')}`).join('')
  const intro = owner(s) ? `<p>Upcoming and recent appointments for the whole clinic. Times are in ${h(zone)}. Your public booking page is <a href="/book">/book</a>.</p>`
    : desk(s) ? `<p>All appointments, in ${h(zone)}. Clinical notes and intake answers stay with practitioners.</p>` : `<p>Your appointments, in ${h(zone)}.</p>`
  return `<h1>Schedule</h1>${intro}<div class="grid">${owner(s) ? setupChecklist(s) : ''}${panel('Appointments', list || empty('No appointments yet. Clients book at /book, or open a client file to book for them.'), 'full')}</div>`
}

