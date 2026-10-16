import { empty, entry, field, form, h, hidden, money, panel, rows, select, status, textarea } from './shared'

const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
const clock = (m: number) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`
const staffFields = (p?: any) => field('name', 'Full name', p?.name, 'text', 'required maxlength="160"') + field('email', 'Email', p?.email, 'email', 'required')
  + select('role', 'Role', [['practitioner', 'Practitioner'], ['reception', 'Reception']], p?.role ?? 'practitioner')
  + `<div class="pair">${field('profession', 'Profession (for invoices)', p?.profession ?? '', 'text', 'maxlength="80" placeholder="Physical Therapist"')}${field('providerNumber', 'Provider number (for invoices)', p?.provider_number ?? '', 'text', 'maxlength="40"')}</div>`
  + select('active', 'Status', [['true', 'Active'], ['false', 'Inactive']], p ? String(!!p.active) : 'true')

function hoursFor(s: any, p: any) {
  const mine = rows(s, 'hours').filter(w => w.practitioner_id === p.id)
  const json = JSON.stringify(mine.map(w => ({ weekday: w.weekday, start: clock(w.start_minute), end: clock(w.end_minute) })))
  const summary = mine.length ? `<ul class="plain">${mine.map(w => `<li>${days[w.weekday]} ${clock(w.start_minute)}–${clock(w.end_minute)}</li>`).join('')}</ul>` : '<p class="empty">No hours yet: nobody can book this practitioner.</p>'
  return summary + `<details><summary>Set weekly hours</summary>${form('hours.save', '/app/clinic', hidden('practitionerId', p.id) + textarea('hours', 'Weekly hours (JSON)', mine.length ? json : '[{"weekday":1,"start":"09:00","end":"17:00"},{"weekday":3,"start":"09:00","end":"17:00"}]', 'required spellcheck="false"') + '<p class="help">One entry per block: weekday 0 is Sunday, 1 is Monday … 6 is Saturday; start and end are 24-hour clinic times.</p>', 'Save hours')}</details>`
}

export function clinic(s: any) {
  const st = s.settings
  const settings = panel('Clinic details', form('settings.save', '/app/clinic', field('clinicName', 'Clinic name', st.clinic_name, 'text', 'required maxlength="120"') + field('timeZone', 'Time zone (IANA name)', st.time_zone, 'text', 'required maxlength="64"') + '<p class="help">For example America/New_York, America/Chicago, America/Denver, America/Los_Angeles. It cannot change after the first booking.</p>' + `<div class="pair">${field('abn', 'Tax ID (shown on invoices)', st.abn, 'text', 'maxlength="20"')}${select('bookingOpen', 'Online booking', [['true', 'Open'], ['false', 'Closed']], String(!!st.booking_open))}</div>` + field('address', 'Address (shown on invoices and reminders)', st.address, 'text', 'maxlength="300"'), 'Save clinic details'))
  const serviceList = rows(s, 'services').map(x => entry(x.name, `<p>${x.duration_minutes} min · ${money(x.price_cents)} ${x.active ? '' : status('Inactive')}</p><details><summary>Edit service</summary>${form('service.save', '/app/clinic', hidden('id', x.id) + serviceFields(x), 'Save service')}</details>`)).join('')
  const staff = rows(s, 'staff').map(p => entry(p.name, `<p>${status(p.active ? 'Active' : 'Inactive')} ${status(p.role)}<br>${h(p.email)}${p.profession ? `<br>${h(p.profession)}` : ''}${p.provider_number ? ` · provider ${h(p.provider_number)}` : ''}</p>${p.role === 'practitioner' ? hoursFor(s, p) : ''}`
    + `<details><summary>Edit staff member</summary>${form('staff.save', '/app/clinic', hidden('id', p.id) + hidden('version', p.version) + staffFields(p), 'Save staff member')}</details>`
    + (p.active && p.email.toLowerCase() !== s.actor.email.toLowerCase() ? form('staff.invite', '/app/clinic', hidden('id', p.id), 'Invite to sign in', true) : '')
    + `<details><summary>Erase staff member</summary><p>Only staff never invited and never used in clinic work can be erased. Deactivate anyone else to remove their access at once.</p>${form('staff.erase', '/app/clinic', hidden('id', p.id) + '<label class="check"><input type="checkbox" required><span>I understand this erases their personal details.</span></label>', 'Erase staff member', true)}</details>`)).join('')
  return `<h1>Clinic</h1><p>Your clinic details, services, staff and practitioner hours. Add yourself as a practitioner with your own sign-in email if you treat clients.</p><div class="grid">${settings}${panel('Services', (serviceList || empty('No services yet.')) + `<details${serviceList ? '' : ' open'}><summary>Add a service</summary>${form('service.save', '/app/clinic', serviceFields(), 'Add service')}</details>`)}${panel('Staff', (staff || empty('No staff yet.')) + `<details${staff ? '' : ' open'}><summary>Add a staff member</summary>${form('staff.save', '/app/clinic', staffFields(), 'Add staff member')}</details>`, 'full')}</div>`
}

function serviceFields(x?: any) {
  return field('name', 'Service name', x?.name, 'text', 'required maxlength="120" placeholder="Initial evaluation"') + `<div class="pair">${field('durationMinutes', 'Length (minutes)', x?.duration_minutes ?? 60, 'number', 'required min="5" max="480" step="5"')}${field('priceCents', 'Price in cents', x?.price_cents ?? '', 'number', 'required min="0" step="1"')}</div>` + select('active', 'Status', [['true', 'Active'], ['false', 'Inactive']], x ? String(!!x.active) : 'true')
}
